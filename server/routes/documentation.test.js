const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerDocumentationRoutes } = require("./documentation");
const { request } = require("./test-http-harness");

function makeFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-docs-"));
  const docsApp = path.join(rootDir, "docs", "app");
  fs.mkdirSync(path.join(docsApp, "get-started"), { recursive: true });
  fs.mkdirSync(path.join(docsApp, "connectors"), { recursive: true });
  fs.mkdirSync(path.join(docsApp, "module"), { recursive: true });
  fs.writeFileSync(path.join(docsApp, "get-started", "introduccion.md"), "# Bienvenido\n\nHola.");
  fs.writeFileSync(path.join(docsApp, "get-started", "introduccion.es.md"), "# Bienvenido\n\nHola en español.");
  fs.writeFileSync(path.join(docsApp, "connectors", "gitlab.md"), "sin heading");
  fs.writeFileSync(path.join(docsApp, "connectors", "introduccion.md"), "# Connectors\n\nOverview.");
  fs.mkdirSync(path.join(docsApp, "connectors", "community"), { recursive: true });
  fs.writeFileSync(path.join(docsApp, "connectors", "community", "anthropic.md"), "# Anthropic\n\nDetail.");
  fs.writeFileSync(path.join(docsApp, "module", "introduccion.md"), "# Boards\n\nContent.");
  fs.mkdirSync(path.join(docsApp, "ssh"), { recursive: true });
  fs.writeFileSync(path.join(docsApp, "ssh", "introduccion.md"), "# SSH\n\nTerminals.");
  return rootDir;
}
// A connector installed outside the repository. Its README is the page, docs/
// holds anything further, and a folder with neither contributes nothing.
function makeInstalled() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-installed-"));
  fs.mkdirSync(path.join(dir, "acme", "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "acme", "README.md"), "# Acme\n\nInstalled page.");
  fs.writeFileSync(path.join(dir, "acme", "README.es.md"), "# Acme\n\nPagina instalada.");
  fs.writeFileSync(path.join(dir, "acme", "docs", "internals.md"), "# Internals\n\nWhy it is like this.");
  // Codigo junto a la documentacion: el arbol no debe entrar aqui.
  fs.mkdirSync(path.join(dir, "acme", "fixtures"), { recursive: true });
  fs.writeFileSync(path.join(dir, "acme", "fixtures", "sample.md"), "# Fixture");
  fs.writeFileSync(path.join(dir, "acme", "manifest.json"), JSON.stringify({ displayName: "Acme SCM" }));
  fs.mkdirSync(path.join(dir, "quiet"), { recursive: true });
  fs.writeFileSync(path.join(dir, "quiet", "manifest.json"), "{}");
  // Sits beside the connectors directory: a traversal out of it must not reach.
  fs.writeFileSync(path.join(dir, "secret.md"), "# nope");
  return dir;
}

// Sin conectores instalados salvo que la prueba pida lo contrario. El valor por
// defecto de la ruta es el directorio real del usuario, asi que heredarlo aqui
// haria que estas pruebas describieran la maquina de quien las corre.
function setup({ connectorsDir = path.join(os.tmpdir(), "lintaya-nothing-installed") } = {}) {
  const rootDir = makeFixture();
  const app = createApp({ token: "test-token" });
  registerDocumentationRoutes({ app, requireAuth, rootDir, AppError, sendAppError, connectorsDir });
  const headers = { authorization: "Bearer test-token" };
  return { app, headers, rootDir };
}

test("an installed connector's docs live inside Connectors, under their own folder", async () => {
  // Inside Connectors because that is where someone looks for them, and grouped
  // rather than loose because they still came with the connector and not with
  // Lintaya — visible without moving them out of where they belong.
  const { app, headers } = setup({ connectorsDir: makeInstalled() });
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  const connectors = res.json().sections.find(s => s.name === "connectors");

  const installed = connectors.children.find(c => c.name === "installed");
  assert.ok(installed, "grouped under Connectors, not a section of its own");
  assert.equal(installed.installed, true);
  assert.equal(connectors.children.at(-1).name, "installed", "after the pages Lintaya ships");

  const acme = installed.children.find(c => c.name === "installed/acme");
  assert.equal(acme.label, "Acme SCM", "the connector names itself; title-casing the folder would say \"Acme\"");
  assert.equal(acme.children[0].path, "installed/acme/README.md", "the README is the page, and it leads");
  assert.equal(acme.children[0].spanishPath, "installed/acme/README.es.md");
  assert.ok(acme.children.some(c => c.name === "docs"), "docs/ carries whatever else it has");
  assert.equal(acme.children.some(c => c.name === "fixtures"), false, "the tree does not wander into the connector's code");
  assert.equal(installed.children.some(c => c.name === "installed/quiet"), false, "a connector with no documentation contributes nothing");
});

test("a page from an installed connector is served", async () => {
  const { app, headers } = setup({ connectorsDir: makeInstalled() });
  const readme = await request(app, "GET", "/api/documentation/file?path=installed/acme/README.md", { headers });
  assert.equal(readme.status, 200);
  assert.match(readme.json().content, /Installed page/);

  const deeper = await request(app, "GET", "/api/documentation/file?path=installed/acme/docs/internals.md", { headers });
  assert.equal(deeper.status, 200);
  assert.match(deeper.json().content, /Why it is like this/);
});

test("the installed prefix cannot be used to escape its connector", async () => {
  // The prefix is stripped before resolving, so traversal is checked against
  // the directory it actually lands in and not the one it claimed.
  const { app, headers } = setup({ connectorsDir: makeInstalled() });
  for (const attempt of [
    "installed/acme/../../secret.md",
    "installed/../secret.md",
    "installed/acme/../../../etc/passwd.md",
  ]) {
    const res = await request(app, "GET", `/api/documentation/file?path=${encodeURIComponent(attempt)}`, { headers });
    assert.notEqual(res.status, 200, `${attempt} must not be served`);
  }
});

test("no installed directory is the normal case, not an error", async () => {
  const { app, headers } = setup({ connectorsDir: path.join(os.tmpdir(), "lintaya-nothing-installed") });
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  assert.equal(res.status, 200);
  const connectors = res.json().sections.find(s => s.name === "connectors");
  assert.equal(connectors.children.some(c => c.installed), false);
});

test("GET /api/documentation/tree puts get-started first and humanizes labels", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  assert.equal(res.status, 200);
  const sections = res.json().sections;
  assert.equal(sections[0].name, "get-started");
  const file = sections[0].children.find(c => c.name === "introduccion.md");
  assert.equal(file.label, "Bienvenido", "the file's own H1 heading wins over the humanized filename");
  assert.equal(file.spanishPath, "get-started/introduccion.es.md");
  assert.equal(sections[0].children.some(c => c.name === "introduccion.es.md"), false, "translation is not a duplicate tree entry");
});

