// Contenedores — vista unificada de contenedores Docker dentro de las VMs
// (colector SSH + conector Portainer; lee /api/containers).
const { useState, useEffect, useCallback, useMemo } = React;
const ct = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

// Relative "hace X" timestamp for the last collection time.
function timeAgo(ts) {
  if (!ts) return null;
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return window.I18N.t("ui.now", "Now");
  if (s < 60) return window.I18N.t("ui.timeAgo", "{value} ago", { value: s + "s" });
  const m = Math.floor(s / 60);
  if (m < 60) return window.I18N.t("ui.timeAgo", "{value} ago", { value: m + " min" });
  const h = Math.floor(m / 60);
  if (h < 24) return window.I18N.t("ui.timeAgo", "{value} ago", { value: h + " h" });
  const d = Math.floor(h / 24);
  return window.I18N.t("ui.timeAgo", "{value} ago", { value: d + " d" });
}

function ContainersView({ onNavigate, onOpenConsole }) {
  window.I18N?.useLocale();
  const [containers, setContainers] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [error,      setError]      = useState("");
  const [stateFilter,  setStateFilter]  = useState("all"); // all | running | exited
  const [sourceFilter, setSourceFilter] = useState("all"); // all | ssh | portainer
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null); // container open in detail drawer
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set()); // group names collapsed
  const toggleGroup = (name) => setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const load = useCallback(async () => {
    const d = await window.HQ_API.request("/api/containers");
    setContainers(Array.isArray(d.containers) ? d.containers : []);
  }, []);

  useEffect(() => { load().catch(() => {}).finally(() => setLoading(false)); }, [load]);

  const collect = useCallback(async () => {
    setCollecting(true); setError("");
    try {
      // SSH collection (marked Docker hosts) + Portainer refresh in parallel
      await Promise.all([
        window.HQ_API.request("/api/containers/collect", { method: "POST" }).catch(() => null),
        window.HQ_API.request("/api/connectors/portainer/sync", { method: "POST" }).catch(() => null),
      ]);
      await load();
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.containers.updated", "Containers updated"), kind: "ok" } }));
    } catch (e) {
      setError(e.message || window.I18N.t("ui.containers.updateFailed", "Update failed"));
    } finally { setCollecting(false); }
  }, [load]);

  const filtered = useMemo(() => containers.filter(c => {
    if (stateFilter !== "all" && (stateFilter === "running" ? c.state !== "running" : c.state === "running")) return false;
    if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
    if (q) {
      const s = q.toLowerCase();
      return (c.name || "").toLowerCase().includes(s)
        || (c.image || "").toLowerCase().includes(s)
        || (c.vmName || "").toLowerCase().includes(s);
    }
    return true;
  }), [containers, stateFilter, sourceFilter, q]);

  const pagination = usePagination(filtered, { key: "containers" });

  // group by VM/host — grouping runs on just the current page's slice, so a
  // page can span several VMs (see the same tradeoff noted in vms.jsx).
  const groups = useMemo(() => {
    const by = {};
    for (const c of pagination.pageItems) { const k = c.vmName || c.hostIp || "—"; (by[k] = by[k] || []).push(c); }
    return Object.entries(by).map(([name, items]) => ({
      name, items,
      collectedAt: items.reduce((mx, c) => Math.max(mx, c.collectedAt || 0), 0) || null,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [pagination.pageItems]);

  const running = containers.filter(c => c.state === "running").length;

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{window.I18N.t("nav.containers.label", "Containers")}</h1>
          <div style={{ fontSize: 12, color: "var(--muted-fg)", marginTop: 3 }}>{window.I18N.t("ui.containers.subtitle", "Docker containers inside your VMs ·")} {running} {window.I18N.t("ui.containers.runningOf", "running of")} {containers.length}
          </div>
        </div>
        <button onClick={collect} disabled={collecting} style={{
          height: 32, padding: "0 14px", background: "#13bef9", color: "white", border: 0, borderRadius: 6,
          fontSize: 12.5, fontWeight: 600, cursor: collecting ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: collecting ? .6 : 1,
        }}>{collecting ? window.I18N.t("containers.refreshing", "Refreshing…") : window.I18N.t("ui.containers.update", "⟳ Refresh")}</button>
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 22%,var(--border))", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>{error}</div>
      )}

      {!loading && containers.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "0 1 260px" }}>
            <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)", fontSize: 13 }}>⌕</span>
            <input placeholder={ct("containers.search", "Search container, image, or VM…")} value={q} onChange={e => setQ(e.target.value)}
              style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "white" }} />
          </div>
          <FilterChip label={ct("containers.state", "State")} value={stateFilter} options={[["all", ct("containers.all", "All")], ["running", ct("containers.running", "Running")], ["exited", ct("containers.stopped", "Stopped")]]} onChange={setStateFilter} />
          <FilterChip label={ct("containers.source", "Source")} value={sourceFilter} options={[["all", ct("containers.allSources", "All")], ["ssh", "SSH"], ["portainer", "Portainer"]]} onChange={setSourceFilter} />
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-fg)" }}>{filtered.length} {window.I18N.t("containers.count", "containers")}</div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>{ct("containers.loading", "Loading…")}</div>
      ) : containers.length === 0 ? (
        <EmptyState
          title={window.I18N.t("ui.containers.empty", "No containers yet")}
          body={window.I18N.t("ui.containers.setupHelp", "Mark a VM as a Docker host (in the VM details) and/or configure the Portainer connector, then click Refresh. Requires VPN and, in Bitwarden mode, an unlocked vault.")}
          action={window.I18N.t("ui.goConnectors", "Go to Connectors")}
          onAction={() => onNavigate && onNavigate("connectors")}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map(g => {
            const collapsed = collapsedGroups.has(g.name);
            return (
              <div key={g.name}>
                <div onClick={() => toggleGroup(g.name)}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--muted-fg)",
                    marginBottom: 8, letterSpacing: 0.3, cursor: "pointer", userSelect: "none" }}>
                  <span style={{ display: "inline-block", transition: "transform .15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", fontSize: 10 }}>▾</span>
                  {g.name} <span style={{ fontWeight: 400 }}>· {g.items.length}</span>
                  {g.collectedAt && (
                    <span style={{ fontWeight: 400, fontSize: 11 }} title={window.I18N.t("ui.containers.lastFetched", "Last retrieved: ") + new Date(g.collectedAt).toLocaleString(window.I18N.dateLocale())}>
                      {" · consultado "}{timeAgo(g.collectedAt)}
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.items.map(c => <ContainerCard key={(c.vmName || "") + c.id} c={c} onSelect={setSelected} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && containers.length > 0 && <PaginationBar {...pagination} />}

      {selected && <ContainerDetail c={selected} onClose={() => setSelected(null)} onOpenConsole={onOpenConsole} />}
    </div>
  );
}

function ContainerCard({ c, onSelect }) {
  const running = c.state === "running";
  return (
    <div onClick={() => onSelect && onSelect(c)}
      title={ct("containers.detailLogs", "View detail, logs, and console")}
      onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
      style={{
      background: "white", border: "1px solid var(--border)",
      borderLeft: `3px solid ${running ? "var(--ok)" : "var(--muted-fg)"}`,
      borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: running ? "var(--ok)" : "var(--muted-fg)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name || "(sin nombre)"}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 2, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.image}{c.ports?.length ? ` · ${c.ports.join(", ")}` : ""}
        </div>
      </div>
      {(c.cpuPct || c.memUsage) && (
        <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", flexShrink: 0 }}>
          {c.cpuPct && <div>CPU {c.cpuPct}</div>}
          {c.memUsage && <div>{c.memUsage}</div>}
        </div>
      )}
      <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--muted-fg)", flexShrink: 0 }} title={c.status}>{c.status}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3, fontFamily: "var(--font-mono)", flexShrink: 0,
        background: c.source === "portainer" ? "color-mix(in srgb,#13bef9 14%,white)" : "var(--muted)",
        color: c.source === "portainer" ? "#0b87b3" : "var(--muted-fg)" }}>{c.source === "portainer" ? "PORTAINER" : "SSH"}</span>
    </div>
  );
}

