// Documentación interna: navegador de docs/app/ — carpeta versionada en el
// repo (get-started/, block/, module/, connectors/…).
const fs = require("node:fs");
const path = require("node:path");

// La misma ruta que escanea el registro de conectores, para que la
// documentacion de uno instalado salga de donde el propio conector vive.
const { userConnectorsDir } = require("../connectors/registry");

// Folder names are lowercase and hyphenated, and a few do not survive plain
// title-casing: "module" predates the Boards rename, and acronyms come back
// as "Ssh". Anything not listed here keeps its title-cased name.
const DOCS_APP_LABELS = { Module: "Boards", Ssh: "SSH", Cli: "CLI", Api: "API" };

function docsAppHumanize(name) {
  const label = name
    .replace(/^[0-9]+[-_.]?/, "")
    .replace(/\.mdx?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
  return DOCS_APP_LABELS[label] || label;
}

// A connector installed outside the repository ships its own page under
// <connector>/docs/. It is reached through this prefix, which keeps the two
// roots apart in every path the API accepts and makes the provenance obvious
// in the tree: a page that came with an installed connector says so.
const INSTALLED_PREFIX = "installed";

function registerDocumentationRoutes({
  app, requireAuth, rootDir, AppError, sendAppError,
  // Defaults to the same directory the connector registry scans. Injected so a
  // test can point it somewhere without an environment variable.
  connectorsDir = userConnectorsDir(),
}) {
  const DOCS_APP_DIR = path.join(rootDir, "docs", "app");

  // La carpeta del conector. Su README es la pagina principal y docs/ lo
  // adicional: README es donde alguien mira primero, aqui y en GitHub, asi
  // que ahi va lo que explica el conector y no las notas de mantenimiento.
  function installedConnectorDir(connectorId) {
    if (!connectorId || connectorId.includes("/") || connectorId.includes("\\") || connectorId.startsWith(".")) return null;
    const dir = path.join(connectorsDir, connectorId);
    return fs.existsSync(path.join(dir, "README.md")) || fs.existsSync(path.join(dir, "docs")) ? dir : null;
  }

  // El nombre que el conector se da a si mismo. Title-casear la carpeta deja
  // "Vcenter" donde el manifiesto ya dice "VMware vCenter".
  function installedLabel(connectorId) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(connectorsDir, connectorId, "manifest.json"), "utf8"));
      if (manifest?.displayName) return String(manifest.displayName);
    } catch { /* sin manifiesto legible, la carpeta sirve */ }
    return docsAppHumanize(connectorId);
  }

  function installedConnectorsWithDocs() {
    if (!connectorsDir || !fs.existsSync(connectorsDir)) return [];
    return fs.readdirSync(connectorsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "docs")
      .filter(entry => installedConnectorDir(entry.name))
      .map(entry => entry.name)
      .sort();
  }

  // Igual que resolveInsideClone: evita que ?path=../../secreto escape de docs/app.
  function resolveInsideRoot(rootDirAbs, relativePath) {
    // Una raiz que no existe es normal, no un error: la mayoria de las
    // instalaciones no tiene conectores instalados ni paginas propias del pack.
    if (!fs.existsSync(rootDirAbs)) return null;
    const rootAbs = fs.realpathSync(rootDirAbs);
    const target = path.resolve(rootAbs, relativePath || "");
    const withSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (target !== rootAbs && !target.startsWith(withSep)) return null;
    try {
      const real = fs.realpathSync(target);
      if (real !== rootAbs && !real.startsWith(withSep)) return null;
      return real;
    } catch {
      return null;
    }
  }

  // Resolves a requested path against whichever root owns it. The prefix is
  // stripped here and nowhere else, so a traversal attempt is checked against
  // the root it actually lands in rather than the one it claimed.
  function resolveDocPath(relativePath) {
    const rel = String(relativePath || "").split("\\").join("/");
    if (!rel.startsWith(INSTALLED_PREFIX + "/")) return resolveInsideRoot(DOCS_APP_DIR, rel);
    const [, first, ...rest] = rel.split("/");
    // Una pagina del propio pack: installed/<archivo>. Vive en <dir>/docs y
    // no pertenece a ningun conector.
    if (rest.length === 0) return resolveInsideRoot(path.join(connectorsDir, "docs"), first);
    const dir = installedConnectorDir(first);
    if (!dir) return null;
    return resolveInsideRoot(dir, rest.join("/"));
  }

  // `onlyDirs` acota qué subcarpetas se recorren en ESTE nivel. La carpeta de
  // un conector es codigo con documentacion dentro, no una carpeta de docs: sin
  // esto el arbol entraria a fixtures, node_modules o lo que hubiera.
  function buildDocsAppTree(dirAbs, relBase, onlyDirs = null) {
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    const folders = [];
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (onlyDirs && !onlyDirs.includes(entry.name)) continue;
        folders.push({
          type: "folder", name: entry.name, label: docsAppHumanize(entry.name), path: rel,
          children: buildDocsAppTree(path.join(dirAbs, entry.name), rel),
        });
      } else if (/\.mdx?$/i.test(entry.name) && !/\.es\.mdx?$/i.test(entry.name)) {
        let title = docsAppHumanize(entry.name);
        try {
          const heading = fs.readFileSync(path.join(dirAbs, entry.name), "utf8").match(/^#\s+(.+)$/m);
          if (heading) title = heading[1].trim();
        } catch {}
        const extension = path.extname(entry.name);
        const spanishName = `${entry.name.slice(0, -extension.length)}.es${extension}`;
        const spanishPath = path.join(dirAbs, spanishName);
        files.push({
          type: "file", name: entry.name, label: title, path: rel,
          spanishPath: fs.existsSync(spanishPath)
            ? (relBase ? `${relBase}/${spanishName}` : spanishName)
            : null,
        });
      }
    }
    folders.sort((a, b) => a.label.localeCompare(b.label));
    files.sort((a, b) => a.name.localeCompare(b.name));
    // A section's pages come before its subfolders, with its own landing page
    // (introduccion.md) leading. Sorting folders first unconditionally buries
    // both: the overview page and everything else written for the section as a
    // whole end up below every per-topic subfolder, which reads backwards —
    // "Create a connector" belongs next to "Connectors", not after the three
    // tier folders it is not about.
    const introIndex = files.findIndex(f => /^introduccion\.mdx?$/i.test(f.name));
    if (introIndex === -1) return [...files, ...folders];
    const [intro] = files.splice(introIndex, 1);
    return [intro, ...files, ...folders];
  }

  // La documentacion de un conector instalado vive dentro de Conectores, que
  // es donde alguien la busca, agrupada bajo una carpeta propia: siguen
  // viniendo con el conector y no con Lintaya, y esa diferencia se ve sin
  // sacarlas de su sitio.
  function installedDocsFolder() {
    const connectors = installedConnectorsWithDocs();
    // El propio pack puede traer paginas que no son de un conector concreto:
    // el indice de que trae, por ejemplo. Viven en <dir>/docs y encabezan el
    // grupo. Esa carpeta no se confunde con un conector porque el escaneo
    // busca <dir>/<id>/docs, y "docs/docs" no existe.
    const packDocs = fs.existsSync(path.join(connectorsDir, "docs"))
      ? buildDocsAppTree(path.join(connectorsDir, "docs"), INSTALLED_PREFIX)
      : [];
    if (connectors.length === 0 && packDocs.length === 0) return null;
    return {
      type: "folder", name: INSTALLED_PREFIX, label: "Installed connectors", path: INSTALLED_PREFIX,
      installed: true,
      children: [...packDocs, ...connectors.map((connectorId) => {
        const relBase = `${INSTALLED_PREFIX}/${connectorId}`;
        return {
          type: "folder", name: relBase, label: installedLabel(connectorId), path: relBase,
          installed: true,
          children: buildDocsAppTree(installedConnectorDir(connectorId), relBase, ["docs"]),
        };
      })],
    };
  }

  // GET → tabs de arriba (carpetas de primer nivel) con su árbol de archivos anidado.
  app.get("/api/documentation/tree", requireAuth, (req, res) => {
    if (!fs.existsSync(DOCS_APP_DIR)) return res.json({ sections: [] });
    const installed = installedDocsFolder();
    const sections = fs.readdirSync(DOCS_APP_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith("."))
      .map(e => ({
        type: "folder", name: e.name, label: docsAppHumanize(e.name), path: e.name,
        children: [
          ...buildDocsAppTree(path.join(DOCS_APP_DIR, e.name), e.name),
          // Al final de Conectores, despues de las paginas que Lintaya trae.
          ...(e.name === "connectors" && installed ? [installed] : []),
        ],
      }))
      // "Get started" siempre primero, como landing/onboarding — el resto alfabético.
      .sort((a, b) => (a.name === "get-started" ? -1 : b.name === "get-started" ? 1 : a.label.localeCompare(b.label)));
    res.json({ sections });
  });

  // GET ?path=get-started/introduccion.md → contenido crudo del .md
  app.get("/api/documentation/file", requireAuth, (req, res) => {
    const rel = req.query.path;
    if (!rel) return sendAppError(res, AppError.badRequest("path-required"), req);
    if (!/\.mdx?$/i.test(rel)) return sendAppError(res, AppError.badRequest("invalid-path"), req);
    const abs = resolveDocPath(rel);
    if (!abs) return sendAppError(res, AppError.badRequest("path-outside-docs"), req);
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return sendAppError(res, AppError.notFound("not-a-file"), req);
      res.json({ path: rel, content: fs.readFileSync(abs, "utf8") });
    } catch (err) {
      const missing = err.code === "ENOENT";
      sendAppError(res, missing ? AppError.notFound("file-not-found") : AppError.internal(err.message), req);
    }
  });
}

module.exports = { registerDocumentationRoutes };
