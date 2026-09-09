// Blocks — catálogo de los blocks activos hoy en Home (vCenter alerts, Plane
// tasks, QPortal solicitudes, GitLab commits, Outline docs). Fuente única de
// verdad: /api/home/blocks (lo que cada conector declara en su manifest.json,
// ya filtrado por "conector configurado" server-side) — lista de solo lectura,
// mismo patrón visual que VMs. Para editar el layout real hay que ir a Home;
// "+ Nuevo Bloque" abre el Block Builder para armar uno custom.
const { useState, useEffect } = React;
const bct = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

// ── Ancho del panel de preview ───────────────────────────────────────────────
// Por navegador y no por cuenta, igual que el del Assistant (ai-chat.jsx): es
// una preferencia de esta ventana, no un ajuste que valga la pena sincronizar.
const PREVIEW_WIDTH_KEY = "hq-blocks-preview-width";
const PREVIEW_MIN_WIDTH = 300;
const PREVIEW_DEFAULT_WIDTH = 400;
const previewMaxWidth = () => Math.round(window.innerWidth * 0.6);

function loadPreviewWidth() {
  try {
    const stored = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.min(stored, previewMaxWidth()) : PREVIEW_DEFAULT_WIDTH;
  } catch {
    return PREVIEW_DEFAULT_WIDTH;
  }
}

const BLOCK_CONNECTOR_STYLE = {
  vcenter:   { icon: "VC", color: "#2563eb" },
  plane:     { icon: "PL", color: "#6366f1" },
  qportal:   { icon: "QP", color: "#9333ea" },
  gitlab:    { icon: "GL", color: "#fc6d26" },
  github:    { icon: "GH", color: "#1c1917" },
  outline:   { icon: "OL", color: "#0f172a" },
  bitbucket: { icon: "BB", color: "#0052cc" },
  portainer: { icon: "PT", color: "#13bef9" },
  bitwarden: { icon: "BW", color: "#175ddc" },
  outlook:   { icon: "OU", color: "#0078d4" },
  "outlook-local": { icon: "CO", color: "#2563eb" },
  ucsm:      { icon: "UC", color: "#1e40af" },
};

function BlockLogo({ connectorId, size = 28, color, icon }) {
  // `icon` (si se pasa) son las iniciales que /api/connectors declara para ese
  // conector. Mismo papel que `color`: BLOCK_CONNECTOR_STYLE es una lista fija
  // que no conoce a los conectores instalados aparte (lintaya-remote,
  // anthropic, los del connector pack), y esos caían todos en "?".
  const s = BLOCK_CONNECTOR_STYLE[connectorId] || { icon: icon || "?", color: "var(--muted-fg)" };
  // Logo real de marca cuando connectors.jsx tiene uno declarado (GitLab,
  // GitHub, Outline, Plane, vCenter, …) — connectorIconContent devuelve el
  // texto de `icon` sin tocar para los que no tienen logo (ej. Qportal), así
  // que el fallback a las iniciales sigue funcionando solo.
  const content = window.connectorIconContent ? window.connectorIconContent(connectorId, s.icon, Math.round(size * 0.64)) : s.icon;
  // `color` (si se pasa) es el color real guardado en /api/connectors para
  // esta conexión — el mismo que pinta el fondo del logo en Connectors.
  // BLOCK_CONNECTOR_STYLE queda solo como fallback para cuando esa conexión
  // no aparece ahí (o mientras carga).
  const bg = color || s.color;
  return (
    <div style={{ width: size, height: size, borderRadius: 7, background: bg, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.36, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
      {content}
    </div>
  );
}

// Mismo select-con-label que usa el toolbar de VMs (vms.jsx) — duplicado acá
// porque este repo no comparte componentes entre .jsx sin pasar por window.*.
function FilterChip({ label, value, options, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-fg)", flexShrink: 0 }}>
      {label}:
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        height: 32, padding: "0 26px 0 8px", border: "1px solid var(--border)",
        borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "white", color: "var(--fg)", cursor: "pointer",
        appearance: "none",
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
        backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
      }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// Scripts JSX are isolated (no bundler/imports), so this catalog keeps its
// small action-button wrapper local and reads the shared line icons lazily
// from app.jsx's window.ICONS when the table renders.
function BlockCatalogActionButton({ label, title = label, iconName, onClick, danger = false }) {
  const fallback = iconName === "edit" ? "✎" : iconName === "trash" ? "⌫" : "👁";
  const icon = window.ICONS?.[iconName] || <span style={{ fontSize: 13 }}>{fallback}</span>;
  const restingColor = danger ? "var(--err)" : "var(--muted-fg)";
  return (
    <button type="button" aria-label={label} title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--row-hover)"; e.currentTarget.style.color = danger ? "var(--err)" : "var(--fg)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = restingColor; }}
      style={{
        width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--border)", background: "white", borderRadius: 6,
        cursor: "pointer", color: restingColor,
      }}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>{icon}</span>
    </button>
  );
}

