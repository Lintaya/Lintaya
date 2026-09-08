// Block Builder — pantalla para armar un block de Home eligiendo conector →
// alcance (proyecto/repo/colección real) → cantidad, con preview en vivo y
// vista de tabla .md, contra los 5 blocks reales que ya declara cada conector
// en su manifest.json (server/connectors/sdk/blocks.js). "Choose data type"
// muestra la única opción real de cada conector — hoy no hay MRs/pipelines de
// GitLab ni project-tasks/cycles de Plane sincronizados, así que no se
// inventan opciones que no funcionarían. "Guardar bloque" persiste de verdad
// en /api/home/custom-blocks — el block queda disponible tanto para Home como
// para cualquier Board (module-builder.jsx), no es exclusivo de Home pese al
// nombre del endpoint. block-catalog.jsx también abre esta misma pantalla
// pasando `editing` con un block ya guardado — mismo formulario, PUT en vez
// de POST al guardar (ver isNew).
const { useState, useMemo, useEffect, useRef, useCallback } = React;
const bbt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback;

const BB_CONNECTOR_NAME = { gitlab: "GitLab", github: "GitHub", plane: "Plane", outline: "Outline", qportal: "Qportal", vcenter: "vCenter" };
const BB_ALL_SCOPE = "__all__";
// Prefijo de texto plano frente al título — mismo formato que ya usan los 5
// blocks fijos de manifest.json (ver ConnectorBlockPanel/block-catalog.jsx:
// `${block.icon} ${block.title}`), así que tiene que seguir siendo un
// carácter simple, no una clave de window.ICONS (esas son elementos SVG y no
// sobreviven una concatenación de string).
const BB_ICON_KEYS = ["🔧", "📄", "⚑", "📋", "🚨", "📊", "🔔", "🛡️", "📁", "⏰", "👥", "🌐"];

// Reglas que se le mandan a Claude junto con el prompt del usuario al
// "Generar" un block de tipo IA — distintas según el formato elegido, porque
// un .md y un HTML esperan estructuras distintas (frontmatter vs. HTML
// semántico). Nota: renderMarkdown() de acá abajo todavía no parsea
// frontmatter ni tablas/```mermaid — hoy se muestran como texto plano en la
// vista previa hasta que el renderer se extienda.
const BB_MD_RULES = () => window.I18N.t("ui.blocks.markdownRules", "Rules for the Markdown you generate:\n- Start with YAML frontmatter between `---` lines: title, category, date (today, YYYY-MM-DD), tag.\n- After the frontmatter, include content: #/## headings, **bold**, lists, `code`, tables when relevant, and ```mermaid blocks for diagrams.\n- Respond ONLY with that document — no explanations, preamble, closing remarks, or extra enclosing code fence.");
const BB_HTML_RULES = () => window.I18N.t("ui.blocks.htmlRules", "Rules for the HTML you generate:\n- Simple semantic HTML: h1-h3, p, ul/ol, strong, code, table — no <html>, <head>, <body>, or <script>, and no inline styles unless requested.\n- Respond ONLY with that HTML — no explanations, preamble, closing remarks, or enclosing code fences (no ```).");

// Mismo ícono que module-builder.jsx usa para reabrir su panel central
// (showLayout) — acá cumple el mismo rol para showConfig, así que se ve/actúa
// igual en los dos builders.
const BB_CONFIG_TOGGLE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="8" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" />
  </svg>
);

function bbTimeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(diff)) return null;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

// ── UI atoms ─────────────────────────────────────────────────────────────
function Badge({ label, color }) {
  if (!label) return null;
  return <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px", borderRadius: 999, background: `color-mix(in srgb, ${color || "var(--muted-fg)"} 14%, white)`, color: color || "var(--muted-fg)", whiteSpace: "nowrap" }}>{label}</span>;
}

function EyeButton({ onClick }) {
  return (
    <button onClick={onClick} title={window.I18N.t("home.plane.viewDetail", "View detail")} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", padding: 2, flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
    </button>
  );
}

// ── Tiny markdown renderer (headers, bold, lists, blockquote) ─────────────
function renderMarkdown(md) {
  const lines = md.split("\n");
  const html = [];
  let inList = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
  lines.forEach(line => {
    if (/^# /.test(line)) { if (inList) { html.push("</ul>"); inList = false; } html.push(`<h1 style="font-size:16px;font-weight:700;margin:0 0 8px">${inline(line.slice(2))}</h1>`); }
    else if (/^## /.test(line)) { if (inList) { html.push("</ul>"); inList = false; } html.push(`<h2 style="font-size:13.5px;font-weight:700;margin:14px 0 6px">${inline(line.slice(3))}</h2>`); }
    else if (/^- \[[ x]\] /.test(line)) { if (!inList) { html.push('<ul style="margin:0 0 8px;padding-left:18px">'); inList = true; } const checked = /\[x\]/.test(line); html.push(`<li style="font-size:12.5px;line-height:1.6;text-decoration:${checked ? 'line-through' : 'none'};color:${checked ? 'var(--muted-fg)' : 'var(--fg)'}">${inline(line.replace(/^- \[[ x]\] /, ''))}</li>`); }
    else if (/^\d+\. /.test(line)) { if (!inList) { html.push('<ol style="margin:0 0 8px;padding-left:18px">'); inList = "ol"; } html.push(`<li style="font-size:12.5px;line-height:1.6">${inline(line.replace(/^\d+\. /, ''))}</li>`); }
    else if (/^> /.test(line)) { if (inList) { html.push(inList === "ol" ? "</ol>" : "</ul>"); inList = false; } html.push(`<div style="border-left:3px solid var(--accent);padding:4px 10px;margin:8px 0;background:var(--muted);font-size:12px;color:var(--muted-fg)">${inline(line.slice(2))}</div>`); }
    else if (line.trim() === "") { if (inList) { html.push(inList === "ol" ? "</ol>" : "</ul>"); inList = false; } }
    else { if (inList) { html.push(inList === "ol" ? "</ol>" : "</ul>"); inList = false; } html.push(`<p style="font-size:12.5px;line-height:1.6;margin:0 0 8px;color:var(--fg)">${inline(line)}</p>`); }
  });
  if (inList) html.push(inList === "ol" ? "</ol>" : "</ul>");
  return html.join("");
}

// ── Render de blocks kind:"content" (marked + mermaid inline) ──────────────
// Mismo patrón que MarkdownBody en blocks.jsx/repos.jsx: los fences
// ```mermaid se sustituyen por placeholders, marked procesa el resto, y
// mermaid.render() rellena los SVG después (async — mermaid.render no es
// sincrónico). Si marked/mermaid no cargaron (CDN caído), cae a la
// renderMarkdown() de arriba en vez de romper. HTML (format:"html") no pasa
// por marked, se inyecta directo.
let bbMermaidInit = false;
const BB_CONTENT_STYLES = `
.aiblock-body { font-size: 12.5px; line-height: 1.65; color: var(--fg); word-break: break-word; }
.aiblock-body h1, .aiblock-body h2, .aiblock-body h3, .aiblock-body h4 { font-weight: 600; line-height: 1.3; margin: .9em 0 .35em; }
.aiblock-body h1 { font-size: 1.3em; } .aiblock-body h2 { font-size: 1.18em; } .aiblock-body h3 { font-size: 1.06em; }
.aiblock-body p { margin: .45em 0; }
.aiblock-body code { font-family: var(--font-mono); background: var(--muted); padding: .1em .35em; border-radius: 4px; font-size: .92em; }
.aiblock-body pre { background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; overflow: auto; margin: .6em 0; }
.aiblock-body pre code { background: none; padding: 0; color: inherit; }
.aiblock-body blockquote { margin: .5em 0; padding: 2px 12px; color: var(--muted-fg); border-left: 3px solid var(--border); }
.aiblock-body ul, .aiblock-body ol { padding-left: 1.3em; margin: .45em 0; }
.aiblock-body li { margin: .15em 0; }
.aiblock-body a { color: var(--accent); }
.aiblock-body table { border-collapse: collapse; margin: .6em 0; }
.aiblock-body th, .aiblock-body td { border: 1px solid var(--border); padding: 4px 8px; font-size: .95em; }
.aiblock-body img, .aiblock-body svg, .aiblock-body video { max-width: 100%; }
/* Mermaid caps each diagram's rendered width to its own natural size via an
   inline style="max-width:…px" — that beats the rule above regardless of
   selector, since inline style always outranks a stylesheet without
   !important. Override it so a diagram stretches to use the Block's full
   width instead of sitting narrow with blank space beside it. */
.aiblock-body svg[id^="svg-bb-mermaid"] { max-width: 100% !important; }
.aiblock-body hr { border: 0; border-top: 1px solid var(--border); margin: .8em 0; }
`;

// Un block "content" es Markdown/HTML pegado a mano (o generado por IA) por
// quien tenga acceso a Block Builder — sin esto, format:"html" (y hasta
// Markdown con HTML inline) va directo a dangerouslySetInnerHTML sin pasar
// por nada. DOMPurify cierra ese XSS (bloquea javascript: en href por
// defecto). El hook de abajo va un paso más allá solo para src/poster
// (imagen/video/audio): DOMPurify por defecto SÍ deja pasar data: ahí, que es
// justo el blob inline que no queremos — content debe quedar como referencia
// liviana a una URL http(s), nunca un blob inflando el registro en el
// kv-store (ver MAX_CONTENT_LENGTH en server/routes/custom-blocks.js). No se
// toca href de <a>: los enlaces normales (relativos, #ancla, mailto:) siguen
// funcionando con la política por defecto de DOMPurify.
const SAFE_CONTENT_CONFIG = {
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "link", "meta", "base"],
};
let bbPurifyHookRegistered = false;
function ensureContentSanitizerHook() {
  if (bbPurifyHookRegistered || !window.DOMPurify) return;
  bbPurifyHookRegistered = true;
  window.DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (!/^(?:src|poster)$/i.test(data.attrName)) return;
    if (!/^https?:/i.test(data.attrValue || "")) data.keepAttr = false;
  });
}
function sanitizeContentHtml(html) {
  if (window.DOMPurify) {
    ensureContentSanitizerHook();
    return window.DOMPurify.sanitize(html, SAFE_CONTENT_CONFIG);
  }
  // DOMPurify no cargó — falla seguro: se pierde el formato en vez de
  // arriesgarse a inyectar HTML/script sin sanitizar.
  return String(html || "").replace(/<[^>]*>/g, "");
}

