// Documentación — visor de docs/app/ (tabs de carpetas arriba, árbol a la izquierda,
// contenido markdown al centro, tabla de contenidos a la derecha).
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const dct = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

const DOCS_ACCENT_MAP = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" };

function docsSlugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, c => DOCS_ACCENT_MAP[c] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "seccion";
}

// Extrae headings h1-h3 del markdown crudo (ignorando los que caen dentro de ```
// fences) para armar la tabla de contenidos y los ids que se inyectan en el HTML
// renderizado — marked no agrega ids por su cuenta en esta versión.
function extractHeadings(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const headings = [];
  const seen = new Map();
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[`*_]/g, "").trim();
    let slug = docsSlugify(text);
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n + 1}`;
    headings.push({ level: m[1].length, text, slug });
  }
  return headings;
}

function renderDocMarkdown(raw, headings) {
  if (!window.marked) return `<p style='color:#dc2626'>${window.I18N.t("ui.documentation.markedFailed", "marked.js failed to load.")}</p>`;
  const content = String(raw || "").replace(/^(?:English \| \[Español\]\([^)]+\)|\[English\]\([^)]+\) \| Español)\r?\n?/m, "");
  const html = window.marked.parse(content);
  let i = 0;
  // Se inyecta HTML directo sin sandbox, a diferencia de repos.jsx que sí aísla
  // en iframe por venir de repositorios externos.
  //
  // La razón ya no es "estas docs están versionadas en el repo": desde ADR-014
  // Fase 3 también se sirven las de un conector instalado bajo
  // LINTAYA_CONNECTORS_DIR. La razón real es que ese conector ya corre su
  // index.js dentro del proceso del servidor, con acceso a la base y al secret
  // store — quien pueda dejar una carpeta ahí ya es dueño del servidor, así que
  // su markdown no abre una frontera de confianza que no estuviera cruzada.
  //
  // Lo que sí cambiaría esto es la Fase 4: si algún día un conector se instala
  // desde un índice remoto sin que nadie lo revise, este render deja de ser
  // defendible y hay que sanear o aislar lo que venga de fuera del repo.
  return html.replace(/<h([1-3])>/g, (match, level) => {
    const h = headings[i]; i++;
    return h ? `<h${level} id="${h.slug}">` : match;
  });
}

// Un folder no arranca colapsado si ya contiene el archivo activo (evita que
// abrir la sección entera "esconda" dónde estás parado); navegar a un archivo
// de otro folder cerrado lo vuelve a abrir automáticamente vía el useEffect
// de abajo, sin forzar cerrado el que el usuario haya abierto a mano.
function containsActiveFile(node, activeFile) {
  return node.type === "file"
    ? node.path === activeFile || node.spanishPath === activeFile
    : node.children.some(child => containsActiveFile(child, activeFile));
}