// Mismo patrón que ChatResizeHandle (ai-chat.jsx) y BoardResizeSeparator
// (custom-page-view.jsx): arrastre por pointer con flechas para teclado. El
// borde que se arrastra es el izquierdo, así que el panel crece hacia la
// izquierda y un delta negativo del mouse lo agranda.
function BlockPreviewResizeHandle({ width, onResize, onCommit }) {
  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus(); // preventDefault() se come el foco por clic
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (moveEvent) => {
      latest = Math.min(previewMaxWidth(), Math.max(PREVIEW_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)));
      onResize(latest);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(latest);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = Math.min(previewMaxWidth(), Math.max(PREVIEW_MIN_WIDTH, width + (event.key === "ArrowLeft" ? 24 : -24)));
    onResize(next);
    onCommit(next);
  };
  return (
    <div
      role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={bct("ui.blocks.resizePreviewPanel", "Resize the preview panel")}
      aria-valuemin={PREVIEW_MIN_WIDTH} aria-valuemax={previewMaxWidth()} aria-valuenow={width}
      onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      title={bct("ui.resize", "Drag to resize · arrow keys also work")}
      style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 8, zIndex: 5,
        cursor: "col-resize", touchAction: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <span aria-hidden="true" style={{ width: 3, height: 42, borderRadius: 99, background: "var(--border)" }} />
    </div>
  );
}