function ContentBlockBody({ format, content }) {
  const [html, setHtml] = useState("");
  // sanitizeContentHtml forbids <style> tags — a real XSS guard for
  // user-typed HTML — but Mermaid embeds its own theming as a <style> block
  // inside the rendered SVG, so it gets stripped along with everything else
  // and every diagram falls back to unstyled black SVG shapes. That block is
  // a fixed theme template scoped to this render's own id (mermaid.render's
  // first argument), never fed from node/label text, so it's safe to carry
  // separately through a trusted <style> tag instead of sanitizeContentHtml.
  const [mermaidCss, setMermaidCss] = useState("");

  useEffect(() => {
    if (format === "html") { setHtml(sanitizeContentHtml(content || "")); setMermaidCss(""); return; }
    if (!window.marked) { setHtml(sanitizeContentHtml(renderMarkdown(content || ""))); setMermaidCss(""); return; }
    let cancelled = false;

    (async () => {
      const fences = [];
      const withPlaceholders = (content || "").replace(/```mermaid\r?\n([\s\S]*?)```/g, (_, code) => {
        const id = `bb-mermaid-${fences.length}-${Math.random().toString(36).slice(2)}`;
        fences.push({ id, code });
        return `<div id="${id}"></div>`;
      });

      let out = window.marked.parse(withPlaceholders);
      const styles = [];

      if (fences.length && window.mermaid) {
        if (!bbMermaidInit) {
          // htmlLabels: false forces plain SVG <text>/<tspan> for every label
          // instead of mermaid's default <foreignObject><div>…</div></foreignObject>.
          // DOMPurify (sanitizeContentHtml below) strips foreignObject outright —
          // it's a real HTML-injection surface in general, and mermaid's own
          // default emits it — so with htmlLabels left on, every diagram's text
          // silently disappeared post-sanitize. Plain SVG text isn't forbidden.
          // var(--font-sans) resolves against the app's own CSS variable —
          // the SVG is inserted straight into the app DOM (not an iframe or
          // shadow root), so it inherits the same font Lintaya uses elsewhere.
          window.mermaid.initialize({
            startOnLoad: false, theme: "neutral", securityLevel: "strict",
            fontFamily: "var(--font-sans)", flowchart: { htmlLabels: false },
          });
          bbMermaidInit = true;
        }
        for (const fence of fences) {
          try {
            const { svg } = await window.mermaid.render(`svg-${fence.id}`, fence.code);
            const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
            if (styleMatch) styles.push(styleMatch[1]);
            out = out.replace(`<div id="${fence.id}"></div>`, `<div style="margin:10px 0">${svg}</div>`);
          } catch (e) {
            out = out.replace(`<div id="${fence.id}"></div>`, `<p style="color:#dc2626;font-size:.9em">⚠ ${e.message || window.I18N.t("ui.blocks.invalidDiagram", "Invalid diagram")}</p>`);
          }
        }
      }

      if (!cancelled) { setHtml(sanitizeContentHtml(out)); setMermaidCss(styles.join("\n")); }
    })();

    return () => { cancelled = true; };
  }, [format, content]);

  return (
    <>
      <style>{BB_CONTENT_STYLES}</style>
      {mermaidCss && <style>{mermaidCss}</style>}
      <div className="aiblock-body" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

// ── Detail view: fetches the real record for Plane/Outline (endpoints that
// already exist — home.jsx's IssueDetailModal/DocumentDetailModal use the
// same ones); other connectors have no per-item endpoint, so it's built
// straight from the normalized block item already in hand. ────────────────
function DetailView({ item, connector, scope, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!item) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    setDetail(null);
    setError(null);
    // Con "Todos" seleccionado, el item mezcla proyectos y no sabemos a cuál
    // pertenece cada uno (el shape normalizado no trae projectId) — sin ese
    // dato no se puede armar la URL del detalle real, así que cae al
    // fallback de campos en vez de intentar un fetch que fallaría.
    if (connector?.id === "plane" && scope && scope !== BB_ALL_SCOPE) {
      setLoading(true);
      window.HQ_API.request(`/api/connectors/plane/issues/${scope}/${item.id}`)
        .then(setDetail).catch(e => setError(e.message)).finally(() => setLoading(false));
    } else if (connector?.id === "outline") {
      setLoading(true);
      window.HQ_API.request(`/api/connectors/outline/documents/${item.id}`)
        .then(setDetail).catch(e => setError(e.message)).finally(() => setLoading(false));
    }
    return () => document.removeEventListener("keydown", onKey);
  }, [item, connector, scope, onClose]);

  if (!item) return null;
  const isMarkdown = connector?.id === "outline";

  // GitLab/Qportal/vCenter (y Plane/Outline mientras cargan o si falla el
  // fetch): campos armados con lo que ya trae el item normalizado — sin
  // fabricar datos que el backend no tiene.
  const fallbackFields = [
    ["Title", item.title],
    item.subtitle && ["Subtitle", item.subtitle],
    item.timestamp && ["When", new Date(item.timestamp).toLocaleString()],
    item.url && ["URL", item.url],
  ].filter(Boolean);

  const planeFields = detail && connector?.id === "plane" ? [
    ["State", detail.state?.name || null],
    ["Priority", item.badge?.text || null],
    item.subtitle && ["Project", item.subtitle],
    detail.due_date && ["Due date", new Date(detail.due_date).toLocaleDateString()],
    detail.created_at && ["Created", new Date(detail.created_at).toLocaleString()],
    detail.updated_at && ["Updated", new Date(detail.updated_at).toLocaleString()],
  ].filter(Boolean).filter(([, v]) => v) : null;

  const fields = planeFields || fallbackFields;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "var(--surface)", borderRadius: 12, width: "min(1100px, 94vw)", maxHeight: "90vh",
        display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px", borderRadius: 4, background: "var(--muted)", color: "var(--muted-fg)", textTransform: "uppercase" }}>{isMarkdown ? "Doc" : window.I18N.t("ui.blocks.fields", "Fields")}</span>
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 16, padding: 2, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {loading && <div style={{ padding: 20, textAlign: "center", color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("settings.loading", "Loading…")}</div>}
          {error && <div style={{ padding: 12, color: "var(--err)", fontSize: 12.5, background: "color-mix(in srgb, var(--err) 8%, white)", borderRadius: 6, marginBottom: 12 }}>{error}</div>}
          {!loading && isMarkdown ? (
            <div dangerouslySetInnerHTML={{ __html: sanitizeContentHtml(renderMarkdown((detail?.text) || "_Sin contenido._")) }} />
          ) : !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
              {fields.map(([k, v], i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, padding: "8px 10px", borderTop: i ? "1px solid var(--border)" : "none", background: i % 2 ? "var(--muted)" : "var(--surface)" }}>
                  <span style={{ fontSize: 11, color: "var(--muted-fg)", fontWeight: 600 }}>{k}</span>
                  <span style={{ fontSize: 12, color: "var(--fg)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Markdown table export for a block's items — one generic shape now that
// every connector returns the same normalized {id,title,subtitle,timestamp,
// url,badge}, instead of a per-connector column layout. ────────────────────
function itemsToMarkdownTable(items) {
  if (!items.length) return "_No items to show._";
  const cols = ["Title", "Subtitle", "When", "Status"];
  const rows = items.map(it => [it.title, it.subtitle || "—", bbTimeAgo(it.timestamp) || "—", it.badge?.text || "—"]);
  const esc = (v) => String(v ?? "").replace(/\|/g, "\\|");
  const header = `| ${cols.map(esc).join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map(r => `| ${r.map(esc).join(" | ")} |`).join("\n");
  return `${header}\n${sep}\n${body}`;
}

// ── Preview card (matches existing block visual language) ─────────────────
function PreviewCard({ connector, dataType, items, loading, error, titleOverride }) {
  const [detailItem, setDetailItem] = useState(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setDetailItem(null); setPage(0); }, [connector, dataType, items]);

  const title = titleOverride || (connector && dataType
    ? connector.dataTypes.find(d => d.id === dataType)?.label || connector.name
    : "Configure your block");

  // Mismo Pager que usan los blocks reales de Home — solo aparece pasando
  // 5 items, self-hides con totalPages <= 1.
  const { pageItems: visibleItems, totalPages, safePage } = paginate(items, page);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative", minHeight: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        {connector ? <BlockLogo connectorId={connector.type || connector.id} color={connector.color} icon={connector.icon} size={22} /> : <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--muted)" }} />}
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <button disabled style={{ height: 22, padding: "0 8px", fontSize: 10.5, border: "1px solid var(--border)", background: "var(--muted)", borderRadius: 5, color: "var(--muted-fg)", cursor: "default" }}>⟳ {bbt("blockBuilder.sync", "Sync")}</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {loading && (
          <div style={{ padding: "28px 14px", textAlign: "center", color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("ui.blocks.loadingData", "Loading live data…")}</div>
        )}
        {!loading && error && (
          <div style={{ padding: "28px 14px", textAlign: "center", color: "var(--err)", fontSize: 12 }}>{error}</div>
        )}
        {!loading && !error && items.length === 0 && (
          <div style={{ padding: "28px 14px", textAlign: "center", color: "var(--muted-fg)", fontSize: 12 }}>
            {!connector || !dataType ? "Pick a connector and scope to preview live data here." : "No items to show."}
          </div>
        )}
        {!loading && !error && visibleItems.map((it) => (
          <div key={it.id} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 12px", borderTop: "1px solid var(--border)", marginTop: -1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
              {it.badge && <Badge label={it.badge.text} color={it.badge.color} />}
              {it.timestamp && <span style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{bbTimeAgo(it.timestamp)}</span>}
              <EyeButton onClick={() => setDetailItem(it)} />
            </div>
            {it.subtitle && <div style={{ fontSize: 11, color: "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.subtitle}</div>}
          </div>
        ))}
      </div>

      <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
      <DetailView item={detailItem} connector={connector} scope={detailItem?.__scope} onClose={() => setDetailItem(null)} />
    </div>
  );
}

// ── .md table view of the same block data ──────────────────────────────
function MarkdownTable({ md, dense }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: dense ? 11.5 : 12.5 }}>
      <thead>
        <tr>{md.split("\n")[0].split("|").filter(s => s.trim()).map((h, i) => (
          <th key={i} style={{ textAlign: "left", padding: dense ? "5px 8px" : "7px 10px", borderBottom: "2px solid var(--border)", color: "var(--muted-fg)", fontSize: dense ? 10.5 : 11, textTransform: "uppercase", letterSpacing: .3 }}>{h.trim()}</th>
        ))}</tr>
      </thead>
      <tbody>
        {md.split("\n").slice(2).map((row, ri) => (
          <tr key={ri} style={{ borderTop: "1px solid var(--border)" }}>
            {row.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1).map((cell, ci) => (
              <td key={ci} style={{ padding: dense ? "5px 8px" : "7px 10px", whiteSpace: dense ? "nowrap" : "normal", overflow: dense ? "hidden" : "visible", textOverflow: dense ? "ellipsis" : "clip", maxWidth: dense ? 180 : "none" }}>{cell.trim()}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MarkdownTableView({ hasData, items }) {
  const md = hasData ? itemsToMarkdownTable(items) : "";
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = e => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const copy = () => { navigator.clipboard?.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1400); };

  const ctrl = { background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 13, lineHeight: 1, padding: 2, fontFamily: "inherit" };

  const Header = ({ large }) => (
    <div style={{ display: "flex", alignItems: "center", gap: large ? 10 : 8, padding: large ? "12px 16px" : "10px 12px", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px", borderRadius: 4, background: "var(--muted)", color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>.md</span>
      <span style={{ fontSize: large ? 13 : 12.5, fontWeight: 600, flex: 1 }}>{bbt("blockBuilder.tableView", "Table view")}</span>
      <button style={{ ...ctrl, color: copied ? "var(--ok)" : "var(--muted-fg)" }} title={window.I18N.t("ui.blocks.copyMarkdown", "Copy Markdown")} disabled={!hasData} onClick={copy}>{copied ? "✓" : "📋"}</button>
      <button style={{ ...ctrl, color: raw ? "var(--accent)" : "var(--muted-fg)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}
        title={raw ? window.I18N.t("ui.blocks.rendered", "Rendered view") : "Markdown raw"} disabled={!hasData} onClick={() => setRaw(v => !v)}>
        {raw ? "👁" : "</>"}
      </button>
      {!large && <button style={ctrl} title={window.I18N.t("ui.expand", "Expand")} disabled={!hasData} onClick={() => setExpanded(true)}>⛶</button>}
      {large && <button style={{ ...ctrl, fontSize: 15 }} title={window.I18N.t("connectors.import.close", "Close")} onClick={() => setExpanded(false)}>×</button>}
    </div>
  );

  const Body = ({ large }) => !hasData ? (
    <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--muted-fg)", fontSize: 12 }}>Configure a block above to see its .md table.</div>
  ) : raw ? (
    <pre style={{ margin: 0, padding: large ? 16 : 12, fontFamily: "var(--font-mono)", fontSize: large ? 12.5 : 11, lineHeight: 1.6, color: "#e7e5e4", background: "#1c1917", overflow: "auto", whiteSpace: "pre", flex: large ? 1 : undefined }}>{md}</pre>
  ) : (
    <div style={{ padding: large ? 16 : 12, overflow: "auto", flex: large ? 1 : undefined }}>
      <MarkdownTable md={md} dense={!large} />
    </div>
  );

  return (
    <>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <Header large={false} />
        <Body large={false} />
      </div>
      {expanded && (
        <div onClick={e => e.target === e.currentTarget && setExpanded(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div style={{
            background: "var(--surface)", borderRadius: 12, width: "min(1100px, 94vw)", maxHeight: "90vh",
            display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
          }}>
            <Header large={true} />
            <Body large={true} />
          </div>
        </div>
      )}
    </>
  );
}

// ── Step 1: connector picker ────────────────────────────────────────────
// Cards are deliberately small (vs. the rest of the wizard's controls) —
// this list only grows as connectors are added, so it's sized to stay
// scannable at dozens of entries, not just today's handful.
function StepConnector({ connectors, value, onSelect }) {
  const [search, setSearch] = useState("");
  if (!connectors.length) {
    return <div style={{ fontSize: 12, color: "var(--muted-fg)", padding: "6px 2px" }}>{window.I18N.t("ui.blocks.emptyConnectors", "No connectors with available blocks — configure one in Connectors.")}</div>;
  }
  const term = search.trim().toLowerCase();
  const filtered = term ? connectors.filter(c => c.name.toLowerCase().includes(term)) : connectors;
  return (
    <div>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)", fontSize: 12 }}>⌕</span>
        <input placeholder={window.I18N.t("logs.searchConnector", "Search connector…")} value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: "100%", height: 28, padding: "0 10px 0 27px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "white", outline: "none" }}
          onFocus={e => e.target.style.borderColor = "var(--accent)"}
          onBlur={e => e.target.style.borderColor = "var(--border)"} />
      </div>
      {filtered.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted-fg)", padding: "6px 2px" }}>{window.I18N.t("ui.blocks.noResults", "No results — adjust your search.")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 6 }}>
          {filtered.map(c => {
            const active = value === c.id;
            return (
              <button key={c.id} type="button" aria-pressed={active} onClick={() => onSelect(c.id)} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 7px",
                border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
                background: active ? "color-mix(in srgb, var(--accent) 6%, white)" : "white",
                borderRadius: 7, cursor: "pointer", textAlign: "left", fontFamily: "inherit", position: "relative",
              }}>
                <BlockLogo connectorId={c.type || c.id} color={c.color} icon={c.icon} size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ fontSize: 9, color: "var(--ok)" }}>{bbt("blockBuilder.connected", "Connected")}</div>
                </div>
                {active && <span style={{ position: "absolute", top: 4, right: 4, color: "var(--accent)", fontSize: 11 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 2: data type picker — hoy siempre una sola opción real por conector ─
function StepDataType({ connector, value, onSelect }) {
  if (!connector) return <div style={{ fontSize: 12, color: "var(--muted-fg)", padding: "6px 2px" }}>{bbt("blockBuilder.selectConnector", "Select a connector first.")}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {connector.dataTypes.map(dt => {
        const active = value === dt.id;
        return (
          <button key={dt.id} type="button" aria-pressed={active} onClick={() => onSelect(dt.id)} style={{
            display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "9px 12px",
            border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
            background: active ? "color-mix(in srgb, var(--accent) 6%, white)" : "white",
            borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? "var(--accent)" : "var(--fg)" }}>{dt.label}</span>
              {active && <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 12 }}>✓</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Step 3: scope + count ───────────────────────────────────────────────
function StepScope({ connector, scope, onScope, count, onCount }) {
  if (!connector) return null;
  const scopeLabel = { gitlab: "Project / repository", github: "Repository", plane: "Project / workspace", outline: "Collection" }[connector.type || connector.id] || "Scope";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", marginBottom: 6, letterSpacing: .3, textTransform: "uppercase" }}>{scopeLabel}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflow: "auto" }}>
          {connector.scopes.length === 0 && <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{connector.name} {window.I18N.t("ui.blocks.singleInstance", "is a single instance — there is nothing to select here.")}</div>}
          {connector.scopes.map(s => {
            const active = scope === s.id;
            return (
              <button key={s.id} type="button" aria-pressed={active} onClick={() => onScope(s.id)} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", textAlign: "left",
                border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
                background: active ? "color-mix(in srgb, var(--accent) 6%, white)" : "white",
                borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12,
                color: active ? "var(--accent)" : "var(--fg)",
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                {active && <span style={{ fontFamily: "var(--font-sans)" }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", marginBottom: 6, letterSpacing: .3, textTransform: "uppercase" }}>{bbt("blockBuilder.itemsToShow", "Items to show")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[5, 10, 20].map(n => (
            <button key={n} type="button" aria-pressed={count === n} onClick={() => onCount(n)} style={{
              width: 52, height: 32, border: "1px solid " + (count === n ? "var(--accent)" : "var(--border)"),
              background: count === n ? "var(--accent)" : "white",
              color: count === n ? "#fff" : "var(--fg)",
              borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 13,
            }}>{n}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Draggable width for the editor's side panels — same hook/handle shape as
// app/module-builder.jsx's/connectors.jsx's/repos.jsx's own copies (this repo
// has no cross-file imports between .jsx modules, so each file keeps its own).
// Named uniquely per file on purpose: these are all plain global <script>
// tags sharing one window scope, not ES modules — same-named top-level
// functions in two files silently overwrite each other (last <script> tag
// wins), so a generic name here would get shadowed by another file's version
// with an incompatible signature. That's exactly what broke this component's
// right-side resize handle for a while — it was actually running repos.jsx's
// version, which ignores the `edge` argument entirely.
function useBlockBuilderResizableWidth(storageKey, defaultWidth, min = 220, max = 460) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= min && saved <= max ? saved : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback((e, edge = "left") => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    const containerRect = container?.getBoundingClientRect();
    const handleWidth = e.currentTarget.getBoundingClientRect().width;
    let currentWidth = widthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = ev => {
      // Calculate from the editor's physical edges rather than a signed delta.
      // That keeps the separator beneath the pointer: left panels grow to the
      // right, while the right preview grows naturally when dragged left.
      const rawWidth = edge === "right"
        ? containerRect.right - ev.clientX - handleWidth
        : ev.clientX - containerRect.left;
      currentWidth = Math.min(max, Math.max(min, rawWidth));
      setWidth(currentWidth);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(storageKey, String(currentWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [min, max, storageKey]);

  return [width, onMouseDown];
}

function BlockBuilderResizeHandle({ onMouseDown, label = window.I18N.t("connectors.resizeHandle", "Drag to resize") }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
      style={{
        width: 5, flexShrink: 0, cursor: "col-resize",
        background: hover ? "var(--accent)" : "transparent",
        borderRight: hover ? "none" : "1px solid var(--border)",
        transition: "background .1s",
      }}
    />
  );
}

// Mobile stand-in for the 3-column layout — one section open at a time
// instead of the desktop's side-by-side identity/config/preview columns,
// which have no room to sit next to each other under ~700px.
function BlockBuilderAccordionSection({ title, open, onToggle, children }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <button type="button" aria-expanded={open} onClick={onToggle} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", background: open ? "var(--muted)" : "white", border: 0, cursor: "pointer",
        fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, textAlign: "left", color: "var(--fg)",
      }}>
        {title}
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .1s", color: "var(--muted-fg)", fontSize: 13 }}>›</span>
      </button>
      {open && <div style={{ padding: "16px" }}>{children}</div>}
    </div>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────────
function BlockBuilder({ onClose, editing }) {
  window.I18N?.useLocale();
  // `editing` con `id` = un custom block real (PUT). `editing` SIN `id` = un
  // block fijo del manifest, precargado desde block-catalog.jsx solo para
  // arrancar con su conector/tipo de dato ya elegidos — un block fijo no
  // tiene registro propio que editar, así que guardar acá crea uno nuevo
  // (POST) en vez de tocar el fijo, que sigue existiendo tal cual.
  const isNew = !editing?.id;
  // Catálogo real: los blocks que declaran los conectores configurados
  // (mismo endpoint que ya usa block-catalog.jsx) + los proyectos/colecciones
  // ya sincronizados de cada uno (mismo endpoint que usa Home/Connectors) para
  // armar los scopes reales.
  const [catalogBlocks, setCatalogBlocks] = useState(null); // null = cargando
  const [connStatus, setConnStatus] = useState(null);
  // id de conexión -> lo que Connectors muestra de ella: el nombre que le puso
  // el usuario y el color que tiene guardado. Sin esto una segunda conexión
  // (github2, gitlab2) se dibujaba con su id crudo y sin logo, porque los mapas
  // locales de acá están indexados por TIPO de conector, no por conexión.
  const [connMeta, setConnMeta] = useState({});
  useEffect(() => {
    window.HQ_API.request("/api/home/blocks").then(setCatalogBlocks).catch(() => setCatalogBlocks([]));
    window.HQ_API.request("/api/connectors/status").then(setConnStatus).catch(() => setConnStatus({}));
    window.HQ_API.request("/api/connectors")
      .then(list => setConnMeta(Object.fromEntries((list || []).map(c => [c.id, c]))))
      .catch(() => {});
  }, []);

  // Un conector por id, con TODOS sus blocks declarados agrupados en
  // dataTypes — antes esto mapeaba 1 catalogBlocks[i] -> 1 "conector" entero,
  // lo cual funcionaba de pura casualidad mientras cada conector declaraba un
  // solo block (gitlab, plane, outline, qportal, vcenter); con GitHub
  // declarando 3 (recent-commits/recent-deployments/repos-overview) esa
  // versión dibujaba 3 tarjetas "GitHub" duplicadas en vez de una con 3
  // opciones en "Tipo de dato" — StepDataType ya estaba armado para eso, solo
  // faltaba agrupar acá.
  const connectors = useMemo(() => {
    if (!catalogBlocks || !connStatus) return [];
    const byConnector = new Map();
    for (const b of catalogBlocks) {
      if (!byConnector.has(b.connectorId)) {
        const status = connStatus[b.connectorId] || {};
        const meta = connMeta[b.connectorId] || {};
        // Por TIPO, no por conexión: github2 es un github y tiene repos que
        // elegir igual que github. Preguntar por el id dejaba a toda segunda
        // conexión sin scopes.
        const type = b.connectorType || meta.type || b.connectorId;
        let scopes = [];
        if (type === "gitlab" || type === "github") scopes = (status.projects || []).map(p => ({ id: String(p.id), label: p.path || p.name }));
        else if (type === "plane") scopes = (status.projects || []).map(p => ({ id: p.id, label: p.name }));
        else if (type === "outline") scopes = (status.collections || []).map(c => ({ id: c.id, label: c.name }));
        // "Todos" — sin filtro de scope, mezclando todos los proyectos/repos/
        // colecciones ya sincronizados, igual que hacían los 5 blocks fijos
        // antes de que este scope existiera.
        if (scopes.length > 0) scopes = [{ id: BB_ALL_SCOPE, label: window.I18N.t("boards.all", "All") }, ...scopes];
        byConnector.set(b.connectorId, {
          id: b.connectorId,
          type,
          color: meta.color || null,
          icon: meta.icon || null,
          // El nombre que el usuario le puso a la conexión gana; los de
          // BB_CONNECTOR_NAME son el respaldo mientras /api/connectors carga.
          name: meta.name || BB_CONNECTOR_NAME[type] || b.connectorId,
          dataTypes: [],
          scopes,
        });
      }
      byConnector.get(b.connectorId).dataTypes.push({ id: b.blockId, label: b.title });
    }
    return [...byConnector.values()];
  }, [catalogBlocks, connStatus, connMeta]);

  // "connector" = flujo de siempre (conector → tipo de dato → alcance, datos
  // en vivo). "content" = markdown/HTML pegado a mano, sin conector — el
  // caso de uso es algo que ya armaste con una IA afuera (ChatGPT, Claude,
  // lo que sea) y solo querés pegar como un block más, usable en Home o en
  // cualquier Board igual que uno conectado a datos reales.
  const [kind, setKind] = useState(() => (editing?.kind === "content" ? "content" : "connector"));
  const [format, setFormat] = useState(() => (editing?.format === "html" ? "html" : "md"));
  const [content, setContent] = useState(() => editing?.content || "");
  // Sub-modo dentro de "IA": mismo espíritu que conector→tipo de dato — una
  // elección explícita antes de mostrar el editor correspondiente, en vez de
  // mezclar Prompt y Contenido en una sola pantalla. Al editar un block que
  // ya tiene contenido pegado, arranca en "paste" (ver ese contenido, no un
  // prompt vacío); si no, arranca en "prompt".
  const [contentMode, setContentMode] = useState(() => (editing?.kind === "content" ? "paste" : "prompt"));

  // Generación con IA: un atajo sobre /api/chat (el mismo endpoint del
  // Asistente en ai-chat.jsx) para llenar `content` a partir de una
  // instrucción, en vez de tener que pegarlo a mano. El resultado sigue
  // siendo editable — no es un chat, es un generador de un solo disparo.
  const [prompt, setPrompt] = useState(() => editing?.prompt || "");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [keyOk, setKeyOk] = useState(null); // null=checking, true=ok, false=falta configurar
  const genReaderRef = useRef(null);
  // Reglas que se le mandan a Claude junto con el prompt — null = usar la
  // plantilla por defecto de BB_MD_RULES/BB_HTML_RULES según `format`;
  // string = el usuario la personalizó para este block puntual (ej: agregar
  // un campo nuevo al frontmatter). Se guarda con el block, así que no hay
  // que tocar código para ajustarla — cada block puede tener la suya.
  const [rules, setRules] = useState(() => (editing?.rules ?? null));
  const [showRules, setShowRules] = useState(false);
  const defaultRules = format === "html" ? BB_HTML_RULES() : BB_MD_RULES();
  const effectiveRules = (rules != null && rules.trim()) ? rules : defaultRules;

  useEffect(() => {
    if (kind !== "content" || keyOk !== null) return;
    window.HQ_API.request("/api/settings/ai")
      .then(d => setKeyOk(!!d.configured))
      .catch(() => setKeyOk(false));
  }, [kind, keyOk]);

  const generateContent = async () => {
    const q = prompt.trim();
    if (!q || generating || keyOk === false) return;
    setGenerating(true);
    setGenError(null);
    try {
      const system = window.I18N.t("ui.blocks.generationPrompt", "Generate content in English for a static block on an internal dashboard (Lintaya).\n\n{rules}", { rules: effectiveRules });
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.HQ_API.getToken()}` },
        body: JSON.stringify({ messages: [{ role: "user", content: q }], system }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error === "claude-api-key-not-configured" || err.detail === "claude-api-key-not-configured") { setKeyOk(false); return; }
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";
      genReaderRef.current = reader;
      setContent("");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") break;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.text) { assembled += chunk.text; setContent(assembled); }
          } catch (e) {
            if (e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }
    } catch (e) {
      setGenError(e.message || String(e));
    } finally {
      setGenerating(false);
      genReaderRef.current = null;
    }
  };

  const [connectorId, setConnectorId] = useState(() => editing?.connectorId || null);
  const [dataType, setDataType] = useState(() => editing?.blockId || null);
  // editing.scope viene null tanto para "Todos" como para un conector de una
  // sola instancia (ver saveBlock: BB_ALL_SCOPE se guarda como null) — ambos
  // casos se comportan igual en el fetch (sin filtro), así que reabrir con
  // BB_ALL_SCOPE es seguro incluso cuando en realidad no había scopes.
  const [scope, setScope] = useState(() => editing ? (editing.scope ?? BB_ALL_SCOPE) : null);
  const [count, setCount] = useState(() => editing?.limit || 5);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [leftWidth, onLeftHandleDown] = useBlockBuilderResizableWidth("hq.blockBuilderLeftWidth", 280);
  const [rightWidth, onRightHandleDown] = useBlockBuilderResizableWidth("hq.blockBuilderRightWidth", 340);
  // Cierra el panel central (tipo de dato + alcance) para darle todo el ancho
  // a la vista previa — mismo comportamiento que showLayout en Board Builder
  // (module-builder.jsx): un botón × lo cierra, un ícono junto a "Nombre" lo reabre.
  const [showConfig, setShowConfig] = useState(true);
  const [showIconModal, setShowIconModal] = useState(false);
  // Below this width the 3-column layout (fixed 280px identity + flexible
  // config + fixed 340px preview) no longer fits — the two fixed-width
  // columns alone need ~630px, so the row overflows and only the identity
  // column is visible, with config/preview clipped off-screen. Under that
  // width we switch to a single-open-at-a-time accordion instead.
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 700);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [openSection, setOpenSection] = useState("identity");

  useEffect(() => {
    if (!showIconModal) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setShowIconModal(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showIconModal]);

  const connector = connectors.find(c => c.id === connectorId) || null;

  // Reset downstream steps when an earlier one changes; el data type real es
  // siempre único, así que elegir conector ya lo deja seleccionado.
  const selectConnector = (id) => {
    setConnectorId(id);
    const c = connectors.find(x => x.id === id);
    setDataType(c?.dataTypes[0]?.id || null);
    setScope(null);
    setSaved(false);
  };

  const step1Done = !!connector;
  // Depende de step1Done, no solo de dataType: en edición, dataType/scope se
  // precargan desde `editing` antes de que `connectors` termine de cargar
  // (fetch async), así que dataType puede estar seteado con connector aún
  // null — sin el && de acá, noScopesNeeded reventaría leyendo connector.scopes.
  const step2Done = step1Done && !!dataType;
  const noScopesNeeded = step2Done && connector.scopes.length === 0;
  const step3Done = step2Done && (noScopesNeeded || !!scope);

  const connectorCanSave = step1Done && step2Done && step3Done;
  const contentCanSave = !!format && content.trim().length > 0;
  const canSave = kind === "content" ? contentCanSave : connectorCanSave;

  // Nombre por defecto, derivado de la selección — solo se usa como
  // placeholder/fallback; el campo "Nombre" en sí queda vacío hasta que el
  // usuario escribe algo (si se precargara como value, un clic a mitad de
  // texto insertaría ahí en vez de reemplazarlo).
  const autoTitle = useMemo(() => {
    if (!connector || !dataType) return null;
    const dt = connector.dataTypes.find(d => d.id === dataType);
    const scopeLabel = connector.scopes.find(s => s.id === scope)?.label;
    return `${dt.label}${scopeLabel ? " — " + scopeLabel : ""}`;
  }, [connector, dataType, scope]);

  // En edición sí se precarga el título real (a diferencia del placeholder-
  // only de creación): acá no hay auto-título "en movimiento" pisando lo que
  // el usuario escriba, es un valor inicial fijo desde el block guardado.
  const [title, setTitle] = useState(() => editing?.title || "");
  const [description, setDescription] = useState(() => editing?.description || "");
  const [icon, setIcon] = useState(() => editing?.icon || null);
  const [active, setActive] = useState(() => editing ? editing.active !== false : true);
  const [tags, setTags] = useState(() => editing?.tags || []);
  const blockTitle = title.trim() || autoTitle || (kind === "content" ? window.I18N.t("ui.blocks.aiBlock", "AI block") : null);

  // Datos reales del block — un solo fetch, compartido por el preview y la
  // tabla .md (antes cada uno llamaba genPreviewItems() por separado). No
  // aplica a kind:"content" — ese no tiene nada que fetchear, el contenido
  // ya está en `content`.
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState(null);
  useEffect(() => {
    if (kind !== "connector" || !canSave) { setItems([]); return; }
    setItemsLoading(true);
    setItemsError(null);
    const qs = new URLSearchParams({ limit: String(count) });
    if (scope && scope !== BB_ALL_SCOPE) qs.set("scope", scope);
    window.HQ_API.request(`/api/connectors/${connector.id}/blocks/${dataType}?${qs}`)
      .then(d => setItems((d.items || []).map(it => ({ ...it, __scope: scope }))))
      .catch(e => setItemsError(e.message))
      .finally(() => setItemsLoading(false));
  }, [kind, canSave, connector, dataType, scope, count]);

  const saveBlock = async () => {
    setSaving(true);
    try {
      const body = kind === "content"
        ? { kind: "content", title: blockTitle, description: description.trim() || null, icon, active, tags, format, content, prompt: prompt.trim() || null, rules: (rules != null && rules.trim()) ? rules : null }
        : {
            kind: "connector", connectorId: connector.id, blockId: dataType, title: blockTitle,
            description: description.trim() || null, icon, active, tags,
            scope: scope === BB_ALL_SCOPE ? null : scope, limit: count,
          };
      await window.HQ_API.request(isNew ? "/api/home/custom-blocks" : `/api/home/custom-blocks/${editing.id}`, {
        method: isNew ? "POST" : "PUT",
        body,
      });
      // App()'s blockCatalog (consumed by CustomPageView for Boards) only
      // refetches on this event — without it, a Board already open in this
      // same session keeps rendering the pre-save catalog until a full reload.
      window.dispatchEvent(new CustomEvent("hq:custom-blocks-changed"));
      setSaved(true);
      setTimeout(onClose, 600); // deja ver el "✓" un instante antes de volver a Blocks
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.saveFailed", "Could not save: {0}", { 0: e.message }), kind: "warn" } }));
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: 10.5, fontWeight: 600, color: "var(--muted-fg)", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 };
  const inputStyle = { width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "white", color: "var(--fg)", font: "inherit", fontSize: 12.5, outline: "none" };
  const loadingCatalog = catalogBlocks === null || connStatus === null;

  // Shared between the desktop 3-column layout and the mobile accordion
  // below — same content, just wrapped differently depending on `mobile`.
  const identityContent = (
    <>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
          <label htmlFor="block-builder-title" style={{ ...labelStyle, marginBottom: 0 }}>{window.I18N.t("settings.profile.name", "Name")}</label>
          {!mobile && !showConfig && (
            <button onClick={() => setShowConfig(true)} title={window.I18N.t("ui.blocks.showConfig", "Show data type and scope")} style={{
              width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--border)", background: "white", borderRadius: 5, cursor: "pointer", color: "var(--muted-fg)", flexShrink: 0,
            }}>
              {BB_CONFIG_TOGGLE_ICON}
            </button>
          )}
        </div>
        <input id="block-builder-title" value={title} onChange={e => setTitle(e.target.value)}
          placeholder={autoTitle || window.I18N.t("ui.blocks.nameHint", "Block name")} style={inputStyle} />
      </div>

      <div>
        <label htmlFor="block-builder-description" style={labelStyle}>{window.I18N.t("home.issue.description", "Description")}</label>
        <textarea id="block-builder-description" value={description} onChange={e => setDescription(e.target.value)} placeholder={window.I18N.t("ui.blocks.descriptionHint", "What does this block show?")}
          rows={2} style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", font: "inherit" }} />
      </div>

      <div>
        <div style={labelStyle}>{window.I18N.t("tags.optional", "Tags (optional)")}</div>
        {window.TagPicker && <window.TagPicker value={tags} onChange={setTags}/>}
      </div>

      <div>
        <div style={labelStyle}>{window.I18N.t("ui.icon", "Icon")}</div>
        <div role="group" aria-label={bbt("blockBuilder.blockIcon", "Block icon")} style={{ display: "flex", gap: 5 }}>
          {/* El ícono elegido siempre aparece primero acá — así queda a
              la vista aunque se haya elegido desde el modal "Más íconos",
              en vez de esconderse detrás de "⋯". */}
          {(icon ? [icon, ...BB_ICON_KEYS.filter(k => k !== icon)] : BB_ICON_KEYS).slice(0, 3).map(k => {
            const on = icon === k;
            return (
              <button key={k} type="button" aria-label={`Use ${k} as block icon`} aria-pressed={on} onClick={() => setIcon(on ? null : k)} title={k} style={{
                flex: 1, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                borderRadius: 6, cursor: "pointer",
              }}>{k}</button>
            );
          })}
          <button type="button" aria-label="Choose another block icon" onClick={() => setShowIconModal(true)} title={window.I18N.t("ui.moreIcons", "More icons")} style={{
            flex: 1, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15,
            border: "1px solid var(--border)", background: "white", borderRadius: 6, cursor: "pointer",
          }}>⋯</button>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={labelStyle}>{window.I18N.t("boards.type", "Type")}</div>
        <div role="group" aria-label={bbt("blockBuilder.blockType", "Block type")} style={{ display: "flex", gap: 5 }}>
          {[["connector", window.I18N.t("boards.connector", "Connector")], ["content", "IA"]].map(([k, l]) => {
            const on = kind === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setKind(k)} style={{
                flex: 1, height: 30, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                color: on ? "var(--accent)" : "var(--fg)", borderRadius: 6,
              }}>{l}</button>
            );
          })}
        </div>
      </div>

      {kind === "connector" && (
        <div>
          {loadingCatalog ? (
            <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{window.I18N.t("connectors.newConnection.loadingConnectors", "Loading connectors…")}</div>
          ) : (
            <div>
              <div style={labelStyle}>{window.I18N.t("boards.connector", "Connector")}</div>
              <StepConnector connectors={connectors} value={connectorId} onSelect={selectConnector} />
            </div>
          )}
        </div>
      )}

      {kind === "content" && (
        <div>
          <div style={labelStyle}>{window.I18N.t("ui.mode", "Mode")}</div>
        <div role="group" aria-label="Content source" style={{ display: "flex", gap: 5 }}>
            {[["prompt", "Local"], ["paste", window.I18N.t("ui.blocks.external", "External")]].map(([m, l]) => {
              const on = contentMode === m;
              return (
              <button key={m} type="button" aria-pressed={on} onClick={() => setContentMode(m)} style={{
                  flex: 1, height: 30, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                  color: on ? "var(--accent)" : "var(--fg)", borderRadius: 6,
                }}>{l}</button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  const configContent = kind === "content" ? (
    <div style={{ height: mobile ? "auto" : "calc(100% - 34px)", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <label htmlFor="block-builder-prompt" style={{ ...labelStyle, marginBottom: 0 }}>
          {contentMode === "prompt" ? window.I18N.t("ui.blocks.aiPrompt", "Prompt (AI)") : window.I18N.t("ui.blocks.contextPrompt", "Context prompt (optional)")}
        </label>
          {contentMode === "prompt" && keyOk === false && (
            <span style={{ fontSize: 10.5, color: "#b45309" }}>{window.I18N.t("ui.blocks.configureAi", "Configure your AI provider in Settings")}</span>
          )}
        </div>
        {contentMode === "paste" && (
          <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.4, marginBottom: 6 }}>{window.I18N.t("ui.blocks.externalPromptHelp", "If you generated this content with an external AI (ChatGPT, Claude, etc.), save your prompt here — it stays with the block for the next time you want to regenerate it.")} </div>
        )}
        <div style={{ position: "relative" }}>
          <textarea id="block-builder-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} disabled={generating}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                generateContent();
              }
            }}
            placeholder={contentMode === "prompt"
              ? window.I18N.t("ui.blocks.promptExample", "E.g. the architecture of all connections this block currently uses")
              : window.I18N.t("ui.blocks.optionalPrompt", "Optional — the prompt/context used to generate this content")}
            style={{
              width: "100%", padding: "8px 38px 8px 10px", border: "1px solid var(--border)", borderRadius: 6,
              background: "white", color: "var(--fg)", font: "inherit", fontSize: 12, lineHeight: 1.4,
              resize: "vertical", outline: "none",
            }} />
          <button onClick={generateContent} disabled={!prompt.trim() || generating || keyOk === false}
            title={keyOk === false ? window.I18N.t("ui.blocks.configureAiFirst", "Configure your AI provider in Settings first") : window.I18N.t("ui.blocks.generateEnter", "Generate (Enter)")}
            style={{
              position: "absolute", right: 6, bottom: 6, width: 24, height: 24, padding: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: "none", borderRadius: 5,
              background: (!prompt.trim() || generating || keyOk === false) ? "var(--muted)" : "var(--accent)",
              color: (!prompt.trim() || generating || keyOk === false) ? "var(--muted-fg)" : "#fff",
              cursor: (!prompt.trim() || generating || keyOk === false) ? "default" : "pointer",
            }}>
            {generating ? (
              <span style={{ fontSize: 11 }}>⋯</span>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 10 4 15 9 20" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
              </svg>
            )}
          </button>
        </div>
        {genError && <div role="alert" style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>⚠️ {genError}</div>}
        <div style={{ marginTop: 6 }}>
          <button onClick={() => setShowRules(s => !s)} style={{
            background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--muted-fg)",
            fontSize: 11, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ transform: showRules ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform .1s" }}>›</span>{window.I18N.t("ui.blocks.rules", "Rules")} {rules != null && rules.trim() ? window.I18N.t("ui.blocks.customRules", "(custom)") : window.I18N.t("ui.blocks.defaultFor", "(default for {0})", { 0: format === "html" ? "HTML" : "Markdown" })}
          </button>
          {showRules && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.4, marginBottom: 6 }}>{window.I18N.t("ui.blocks.rulesHelp", "Instructions for the AI on how to structure the content — edit them if this block needs, for example, a new frontmatter field.")} </div>
              <textarea value={effectiveRules} onChange={e => setRules(e.target.value)} rows={6}
                style={{
                  width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6,
                  background: "white", color: "var(--fg)", font: "inherit", fontSize: 11.5, fontFamily: "var(--font-mono)",
                  lineHeight: 1.5, resize: "vertical", outline: "none",
                }} />
              {rules != null && rules.trim() && (
                <button onClick={() => setRules(null)} style={{
                  marginTop: 6, background: "none", border: 0, padding: 0, cursor: "pointer",
                  color: "var(--accent)", fontSize: 11, fontFamily: "inherit",
                }}>{window.I18N.t("ui.blocks.resetRules", "Reset to the default rules for")} {format === "html" ? "HTML" : "Markdown"}</button>
              )}
            </div>
          )}
        </div>
      </div>
      <div>
        <div style={labelStyle}>{window.I18N.t("ui.format", "Format")}</div>
        <div style={{ display: "flex", gap: 5, maxWidth: 220 }}>
          {[["md", "Markdown"], ["html", "HTML"]].map(([f, l]) => {
            const on = format === f;
            return (
              <button key={f} onClick={() => setFormat(f)} style={{
                flex: 1, height: 30, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                color: on ? "var(--accent)" : "var(--fg)", borderRadius: 6,
              }}>{l}</button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <label htmlFor="block-builder-content" style={labelStyle}>{window.I18N.t("common.content", "Content")}</label>
        <textarea id="block-builder-content" value={content} onChange={e => setContent(e.target.value)}
          placeholder={format === "md" ? window.I18N.t("ui.blocks.pasteMarkdown", "Paste Markdown here — # headings, **bold**, lists, `code`…") : window.I18N.t("ui.blocks.pasteHtml", "Paste HTML here…")}
          style={{
            flex: 1, minHeight: 200, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 6,
            background: "white", color: "var(--fg)", font: "inherit", fontSize: 12, fontFamily: "var(--font-mono)",
            lineHeight: 1.5, resize: "vertical", outline: "none",
          }} />
      </div>
    </div>
  ) : !step1Done ? (
    <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{window.I18N.t("ui.blocks.selectConnector", "Choose a connector first.")}</div>
  ) : (
    <div style={{ maxWidth: mobile ? "none" : 420, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={labelStyle}>{window.I18N.t("ui.blocks.dataType", "Data type")}</div>
        <StepDataType connector={connector} value={dataType} onSelect={setDataType} />
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{window.I18N.t("ui.blocks.scopeSize", "Scope and size")}</div>
        <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 10 }}>{window.I18N.t("ui.blocks.scopeHelp", "Choose the data this block will use and how many items to show.")} </div>
        <StepScope connector={connector} scope={scope} onScope={setScope} count={count} onCount={setCount} />
      </div>
    </div>
  );

  const previewContent = kind === "content" ? (
    <>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{window.I18N.t("tags.preview", "Preview")}</div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{icon || "🤖"}</span>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{blockTitle}</span>
        </div>
        <div style={{ padding: 14, fontSize: 12.5, lineHeight: 1.6, minHeight: 180 }}>
          {content.trim() ? (
            <ContentBlockBody format={format} content={content} />
          ) : (
            <div style={{ textAlign: "center", color: "var(--muted-fg)", fontSize: 12, padding: "28px 14px" }}>{window.I18N.t("ui.blocks.pastePreview", "Paste content in the middle panel to see the preview.")}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5 }}>{window.I18N.t("ui.blocks.previewHelp", "This is exactly how it will look on Home or any Board you add it to.")} </div>
    </>
  ) : (
    <>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{bbt("blockBuilder.livePreview", "Live preview")}</div>
      <PreviewCard connector={connector} dataType={dataType} items={items} loading={itemsLoading} error={itemsError}
        titleOverride={blockTitle ? `${icon ? icon + " " : ""}${blockTitle}` : null} />
      <div style={{ marginTop: 14, fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 16 }}>
        This is exactly how the block will look on your Home dashboard, using live data from {connector ? connector.name : "the selected connector"}.
      </div>

      <div style={{ ...labelStyle, marginBottom: 8 }}>.md table view</div>
      <MarkdownTableView hasData={canSave && !itemsLoading && !itemsError} items={items} />
    </>
  );

  // fixed, not absolute: this renders inside the shell's scrollable content,
  // below the mobile shell's sticky header (z-index 30) and fixed bottom nav
  // (z-index 40) — an absolute overlay only ever covers its own positioned
  // ancestor (main's content box), never those, so on mobile they showed
  // through on top of it. z-index 50 clears both while staying under the
  // floating assistant button (60) and toasts (200).
  return (
    <section aria-label={isNew ? "Create block" : "Edit block"} data-lintaya-entity="block" style={{ height: "100%", background: "white", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, minHeight: "var(--header-h)", padding: "8px 18px 8px 4px", borderBottom: "1px solid var(--border)", background: "white", flexShrink: 0 }}>
        <div style={{ alignSelf: "stretch", display: "flex", alignItems: "flex-end", padding: "0 14px 6px", borderBottom: "2px solid var(--accent)" }}>
          <h1 style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>
            {isNew ? (editing ? window.I18N.t("ui.blocks.basedOn", "New Block (based on {0})", { 0: editing.title }) : window.I18N.t("ui.blocks.newTitle", "New Block")) : window.I18N.t("ui.boards.edit", "Edit · {0}", { 0: editing.title })}
          </h1>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" aria-pressed={active} onClick={() => setActive(a => !a)} title={active ? window.I18N.t("ui.blocks.visible", "Visible on Home") : window.I18N.t("ui.blocks.savedHidden", "Saved but hidden")} style={{
          height: 28, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          background: active ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "white",
          color: active ? "var(--accent)" : "var(--muted-fg)", borderRadius: 6, cursor: "pointer",
        }}>
          <span style={{ width: 22, height: 13, borderRadius: 99, padding: 1.5, flexShrink: 0, background: active ? "var(--accent)" : "var(--border)", display: "inline-flex", justifyContent: active ? "flex-end" : "flex-start" }}>
            <span style={{ width: 10, height: 10, borderRadius: 99, background: "#fff", display: "block" }} />
          </span>
          {active ? window.I18N.t("ui.active", "Active") : window.I18N.t("ui.blocks.hidden", "Hidden")}
        </button>
        <button disabled={!canSave || saving} onClick={saveBlock} style={{
          height: 28, padding: "0 16px", border: 0, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: canSave && !saving ? "pointer" : "default",
          background: canSave ? "var(--accent)" : "var(--muted)", color: canSave ? "#fff" : "var(--muted-fg)", opacity: saving ? 0.7 : 1,
        }}>
          {saved ? window.I18N.t("ui.saved", "✓ Saved") : saving ? window.I18N.t("ui.saving", "Saving…") : isNew ? window.I18N.t("ui.blocks.save", "Save block") : window.I18N.t("ui.saveChanges", "Save changes")}
        </button>
        <button type="button" onClick={onClose} aria-label={window.I18N.t("ui.boards.closeEditor", "Close editor without saving")} title={window.I18N.t("ui.boards.closeWithoutSaving", "Close without saving")}
          style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--border)", background: "white", color: "var(--muted-fg)", borderRadius: 6, fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" }}>×</button>
      </header>

      {mobile ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "white" }}>
          <BlockBuilderAccordionSection title={window.I18N.t("ui.blocks.identity", "Identity and connector")} open={openSection === "identity"} onToggle={() => setOpenSection(s => s === "identity" ? null : "identity")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{identityContent}</div>
          </BlockBuilderAccordionSection>
          <BlockBuilderAccordionSection title={kind === "content" ? window.I18N.t("common.content", "Content") : window.I18N.t("ui.configuration", "Configuration")} open={openSection === "config"} onToggle={() => setOpenSection(s => s === "config" ? null : "config")}>
            {configContent}
          </BlockBuilderAccordionSection>
          <BlockBuilderAccordionSection title={window.I18N.t("tags.preview", "Preview")} open={openSection === "preview"} onToggle={() => setOpenSection(s => s === "preview" ? null : "preview")}>
            {previewContent}
          </BlockBuilderAccordionSection>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          {/* izquierda: identidad del block + conector/tipo de dato */}
          <aside aria-label="Block identity and source" style={{ width: leftWidth, flexShrink: 0, background: "white", padding: "16px 16px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
            {identityContent}
          </aside>
          <BlockBuilderResizeHandle onMouseDown={e => onLeftHandleDown(e, "left")} label={window.I18N.t("ui.blocks.resizeConfig", "Drag right to widen the configuration panel")} />

          {/* centro: tipo de dato + alcance y tamaño */}
          {showConfig && (
            <section aria-label={window.I18N.t("ui.blocks.config", "Block configuration")} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "16px 18px 24px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => setShowConfig(false)} title={window.I18N.t("ui.blocks.closeConfig", "Close — show only the preview")} style={{
                  width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  border: "1px solid var(--border)", background: "white", borderRadius: 6, cursor: "pointer", color: "var(--muted-fg)", fontSize: 15, lineHeight: 1, flexShrink: 0,
                }}>×</button>
              </div>
              {configContent}
            </section>
          )}
          {showConfig && <BlockBuilderResizeHandle onMouseDown={e => onRightHandleDown(e, "right")} label={window.I18N.t("ui.blocks.resizePreview", "Drag left to widen the preview")} />}

          {/* derecha: preview — toma todo el ancho restante cuando el panel central está cerrado */}
          <aside aria-label="Block preview" style={{
            ...(showConfig ? { width: rightWidth, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
            background: "var(--muted)", padding: "16px 14px 24px", overflowY: "auto",
          }}>
            {previewContent}
          </aside>
        </div>
      )}

      {showIconModal && (
        <div onClick={e => e.target === e.currentTarget && setShowIconModal(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div role="dialog" aria-modal="true" aria-label="Choose a block icon" style={{
            background: "var(--surface)", borderRadius: 12, width: "min(340px, 94vw)",
            boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{window.I18N.t("ui.chooseIcon", "Choose an icon")}</span>
              <button type="button" aria-label="Close icon picker" onClick={() => setShowIconModal(false)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 16, padding: 2, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
              {BB_ICON_KEYS.map(k => {
                const on = icon === k;
                return (
                  <button key={k} onClick={() => { setIcon(on ? null : k); setShowIconModal(false); }} title={k} style={{
                    height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 17,
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                    background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                    borderRadius: 6, cursor: "pointer",
                  }}>{k}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

window.BlockBuilderView = BlockBuilder;
// Reused by home.jsx's ConnectorBlockPanel to render a "content" (IA) custom
// block's stored markdown/HTML — read lazily inside render, never at
// module-eval top level, since home.jsx loads before block-builder.jsx in
// Lintaya.html. ContentBlockBody is the real renderer (marked + mermaid);
// renderMarkdown stays exported too as the no-CDN fallback and for
// DetailView's unrelated plain-text preview.
window.renderMarkdown = renderMarkdown;
window.ContentBlockBody = ContentBlockBody;