function EmptyState({ title, body, action, onAction }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border)", borderRadius: 10, background: "var(--muted)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted-fg)", maxWidth: 440, margin: "0 auto 14px", lineHeight: 1.5 }}>{body}</div>
      {action && <button onClick={onAction} style={{ height: 32, padding: "0 16px", background: "var(--accent)", color: "white", border: 0, borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{action}</button>}
    </div>
  );
}

function ContainerDetail({ c, onClose, onOpenConsole }) {
  const [inspect, setInspect] = useState(null);
  const [logs, setLogs]       = useState(null);
  const [tail, setTail]       = useState(200);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [err, setErr]         = useState("");

  const qs = (extra) => {
    const p = new URLSearchParams({ source: c.source, id: c.id });
    if (c.source === "portainer") p.set("endpointId", String(c.endpointId)); else p.set("vmId", c.vmId || "");
    Object.entries(extra || {}).forEach(([k, v]) => p.set(k, String(v)));
    return p.toString();
  };
  const loadLogs = (n) => {
    setLoadingLogs(true);
    window.HQ_API.request(`/api/containers/logs?${qs({ tail: n })}`)
      .then(d => setLogs(d.logs || "(sin salida)"))
      .catch(e => setLogs(window.I18N.t("ui.containers.logsFailed", "(could not load logs:") + " " + e.message + ")"))
      .finally(() => setLoadingLogs(false));
  };
  useEffect(() => {
    setInspect(null); setLogs(null); setErr("");
    window.HQ_API.request(`/api/containers/inspect?${qs()}`).then(d => setInspect(d.inspect)).catch(e => setErr(e.message));
    loadLogs(tail);
  }, [c.id, c.source]);

  const kk = { color: "var(--muted-fg)", fontWeight: 500 };
  const mono = { fontFamily: "var(--font-mono)" };
  const canSshConsole = !!c.vmId;
  const portainerDetailUrl = c.portainerUrl ? `${c.portainerUrl}/${c.id}` : null;

  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 560, maxWidth: "96vw", background: "white", borderLeft: "1px solid var(--border)", boxShadow: "-10px 0 24px -16px rgba(0,0,0,.18)", zIndex: 60, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: c.state === "running" ? "var(--ok)" : "var(--muted-fg)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3, fontFamily: "var(--font-mono)", flexShrink: 0, background: c.source === "portainer" ? "color-mix(in srgb,#13bef9 14%,white)" : "var(--muted)", color: c.source === "portainer" ? "#0b87b3" : "var(--muted-fg)" }}>{c.source === "portainer" ? "PORTAINER" : "SSH"}</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 18, color: "var(--muted-fg)" }}>×</button>
      </div>

      <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Console actions */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {canSshConsole && (
            <button onClick={() => onOpenConsole && onOpenConsole(c)} style={{ height: 30, padding: "0 12px", background: "#1c1917", color: "white", border: 0, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{window.I18N.t("ui.containers.console", "›_ Console (SSH)")}</button>
          )}
          {portainerDetailUrl && (
            <a href={portainerDetailUrl} target="_blank" rel="noreferrer" style={{ height: 30, padding: "0 12px", display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#0b87b3", textDecoration: "none" }}>{ct("containers.openPortainer", "Open in Portainer ↗")}</a>
          )}
        </div>

        {c.collectedAt && (
          <div style={{ fontSize: 11, color: "var(--muted-fg)" }} title={new Date(c.collectedAt).toLocaleString(window.I18N.dateLocale())}>{window.I18N.t("ui.containers.fetched", "List data retrieved")} {timeAgo(c.collectedAt)} {window.I18N.t("ui.containers.liveHelp", "· status/logs above are loaded live")} </div>
        )}

        {err && <div style={{ fontSize: 12, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 22%,var(--border))", borderRadius: 6, padding: "8px 12px" }}>{err}</div>}

        {/* Inspect */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, color: "var(--muted-fg)", textTransform: "uppercase", marginBottom: 8 }}>{window.I18N.t("containers.detail", "Details")}</div>
          {inspect === null ? (
            <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
          ) : !inspect ? (
            <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{window.I18N.t("containers.noData", "No data.")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "5px 12px", fontSize: 12 }}>
              <span style={kk}>{window.I18N.t("settings.ai.status", "Status")}</span><span style={{ ...mono, color: inspect.state === "running" ? "var(--ok)" : "var(--muted-fg)" }}>{inspect.status}{inspect.health ? ` · ${inspect.health}` : ""}</span>
              <span style={kk}>{window.I18N.t("ui.containers.image", "Image")}</span><span style={mono}>{inspect.image}</span>
              <span style={kk}>{window.I18N.t("ui.containers.restarts", "Restarts")}</span><span style={mono}>{inspect.restartCount} {window.I18N.t("ui.containers.policy", "· policy")} {inspect.restartPolicy || "—"}</span>
              {inspect.created && <><span style={kk}>{window.I18N.t("home.issue.created", "Created")}</span><span style={mono}>{new Date(inspect.created).toLocaleString(window.I18N.dateLocale())}</span></>}
              {inspect.cmd && <><span style={kk}>{window.I18N.t("ui.containers.command", "Command")}</span><span style={{ ...mono, wordBreak: "break-all" }}>{inspect.cmd}</span></>}
              {inspect.networks?.length > 0 && <><span style={kk}>{window.I18N.t("ui.containers.networks", "Networks")}</span><span style={mono}>{inspect.networks.map(n => `${n.name}${n.ip ? ` (${n.ip})` : ""}`).join(", ")}</span></>}
              {inspect.ports?.length > 0 && <><span style={kk}>{window.I18N.t("devices.ports", "Ports")}</span><span style={mono}>{inspect.ports.join(", ")}</span></>}
              {inspect.mounts?.length > 0 && <><span style={kk}>{window.I18N.t("ui.containers.volumes", "Volumes")}</span><span style={{ ...mono, fontSize: 11 }}>{inspect.mounts.map(m => `${m.src} → ${m.dst}`).join("  ·  ")}</span></>}
            </div>
          )}
          {inspect?.env?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11.5, color: "var(--accent)", cursor: "pointer" }}>{window.I18N.t("ui.containers.env", "Environment variables (")}{inspect.env.length})</summary>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", marginTop: 6, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap" }}>{inspect.env.join("\n")}</div>
            </details>
          )}
        </div>

        {/* Logs */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, color: "var(--muted-fg)", textTransform: "uppercase" }}>{ct("containers.logs", "Logs")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select value={tail} onChange={e => { const n = Number(e.target.value); setTail(n); loadLogs(n); }} style={{ height: 26, fontSize: 11.5, border: "1px solid var(--border)", borderRadius: 5, background: "white", fontFamily: "inherit", cursor: "pointer" }}>
                <option value={200}>tail 200</option><option value={500}>tail 500</option><option value={1000}>tail 1000</option>
              </select>
              <button onClick={() => loadLogs(tail)} disabled={loadingLogs} style={{ height: 26, padding: "0 10px", border: "1px solid var(--border)", background: "white", borderRadius: 5, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", color: "var(--fg)" }}>{loadingLogs ? "…" : window.I18N.t("ui.refresh", "↻ Refresh")}</button>
            </div>
          </div>
          <pre style={{ margin: 0, background: "#0b0f14", color: "#cbd5e1", borderRadius: 6, padding: "10px 12px", fontSize: 11, lineHeight: 1.45, fontFamily: "var(--font-mono)", maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{logs === null ? window.I18N.t("settings.loading", "Loading…") : (logs || "(sin salida)")}</pre>
        </div>
      </div>
    </div>
  );
}

// Local filter chip (each text/babel script is its own scope — keep self-contained)
function FilterChip({ label, value, options, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-fg)" }}>
      {label}:
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ height: 32, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", background: "white", color: "var(--fg)", cursor: "pointer" }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

window.ContainersView = ContainersView;