function BlockCatalogView({ isMobile }) {
  window.I18N?.useLocale();
  const [connectorBlocks, setConnectorBlocks] = useState(null); // null = cargando
  const [customBlocks, setCustomBlocks] = useState([]);
  const [layout, setLayout] = useState({ left: [], right: [] });
  // connectorId -> color real guardado en /api/connectors, para que el fondo
  // del logo en Blocks sea EXACTAMENTE el mismo que en Connectors (no una
  // paleta de marca aparte que puede no coincidir con lo que el usuario
  // eligió/tiene guardado).
  const [connectorColors, setConnectorColors] = useState({});
  // null = cerrado; "new" = creando; un objeto block = editándolo.
  const [builderTarget, setBuilderTarget] = useState(null);
  // null = panel cerrado; un block = el que se está previsualizando.
  const [previewBlock, setPreviewBlock] = useState(null);
  const [previewWidth, setPreviewWidth] = useState(loadPreviewWidth);
  // Borrar un block es irreversible y el botón vive en la propia fila: sin
  // confirmación, un clic de más se lleva el block por delante.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const commitPreviewWidth = (next) => {
    try { localStorage.setItem(PREVIEW_WIDTH_KEY, String(next)); } catch { /* modo privado */ }
  };
  const [q, setQ] = useState("");
  const [connectorFilter, setConnectorFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [estadoFilter, setEstadoFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");

  const reload = () => {
    window.HQ_API.request("/api/home/blocks").then(setConnectorBlocks).catch(() => setConnectorBlocks([]));
    window.HQ_API.request("/api/home/custom-blocks").then(setCustomBlocks).catch(() => setCustomBlocks([]));
    window.HQ_API.request("/api/home/layout").then(setLayout).catch(() => {});
    window.HQ_API.request("/api/connectors")
      .then(list => setConnectorColors(Object.fromEntries((list || []).filter(c => c.color).map(c => [c.id, c.color]))))
      .catch(() => {});
  };
  useEffect(reload, []);

  // Ids legacy (pre-manifest) que puede tener guardado el layout de Home para
  // este mismo block — ver LEGACY_BLOCK_IDS / HOME_LAYOUT_DEFAULT en home.jsx.
  const inHome = (b) => {
    const all = [...(layout.left || []), ...(layout.right || [])];
    return all.includes(b.id) || all.includes(b.blockId) || all.includes(b.connectorId);
  };

  const deleteCustomBlock = async (id) => {
    await window.HQ_API.request(`/api/home/custom-blocks/${id}`, { method: "DELETE" });
    reload();
    // Same staleness this page's own reload() fixes for itself — App()'s
    // shared blockCatalog (Boards' CustomPageView) needs its own nudge too.
    window.dispatchEvent(new CustomEvent("hq:custom-blocks-changed"));
  };

  const totalCount = (connectorBlocks || []).length + customBlocks.length;

  // "Fijo" (manifest) nunca tiene active:false — "Oculta" solo puede salir de
  // un custom block, así que el filtro simplemente no matchea ninguna fila
  // Fijo cuando está en "oculta", sin necesitar un caso especial acá.
  const estadoOf = (b, isCustom) => isCustom && b.active === false ? "oculta" : inHome(b) ? "en-home" : "no-agregado";
  const term = q.trim().toLowerCase();
  const matches = (b, isCustom) =>
    (connectorFilter === "all" || b.connectorId === connectorFilter) &&
    (typeFilter === "all" || typeFilter === (isCustom ? "custom" : "fijo")) &&
    (estadoFilter === "all" || estadoFilter === estadoOf(b, isCustom)) &&
    (tagFilter === "all" || (b.tags || []).includes(tagFilter)) &&
    (!term || b.title.toLowerCase().includes(term) || (b.description || "").toLowerCase().includes(term) || (b.connectorId || "").toLowerCase().includes(term));

  // Sobre la lista completa, no la filtrada: si se calculara sobre lo visible,
  // elegir una etiqueta dejaría el desplegable con esa sola opción y no habría
  // forma de cambiar a otra.
  const tagOptions = window.tagFilterOptions ? window.tagFilterOptions([...(connectorBlocks || []), ...customBlocks]) : [];

  const filteredConnectorBlocks = (connectorBlocks || []).filter(b => matches(b, false));
  const filteredCustomBlocks = customBlocks.filter(b => matches(b, true));
  const visibleCount = filteredConnectorBlocks.length + filteredCustomBlocks.length;

  // One combined, ordered list for pagination — the table shows Fijo rows
  // then Custom rows as a single continuous list, so a page boundary should
  // cut across both, not paginate each kind separately. usePagination (and
  // its internal hooks) must run every render, so this stays above the
  // "Cargando…" early return below — never call it conditionally.
  const allFiltered = React.useMemo(
    () => [
      ...filteredConnectorBlocks.map(b => ({ ...b, __kind: "fixed" })),
      ...filteredCustomBlocks.map(b => ({ ...b, __kind: "custom" })),
    ],
    [filteredConnectorBlocks, filteredCustomBlocks],
  );
  const pagination = usePagination(allFiltered, { key: "blocks-catalog" });
  const pageConnectorBlocks = pagination.pageItems.filter(b => b.__kind === "fixed");
  const pageCustomBlocks = pagination.pageItems.filter(b => b.__kind === "custom");

  if (connectorBlocks === null) {
    return <div style={{ padding: 20, color: "var(--muted-fg)", fontSize: 13 }}>{bct("containers.loading", "Loading…")}</div>;
  }

  // El builder ocupa la vista entera, igual que los editores de Board y de
  // Dashboard. Renderizarlo dentro del catálogo obligaba a un position:fixed
  // para taparlo, y eso tapaba también el menú lateral.
  if (builderTarget) {
    return <window.BlockBuilderView
      editing={builderTarget === "new" ? null : builderTarget}
      onClose={() => { setBuilderTarget(null); reload(); }}
    />;
  }

  // Un block kind:"content" (IA) no tiene connectorId — el filter() lo saca
  // antes del .map(), que si no reventaría con undefined.charAt().
  // La etiqueta es el nombre de la conexión, no su id: "Github"/"Github2" no
  // decía cuál de las dos cuentas era cuál. El value sigue siendo el id, que
  // es contra lo que compara matches(). Los bloques custom vienen de otro
  // endpoint y no traen nombre, así que ahí queda el id capitalizado.
  const connectorOptions = [...new Map([...connectorBlocks, ...customBlocks]
    .filter(b => b.connectorId)
    .map(b => [b.connectorId, b.connectorName || b.connectorId.charAt(0).toUpperCase() + b.connectorId.slice(1)]))]
    .sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div style={{ display: "flex", height: "100%", minWidth: 0 }}>
      {/* En móvil no caben lista y panel a la vez, así que el preview se queda
          con todo el ancho. Se oculta en vez de desmontarse para volver al
          mismo filtro y la misma página al cerrarlo. */}
      <div style={{
        display: isMobile && previewBlock ? "none" : "block",
        flex: 1, minWidth: 0, overflowY: "auto", padding: 20, maxWidth: 1480, margin: "0 auto",
      }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{bct("blocks.title", "Blocks")}</h1>
            <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
              {window.I18N.t("ui.blocks.configuredCount", "{count} configured block{plural} — live data from your connectors", { count: totalCount, plural: totalCount === 1 ? "" : "s" })}
            </p>
          </div>
          <button onClick={() => setBuilderTarget("new")}
            style={{ height: 32, padding: "0 12px", border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>{window.I18N.t("ui.blocks.new", "+ New Block")} </button>
        </div>

        {totalCount === 0 ? (
          <window.LintayaEmptyState
            icon="🧱"
            title={window.I18N.t("ui.blocks.emptyTitle", "No blocks yet")}
            body={window.I18N.t("ui.blocks.empty", "No active blocks — connect a system in Connectors to see data here.")}
          />
        ) : (<>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "nowrap", overflowX: "auto" }}>
          <div style={{ position: "relative", flex: "0 0 220px" }}>
            <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)", fontSize: 13 }}>⌕</span>
            <input placeholder={window.I18N.t("ui.blocks.search", "Search blocks…")} value={q} onChange={e => setQ(e.target.value)}
              style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "white", outline: "none" }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"} />
          </div>
          <FilterChip label={window.I18N.t("boards.connector", "Connector")} value={connectorFilter} options={[["all", "All"], ...connectorOptions]} onChange={setConnectorFilter} />
          <FilterChip label={window.I18N.t("boards.type", "Type")} value={typeFilter} options={[["all", "All"], ["fijo", window.I18N.t("blocks.fixed", "Fixed")], ["custom", "Custom"]]} onChange={setTypeFilter} />
          <FilterChip label={window.I18N.t("settings.ai.status", "Status")} value={estadoFilter} options={[["all", "All"], ["en-home", window.I18N.t("blocks.inHome", "On Home")], ["no-agregado", window.I18N.t("blocks.noAdded", "Not added")], ["oculta", window.I18N.t("ui.blocks.hidden", "Hidden")]]} onChange={setEstadoFilter} />
          {tagOptions.length > 0 && (
            <FilterChip label={bct("tags.title", "Tags")} value={tagFilter} options={[["all", "All"], ...tagOptions]} onChange={setTagFilter} />
          )}
          <div style={{ marginLeft: "auto", flexShrink: 0, fontSize: 12, color: "var(--muted-fg)", whiteSpace: "nowrap" }}>
            <b style={{ color: "var(--fg)" }}>{visibleCount}</b> / {totalCount}
          </div>
        </div>


        <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", overflow: "hidden" }}>
          <table className="blocks-catalog-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--muted)", color: "var(--muted-fg)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase" }}>
                <th className="blocks-catalog-icon" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}></th>
                <th className="blocks-catalog-title" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{bct("blocks.block", "Block")}</th>
                <th className="blocks-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{window.I18N.t("boards.connector", "Connector")}</th>
                <th className="blocks-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{window.I18N.t("boards.type", "Type")}</th>
                <th className="blocks-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{window.I18N.t("settings.ai.status", "Status")}</th>
                <th className="blocks-catalog-actions" style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>{window.I18N.t("settings.ai.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {totalCount > 0 && visibleCount === 0 && (
                <tr><td colSpan={6} style={{ padding: "28px 14px", textAlign: "center", color: "var(--muted-fg)", fontSize: 12.5 }}>{window.I18N.t("ui.blocks.noMatches", "No results — adjust the filters or search.")} </td></tr>
              )}
              {pageConnectorBlocks.map((b, i) => (
                <tr key={b.id}
                  style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent", cursor: "pointer" }}
                  onClick={() => setPreviewBlock(b)}
                  tabIndex={0}
                  aria-selected={previewBlock?.id === b.id}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPreviewBlock(b); } }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent"}>
                  <td className="blocks-catalog-icon" style={{ padding: "8px 12px" }}><BlockLogo connectorId={b.connectorType || b.connectorId} color={connectorColors[b.connectorId]} /></td>
                  <td className="blocks-catalog-title" style={{ padding: "8px 12px", fontWeight: 500 }}>{b.icon ? `${b.icon} ` : ""}{b.title}</td>
                  <td className="blocks-catalog-secondary" style={{ padding: "8px 12px", color: "var(--muted-fg)" }}>{b.connectorName || b.connectorType || b.connectorId}</td>
                  <td className="blocks-catalog-secondary" style={{ padding: "8px 12px", color: "var(--muted-fg)" }}>{bct("blocks.fixed", "Fixed")}</td>
                  <td className="blocks-catalog-secondary" style={{ padding: "8px 12px" }}>
                    {inHome(b)
                      ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "color-mix(in srgb, var(--ok) 14%, white)", color: "var(--ok)" }}>{window.I18N.t("blocks.inHome", "On Home")}</span>
                      : <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "var(--muted)", color: "var(--muted-fg)" }}>{bct("blocks.noAdded", "Not added")}</span>}
                  </td>
                  <td className="blocks-catalog-actions" style={{ padding: "8px 12px", textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end", whiteSpace: "nowrap" }}>
                    <BlockCatalogActionButton label={window.I18N.t("ui.blocks.createCopy", "Create an editable copy of {0}", { 0: b.title })} iconName="edit"
                      title={window.I18N.t("ui.blocks.copyHelp", "A fixed Block cannot be edited: create a custom copy with the same connector and data type")}
                      onClick={() => setBuilderTarget({ connectorId: b.connectorId, blockId: b.blockId, title: b.title, icon: b.icon })} />
                    <BlockCatalogActionButton label={bct("ui.blocks.previewNamed", "Preview {0}", { 0: b.title })} iconName="view"
                      onClick={() => setPreviewBlock(b)} />
                  </td>
                </tr>
              ))}
              {pageCustomBlocks.map((b, i) => (
                <tr key={b.id}
                  style={{ borderTop: "1px solid var(--border)", background: (pageConnectorBlocks.length + i) % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent", cursor: "pointer" }}
                  onClick={() => setPreviewBlock(b)}
                  tabIndex={0}
                  aria-selected={previewBlock?.id === b.id}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPreviewBlock(b); } }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = (pageConnectorBlocks.length + i) % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent"}>
                  <td className="blocks-catalog-icon" style={{ padding: "8px 12px" }}>
                    {b.kind === "content"
                      ? <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{b.icon || "🤖"}</div>
                      : <BlockLogo connectorId={b.connectorId} color={connectorColors[b.connectorId]} />}
                  </td>
                  <td className="blocks-catalog-title" style={{ padding: "8px 12px", fontWeight: 500 }}>
                    {b.icon ? `${b.icon} ` : ""}{b.title}
                    {b.description && <div style={{ fontWeight: 400, fontSize: 11, color: "var(--muted-fg)", marginTop: 1 }}>{b.description}</div>}
                  </td>
                  <td className="blocks-catalog-secondary" style={{ padding: "8px 12px", color: "var(--muted-fg)", textTransform: "capitalize" }}>{b.kind === "content" ? "IA" : b.connectorId}</td>
                  <td className="blocks-catalog-secondary" style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "color-mix(in srgb, var(--accent) 14%, white)", color: "var(--accent)" }}>{bct("blocks.custom", "Custom")}</span>
                  </td>
                  <td className="blocks-catalog-secondary" style={{ padding: "8px 12px" }}>
                    {b.active === false
                      ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "var(--muted)", color: "var(--muted-fg)" }}>{bct("blocks.hidden", "Hidden")}</span>
                      : inHome(b)
                        ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "color-mix(in srgb, var(--ok) 14%, white)", color: "var(--ok)" }}>{bct("blocks.inHome", "On Home")}</span>
                        : <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "var(--muted)", color: "var(--muted-fg)" }}>{bct("blocks.noAdded", "Not added")}</span>}
                  </td>
                  <td className="blocks-catalog-actions" style={{ padding: "8px 12px", textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end", whiteSpace: "nowrap" }}>
                    <BlockCatalogActionButton label={window.I18N.t("ui.editNamed", "Edit {0}", { 0: b.title })} iconName="edit"
                      onClick={() => setBuilderTarget(b)} />
                    <BlockCatalogActionButton label={bct("ui.blocks.previewNamed", "Preview {0}", { 0: b.title })} iconName="view"
                      onClick={() => setPreviewBlock(b)} />
                    <BlockCatalogActionButton label={window.I18N.t("ui.deleteNamed", "Delete {0}", { 0: b.title })} iconName="trash" danger
                      onClick={() => setConfirmDelete(b)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleCount > 0 && <PaginationBar {...pagination} />}
        </>)}
      </div>

      {previewBlock && (
        <aside aria-label={bct("ui.blocks.previewPanel", "Block preview")}
          style={{
            // Acotado en el render y no solo al cargar: si la ventana se
            // encoge, un ancho guardado de antes dejaría el panel desbordado.
            width: isMobile ? "100%" : Math.min(previewWidth, previewMaxWidth()),
            flexShrink: 0, position: "relative", overflowY: "auto",
            background: "var(--muted)", padding: "16px 14px 24px",
            borderLeft: isMobile ? "none" : "1px solid var(--border)",
          }}>
          {!isMobile && <BlockPreviewResizeHandle width={previewWidth} onResize={setPreviewWidth} onCommit={commitPreviewWidth} />}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, fontSize: 10.5, fontWeight: 600, color: "var(--muted-fg)", letterSpacing: 0.4, textTransform: "uppercase" }}>
              {bct("blockBuilder.livePreview", "Live preview")}
            </div>
            <button onClick={() => setPreviewBlock(null)} title={bct("ui.blocks.closePreview", "Close the preview")}
              style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
          </div>
          {/* El mismo componente con el que Home pinta el block, no una
              maqueta aparte: la key lo remonta al cambiar de fila para que
              vuelva a pedir sus datos en vez de mostrar los del anterior. */}
          <window.ConnectorBlockPanel key={previewBlock.id} block={previewBlock} />
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5 }}>
            {bct("ui.blocks.previewHelp", "This is exactly how it will look on Home or any Board you add it to.")}
          </div>
        </aside>
      )}

      {confirmDelete && (
        <window.ConfirmModal
          title={bct("ui.confirm.deleteTitle", "Confirm deletion")}
          message={bct("ui.blocks.confirmDelete", "Delete Block “{0}”? It is removed from Home and from any Board using it. This cannot be undone.", { 0: confirmDelete.title })}
          onConfirm={() => deleteCustomBlock(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)} />
      )}
    </div>
  );
}

window.BlockCatalogView = BlockCatalogView;
// Reused by the Module Builder block picker (module-builder.jsx) so its
// connector color/initials match the existing Blocks catalog exactly.
window.BLOCK_CONNECTOR_STYLE = BLOCK_CONNECTOR_STYLE;
window.BlockLogo = BlockLogo;
