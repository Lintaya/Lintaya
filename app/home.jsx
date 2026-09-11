// Dashboard — vista de inicio: KPIs, alertas, accesos rápidos, agenda
const { useMemo, useState, useEffect, useRef, useCallback } = React;

const DEFAULT_LAYOUT = { left: ["qportal","alerts","gitlab.recent-commits"], right: ["plane","outline.recent-docs"] };

// Catálogo de blocks propios de Home — cada uno vive como una entrada de
// panelContent más abajo. Los blocks de conectores ya no se listan aquí: los
// declara cada conector en su manifest.json y llegan por /api/home/blocks.
const BLOCK_CATALOG = [
  { id: "alerts",  label: "Alerts & outages" },
  { id: "plane",   label: "⚑ Tasks — Plane" },
  { id: "qportal", label: "📋 Qportal — Solicitudes" },
];

// GitLab y Outline eran blocks fijos con ids planos antes de volverse blocks
// declarados por su conector; los layouts guardados aún traen esos ids.
const LEGACY_BLOCK_IDS = { gitlab: "gitlab.recent-commits", outline: "outline.recent-docs" };
const migrateLayoutIds = (l) => ({
  left:  (l?.left  || []).map(id => LEGACY_BLOCK_IDS[id] || id),
  right: (l?.right || []).map(id => LEGACY_BLOCK_IDS[id] || id),
});

// Layout y notas ahora viven en el servidor (tabla kv, vía /api/home/*) en
// vez de localStorage — así el dashboard sigue a la cuenta, no al navegador.

// ── Pagination helper — used by the Home panels that list many items ────────
const PAGE_SIZE = 5;
function paginate(items, page, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  return { pageItems: items.slice(safePage * pageSize, safePage * pageSize + pageSize), totalPages, safePage };
}

// Blocks live inside resizable Board zones — they can go narrow on a wide
// desktop window, so a viewport media query (like PaginationBar's) doesn't
// catch it. Measure the pager's own container instead: below ~230px the
// "← Anterior / Página N de M / Siguiente →" text wraps mid-word, so switch
// to bare chevrons + "N/M" (same compact affordance PaginationBar already
// uses for narrow contexts, e.g. Board Builder's sidebar).
const PAGER_COMPACT_WIDTH = 230;

function Pager({ page, totalPages, onChange }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const ref = useRef(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (typeof width === "number") setCompact(width < PAGER_COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (totalPages <= 1) return null;
  const btn = (disabled) => ({
    background: "none", border: "1px solid var(--border)", borderRadius: 5,
    padding: "3px 9px", fontSize: 11, fontFamily: "inherit", color: disabled ? "var(--muted-fg)" : "var(--fg)",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  });
  const iconBtn = (disabled) => ({
    width: 22, height: 22, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "none", border: "1px solid var(--border)", borderRadius: 5,
    fontSize: 13, lineHeight: 1, fontFamily: "inherit", color: disabled ? "var(--muted-fg)" : "var(--fg)",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  });
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid var(--border)" }}>
      {compact ? (
        <>
          <button onClick={() => onChange(page - 1)} disabled={page <= 0} style={iconBtn(page <= 0)} aria-label={t("pagination.prevAria")}>‹</button>
          <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{page + 1}/{totalPages}</span>
          <button onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1} style={iconBtn(page >= totalPages - 1)} aria-label={t("pagination.nextAria")}>›</button>
        </>
      ) : (
        <>
          <button onClick={() => onChange(page - 1)} disabled={page <= 0} style={btn(page <= 0)}>{t("pagination.prev")}</button>
          <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{t("pagination.page", "", { page: page + 1, total: totalPages })}</span>
          <button onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1} style={btn(page >= totalPages - 1)}>{t("pagination.next")}</button>
        </>
      )}
    </div>
  );
}

