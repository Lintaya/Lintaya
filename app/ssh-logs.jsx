// Logs — mismo patrón visual que DocumentationView (app/documentation.jsx):
// tabs arriba (SSH / Conectores), panel lateral izquierdo con la lista a
// filtrar (máquinas o conectores) y contenido a la derecha.
//  - SSH: historial de sesiones (lee server/ssh-logs vía /api/ssh/logs)
//  - Conectores: activity log por conector (ya vive en /api/connectors/status,
//    hasta ahora solo visible abriendo el detalle de un conector a la vez)
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const lt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

function parseSshLogName(file) {
  // formato: <YYYY-MM-DD>_<ip>_<user>_<sessionId>.log
  const m = file.replace(/\.log$/, "").match(/^(\d{4}-\d{2}-\d{2})_(.+?)_(.+?)_([^_]+)$/);
  if (!m) return { date: "?", ip: "?", user: "?", sid: "" };
  return { date: m[1], ip: m[2], user: m[3], sid: m[4] };
}

function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

const inputStyle = {
  width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)",
  borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "var(--surface)", color: "var(--fg)",
};

// Estilos de tabla compartidos entre SshPane y ConnectorsPane — mismo formato
// para las dos pestañas de Logs.
const th = { padding: "6px 10px", textAlign: "left", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted-fg)" };
const td = { padding: "6px 10px", fontSize: 12.5, borderTop: "1px solid var(--border)" };

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative", flex: "0 1 340px" }}>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

const sidebarToggleIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
);

// Same shape as repos.jsx's useReposResizableWidth/ResizeHandle and
// module-builder.jsx's useModuleBuilderResizableWidth — duplicated locally
// rather than shared, matching how every other resizable panel in this app
// is built (see module-builder.jsx's own comment on that choice).
function useLogsResizableWidth(storageKey, defaultWidth, min = 180, max = 420) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= min && saved <= max ? saved : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      currentWidth = Math.min(max, Math.max(min, startWidth + (ev.clientX - startX)));
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

// ── Panel lateral compartido: búsqueda + lista de máquinas/conectores ──────
// Mismo ancho y estilo de item que el árbol de archivos de Documentación, y
// mismo patrón de colapsar/expandir que ese sidebar — para liberar margen
// cuando no hace falta la lista. El ancho también se puede arrastrar, igual
// que los paneles equivalentes de Repos y Board Builder.
function LogsLateral({ query, onQuery, placeholder, items, activeId, onSelect, allLabel, allCount }) {
  const [open, setOpen] = useState(true);
  const [width, onResizeStart] = useLogsResizableWidth("logs.sidebarWidth", 220);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title={window.I18N.t("ui.logs.showPanel", "Show panel")}
        style={{
          flexShrink: 0, width: 28, alignSelf: "stretch", borderRight: "1px solid var(--border)",
          background: "var(--surface)", border: 0, borderRight: "1px solid var(--border)",
          cursor: "pointer", color: "var(--muted-fg)", display: "flex", justifyContent: "center",
          alignItems: "flex-start", paddingTop: 10,
        }}>
        {sidebarToggleIcon}
      </button>
    );
  }

  return (
    <>
    <div style={{ width, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
        <input value={query} onChange={e => onQuery(e.target.value)} placeholder={placeholder} style={{
          flex: 1, minWidth: 0, boxSizing: "border-box", height: 30, padding: "0 8px", fontSize: 12,
          border: "1px solid var(--border)", borderRadius: 6, outline: "none", fontFamily: "inherit",
          background: "var(--surface)", color: "var(--fg)",
        }} />
        <button onClick={() => setOpen(false)} title={window.I18N.t("ui.logs.hidePanel", "Hide panel")} style={{
          flexShrink: 0, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          border: 0, background: "transparent", cursor: "pointer", color: "var(--muted-fg)", padding: 2, borderRadius: 5,
        }}>
          {sidebarToggleIcon}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        <button onClick={() => onSelect(null)} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
          width: "100%", textAlign: "left", border: 0, cursor: "pointer", fontFamily: "inherit",
          padding: "6px 10px", background: activeId == null ? "var(--muted)" : "transparent",
          color: activeId == null ? "var(--accent)" : "var(--fg)", fontWeight: activeId == null ? 600 : 400,
          fontSize: 12.5, borderLeft: activeId == null ? "2px solid var(--accent)" : "2px solid transparent",
        }}>
          <span>{allLabel}</span>
          <span style={{ fontSize: 10.5, color: "var(--muted-fg)" }}>{allCount}</span>
        </button>
        {items.length === 0 ? (
          <div style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--muted-fg)" }}>{lt("logs.noResults", "No results.")}</div>
        ) : items.map(it => {
          const active = activeId === it.id;
          return (
            <button key={it.id} onClick={() => onSelect(it.id)} title={it.label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
              width: "100%", textAlign: "left", border: 0, cursor: "pointer", fontFamily: "inherit",
              padding: "6px 10px", background: active ? "var(--muted)" : "transparent",
              color: active ? "var(--accent)" : "var(--fg)", fontWeight: active ? 600 : 400,
              fontSize: 12.5, borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              <span style={{ fontSize: 10.5, color: "var(--muted-fg)", flexShrink: 0 }}>{it.count}</span>
            </button>
          );
        })}
      </div>
    </div>
    <window.ResizeHandle onMouseDown={onResizeStart} />
    </>
  );
}