test("GET /api/documentation/tree presents Module Builder documentation as Boards", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  const moduleSection = res.json().sections.find(section => section.name === "module");
  assert.equal(moduleSection.label, "Boards");
});

test("GET /api/documentation/tree keeps an acronym folder uppercase", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  const sshSection = res.json().sections.find(section => section.name === "ssh");
  // Title-casing the folder name alone would label this tab "Ssh".
  assert.equal(sshSection.label, "SSH");
});

test("GET /api/documentation/tree falls back to a humanized name when there's no H1", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  const connectors = res.json().sections.find(s => s.name === "connectors");
  const file = connectors.children.find(c => c.name === "gitlab.md");
  assert.equal(file.label, "Gitlab");
});

test("GET /api/documentation/tree puts a section's own pages before its subfolders", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/tree", { headers });
  const connectors = res.json().sections.find(s => s.name === "connectors");
  // Folders sort before files unconditionally otherwise (see buildDocsAppTree),
  // which buries both the landing page and anything else written about the
  // section as a whole below every per-topic subfolder.
  assert.deepEqual(connectors.children.map(c => c.name), ["introduccion.md", "gitlab.md", "community"]);
});

test("GET /api/documentation/tree returns an empty section list when docs/app doesn't exist", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-docs-empty-"));
  const app = createApp({ token: "test-token" });
  // connectorsDir explicito: por defecto apunta al directorio real del usuario,
  // asi que sin esto la prueba describiria los conectores que tenga instalados
  // quien la corre en vez de un arbol vacio.
  registerDocumentationRoutes({
    app, requireAuth, rootDir, AppError, sendAppError,
    connectorsDir: path.join(os.tmpdir(), "lintaya-nothing-installed"),
  });
  const res = await request(app, "GET", "/api/documentation/tree", { headers: { authorization: "Bearer test-token" } });
  assert.deepEqual(res.json(), { sections: [] });
});

test("GET /api/documentation/file returns the raw markdown for a valid path", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/file?path=get-started%2Fintroduccion.md", { headers });
  assert.equal(res.status, 200);
  assert.equal(res.json().content, "# Bienvenido\n\nHola.");
});

test("GET /api/documentation/file rejects a missing or non-.md path", async () => {
  const { app, headers } = setup();
  const noPath = await request(app, "GET", "/api/documentation/file", { headers });
  assert.equal(noPath.status, 400);

  const badExt = await request(app, "GET", "/api/documentation/file?path=get-started%2Fintroduccion.txt", { headers });
  assert.equal(badExt.status, 400);
});

test("GET /api/documentation/file blocks path traversal out of docs/app", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/file?path=..%2F..%2Fserver.js.md", { headers });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});

test("GET /api/documentation/file rejects a .md path that doesn't exist", async () => {
  // Pre-existing behavior, unchanged by this extraction: resolveInsideDocsApp
  // uses realpathSync, which throws ENOENT for a path that isn't there yet —
  // caught and treated the same as "outside docs/app" (400), not a 404. The
  // statSync/ENOENT branch further down only fires in the narrow TOCTOU case
  // where the file existed during resolveInsideDocsApp and was removed after.
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/documentation/file?path=get-started%2Fnope.md", { headers });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});