// ── Plane Issue Detail Modal ─────────────────────────────────────────────────
function IssueDetailModal({ issue, onClose, connectionId = "plane" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const pm = PRIORITY_META[issue.priority] || PRIORITY_META.none;
  const pmLabel = t(`home.priority.${issue.priority}`, pm.label);

  useEffect(() => {
    window.HQ_API.request(`/api/connectors/${connectionId}/issues/${issue.projectId}/${issue.id}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr(e.message); setLoading(false); });
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [connectionId, issue.id]);

  const Row = ({ label, value, mono, color }) => value ? (
    <div style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 90, flexShrink: 0, fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.3, paddingTop: 1 }}>{label}</span>
      <span style={{ fontSize: 12.5, fontFamily: mono ? "var(--font-mono)" : "inherit", color: color || "var(--fg)", flex: 1 }}>{value}</span>
    </div>
  ) : null;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "white", borderRadius: 12, width: "min(600px, 95vw)",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 7px", borderRadius: 4, background: pm.bg, color: pm.color, letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0, marginTop: 3 }}>
            {pmLabel}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>{issue.title}</div>
            <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {issue.identifier} · {issue.projectName}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 20, color: "var(--muted-fg)", lineHeight: 1, flexShrink: 0, padding: 2 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 18px", overflow: "auto", flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>{t("connectors.loading")}</div>}
          {err && <div style={{ padding: 14, color: "var(--err)", fontSize: 13, background: "color-mix(in srgb,var(--err) 8%,white)", borderRadius: 6 }}>{err}</div>}
          {data && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {/* Meta fields */}
              <Row label={t("home.issue.state")}    value={data.state?.name || issue.state} />
              <Row label={t("home.issue.priority")} value={pmLabel} color={pm.color} />
              <Row label={t("home.issue.project")}  value={issue.projectName} />
              <Row label={t("home.issue.id")}       value={issue.identifier} mono />
              {data.start_date  && <Row label={t("home.issue.startDate")}  value={new Date(data.start_date + "T00:00:00").toLocaleDateString(window.I18N.dateLocale(), { year:"numeric", month:"long", day:"numeric" })} />}
              {data.target_date && <Row label={t("home.issue.targetDate")} value={new Date(data.target_date + "T00:00:00").toLocaleDateString(window.I18N.dateLocale(), { year:"numeric", month:"long", day:"numeric" })} />}
              {data.created_at  && <Row label={t("home.issue.created")}  value={new Date(data.created_at).toLocaleString()} mono />}
              {data.updated_at  && <Row label={t("home.issue.updated")}  value={new Date(data.updated_at).toLocaleString()} mono />}

              {/* Description */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{t("home.issue.description")}</div>
                {data.description_html ? (
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--fg)", background: "var(--muted)", borderRadius: 8, padding: "12px 14px", maxHeight: 300, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                    {(() => { const d = document.createElement("div"); d.innerHTML = data.description_html; return d.textContent || d.innerText || ""; })()}
                  </div>
                ) : data.description ? (
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--fg)", background: "var(--muted)", borderRadius: 8, padding: "12px 14px" }}>
                    {data.description}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--muted-fg)", fontStyle: "italic" }}>{t("home.issue.noDescription")}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ height: 32, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 6, background: "white", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
            {t("home.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompletedWeekModal({ issues, weekStart, onClose, onSelectIssue }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "white", borderRadius: 12, width: "min(560px, 95vw)",
        maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("home.completedWeek.title")}</div>
            <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 2 }}>
              {t("home.completedWeek.taskCount", "", { count: issues.length, plural: issues.length !== 1 ? "s" : "" })}
              {weekStart && t("home.completedWeek.sinceMonday", "", { date: weekStart.toLocaleDateString(window.I18N.dateLocale(), { day: "numeric", month: "long" }) })}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 20, color: "var(--muted-fg)", lineHeight: 1, flexShrink: 0, padding: 2 }}>×</button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {issues.map(issue => {
            const pm = PRIORITY_META[issue.priority] || PRIORITY_META.none;
            const pmLabel = t(`home.priority.${issue.priority}`, pm.label);
            return (
              <div key={issue.id} onClick={() => onSelectIssue(issue)}
                style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 18px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: pm.bg, color: pm.color, letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0, marginTop: 2 }}>{pmLabel}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{issue.title}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                    {issue.identifier} · {issue.projectName} · {t("home.completedWeek.completedOn", "", { date: new Date(issue.completedAt || issue.updatedAt).toLocaleDateString(window.I18N.dateLocale(), { day: "2-digit", month: "short", year: "numeric" }) })}
                  </div>
                </div>
              </div>
            );
          })}
          {issues.length === 0 && (
            <window.LintayaEmptyState compact icon="✅" body={t("home.completedWeek.empty")} />
          )}
        </div>
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ height: 32, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 6, background: "white", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>{t("home.close")}</button>
        </div>
      </div>
    </div>
  );
}

// Renders one ```mermaid fenced block as an SVG diagram.
let mermaidInitDone = false;
function MermaidDiagram({ code }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const ref                 = useRef(null);
  const [svg, setSvg]       = useState(null);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!window.mermaid) { setError(t("home.mermaid.notLoaded")); return; }
    if (!mermaidInitDone) {
      window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
      mermaidInitDone = true;
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    window.mermaid.render(id, code)
      .then(({ svg }) => setSvg(svg))
      .catch(e => setError(e.message || t("home.mermaid.renderError")));
  }, [code]);

  if (error) return (
    <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", borderRadius: 6, padding: "8px 10px", margin: "8px 0" }}>
      ⚠ {error}
    </div>
  );
  if (!svg) return <div style={{ fontSize: 11.5, color: "var(--muted-fg)", padding: "8px 0" }}>{t("home.mermaid.rendering")}</div>;
  return <div ref={ref} style={{ margin: "12px 0", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Splits raw markdown text on ```mermaid fences → [{ type: "text"|"mermaid", content }]
function splitMermaidBlocks(text) {
  const parts = [];
  const re = /```mermaid\n([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: "text", content: text.slice(last, m.index) });
    parts.push({ type: "mermaid", content: m[1] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ type: "text", content: text.slice(last) });
  return parts;
}

// ── Outline Document Detail Modal ────────────────────────────────────────────
function DocumentDetailModal({ doc, baseUrl, onClose }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  useEffect(() => {
    window.HQ_API.request(`/api/connectors/outline/documents/${doc.id}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr(e.message); setLoading(false); });
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doc.id]);

  const externalUrl = doc.absoluteUrl
    || (baseUrl && (data?.url || doc.url) ? `${baseUrl}${data?.url || doc.url}` : null);

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "white", borderRadius: 12, width: "min(680px, 95vw)",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>{data?.title || doc.title}</div>
            <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {(data?.updatedBy || doc.updatedBy) ? `${data?.updatedBy || doc.updatedBy} · ` : ""}
              {(data?.updatedAt || doc.updatedAt) ? new Date(data?.updatedAt || doc.updatedAt).toLocaleString() : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 20, color: "var(--muted-fg)", lineHeight: 1, flexShrink: 0, padding: 2 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 18px", overflow: "auto", flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>{t("connectors.loading")}</div>}
          {err && <div style={{ padding: 14, color: "var(--err)", fontSize: 13, background: "color-mix(in srgb,var(--err) 8%,white)", borderRadius: 6 }}>{err}</div>}
          {data && !loading && (
            data.text ? (
              <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
                {splitMermaidBlocks(data.text).map((part, i) => part.type === "mermaid"
                  ? <MermaidDiagram key={i} code={part.content} />
                  : <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part.content}</span>
                )}
              </div>
            ) : (
              <window.LintayaEmptyState compact icon="📄" body={t("home.doc.empty")} />
            )
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          {externalUrl ? (
            <a href={externalUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              {t("home.doc.openInOutline")}
            </a>
          ) : <span />}
          <button onClick={onClose} style={{ height: 32, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 6, background: "white", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
            {t("home.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Block de nota libre — el único tipo de block de Home que no viene de un
// conector. Guarda al perder foco (sin autosave por tecla, para no golpear
// la API en cada letra).
function NoteBlockContent({ note, onSave, onDelete }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [title, setTitle] = useState(note.title || "");
  const [body, setBody]   = useState(note.body || "");

  const inputStyle = {
    border: 0, borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600,
    padding: "4px 0", fontFamily: "inherit", outline: 0, background: "transparent", color: "var(--fg)",
  };
  const textareaStyle = {
    border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, padding: 8,
    fontFamily: "inherit", resize: "vertical", outline: 0, color: "var(--fg)", background: "white",
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onBlur={() => onSave({ title })}
        placeholder={t("home.note.titlePlaceholder")}
        style={inputStyle}
      />
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        onBlur={() => onSave({ body })}
        placeholder={t("home.note.bodyPlaceholder")}
        rows={5}
        style={textareaStyle}
      />
      <button onClick={onDelete}
        style={{ alignSelf: "flex-end", fontSize: 11, color: "var(--err)", background: "none", border: 0, cursor: "pointer", fontFamily: "inherit" }}>
        {t("home.note.delete")}
      </button>
    </div>
  );
}

// ── Block genérico de conector ───────────────────────────────────────────────
// Renderiza cualquier block declarado en el manifest.json de un conector
// leyendo el endpoint estándar GET /api/connectors/<id>/blocks/<blockId>
// (shape: { items: [{ id, title, subtitle?, timestamp?, url?, badge? }],
// updatedAt }). Un conector que necesite UI propia puede sustituirlo
// registrando un componente en window.HomeBlocks["conector.block"]; Home lo
// monta en su lugar con las mismas props.
function ConnectorBlockPanel(props) {
  const { block, panelProps } = props;
  if ((block.connectorType || block.connectorId) === "plane" && block.blockId === "my-issues") {
    return <PlaneTasksPanel connectionId={block.connectorId} panelProps={panelProps} />;
  }
  return <GenericConnectorBlockPanel {...props} />;
}

function PlaneTasksPanel({ connectionId = "plane", panelProps }) {
  window.I18N.useLocale();
  const t = window.I18N.t;
  // Plane.so tasks
  const [planeIssues, setPlaneIssues]         = useState([]);
  const [planeLoading, setPlaneLoading]       = useState(true);
  const [planeSyncing, setPlaneSyncing]       = useState(false);
  const [planeMembers, setPlaneMembers]       = useState([]);
  const [planeAssignee, setPlaneAssignee]     = useState("me"); // "me" | member id
  const [planeCompletedWeek, setPlaneCompletedWeek] = useState(null);
  const [planeCompletedList, setPlaneCompletedList] = useState([]);
  const [planeWeekStart, setPlaneWeekStart]   = useState(null);
  const [planePage, setPlanePage]             = useState(0);
  const [modalIssue, setModalIssue]           = useState(null);
  const [showCompletedWeek, setShowCompletedWeek] = useState(false);

  const loadPlaneIssues = useCallback((assignee) => {
    setPlaneLoading(true);
    const qs = assignee === "me" ? "mine=true" : `assignee=${assignee}`;
    window.HQ_API.request(`/api/connectors/${connectionId}/issues?${qs}&limit=10`)
      .then(top => setPlaneIssues(top.issues || []))
      .catch(() => {})
      .finally(() => setPlaneLoading(false));

    // Completed this week — Monday 00:00 local through now
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    setPlaneWeekStart(monday);
    window.HQ_API.request(`/api/connectors/${connectionId}/issues?${qs}&active=false&limit=200`)
      .then(all => {
        const completed = (all.issues || []).filter(i =>
          i.stateGroup === "completed" && new Date(i.completedAt || i.updatedAt) >= monday
        ).sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt));
        setPlaneCompletedWeek(completed.length);
        setPlaneCompletedList(completed);
      })
      .catch(() => { setPlaneCompletedWeek(null); setPlaneCompletedList([]); });
  }, [connectionId]);

  // Only offer people who actually have active (non-done) work — filters out bots/service
  // accounts (e.g. "execute report", "ADMIN ADMIN") and members with nothing pending.
  const loadPlaneMembers = useCallback(() => {
    Promise.all([
      window.HQ_API.request(`/api/connectors/${connectionId}/members`),
      window.HQ_API.request(`/api/connectors/${connectionId}/issues?limit=500`),
    ]).then(([m, allActive]) => {
      const activeAssigneeIds = new Set();
      (allActive.issues || []).forEach(i => (i.assignees || []).forEach(a => activeAssigneeIds.add(a)));
      setPlaneMembers((m.members || []).filter(mem => activeAssigneeIds.has(mem.id)));
    }).catch(() => {});
  }, [connectionId]);

  useEffect(() => {
    loadPlaneMembers();
    loadPlaneIssues("me");
  }, [connectionId]);

  const handlePlaneAssigneeChange = (id) => {
    setPlaneAssignee(id);
    setPlanePage(0);
    loadPlaneIssues(id);
  };

  return <>
            <Panel key="plane" title={t("home.plane.title")}
              titleExtra={
                <>
                  <select aria-label={t("home.plane.assignedToMe")} value={planeAssignee} onChange={e => handlePlaneAssigneeChange(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ height: 22, padding: "0 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "white", color: "var(--fg)", fontFamily: "inherit", fontWeight: 400, textTransform: "none", letterSpacing: "normal", cursor: "pointer", maxWidth: 160 }}>
                    <option value="me">{t("home.plane.assignedToMe")}</option>
                    {planeMembers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button
                    title={t("home.plane.completedWeekTitle")}
                    onClick={e => { e.stopPropagation(); if (planeCompletedWeek) setShowCompletedWeek(true); }}
                    disabled={!planeCompletedWeek}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600,
                      color: "var(--ok)", textTransform: "none", letterSpacing: "normal",
                      background: "none", border: 0, padding: 0, fontFamily: "inherit",
                      cursor: planeCompletedWeek ? "pointer" : "default",
                    }}>
                    ✓ {planeCompletedWeek == null ? "…" : planeCompletedWeek}
                  </button>
                </>
              }
              action={{ label: planeSyncing ? t("home.block.syncing") : t("home.block.sync"), disabled: planeSyncing, onClick: async () => {
              if (planeSyncing) return;
              setPlaneSyncing(true);
              try {
                const r = await window.HQ_API.request(`/api/connectors/${connectionId}/sync`, { method: "POST" });
                loadPlaneMembers();
                loadPlaneIssues(planeAssignee);
                window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("home.plane.syncedToast", "", { count: r.issueCount }), kind: "ok" } }));
              } catch (e) {
                window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("home.plane.syncFailedToast", "", { message: e.message }), kind: "error" } }));
              } finally {
                setPlaneSyncing(false);
              }
            }}} {...panelProps}>
              {planeLoading ? (
                <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{t("connectors.loading")}</div>
              ) : planeIssues.length === 0 ? (
                <div style={{ padding: 14, color: "var(--ok)", fontSize: 13 }}>✓ {planeAssignee === "me" ? t("home.plane.noTasksAssigned") : t("home.plane.noTasksOther")}</div>
              ) : (() => {
                const { pageItems, totalPages, safePage } = paginate(planeIssues, planePage);
                return (
                  <>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {pageItems.map(issue => {
                        const pm = PRIORITY_META[issue.priority] || PRIORITY_META.none;
                        const pmLabel = t(`home.priority.${issue.priority}`, pm.label);
                        const stateLabel = issue.state && !/^[0-9a-f]{8}-/.test(issue.state) ? issue.state : null;
                        return (
                          <div key={issue.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: pm.bg, color: pm.color, letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0, marginTop: 2 }}>{pmLabel}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.title}</div>
                              <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                                {issue.identifier} · {issue.projectName}
                                {issue.createdAt && (
                                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                                    · {new Date(issue.createdAt).toLocaleDateString(window.I18N.dateLocale(), { day:"2-digit", month:"short", year:"numeric" })}
                                  </span>
                                )}
                                {issue.dueDate && <span style={{ color: "#dc2626", marginLeft: 6 }}>· {t("home.plane.dueDate", "", { date: new Date(issue.dueDate).toLocaleDateString(window.I18N.dateLocale(), { day:"2-digit", month:"short" }) })}</span>}
                              </div>
                            </div>
                            {stateLabel && <span style={{ fontSize: 10, color: "var(--muted-fg)", flexShrink: 0, background: "var(--muted)", padding: "1px 6px", borderRadius: 3, whiteSpace: "nowrap" }}>{stateLabel}</span>}
                            <button onClick={() => setModalIssue(issue)} title={t("home.plane.viewDetail")}
                              style={{ background: "none", border: "1px solid var(--border)", cursor: "pointer", padding: "2px 6px", color: "var(--muted-fg)", fontSize: 13, lineHeight: 1, flexShrink: 0, borderRadius: 4, display: "flex", alignItems: "center" }}
                              onMouseEnter={e => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
                              onMouseLeave={e => { e.currentTarget.style.color = "var(--muted-fg)"; e.currentTarget.style.borderColor = "var(--border)"; }}>
                              👁
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <Pager page={safePage} totalPages={totalPages} onChange={setPlanePage} />
                  </>
                );
              })()}
            </Panel>
      {modalIssue && <IssueDetailModal issue={modalIssue} connectionId={connectionId} onClose={() => setModalIssue(null)} />}
      {showCompletedWeek && (
        <CompletedWeekModal
          issues={planeCompletedList}
          weekStart={planeWeekStart}
          onClose={() => setShowCompletedWeek(false)}
          onSelectIssue={issue => { setShowCompletedWeek(false); setModalIssue(issue); }}
        />
      )}
  </>;
}

function GenericConnectorBlockPanel({ block, onItemClick, panelProps }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  // Un block "content" (Block Builder → tipo IA) no viene de un conector —
  // su contenido ya está guardado en el propio registro (pegado a mano), así
  // que no hay nada que fetchear ni sincronizar.
  const isContent = block.kind === "content";
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(!isContent);
  const [error, setError]         = useState(null);
  const [syncing, setSyncing]     = useState(false);
  const [page, setPage]           = useState(0);

  const load = useCallback(() => {
    if (isContent) return Promise.resolve();
    // Custom blocks (Block Builder) carry a scope/limit the fixed manifest
    // blocks don't — same route, just parameterized.
    const qs = new URLSearchParams();
    if (block.scope) qs.set("scope", block.scope);
    if (block.limit) qs.set("limit", String(block.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return window.HQ_API.request(`/api/connectors/${block.connectorId}/blocks/${block.blockId}${suffix}`)
      .then(d => { setItems(d.items || []); setError(null); })
      .catch(e => setError(e.message));
  }, [isContent, block.connectorId, block.blockId, block.scope, block.limit]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await window.HQ_API.request(`/api/connectors/${block.connectorId}/sync`, { method: "POST" });
      await load();
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("home.block.syncedToast", "", { title: block.title }), kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("home.block.syncFailedToast", "", { title: block.title, message: e.message }), kind: "error" } }));
    } finally {
      setSyncing(false);
    }
  };

  const fmtTs = ts => new Date(ts).toLocaleString(window.I18N.dateLocale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const itemBody = (item) => (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg)", minWidth: 0 }}>{item.title}</span>
        {item.badge && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, flexShrink: 0, color: item.badge.color || "var(--muted-fg)", background: `color-mix(in srgb, ${item.badge.color || "var(--muted-fg)"} 12%, white)` }}>
            {item.badge.text}
          </span>
        )}
      </span>
      {(item.subtitle || item.timestamp) && (
        <span style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {[item.subtitle, item.timestamp ? fmtTs(item.timestamp) : null].filter(Boolean).join(" · ")}
        </span>
      )}
    </>
  );
  const rowStyle = { display: "flex", flexDirection: "column", gap: 2, padding: "9px 14px", borderBottom: "1px solid var(--border)", minWidth: 0 };

  if (isContent) {
    return (
      <Panel title={`${block.icon ? block.icon + " " : ""}${block.title}`} {...panelProps}>
        <div style={{ padding: 14, fontSize: 12.5, lineHeight: 1.6 }}>
          {block.content && block.content.trim() ? (
            window.ContentBlockBody
              ? <window.ContentBlockBody format={block.format} content={block.content} />
              : <div dangerouslySetInnerHTML={{ __html: block.format === "html" ? block.content : block.content }} />
          ) : (
            <div style={{ color: "var(--muted-fg)" }}>{t("home.block.noContent")}</div>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={`${block.icon ? block.icon + " " : ""}${block.title}`}
      action={{ label: syncing ? t("home.block.syncing") : t("home.block.sync"), disabled: syncing, onClick: sync }}
      {...panelProps}>
      {loading ? (
        <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{t("connectors.loading")}</div>
      ) : error ? (
        <div style={{ padding: 14, color: "var(--err)", fontSize: 12.5 }}>{error}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 13 }}>{t("home.block.noSyncedData")}</div>
      ) : (() => {
        const { pageItems, totalPages, safePage } = paginate(items, page);
        return (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {pageItems.map((item, i) => onItemClick ? (
                <button key={item.id + i} onClick={() => onItemClick(item)}
                  style={{ ...rowStyle, background: "none", border: 0, borderBottom: "1px solid var(--border)", textAlign: "left", width: "100%", cursor: "pointer", fontFamily: "inherit" }}>
                  {itemBody(item)}
                </button>
              ) : item.url ? (
                <a key={item.id + i} href={item.url} target="_blank" rel="noreferrer"
                  style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>
                  {itemBody(item)}
                </a>
              ) : (
                <div key={item.id + i} style={rowStyle}>{itemBody(item)}</div>
              ))}
            </div>
            <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
          </>
        );
      })()}
    </Panel>
  );
}

const PRIORITY_META = {
  urgent: { label: "Urgent", color: "#dc2626", bg: "#fef2f2" },
  high:   { label: "High",   color: "#ea580c", bg: "#fff7ed" },
  medium: { label: "Medium", color: "#ca8a04", bg: "#fefce8" },
  low:    { label: "Low",    color: "#2563eb", bg: "#eff6ff" },
  none:   { label: "None",   color: "#64748b", bg: "#f8fafc" },
};

function HomeView({ onNavigate, liveVMs, liveHosts, liveMeta }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  // Datos reales de vCenter — sin fallback a datos de ejemplo: sin vCenter
  // configurado/sincronizado, el dashboard debe verse vacío, no simular VMs.
  // Exclude VMs on hosts disabled for monitoring — they must not pollute alerts/metrics.
  const vms  = (liveVMs || []).filter(v => v.monitoringEnabled !== false);
  const hostCount = liveHosts ? liveHosts.length : 0;

  const stats = useMemo(() => ({
    total:    vms.length,
    online:   vms.filter(v => v.status === "online").length,
    warn:     vms.filter(v => v.status === "warn").length,
    offline:  vms.filter(v => v.status === "offline").length,
    maint:    vms.filter(v => v.status === "maint").length,
    alerts:   vms.filter(v => v.status === "warn" || v.status === "offline")
                 .sort((a, b) => {
                   // offline (DOWN) first — most critical; then warn; alphabetical within group
                   const sev = { offline: 0, warn: 1 };
                   const diff = (sev[a.status] ?? 1) - (sev[b.status] ?? 1);
                   return diff !== 0 ? diff : a.name.localeCompare(b.name);
                 })
                 .slice(0, 5),
  }), [vms]);

  // Estado de conectores — gatea los blocks fijos de Alerts/Plane/Qportal (a
  // diferencia de connectorBlocks, no llegan filtrados por /api/home/blocks
  // porque están hardcodeados abajo, no declarados por manifest.json).
  // null = todavía no llegó la respuesta; hasta entonces no se dispara nada.
  const [connStatus, setConnStatus] = useState(null);
  useEffect(() => {
    window.HQ_API.request("/api/connectors/status").then(setConnStatus).catch(() => setConnStatus({}));
  }, []);
  const vcenterConfigured = !!connStatus?.vcenter?.configured;
  const planeConfigured   = !!connStatus?.plane?.configured;
  const qportalConfigured = !!connStatus?.qportal?.configured;

  const [modalDoc, setModalDoc] = useState(null);
  const [modalPR, setModalPR] = useState(null);
  const [modalCommit, setModalCommit] = useState(null);
  const [modalIssue, setModalIssue] = useState(null);

  // Qportal data
  const [qpData, setQpData]       = useState(null);
  const [qpLoading, setQpLoading] = useState(true);
  const [qpTab, setQpTab]           = useState("review"); // "review" | "weekly"
  const [qpSyncing, setQpSyncing]   = useState(false);
  const [qpExpandedWeek, setQpExpandedWeek] = useState(null); // "TW" | "LW" | "2W" | null

  useEffect(() => {
    if (!qportalConfigured) { setQpLoading(false); return; }
    window.HQ_API.request("/api/connectors/qportal/data")
      .then(data => {
        // metrics are stored inside the sync data under `metrics`
        setQpData({ ...(data || {}), liveMetrics: data?.metrics || null });
      })
      .catch(() => setQpData(null))
      .finally(() => setQpLoading(false));
  }, [qportalConfigured]);

  // Blocks declarados por conectores en su manifest.json — el catálogo llega
  // del servidor, así agregar un conector con block no toca este archivo.
  const [connectorBlocks, setConnectorBlocks] = useState([]);
  // Custom blocks armados en el Block Builder — misma forma que connectorBlocks
  // más scope/limit; se agregan/quitan del layout igual que cualquier otro block.
  const [customBlocks, setCustomBlocks] = useState([]);

  // Draggable layout — cargado del servidor; DEFAULT_LAYOUT solo se usa como
  // placeholder mientras llega la respuesta, para no renderizar con null.
  const [layout, setLayout]     = useState(DEFAULT_LAYOUT);
  const [dragOver, setDragOver] = useState(null); // { col, idx }
  const dragging                = useRef(null);    // { id, col, idx }
  const [notes, setNotes]       = useState([]);
  // null = menu cerrado; "left" o "right" = columna que va a recibir el block.
  // Antes era un booleano y addBlock caia siempre en la izquierda, asi que
  // llenar la segunda columna obligaba a añadir y luego arrastrar.
  const [showAddBlock, setShowAddBlock] = useState(null);
  const [blockQuery, setBlockQuery] = useState("");
  useEffect(() => { setBlockQuery(""); }, [showAddBlock]);
  // Cuanto ocupa la zona 1 frente a la zona 2. Se guarda por navegador, como
  // el ancho del sidebar: es una preferencia de esta pantalla, no del layout
  // de bloques que sí viaja al servidor.
  // Mismos topes que el separador del Dashboard (15%-85%). Alli el modelo es
  // un ratio 0..1 y aqui una razon fr entre las dos zonas, asi que se convierte
  // con pct/(1-pct) en vez de duplicar dos numeros que luego se desincronizan.
  const ZONE_PCT_MIN = 0.15, ZONE_PCT_MAX = 0.85, ZONE_RATIO_DEFAULT = 1.4;
  const ZONE_RATIO_MIN = ZONE_PCT_MIN / (1 - ZONE_PCT_MIN);
  const ZONE_RATIO_MAX = ZONE_PCT_MAX / (1 - ZONE_PCT_MAX);
  const clampZonePct = value => Math.min(ZONE_PCT_MAX, Math.max(ZONE_PCT_MIN, value));
  const ratioFromPct = pct => Math.round((pct / (1 - pct)) * 100) / 100;
  const [zoneRatio, setZoneRatio] = useState(() => {
    const saved = parseFloat(localStorage.getItem("hq.homeZoneRatio"));
    return Number.isFinite(saved) && saved >= ZONE_RATIO_MIN && saved <= ZONE_RATIO_MAX ? saved : ZONE_RATIO_DEFAULT;
  });
  const zoneGridRef = useRef(null);
  useEffect(() => {
    try { localStorage.setItem("hq.homeZoneRatio", String(zoneRatio)); } catch {}
  }, [zoneRatio]);
  // El paso se aplica en porcentaje (5 puntos, como en Dashboard) y no sobre la
  // razon fr: sumarle un delta fijo a la razon desplaza la barra mucho mas hacia
  // un lado que hacia el otro, porque la razon no es lineal en el ancho.
  const nudgeZone = (e) => {
    const step = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
    if (!step) return;
    e.preventDefault();
    setZoneRatio(prev => ratioFromPct(clampZonePct(prev / (1 + prev) + step)));
  };
  // Mismo arrastre que el separador del Dashboard: pointer events (para que
  // valga con raton, tactil y lapiz) y un aviso de fin para que el separador
  // apague su estado activo. finishVisualState lo pasa el propio separador.
  const startZoneResize = (e, finishVisualState) => {
    if (e.pointerType === "mouse" && e.button !== 0) { finishVisualState?.(); return; }
    e.preventDefault();
    const grid = zoneGridRef.current;
    if (!grid) { finishVisualState?.(); return; }
    const rect = grid.getBoundingClientRect();
    // La barra parte el ancho de la rejilla: la razon es lo que queda a la
    // izquierda contra lo que queda a la derecha.
    const move = (ev) => setZoneRatio(ratioFromPct(clampZonePct((ev.clientX - rect.left) / Math.max(rect.width, 1))));
    const end = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      finishVisualState?.();
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  // Encola los guardados de layout uno tras otro — sin esto, dos cambios
  // seguidos (p. ej. quitar un block justo después de agregar una nota)
  // podían viajar en paralelo y llegar al servidor fuera de orden, dejando
  // guardado el valor más viejo en vez del más nuevo.
  const layoutSaveQueue = useRef(Promise.resolve());

  useEffect(() => {
    window.HQ_API.request("/api/home/layout").then(l => setLayout(migrateLayoutIds(l))).catch(() => {});
    window.HQ_API.request("/api/home/notes").then(setNotes).catch(() => {});
  }, []);

  // /api/home/blocks already excludes a connector's block once it's disabled
  // or unconfigured — but that only helps if this refetches. Without this
  // listener (same event connectors.jsx's Sidebar fix started dispatching),
  // toggling a connector off while Home is open left its block showing stale
  // data with a live Sync button until a full page reload.
  const loadHomeBlocks = useCallback(() => {
    window.HQ_API.request("/api/home/blocks").then(setConnectorBlocks).catch(() => {});
    window.HQ_API.request("/api/home/custom-blocks").then(setCustomBlocks).catch(() => {});
  }, []);
  useEffect(() => {
    loadHomeBlocks();
    window.addEventListener("hq:connector-config-changed", loadHomeBlocks);
    window.addEventListener("hq:connector-status-changed", loadHomeBlocks);
    return () => {
      window.removeEventListener("hq:connector-config-changed", loadHomeBlocks);
      window.removeEventListener("hq:connector-status-changed", loadHomeBlocks);
    };
  }, [loadHomeBlocks]);

  const saveLayoutToServer = (next) => {
    layoutSaveQueue.current = layoutSaveQueue.current
      .then(() => window.HQ_API.request("/api/home/layout", { method: "POST", body: next }))
      .catch(() => {});
  };

  const movePanel = useCallback((fromCol, fromIdx, toCol, toIdx) => {
    setLayout(prev => {
      const next = { left: [...prev.left], right: [...prev.right] };
      const [item] = next[fromCol].splice(fromIdx, 1);
      next[toCol].splice(toIdx, 0, item);
      saveLayoutToServer(next);
      return next;
    });
  }, []);

  const addBlock = (id, col = "left") => {
    setLayout(prev => {
      if (prev.left.includes(id) || prev.right.includes(id)) return prev;
      const next = { ...prev, [col]: [...prev[col], id] };
      saveLayoutToServer(next);
      return next;
    });
    setShowAddBlock(null);
  };

  const removeBlock = (id) => {
    setLayout(prev => {
      const next = { left: prev.left.filter(x => x !== id), right: prev.right.filter(x => x !== id) };
      saveLayoutToServer(next);
      return next;
    });
  };

  const addNote = (col = "right") => {
    window.HQ_API.request("/api/home/notes", { method: "POST", body: { title: t("home.note.newTitle"), body: "" } })
      .then(note => {
        setNotes(prev => [...prev, note]);
        addBlock(note.id, col);
      })
      .catch(() => {});
    setShowAddBlock(null);
  };

  const saveNote = (id, changes) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...changes } : n));
    window.HQ_API.request(`/api/home/notes/${id}`, { method: "PUT", body: changes }).catch(() => {});
  };

  const deleteNote = (id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    setLayout(prev => ({ left: prev.left.filter(x => x !== id), right: prev.right.filter(x => x !== id) }));
    window.HQ_API.request(`/api/home/notes/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // alerts/plane/qportal solo se ofrecen para agregar si el conector está
  // configurado — si no, el panel no tendría datos que mostrar (ver panelContent abajo).
  const BLOCK_CATALOG_KEYS = { alerts: "home.alerts.title", plane: "home.plane.title", qportal: "home.qportal.title" };
  const availableBlocks = [
    ...BLOCK_CATALOG
      .filter(w => w.id !== "alerts"  || vcenterConfigured)
      .filter(w => w.id !== "plane"   || planeConfigured)
      .filter(w => w.id !== "qportal" || qportalConfigured)
      .map(w => ({ id: w.id, label: t(BLOCK_CATALOG_KEYS[w.id], w.label) })),
    ...connectorBlocks.map(b => ({ id: b.id, label: `${b.icon ? b.icon + " " : ""}${b.title}` })),
    ...customBlocks.filter(b => b.active !== false).map(b => ({ id: b.id, label: `${b.icon ? b.icon + " " : ""}${b.title}` })),
  ].filter(w => !layout.left.includes(w.id) && !layout.right.includes(w.id));

  // Los titulos de los blocks vienen de los connectors ("Leon", "Delfin"...) y
  // nadie teclea los acentos al buscar, asi que se comparan ambos lados sin
  // diacriticos en vez de exigir una coincidencia literal.
  const foldForSearch = value => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const blockNeedle = foldForSearch(blockQuery).trim();
  const matchingBlocks = blockNeedle
    ? availableBlocks.filter(w => foldForSearch(w.label).includes(blockNeedle))
    : availableBlocks;

  // Subtitle: show sync time from meta if available
  const syncedAt = liveMeta?.[0]?.syncedAt;
  const syncInfo = syncedAt ? (() => {
    const diff = Date.now() - new Date(syncedAt).getTime();
    if (diff < 60000) return t("home.sync.secondsAgo", "", { s: Math.round(diff/1000) });
    if (diff < 3600000) return t("home.sync.minutesAgo", "", { m: Math.round(diff/60000) });
    return t("home.sync.at", "", { time: new Date(syncedAt).toLocaleTimeString() });
  })() : null;

  return (
    <div className="home-view" style={{ padding: 20, width: "100%", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 22, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        {/* El subtitulo colgaba de vcenterConfigured, asi que sin vCenter decia
            "No connectors configured" aunque hubiera otros conectores sincronizando.
            Home pasa a encabezarse con su titulo, como el resto de vistas, y el
            resumen de vCenter queda debajo solo cuando ese conector esta puesto. */}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{t("nav.home.label", "Home")}</h1>
          {vcenterConfigured && (
            <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13.5 }}>
              {t("home.subtitle.summary", "", { online: stats.online, total: stats.total, hosts: hostCount, alerts: stats.alerts.length })}
              {syncInfo && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ok)" }}>● {syncInfo}</span>}
            </p>
          )}
        </div>
        <div style={{ position: "relative", flexShrink: 0, display: "flex", gap: 6 }}>
          {[["left", t("home.addBlock.zone1", "+ Block · Zone 1")], ["right", t("home.addBlock.zone2", "+ Block · Zone 2")]].map(([col, etiqueta]) => (
            <button key={col} onClick={() => setShowAddBlock(v => v === col ? null : col)}
              style={{ height: 28, padding: "0 12px", background: showAddBlock === col ? "var(--accent)" : "white", color: showAddBlock === col ? "white" : "var(--accent)", border: "1px solid var(--accent)", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {etiqueta}
            </button>
          ))}
          {showAddBlock && (
            <>
              <div onClick={() => setShowAddBlock(null)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
              {/* La lista crece con cada connector — un catalogo grande sin filtro
                  es impracticable —, asi que el buscador y "nota nueva" quedan
                  fijos y solo desplaza la lista de en medio. */}
              <div onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setShowAddBlock(null); } }}
                style={{
                position: "absolute", right: 0, top: 34, zIndex: 11, minWidth: 240,
                background: "white", border: "1px solid var(--border)", borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,.12)", overflow: "hidden",
                display: "flex", flexDirection: "column", maxHeight: 360,
              }}>
                {availableBlocks.length > 0 && (
                  <div style={{ position: "relative", flex: "0 0 auto", padding: 8, borderBottom: "1px solid var(--border)" }}>
                    <span aria-hidden="true" style={{ position: "absolute", left: 17, top: 15, color: "var(--muted-fg)", fontSize: 13 }}>⌕</span>
                    <input
                      autoFocus
                      value={blockQuery}
                      onChange={e => setBlockQuery(e.target.value)}
                      onKeyDown={e => {
                        // Enter agrega la primera coincidencia: con el filtro escrito
                        // suele quedar una sola y obliga a soltar el teclado si no.
                        if (e.key === "Enter" && matchingBlocks.length) { e.preventDefault(); addBlock(matchingBlocks[0].id, showAddBlock); }
                      }}
                      placeholder={t("home.addBlock.search", "Search blocks…")}
                      aria-label={t("home.addBlock.search", "Search blocks…")}
                      style={{ width: "100%", height: 30, boxSizing: "border-box", padding: "0 10px 0 26px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", background: "white", outline: "none", color: "var(--fg)" }}
                      onFocus={e => e.target.style.borderColor = "var(--accent)"}
                      onBlur={e => e.target.style.borderColor = "var(--border)"} />
                  </div>
                )}
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
                {availableBlocks.length === 0 && (
                  <div style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--muted-fg)" }}>
                    {t("home.addBlock.allAdded")}
                  </div>
                )}
                {availableBlocks.length > 0 && matchingBlocks.length === 0 && (
                  <div style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--muted-fg)" }}>
                    {t("home.addBlock.noMatches", "", { q: blockQuery })}
                  </div>
                )}
                {matchingBlocks.map(w => (
                  <button key={w.id} onClick={() => addBlock(w.id, showAddBlock)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", fontSize: 12.5, background: "none", border: 0, borderBottom: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", color: "var(--fg)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {w.label}
                  </button>
                ))}
                </div>
                <button onClick={() => addNote(showAddBlock)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", fontSize: 12.5, fontWeight: 600, background: "none", border: 0, cursor: "pointer", fontFamily: "inherit", color: "var(--accent)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {t("home.addBlock.newNote")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Draggable panel grid */}
      {modalDoc && <DocumentDetailModal doc={modalDoc} onClose={() => setModalDoc(null)} />}
      {modalPR && window.PullRequestDetailModal && <window.PullRequestDetailModal pr={modalPR} onClose={() => setModalPR(null)} />}
      {modalCommit && window.CommitDetailModal && <window.CommitDetailModal commit={modalCommit} onClose={() => setModalCommit(null)} />}
      {modalIssue && window.IssueDetailModal && <window.IssueDetailModal issue={modalIssue} onClose={() => setModalIssue(null)} />}

      {(() => {
        // Panel content definitions
        const panelContent = {
          // alerts solo se agrega si vCenter está configurado — mismo patrón
          // que plane/qportal más abajo: sin conector, panelContent.alerts
          // queda undefined y el panel no se renderiza en absoluto.
          ...(vcenterConfigured ? { alerts: (
            <Panel key="alerts" title={t("home.alerts.title")}
              titleExtra={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 11.5, fontWeight: 600, textTransform: "none", letterSpacing: "normal" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--ok)" }} />{stats.online}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--err)" }} />{stats.warn + stats.offline}
                  </span>
                </span>
              }
              action={{ label: t("home.alerts.seeAll"), onClick: () => onNavigate("vms") }}
              draggable dragId="alerts" col="left" layout={layout} dragging={dragging} dragOver={dragOver} setDragOver={setDragOver} movePanel={movePanel} onRemove={() => removeBlock("alerts")}>
              {vms.length === 0 ? (
                <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 13 }}>{t("home.alerts.noVmData")}</div>
              ) : stats.alerts.length === 0 ? (
                <div style={{ padding: 14, color: "var(--ok)", fontSize: 13 }}>{t("home.alerts.allClear")}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {stats.alerts.map(vm => (
                    <div key={vm.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: vm.status === "offline" ? "var(--err)" : "var(--warn)" }} />
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vm.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 6px", borderRadius: 3, background: vm.status === "offline" ? "color-mix(in srgb, var(--err) 14%, white)" : "color-mix(in srgb, var(--warn) 16%, white)", color: vm.status === "offline" ? "var(--err)" : "#9a6f00" }}>{vm.status === "offline" ? t("home.alerts.down") : t("home.alerts.warn")}</span>
                      <span style={{ fontSize: 11.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{vm.ip}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          ) } : {}),
          // plane/qportal siguen el mismo patrón.
          ...(planeConfigured ? { plane: (
            <PlaneTasksPanel panelProps={{ draggable: true, dragId: "plane", col: "right", layout, dragging, dragOver, setDragOver, movePanel, onRemove: () => removeBlock("plane") }} />
          ) } : {}),
          ...(qportalConfigured ? { qportal: (() => {
            const metrics = qpData?.liveMetrics;
            const allRequests = qpData?.requests || [];
            const PENDING_STATES = ["created","pending by user","authorized","Draft"];
            const pending = allRequests.filter(r => PENDING_STATES.includes(r.state));

            let weeklyData = null;
            if (metrics?.historyrequesttype) {
              try { weeklyData = JSON.parse(metrics.historyrequesttype); } catch {}
            }
            const fmtRange = (weeksAgo) => {
              const now = new Date();
              const day = now.getDay() || 7;
              const mon = new Date(now); mon.setDate(now.getDate() - day + 1 - weeksAgo * 7);
              const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
              const fmt = d => d.toLocaleDateString(window.I18N.dateLocale(), { day: "2-digit", month: "short" });
              return `${fmt(mon)} – ${fmt(sun)}`;
            };
            const weekLabels = { TW: t("home.qportal.weekTW"), LW: t("home.qportal.weekLW"), "2W": t("home.qportal.week2W") };
            const weekDates  = { TW: fmtRange(0), LW: fmtRange(1), "2W": fmtRange(2) };

            const STATE_COLOR = {
              "Done":"#22c55e","Rejected":"#ef4444","authorized":"#f97316",
              "created":"#0ea5e9","pending by user":"#a855f7","Draft":"#94a3b8",
            };
            const STATE_ICON = {
              "Done":"✓","Rejected":"✕","authorized":"✔","created":"○","pending by user":"⏳","Draft":"✏",
            };

            return (
              <Panel key="qportal" title={t("home.qportal.title")}
                action={{ label: qpSyncing ? t("home.block.syncing") : t("home.block.sync"), disabled: qpSyncing, onClick: async () => {
                  if (qpSyncing) return;
                  setQpSyncing(true);
                  try {
                    await window.HQ_API.request("/api/connectors/qportal/sync", { method: "POST" });
                    const [data, metrics2] = await Promise.all([
                      window.HQ_API.request("/api/connectors/qportal/data").catch(() => null),
                      window.HQ_API.request("/api/connectors/qportal/metrics").catch(() => null),
                    ]);
                    setQpData({ ...(data || {}), liveMetrics: metrics2 });
                    window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("home.qportal.syncedToast"), kind: "ok" } }));
                  } catch (e) {
                    window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("home.qportal.syncFailedToast", "", { message: e.message }), kind: "error" } }));
                  } finally { setQpSyncing(false); }
                }}}
                draggable dragId="qportal" col="left" layout={layout} dragging={dragging} dragOver={dragOver} setDragOver={setDragOver} movePanel={movePanel} onRemove={() => removeBlock("qportal")}>

                {/* Tabs */}
                <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
                  {[["review", t("home.qportal.reviewTab", "", { count: pending.length ? ` (${pending.length})` : "" })], ["weekly", t("home.qportal.weeklyTab")]].map(([k, l]) => (
                    <button key={k} onClick={() => setQpTab(k)} style={{
                      flex: 1, height: 34, border: 0, background: "transparent",
                      borderBottom: `2px solid ${qpTab === k ? "#0ea5e9" : "transparent"}`,
                      fontSize: 11.5, fontFamily: "inherit", cursor: "pointer",
                      color: qpTab === k ? "#0ea5e9" : "var(--muted-fg)",
                      fontWeight: qpTab === k ? 600 : 400,
                    }}>{l}</button>
                  ))}
                </div>

                {qpLoading ? (
                  <div style={{ padding: 16, color: "var(--muted-fg)", fontSize: 12 }}>{t("connectors.loading")}</div>
                ) : qpTab === "review" ? (
                  pending.length === 0 ? (
                    <div style={{ padding: 16, color: "var(--ok)", fontSize: 13 }}>{t("home.qportal.noPending")}</div>
                  ) : (
                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                      {pending.slice(0, 20).map(r => (
                        <div key={r._id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 5px", borderRadius: 4,
                            background: `color-mix(in srgb, ${STATE_COLOR[r.state]||"#94a3b8"} 12%, white)`,
                            color: STATE_COLOR[r.state]||"#94a3b8",
                            border: `1px solid color-mix(in srgb, ${STATE_COLOR[r.state]||"#94a3b8"} 25%, var(--border))`,
                            flexShrink: 0, marginTop: 1, whiteSpace: "nowrap" }}>
                            {STATE_ICON[r.state]} {r.state}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description || t("home.qportal.requestFallback", "", { n: r.sequence })}</div>
                            <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                              #{r.sequence} · {r.requested_by} · {r.created_at}
                            </div>
                          </div>
                        </div>
                      ))}
                      {pending.length > 20 && (
                        <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--muted-fg)", textAlign: "center" }}>
                          {t("home.qportal.moreInBatch", "", { count: pending.length - 20 })}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    {weeklyData ? (() => {
                      // Helper: classify request description into service type
                      const classify = (desc) => {
                        const d = (desc || "").toLowerCase();
                        if (/\bip\b|ips\b|\bprefijo\b|\bsubred\b/.test(d)) return "IPs";
                        if (/\bvlan\b/.test(d)) return "VLANs";
                        if (/\bevi\b/.test(d)) return "EVIs";
                        if (/\basn\b|\bbgp\b/.test(d)) return "ASNs";
                        if (/\bpuerto\b|\bport\b/.test(d)) return "Puertos";
                        if (/\busuario\b|\buser\b/.test(d)) return "Usuarios";
                        if (/\bvrf\b/.test(d)) return "VRFs";
                        return "Otros";
                      };

                      // Determine week date ranges (Mon–Sun)
                      const getWeekRange = (weeksAgo) => {
                        const now = new Date();
                        const day = now.getDay() || 7; // Mon=1 Sun=7
                        const monday = new Date(now); monday.setDate(now.getDate() - day + 1 - weeksAgo * 7); monday.setHours(0,0,0,0);
                        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23,59,59,999);
                        return { monday, sunday };
                      };
                      const weekRanges = { TW: getWeekRange(0), LW: getWeekRange(1), "2W": getWeekRange(2) };

                      const maxVal = Math.max(...Object.keys(weekLabels).map(k => {
                        const w = weeklyData[k] || [];
                        return (w.find(x=>x.name==="Done")?.value||0) + (w.find(x=>x.name==="Rejected")?.value||0);
                      }), 1);

                      return Object.entries(weekLabels).map(([key, label]) => {
                        const week    = weeklyData[key] || [];
                        const done    = week.find(x => x.name === "Done")?.value     || 0;
                        const rejected= week.find(x => x.name === "Rejected")?.value || 0;
                        const total   = done + rejected;
                        const isOpen  = qpExpandedWeek === key;

                        // Filter synced requests to this week
                        const { monday, sunday } = weekRanges[key];
                        const weekReqs = allRequests.filter(r => {
                          const d = new Date(r.created_at); return d >= monday && d <= sunday;
                        });

                        // Count by service type
                        const byService = {};
                        weekReqs.forEach(r => {
                          const svc = classify(r.description);
                          byService[svc] = (byService[svc] || 0) + 1;
                        });
                        const svcEntries = Object.entries(byService).sort((a,b) => b[1]-a[1]);

                        // Count by state from synced data
                        const byState = {};
                        weekReqs.forEach(r => { byState[r.state] = (byState[r.state]||0) + 1; });

                        const SVC_COLOR = { "IPs":"#0ea5e9","VLANs":"#8b5cf6","EVIs":"#f97316","ASNs":"#22c55e","Puertos":"#ec4899","VRFs":"#14b8a6","Usuarios":"#f59e0b","Otros":"#94a3b8" };

                        return (
                          <div key={key} style={{ borderRadius: 7, border: isOpen ? "1px solid color-mix(in srgb,#0ea5e9 30%,var(--border))" : "1px solid transparent", overflow: "hidden" }}>
                            {/* Row */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                                  <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                    <span style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</span>
                                    <span style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{weekDates[key]}</span>
                                  </span>
                                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-fg)" }}>
                                    {t("home.qportal.countLine", "", { done, rejected })} <b style={{ color: "var(--fg)" }}>{total}</b>
                                  </span>
                                </div>
                                <div style={{ height: 10, borderRadius: 5, overflow: "hidden", background: "var(--muted)", display: "flex" }}>
                                  <div style={{ width: `${(done/maxVal)*100}%`, background: "#22c55e", transition: "width .4s" }} />
                                  <div style={{ width: `${(rejected/maxVal)*100}%`, background: "#ef4444", transition: "width .4s" }} />
                                </div>
                              </div>
                              {/* Eye toggle */}
                              <button onClick={() => setQpExpandedWeek(isOpen ? null : key)}
                                title={isOpen ? t("home.qportal.closeDetail") : t("home.qportal.viewServiceDetail")}
                                style={{ width: 26, height: 26, border: `1px solid ${isOpen ? "#0ea5e9" : "var(--border)"}`, borderRadius: 5, background: isOpen ? "color-mix(in srgb,#0ea5e9 10%,white)" : "white", cursor: "pointer", color: isOpen ? "#0ea5e9" : "var(--muted-fg)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                👁
                              </button>
                            </div>

                            {/* Expanded detail */}
                            {isOpen && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid color-mix(in srgb,#0ea5e9 20%,var(--border))" }}>
                                {weekReqs.length === 0 ? (
                                  <div style={{ fontSize: 11, color: "var(--muted-fg)", fontStyle: "italic" }}>
                                    {t("home.qportal.noRequestsThisWeek")}
                                  </div>
                                ) : (
                                  <>
                                    {/* Service type chips */}
                                    {svcEntries.length > 0 && (
                                      <div style={{ marginBottom: 8 }}>
                                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{t("home.qportal.byServiceType")}</div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                          {svcEntries.map(([svc, cnt]) => (
                                            <span key={svc} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 12, background: `color-mix(in srgb, ${SVC_COLOR[svc]||"#94a3b8"} 12%, white)`, color: SVC_COLOR[svc]||"#94a3b8", border: `1px solid color-mix(in srgb, ${SVC_COLOR[svc]||"#94a3b8"} 28%, var(--border))` }}>
                                              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{cnt}</span> {svc}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* State breakdown */}
                                    <div style={{ marginBottom: 8 }}>
                                      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{t("home.qportal.byState")}</div>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        {Object.entries(byState).map(([state, cnt]) => (
                                          <span key={state} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 12, background: `color-mix(in srgb, ${STATE_COLOR[state]||"#94a3b8"} 12%, white)`, color: STATE_COLOR[state]||"#94a3b8", border: `1px solid color-mix(in srgb, ${STATE_COLOR[state]||"#94a3b8"} 28%, var(--border))` }}>
                                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{cnt}</span> {state}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    {/* Last 5 requests */}
                                    <div>
                                      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("home.qportal.lastRequests", "", { count: weekReqs.length })}</div>
                                      {weekReqs.slice(0, 5).map(r => (
                                        <div key={r._id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                                          <span style={{ width: 6, height: 6, borderRadius: 999, background: STATE_COLOR[r.state]||"#94a3b8", flexShrink: 0 }} />
                                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg)" }}>{r.description || `#${r.sequence}`}</span>
                                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted-fg)", flexShrink: 0, fontSize: 10 }}>{r.requested_by?.split("@")[0]}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })() : (
                      <div style={{ color: "var(--muted-fg)", fontSize: 12 }}>{t("home.qportal.noMetrics")}</div>
                    )}
                    <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted-fg)" }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "#22c55e", flexShrink: 0 }} /> {t("home.qportal.handledLegend")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted-fg)" }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "#ef4444", flexShrink: 0 }} /> {t("home.qportal.rejectedLegend")}
                      </div>
                    </div>
                    {metrics && (
                      <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
                        {[["nrequest",t("home.qportal.totalRequests"),"#0ea5e9"],["nproject",t("home.qportal.projects"),"#8b5cf6"],["nservice",t("home.qportal.services"),"#f97316"]].map(([k,l,c]) => (
                          <div key={k} style={{ flex: 1, textAlign: "center", padding: "8px 4px", background: "var(--muted)", borderRadius: 6 }}>
                            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: c }}>{(metrics[k]||0).toLocaleString()}</div>
                            <div style={{ fontSize: 9.5, color: "var(--muted-fg)", marginTop: 2 }}>{l}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            );
          })() } : {}),
        };

        // Note Blocks — a diferencia de los fijos de arriba, no tienen una
        // entrada estática: se agregan uno por nota existente, en la columna
        // donde el layout diga que están.
        notes.forEach(note => {
          const col = layout.left.includes(note.id) ? "left" : "right";
          panelContent[note.id] = (
            <Panel key={note.id} title={t("home.note.panelTitle")}
              draggable dragId={note.id} col={col} layout={layout} dragging={dragging} dragOver={dragOver} setDragOver={setDragOver} movePanel={movePanel}
              onRemove={() => deleteNote(note.id)}>
              <NoteBlockContent note={note} onSave={changes => saveNote(note.id, changes)} onDelete={() => deleteNote(note.id)} />
            </Panel>
          );
        });

        // Comportamientos por item que el shape genérico no expresa: Outline
        // abre su modal de documento en vez del link externo.
        const blockItemHandlers = {
          "outline.recent-docs": item => setModalDoc({
            id: item.id, title: item.title, updatedBy: item.subtitle,
            updatedAt: item.timestamp, absoluteUrl: item.url,
          }),
        };
        // Un block de pull requests abre su detalle en un modal en vez de
        // mandarte a GitHub. La clave lleva el id de la conexión, no el tipo:
        // una segunda conexión GitHub tiene sus propios blocks.
        // Se filtra tambien por tipo de conector, no solo por blockId: GitLab
        // declara su propio "recent-commits" y no tiene la ruta de detalle, asi
        // que capturarle el click lo llevaria a un 404 en vez de a GitHub.
        connectorBlocks.forEach(candidate => {
          if ((candidate.connectorType || candidate.connectorId) !== "github") return;
          if (candidate.blockId === "open-pull-requests") {
            blockItemHandlers[candidate.id] = item => setModalPR({ ...item, connectorId: candidate.connectorId });
          }
          if (candidate.blockId === "recent-commits") {
            blockItemHandlers[candidate.id] = item => setModalCommit({ ...item, connectorId: candidate.connectorId });
          }
          if (candidate.blockId === "open-issues") {
            blockItemHandlers[candidate.id] = item => setModalIssue({ ...item, connectorId: candidate.connectorId });
          }
        });

        // Blocks declarados por conectores — genéricos, salvo que alguien haya
        // registrado un componente propio en window.HomeBlocks.
        connectorBlocks.forEach(block => {
          const col = layout.left.includes(block.id) ? "left" : "right";
          const panelProps = {
            draggable: true, dragId: block.id, col, layout, dragging, dragOver,
            setDragOver, movePanel, onRemove: () => removeBlock(block.id),
          };
          const Custom = window.HomeBlocks?.[block.id];
          panelContent[block.id] = Custom
            ? <Custom key={block.id} block={block} panelProps={panelProps} />
            : <ConnectorBlockPanel key={block.id} block={block} panelProps={panelProps} onItemClick={blockItemHandlers[block.id]} />;
        });

        // Custom blocks (Block Builder) — mismo panel genérico, ya trae
        // scope/limit propios que ConnectorBlockPanel.load ya sabe leer.
        // Uno marcado "Oculta" (active:false) simplemente no entra acá — su id
        // sigue en el layout guardado por si se reactiva, pero no se renderiza.
        customBlocks.filter(block => block.active !== false).forEach(block => {
          const col = layout.left.includes(block.id) ? "left" : "right";
          const panelProps = {
            draggable: true, dragId: block.id, col, layout, dragging, dragOver,
            setDragOver, movePanel, onRemove: () => removeBlock(block.id),
          };
          panelContent[block.id] = <ConnectorBlockPanel key={block.id} block={block} panelProps={panelProps} />;
        });

        const panelsOf = (colId) => layout[colId].map(id => panelContent[id]).filter(Boolean);
        const anyPanels = panelsOf("left").length > 0 || panelsOf("right").length > 0;
        const renderCol = (colId) => {
          const panels = panelsOf(colId);
          return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}
            onDragOver={e => { e.preventDefault(); if (!layout[colId].length) setDragOver({ col: colId, idx: 0 }); }}
            onDrop={e => {
              e.preventDefault();
              if (!dragging.current) return;
              const { id: fromId, col: fromCol, idx: fromIdx } = dragging.current;
              if (!layout[colId].length) { movePanel(fromCol, fromIdx, colId, 0); }
              dragging.current = null; setDragOver(null);
            }}>
            {panels.length === 0 ? (
              <window.LintayaEmptyState
                icon="🧱"
                title={t("home.zoneEmptyTitle", "Zone {n} is empty", { n: colId === "left" ? 1 : 2 })}
                body={t("home.zoneEmptyBody", "Add a block to start filling this zone.")}
                action={colId === "left" ? t("home.addBlock.zone1", "+ Block · Zone 1") : t("home.addBlock.zone2", "+ Block · Zone 2")}
                onAction={() => setShowAddBlock(colId)}
              />
            ) : panels}
          </div>
          );
        };

        return (
          <div className="home-dashboard-grid" ref={zoneGridRef} style={{
            display: "grid",
            // Sin un solo bloque las dos zonas dicen lo mismo, asi que reparten
            // el ancho a partes iguales; el desequilibrio 1.4/1 solo tiene
            // sentido cuando hay contenido que lo justifique.
            gridTemplateColumns: anyPanels ? `${zoneRatio}fr 12px 1fr` : "1fr 1fr",
            columnGap: anyPanels ? 0 : 12,
          }}>
            {renderCol("left")}
            {anyPanels && (
              <window.BoardResizeSeparator
                vertical
                className="home-zone-resizer"
                ratio={zoneRatio / (1 + zoneRatio)}
                onPointerDown={startZoneResize}
                onKeyDown={nudgeZone}
              />
            )}
            {renderCol("right")}
          </div>
        );
      })()}
    </div>
  );
}

function Panel({ title, titleExtra, action, children, draggable: isDraggable, dragId, col, layout, dragging, dragOver, setDragOver, movePanel, onRemove, removeLabel, removeTitle, removeButtonRef, contentScroll, contentScrollLabel, fillHeight, hideHeader = false }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const idx     = layout?.[col]?.indexOf(dragId) ?? -1;
  const isOver  = dragOver?.col === col && dragOver?.idx === idx;

  const handleDragStart = (e) => {
    dragging.current = { id: dragId, col, idx };
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
    dragging.current = null;
    setDragOver(null);
  };
  const handleDragOver = (e) => {
    if (!dragging.current || dragging.current.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver({ col, idx });
  };
  const handleDrop = (e) => {
    e.preventDefault();
    if (!dragging.current || dragging.current.id === dragId) return;
    const { id: fromId, col: fromCol, idx: fromIdx } = dragging.current;
    movePanel(fromCol, fromIdx, col, idx);
    dragging.current = null;
    setDragOver(null);
  };

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
      onDragOver={isDraggable ? handleDragOver : undefined}
      onDrop={isDraggable ? handleDrop : undefined}
      style={{
        background: "white", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
        minHeight: contentScroll ? 0 : undefined,
        maxHeight: contentScroll ? "100%" : undefined,
        // Home stacks several panels of naturally different height in one
        // column, so they size to their own content ("0 1 auto") instead of
        // fighting each other for space. A Board zone is dedicated space for
        // its block(s) — fillHeight (set only by custom-page-view.jsx) makes
        // it grow and share the zone evenly instead of leaving it half empty.
        flex: contentScroll ? (fillHeight ? "1 1 0" : "0 1 auto") : undefined,
        display: contentScroll ? "flex" : undefined,
        flexDirection: contentScroll ? "column" : undefined,
        outline: isOver ? "2px dashed var(--accent)" : "none",
        outlineOffset: 2,
        transition: "outline .1s",
      }}>
      {!hideHeader && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: contentScroll ? 0 : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isDraggable && (
            <span title={t("home.panel.dragToMove")} style={{ cursor: "grab", color: "var(--muted-fg)", fontSize: 14, lineHeight: 1, userSelect: "none", opacity: 0.5 }}>⠿</span>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "var(--muted-fg)", textTransform: "uppercase" }}>{title}</span>
          {titleExtra}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {action && <button onClick={action.onClick} disabled={action.disabled} style={{ background: "none", border: 0, color: action.disabled ? "var(--muted-fg)" : "var(--accent)", fontSize: 12, fontWeight: 500, cursor: action.disabled ? "default" : "pointer", fontFamily: "inherit", opacity: action.disabled ? 0.6 : 1 }}>{action.label} {action.disabled ? "⟳" : "→"}</button>}
          {onRemove && (
            <button ref={removeButtonRef} type="button" onClick={onRemove}
              aria-label={removeLabel || t("home.panel.removeDefault", "", { title })}
              title={removeTitle || t("home.panel.removeTitleDefault")}
              style={{ background: "none", border: 0, color: "var(--muted-fg)", fontSize: 15, lineHeight: 1, cursor: "pointer", padding: 2 }}
              onMouseEnter={e => e.currentTarget.style.color = "var(--err)"}
              onMouseLeave={e => e.currentTarget.style.color = "var(--muted-fg)"}>
              ×
            </button>
          )}
        </div>
      </div>}
      {contentScroll ? (
        <div className="board-block-scroll" role="region" tabIndex={0}
          aria-label={contentScrollLabel || t("home.panel.contentScrollDefault", "", { title })}
          style={{
            minHeight: 0, flex: "1 1 auto", overflowX: "hidden", overflowY: "auto",
            scrollbarWidth: "thin", scrollbarColor: "var(--scrollbar) transparent",
            overscrollBehavior: "contain",
          }}>
          {children}
        </div>
      ) : children}
    </div>
  );
}

window.HomeView = HomeView;
// Reused by the Module Builder (module-builder.jsx) and interactive Board
// workspace (custom-page-view.jsx) to show real, synced, paginated block data without
// re-implementing the fetch/sync/pagination logic a second time.
window.Panel = Panel;
window.ConnectorBlockPanel = ConnectorBlockPanel;
window.DocumentDetailModal = DocumentDetailModal;
window.Pager = Pager;
window.paginate = paginate;