// ── SSH pane ──────────────────────────────────────────────────────────────────
function SshPane() {
  const [rows, setRows]       = useState(null);   // null = cargando
  const [ipName, setIpName]   = useState({});
  const [err, setErr]         = useState(null);
  const [q, setQ]             = useState("");
  const [deviceQ, setDeviceQ] = useState("");
  const [device, setDevice]   = useState(null);   // ip seleccionada en el lateral, o null = todas
  const [selected, setSelected] = useState(null); // { file, ... }
  const [content, setContent] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    window.HQ_API.request("/api/ssh/logs")
      .then(list => setRows(Array.isArray(list) ? list : []))
      .catch(e => { setErr(e.message || "Error"); setRows([]); });
  }, []);

  // Mapa IP → nombre de VM (para mostrar a qué máquina fue cada sesión)
  useEffect(() => {
    window.HQ_API.request("/api/vms-live").then(d => {
      const map = {};
      (d?.vms || []).forEach(v => {
        const ips = v.ips || (v.ip ? [v.ip] : []);
        ips.forEach(ip => { if (ip) map[ip] = v.name; });
      });
      setIpName(map);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const enriched = useMemo(() => (rows || []).map(r => {
    const p = parseSshLogName(r.file);
    return {
      ...r, ...p,
      name: ipName[p.ip] || null,
      when: new Date(r.mtime),
      empty: r.size <= 120,   // solo cabecera → sesión sin actividad / fallida
    };
  }), [rows, ipName]);

  // Lista de máquinas distintas vistas en el historial, para el panel lateral.
  const devices = useMemo(() => {
    const map = new Map();
    for (const r of enriched) {
      if (!map.has(r.ip)) map.set(r.ip, { id: r.ip, label: r.name || r.ip, count: 0 });
      map.get(r.ip).count++;
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [enriched]);

  const filteredDevices = useMemo(() => {
    const s = deviceQ.trim().toLowerCase();
    if (!s) return devices;
    return devices.filter(d => d.label.toLowerCase().includes(s) || d.id.toLowerCase().includes(s));
  }, [devices, deviceQ]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return enriched.filter(r => {
      if (device && r.ip !== device) return false;
      if (!s) return true;
      return r.ip.toLowerCase().includes(s) ||
        r.user.toLowerCase().includes(s) ||
        (r.name && r.name.toLowerCase().includes(s));
    });
  }, [enriched, q, device]);

  const pagination = usePagination(filtered, { key: "ssh-sessions" });

  function openLog(row) {
    setSelected(row);
    setContent("");
    setLoadingDoc(true);
    window.HQ_API.request("/api/ssh/logs/" + encodeURIComponent(row.file))
      .then(txt => setContent(typeof txt === "string" ? txt : JSON.stringify(txt, null, 2)))
      .catch(e => setContent(window.I18N.t("ui.logs.readFailed", "Could not read the log: ") + (e.message || e)))
      .finally(() => setLoadingDoc(false));
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <LogsLateral
        query={deviceQ} onQuery={setDeviceQ} placeholder={window.I18N.t("logs.searchMachine", "Search machine…")}
        items={filteredDevices} activeId={device} onSelect={setDevice}
        allLabel={window.I18N.t("ui.logs.allMachines", "All machines")} allCount={enriched.length}
      />

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ maxWidth: 1180 }}>
          <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <p style={{ margin: 0, color: "var(--muted-fg)", fontSize: 13 }}>{window.I18N.t("ui.logs.sshHelp", "SSH session history — date, user, and machine. Click a row to view the transcript.")} </p>
            <button onClick={load} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}>{lt("logs.refresh", "Refresh")}</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
            <SearchBox value={q} onChange={setQ} placeholder={lt("logs.searchSession", "Search by IP, user, or machine…")} />
            <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>{filtered.length} {window.I18N.t("logs.sessions", "sessions")}</span>
          </div>

          {err && <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 12 }}>{err}</div>}

          {rows === null ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: 20 }}>{lt("logs.loading", "Loading…")}</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: 20 }}>{lt("logs.empty", "No sessions recorded.")}</div>
          ) : (
            <>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--muted)" }}>
                  <th style={{ ...th, width: 160 }}>{lt("logs.date", "Date / time")}</th>
                  <th style={{ ...th, width: 110 }}>{lt("logs.user", "User")}</th>
                  <th style={{ ...th, width: 130 }}>IP</th>
                  <th style={th}>{lt("logs.machine", "Machine")}</th>
                  <th style={{ ...th, width: 90 }}>{lt("logs.size", "Size")}</th>
                </tr></thead>
                <tbody>
                  {pagination.pageItems.map(r => (
                    <tr key={r.file} onClick={() => openLog(r)}
                        style={{ cursor: "pointer", background: selected?.file === r.file ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)" }}
                        onMouseEnter={e => { if (selected?.file !== r.file) e.currentTarget.style.background = "var(--muted)"; }}
                        onMouseLeave={e => { if (selected?.file !== r.file) e.currentTarget.style.background = "var(--surface)"; }}>
                      <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-fg)" }}>
                        {r.when.toLocaleString(window.I18N.dateLocale(), { hour12: false })}
                      </td>
                      <td style={td}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: r.user === "root" ? "#b45309" : "var(--fg)" }}>{r.user}</span>
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{r.ip}</td>
                      <td style={td}>
                        {r.name
                          ? <span style={{ fontWeight: 500 }}>{r.name}</span>
                          : <span style={{ color: "var(--muted-fg)", fontStyle: "italic" }}>—</span>}
                        {r.empty && <span style={{ marginLeft: 8, fontSize: 9.5, color: "#9ca3af", background: "#f3f4f6", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>{lt("logs.inactive", "inactive")}</span>}
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-fg)" }}>{fmtBytes(r.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar {...pagination} />
            </>
          )}
        </div>
      </div>

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: 10, width: "min(900px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {selected.user}@{selected.ip}{selected.name ? <span style={{ color: "var(--muted-fg)", fontWeight: 400 }}> · {selected.name}</span> : null}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{selected.when.toLocaleString(window.I18N.dateLocale(), { hour12: false })} · {fmtBytes(selected.size)}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={"/api/ssh/logs/" + encodeURIComponent(selected.file)} target="_blank" rel="noreferrer"
                   style={{ height: 30, lineHeight: "30px", padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, textDecoration: "none", color: "var(--fg)" }}>{lt("logs.openRaw", "Open raw ↗")}</a>
                <button onClick={() => setSelected(null)} style={{ height: 30, padding: "0 12px", border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 6, fontSize: 12.5, cursor: "pointer" }}>{lt("logs.close", "Close")}</button>
              </div>
            </div>
            <div style={{ overflow: "auto", padding: 0, background: "#1c1917" }}>
              <pre style={{ margin: 0, padding: 16, color: "#fafaf9", fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 120 }}>
                {loadingDoc ? window.I18N.t("logs.loadingLog", "Loading log…") : (content || window.I18N.t("ui.emptyLog", "(empty log)"))}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conectores pane ─────────────────────────────────────────────────────────