function DocsTreeNode({ node, depth, activeFile, onSelectFile }) {
  const isActiveHere = node.type === "file" && (activeFile === node.path || activeFile === node.spanishPath);
  const hasActiveChild = node.type === "folder" && containsActiveFile(node, activeFile);
  const [expanded, setExpanded] = useState(() => node.type === "folder" && hasActiveChild);
  useEffect(() => { if (hasActiveChild) setExpanded(true); }, [activeFile, hasActiveChild]);

  if (node.type === "file") {
    return (
      <button onClick={() => onSelectFile(node)} title={node.label} style={{
        display: "block", width: "100%", textAlign: "left", border: 0, cursor: "pointer",
        fontFamily: "inherit", padding: `6px 10px 6px ${10 + depth * 12}px`,
        background: isActiveHere ? "var(--muted)" : "transparent",
        color: isActiveHere ? "var(--accent)" : "var(--fg)",
        fontWeight: isActiveHere ? 600 : 400, fontSize: 12.5,
        borderLeft: isActiveHere ? "2px solid var(--accent)" : "2px solid transparent",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{node.label}</button>
    );
  }
  return (
    <div>
      <button onClick={() => setExpanded(e => !e)} title={node.label} style={{
        display: "flex", alignItems: "center", gap: 5, width: "100%", textAlign: "left",
        border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit",
        padding: `8px 10px 4px ${10 + depth * 12}px`, fontSize: 10.5, fontWeight: 700,
        color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: ".03em",
      }}>
        <span style={{
          display: "inline-block", fontSize: 8, transition: "transform .12s ease",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        }}>▶</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
      </button>
      {expanded && node.children.map(child => (
        <DocsTreeNode key={child.path} node={child} depth={depth + 1} activeFile={activeFile} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}

// Junta todos los archivos de una sección (recorriendo subcarpetas) en orden de árbol.
function flattenFiles(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.type === "file") out.push(node);
    else out.push(...flattenFiles(node.children));
  }
  return out;
}

function resolveInternalDocPath(href, activeFile, files) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null;
  try {
    const path = new URL(href, `https://lintaya.local/${activeFile}`).pathname.slice(1);
    return files.some(file => file.path === path || file.spanishPath === path) ? path : null;
  } catch {
    return null;
  }
}

function DocumentationView() {
  window.I18N?.useLocale();
  const [sections, setSections] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    window.HQ_API.request("/api/documentation/tree")
      .then(d => {
        const source = d.sections || [];
        const corePaths = ["devices", "block", "module", "dashboard", "ssh"];
        const overview = source.find(section => section.path === "lintaya");
        const lintaya = {
          type: "folder", name: "lintaya", path: "lintaya", label: "Lintaya",
          children: [
            ...(overview?.children || []),
            ...corePaths.flatMap(path => source.filter(section => section.path === path)),
          ],
        };
        const list = source.filter(section => section.path !== "lintaya" && !corePaths.includes(section.path));
        list.splice(list[0]?.path === "get-started" ? 1 : 0, 0, lintaya);
        // Add synthetic API section at the end
        list.push({
          path: "__api__",
          label: "API",
          children: [],
          isAPI: true
        });
        setSections(list);
        if (list.length) {
          setActiveSection(list[0].path);
          const firstFile = flattenFiles(list[0].children)[0];
          if (firstFile) setActiveFile(firstFile.path);
        }
      })
      .catch(() => setSections([]));
  }, []);

  const openSection = useCallback((section) => {
    setActiveSection(section.path);
    if (!section.isAPI) {
      const firstFile = flattenFiles(section.children)[0];
      setActiveFile(firstFile ? firstFile.path : null);
    } else {
      setActiveFile(null);
    }
  }, []);

  useEffect(() => {
    if (!activeFile) { setContent(""); return; }
    setLoading(true); setError(null);
    window.HQ_API.request(`/api/documentation/file?path=${encodeURIComponent(activeFile)}`)
      .then(d => setContent(d.content || ""))
      .catch(e => setError(e.message || "Error al cargar el documento"))
      .finally(() => setLoading(false));
  }, [activeFile]);

  const headings = useMemo(() => extractHeadings(content), [content]);
  const html = useMemo(() => renderDocMarkdown(content, headings), [content, headings]);
  const files = useMemo(() => sections
    ? sections.filter(section => !section.isAPI).flatMap(section => flattenFiles(section.children))
    : [], [sections]);
  const activeDocument = useMemo(() => files.find(file => file.path === activeFile || file.spanishPath === activeFile) || null,
    [files, activeFile]);

  const scrollToHeading = useCallback((slug) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(slug)}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Los .md pueden traer links relativos entre docs o al repo (../../app/blocks.jsx).
  // Sin esto, un click navega la pestaña entera fuera de la SPA y pierde el estado.
  const handleContentClick = useCallback((e) => {
    const a = e.target.closest && e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#")) { scrollToHeading(href.slice(1)); return; }
    const internalPath = resolveInternalDocPath(href, activeFile, files);
    if (internalPath) { setActiveFile(internalPath); return; }
    window.open(href, "_blank", "noopener");
  }, [activeFile, files, scrollToHeading]);

  const section = sections?.find(s => s.path === activeSection) || null;
  const isAPISection = section?.isAPI;

  if (sections === null) {
    return <div style={{ padding: 24, color: "var(--muted-fg)", fontSize: 13 }}>{dct("docs.loading", "Loading documentation…")}</div>;
  }

  if (!sections.length) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--muted-fg)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{dct("docs.emptyTitle", "No documentation yet")}</div>
        <div style={{ fontSize: 12.5 }}>{dct("docs.emptyBody", "Create folders inside docs/app/ for them to appear here.")}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>

      {/* ── Tabs de carpetas de primer nivel ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, minHeight: "var(--header-h)", padding: "0 12px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0, overflowX: "auto" }}>
        {sections.map(s => (
          <button key={s.path} onClick={() => { setActiveSection(s.path); if (!s.isAPI) { const firstFile = flattenFiles(s.children)[0]; setActiveFile(firstFile ? firstFile.path : null); } else { setActiveFile(null); } }} style={{
            padding: "14px 14px 6px", border: 0, background: "transparent", cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap",
            color: activeSection === s.path ? "var(--fg)" : "var(--muted-fg)",
            borderBottom: activeSection === s.path ? "2px solid var(--accent)" : "2px solid transparent",
            marginBottom: -1,
          }}>{s.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>

        {/* ── Árbol de archivos de la sección activa ── */}
        {!isAPISection && (
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "8px 0", background: "var(--surface)" }}>
            {section?.children.length ? (
              section.children.map(node => (
                <DocsTreeNode key={node.path} node={node} depth={0} activeFile={activeFile} onSelectFile={n => setActiveFile(n.path)} />
              ))
            ) : (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted-fg)" }}>{dct("docs.noFiles", "No .md files yet.")}</div>
            )}
          </div>
        )}

        {/* ── Contenido ── */}
        <div ref={contentRef} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: isAPISection ? 0 : "24px 32px" }}>
          {isAPISection ? (
            /* API Tab - Show Swagger UI */
            <div style={{ height: "100%", border: 0, width: "100%" }}>
              <iframe 
                src="/docs" 
                style={{ width: "100%", height: "100%", border: 0 }}
                title="API Documentation"
              />
            </div>
          ) : (
            <>
              {loading && <div style={{ color: "var(--muted-fg)", fontSize: 13 }}>{dct("docs.loadingFile", "Loading…")}</div>}
              {error && <div style={{ color: "var(--err)", fontSize: 13 }}>{error}</div>}
              {!loading && !error && activeFile && (
                <div style={{ maxWidth: 860 }}>
                  {activeDocument?.spanishPath && (
                    <div style={{ display: "flex", gap: 4, marginBottom: 16 }} aria-label={dct("docs.language", "Documentation language")}>
                      {[{ label: "English", path: activeDocument.path }, { label: "Español", path: activeDocument.spanishPath }].map(language => (
                        <button key={language.path} onClick={() => setActiveFile(language.path)} style={{
                          border: "1px solid var(--border)", borderRadius: 5, padding: "4px 8px", cursor: "pointer",
                          fontFamily: "inherit", fontSize: 12, fontWeight: activeFile === language.path ? 650 : 400,
                          background: activeFile === language.path ? "var(--accent)" : "var(--surface)",
                          color: activeFile === language.path ? "var(--accent-fg, white)" : "var(--fg)",
                        }}>{language.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="docs-app-markdown" onClick={handleContentClick} style={{ lineHeight: 1.65, fontSize: 14 }} dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              )}
              {!activeFile && !loading && (
                <div style={{ color: "var(--muted-fg)", fontSize: 13 }}>{dct("docs.selectFile", "Select a document on the left.")}</div>
              )}
            </>
          )}
        </div>

        {/* ── Tabla de contenidos ── */}
        {!isAPISection && headings.length > 0 && (
          <div style={{ width: 200, flexShrink: 0, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: "16px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 8 }}>{dct("docs.toc", "On this page")}</div>
            {headings.map(h => (
              <button key={h.slug} onClick={() => scrollToHeading(h.slug)} style={{
                display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent",
                cursor: "pointer", fontFamily: "inherit", padding: `3px 0 3px ${(h.level - 1) * 10}px`,
                fontSize: 12, color: "var(--muted-fg)",
              }}>{h.text}</button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .docs-app-markdown h1, .docs-app-markdown h2, .docs-app-markdown h3, .docs-app-markdown h4 { font-weight: 600; line-height: 1.3; margin: 1.2em 0 .5em; color: var(--fg); }
        .docs-app-markdown h1 { font-size: 1.6em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
        .docs-app-markdown h2 { font-size: 1.3em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
        .docs-app-markdown p, .docs-app-markdown li { color: var(--fg); }
        .docs-app-markdown code { font-family: var(--font-mono); background: var(--muted); padding: .15em .4em; border-radius: 4px; font-size: .9em; }
        .docs-app-markdown pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow: auto; }
        .docs-app-markdown pre code { background: none; padding: 0; color: inherit; }
        .docs-app-markdown a { color: var(--accent); }
        .docs-app-markdown blockquote { margin: 0; padding: 0 1em; color: var(--muted-fg); border-left: 3px solid var(--border); }
        .docs-app-markdown table { border-collapse: collapse; width: 100%; }
        .docs-app-markdown th, .docs-app-markdown td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
        .docs-app-markdown img { max-width: 100%; }
      `}</style>
    </div>
  );
}

window.DocumentationView = DocumentationView;