// Fusiona los ~30 eventos más recientes de TODOS los conectores en una sola
// línea de tiempo — hoy solo se veían de a uno, abriendo cada conector por
// separado. Mismo formato de tabla que el pane SSH (no el "Activity log"
// oscuro tipo terminal del detalle de conector) para que las dos pestañas de
// Logs se vean consistentes y respeten el tema claro/oscuro de la app.
const LOG_COLORS = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)" };

function ConnectorsPane() {
  const [meta, setMeta]     = useState({});   // id → { name, icon, color }
  const [entries, setEntries] = useState(null); // null = cargando
  const [err, setErr]       = useState(null);
  const [q, setQ]           = useState("");
  const [connQ, setConnQ]   = useState("");
  const [connFilter, setConnFilter] = useState(null); // id seleccionado en el lateral, o null = todos
  const [expanded, setExpanded] = useState(null); // key of the row showing its detail, or null

  const load = useCallback(() => {
    setErr(null);
    Promise.all([
      window.HQ_API.request("/api/connectors"),
      window.HQ_API.request("/api/connectors/status"),
    ]).then(([registry, statusData]) => {
      const m = {};
      (Array.isArray(registry) ? registry : []).forEach(c => { m[c.id] = { name: c.name || c.id, icon: c.icon, color: c.color }; });
      setMeta(m);

      const merged = [];
      for (const [id, s] of Object.entries(statusData || {})) {
        for (const entry of (s.log || [])) merged.push({ ...entry, connectorId: id });
      }
      merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setEntries(merged);
    }).catch(e => { setErr(e.message || "Error"); setEntries([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Lista de conectores con actividad, para el panel lateral.
  const connectors = useMemo(() => {
    const counts = new Map();
    for (const e of (entries || [])) counts.set(e.connectorId, (counts.get(e.connectorId) || 0) + 1);
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: meta[id]?.name || id, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [entries, meta]);

  const filteredConnectors = useMemo(() => {
    const s = connQ.trim().toLowerCase();
    if (!s) return connectors;
    return connectors.filter(c => c.label.toLowerCase().includes(s));
  }, [connectors, connQ]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (entries || []).filter(e => {
      if (connFilter && e.connectorId !== connFilter) return false;
      if (!s) return true;
      const name = (meta[e.connectorId]?.name || e.connectorId).toLowerCase();
      return name.includes(s) || (e.msg || "").toLowerCase().includes(s);
    });
  }, [entries, q, connFilter, meta]);

  const pagination = usePagination(filtered, { key: "connector-activity" });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <LogsLateral
        query={connQ} onQuery={setConnQ} placeholder={window.I18N.t("logs.searchConnector", "Search connector…")}
        items={filteredConnectors} activeId={connFilter} onSelect={setConnFilter}
        allLabel={window.I18N.t("ui.allConnectors", "All connectors")} allCount={(entries || []).length}
      />

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ maxWidth: 1180 }}>
          <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <p style={{ margin: 0, color: "var(--muted-fg)", fontSize: 13 }}>{window.I18N.t("ui.logs.connectorsHelp", "Activity from all connectors (test, sync, errors) in one timeline — the latest ~30 events per connector.")} </p>
            <button onClick={load} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}>{window.I18N.t("ui.refresh", "↻ Refresh")}</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
            <SearchBox value={q} onChange={setQ} placeholder={window.I18N.t("logs.searchConnectorMessage", "Search by connector or message…")} />
            <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>{filtered.length} {window.I18N.t("ui.events", "events")}</span>
          </div>

          {err && <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 12 }}>{err}</div>}

          {entries === null ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: 20 }}>{window.I18N.t("settings.loading", "Loading…")}</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: 20 }}>
              {entries.length === 0 ? window.I18N.t("ui.logs.noConnectorActivity", "No activity yet — run Test or Sync on a connector.") : window.I18N.t("ui.logs.noMatches", "No matching events.")}
            </div>
          ) : (
            <>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--muted)" }}>
                  <th style={{ ...th, width: 90 }}>{lt("logs.hour", "Time")}</th>
                  <th style={{ ...th, width: 150 }}>{lt("logs.connector", "Connector")}</th>
                  <th style={th}>{lt("logs.event", "Event")}</th>
                  <th style={{ ...th, width: 36 }}></th>
                </tr></thead>
                <tbody>
                  {pagination.pageItems.map((l, i) => {
                    const color   = LOG_COLORS[l.level] || "var(--muted-fg)";
                    const name    = meta[l.connectorId]?.name || l.connectorId;
                    const key     = `${l.connectorId}-${l.ts}-${i}`;
                    const hasMeta = l.meta && Object.keys(l.meta).length > 0;
                    const isOpen  = expanded === key;
                    return (
                      <React.Fragment key={key}>
                        <tr>
                          <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-fg)" }}>{l.t}</td>
                          <td style={td}>
                            <span style={{
                              fontSize: 10.5, fontWeight: 600, color: "var(--muted-fg)", background: "var(--muted)",
                              padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
                            }}>{name}</span>
                          </td>
                          <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11.5, color, wordBreak: "break-all" }}>
                            {l.msg}
                            {l.meta?.actor && (
                              <span style={{
                                marginLeft: 8, fontFamily: "var(--font-sans, inherit)", fontSize: 10, fontWeight: 600,
                                color: "var(--accent)", background: "var(--accent-soft, var(--muted))",
                                padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap",
                              }} title={window.I18N.t("ui.logs.agentCall", "Request made by an AI agent, not from the UI")}>🤖 {l.meta.actor}</span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign: "center" }}>
                            {hasMeta && (
                              <button
                                onClick={() => setExpanded(isOpen ? null : key)}
                                title={isOpen ? window.I18N.t("ui.logs.hideDetail", "Hide details") : window.I18N.t("ui.logs.viewEndpoint", "View details (endpoint)")}
                                style={{
                                  width: 22, height: 22, border: "1px solid var(--border)", borderRadius: 5,
                                  background: isOpen ? "var(--accent)" : "var(--surface)",
                                  color: isOpen ? "white" : "var(--muted-fg)",
                                  cursor: "pointer", fontSize: 11, lineHeight: "20px", padding: 0,
                                }}
                              >👁</button>
                            )}
                          </td>
                        </tr>
                        {isOpen && hasMeta && (
                          <tr>
                            <td colSpan={4} style={{ ...td, background: "var(--muted)", padding: "8px 12px" }}>
                              {l.meta.endpoint && (
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg)" }}>
                                  <strong>{lt("logs.endpoint", "Endpoint")}:</strong> {l.meta.endpoint}
                                </div>
                              )}
                              {Array.isArray(l.meta.endpoints) && (
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--fg)", marginBottom: 2 }}>{lt("logs.calledEndpoints", "Called endpoints")}:</div>
                                  {l.meta.endpoints.map((ep, j) => (
                                    <div key={j} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-fg)" }}>{ep}</div>
                                  ))}
                                </div>
                              )}
                              {Object.entries(l.meta).filter(([k]) => k !== "endpoint" && k !== "endpoints").map(([k, v]) => (
                                <div key={k} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-fg)" }}>
                                  <strong style={{ color: "var(--fg)" }}>{k}:</strong> {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar {...pagination} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Actividad pane ───────────────────────────────────────────────────────────
// Mismo patrón que ConnectorsPane, pero para escrituras que no pertenecen a
// ningún conector (Home, Blocks, Devices, Apps, Docs, Vault, Settings...) —
// ver ACTIVITY_DOMAIN_LABELS/activityLog en server.js. Fuente: /api/activity/status.
function ActivityPane() {
  const [entries, setEntries] = useState(null); // null = cargando
  const [labels, setLabels]   = useState({});   // domain → label
  const [err, setErr]         = useState(null);
  const [q, setQ]             = useState("");
  const [domainQ, setDomainQ] = useState("");
  const [domainFilter, setDomainFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(() => {
    setErr(null);
    window.HQ_API.request("/api/activity/status").then(statusData => {
      const l = {};
      const merged = [];
      for (const [domain, s] of Object.entries(statusData || {})) {
        l[domain] = s.label || domain;
        for (const entry of (s.log || [])) merged.push({ ...entry, domain });
      }
      setLabels(l);
      merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setEntries(merged);
    }).catch(e => { setErr(e.message || "Error"); setEntries([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const domains = useMemo(() => {
    const counts = new Map();
    for (const e of (entries || [])) counts.set(e.domain, (counts.get(e.domain) || 0) + 1);
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: labels[id] || id, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [entries, labels]);

  const filteredDomains = useMemo(() => {
    const s = domainQ.trim().toLowerCase();
    if (!s) return domains;
    return domains.filter(d => d.label.toLowerCase().includes(s));
  }, [domains, domainQ]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (entries || []).filter(e => {
      if (domainFilter && e.domain !== domainFilter) return false;
      if (!s) return true;
      const name = (labels[e.domain] || e.domain).toLowerCase();
      return name.includes(s) || (e.msg || "").toLowerCase().includes(s);
    });
  }, [entries, q, domainFilter, labels]);

  const pagination = usePagination(filtered, { key: "activity-log" });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <LogsLateral
        query={domainQ} onQuery={setDomainQ} placeholder={window.I18N.t("logs.searchSection", "Search section…")}
        items={filteredDomains} activeId={domainFilter} onSelect={setDomainFilter}
        allLabel={window.I18N.t("ui.logs.allActivity", "All activity")} allCount={(entries || []).length}
      />

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ maxWidth: 1180 }}>
          <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <p style={{ margin: 0, color: "var(--muted-fg)", fontSize: 13 }}>{window.I18N.t("ui.logs.activityHelp", "Writes outside connectors (Home, Blocks, Devices, Apps, Docs, Vault, Settings...) in one timeline.")} </p>
            <button onClick={load} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}>{window.I18N.t("ui.refresh", "↻ Refresh")}</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
            <SearchBox value={q} onChange={setQ} placeholder={window.I18N.t("logs.searchSectionMessage", "Search by section or message…")} />
            <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>{filtered.length} {window.I18N.t("ui.events", "events")}</span>
          </div>

          {err && <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 12 }}>{err}</div>}

          {entries === null ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: 20 }}>{window.I18N.t("settings.loading", "Loading…")}</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: 20 }}>
              {entries.length === 0 ? window.I18N.t("ui.logs.noActivity", "No activity yet.") : window.I18N.t("ui.logs.noMatches", "No matching events.")}
            </div>
          ) : (
            <>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--muted)" }}>
                  <th style={{ ...th, width: 90 }}>{lt("logs.hour", "Time")}</th>
                  <th style={{ ...th, width: 150 }}>{lt("logs.section", "Section")}</th>
                  <th style={th}>{lt("logs.event", "Event")}</th>
                  <th style={{ ...th, width: 36 }}></th>
                </tr></thead>
                <tbody>
                  {pagination.pageItems.map((l, i) => {
                    const color   = LOG_COLORS[l.level] || "var(--muted-fg)";
                    const name    = labels[l.domain] || l.domain;
                    const key     = `${l.domain}-${l.ts}-${i}`;
                    const hasMeta = l.meta && Object.keys(l.meta).length > 0;
                    const isOpen  = expanded === key;
                    return (
                      <React.Fragment key={key}>
                        <tr>
                          <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-fg)" }}>{l.t}</td>
                          <td style={td}>
                            <span style={{
                              fontSize: 10.5, fontWeight: 600, color: "var(--muted-fg)", background: "var(--muted)",
                              padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
                            }}>{name}</span>
                          </td>
                          <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 11.5, color, wordBreak: "break-all" }}>
                            {l.msg}
                            {l.meta?.actor && (
                              <span style={{
                                marginLeft: 8, fontFamily: "var(--font-sans, inherit)", fontSize: 10, fontWeight: 600,
                                color: "var(--accent)", background: "var(--accent-soft, var(--muted))",
                                padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap",
                              }} title={window.I18N.t("ui.logs.agentCall", "Request made by an AI agent, not from the UI")}>🤖 {l.meta.actor}</span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign: "center" }}>
                            {hasMeta && (
                              <button
                                onClick={() => setExpanded(isOpen ? null : key)}
                                title={isOpen ? window.I18N.t("ui.logs.hideDetail", "Hide details") : window.I18N.t("ui.logs.viewEndpoint", "View details (endpoint)")}
                                style={{
                                  width: 22, height: 22, border: "1px solid var(--border)", borderRadius: 5,
                                  background: isOpen ? "var(--accent)" : "var(--surface)",
                                  color: isOpen ? "white" : "var(--muted-fg)",
                                  cursor: "pointer", fontSize: 11, lineHeight: "20px", padding: 0,
                                }}
                              >👁</button>
                            )}
                          </td>
                        </tr>
                        {isOpen && hasMeta && (
                          <tr>
                            <td colSpan={4} style={{ ...td, background: "var(--muted)", padding: "8px 12px" }}>
                              {l.meta.endpoint && (
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg)" }}>
                                  <strong>{lt("logs.endpoint", "Endpoint")}:</strong> {l.meta.endpoint}
                                </div>
                              )}
                              {Object.entries(l.meta).filter(([k]) => k !== "endpoint").map(([k, v]) => (
                                <div key={k} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-fg)" }}>
                                  <strong style={{ color: "var(--fg)" }}>{k}:</strong> {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar {...pagination} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shell: tabs arriba + pane (mismo patrón que app/documentation.jsx) ─────
const LOGS_TABS = [
  { id: "ssh",        label: "SSH" },
  { id: "connectors", label: "Conectores" },
  { id: "activity",   label: "Actividad" },
];

function LogsView() {
  window.I18N?.useLocale();
  const [tab, setTab] = useState("ssh");
  const active = LOGS_TABS.some(t => t.id === tab) ? tab : "ssh";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* ── Tabs ── */}
      {/* 45 px, la altura de la cabecera del sidebar (box-sizing: border-box,
          así que el borde ya va dentro): las dos líneas caen a la misma
          altura en vez de a 38 y 45. */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, minHeight: "var(--header-h)", padding: "0 12px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
        {LOGS_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "14px 14px 6px", border: 0, background: "transparent", cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap",
            color: active === t.id ? "var(--fg)" : "var(--muted-fg)",
            borderBottom: active === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            marginBottom: -1,
          }}>{lt(`ui.logs.tab.${t.id}`, t.label)}</button>
        ))}
      </div>

      {active === "ssh" ? <SshPane /> : active === "connectors" ? <ConnectorsPane /> : <ActivityPane />}
    </div>
  );
}
window.SshLogsView = LogsView;
