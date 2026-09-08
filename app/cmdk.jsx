// Command palette (Ctrl+K) — busca VMs, contraseñas, snippets, acciones
const { useState, useEffect, useMemo, useRef } = React;

function CommandK({ open, onClose, onNavigate, connectorModules = [], modulePages = [], dashboards = [], blockCatalog = [] }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [q, setQ] = useState("");
  const [selIdx, setSelIdx] = useState(0);
  const [fetchVersion, setFetchVersion] = useState(0);
  const [fetching, setFetching] = useState(false);
  const inputRef = useRef(null);
  const itemsCacheRef = useRef(new Map());
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setQ("");
      setSelIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Contenido de conectores (commits, deployments…) no vive en modulePages/blockCatalog — hay que
  // pedirlo por block. Se dispara una sola vez, la primera vez que hay texto que buscar, y el
  // resultado se cachea en un ref: CommandK nunca se desmonta (open solo controla el render), así
  // que la cache sobrevive a cerrar/reabrir la paleta.
  useEffect(() => {
    if (!open || !q.trim() || fetchedRef.current) return;
    const catalogById = new Map(blockCatalog.map(b => [b.id, b]));
    const pairs = new Map();
    modulePages.forEach(board => {
      if (board.active === false) return;
      window.ZoneTree.blockIds(board.tree).forEach(blockId => {
        const block = catalogById.get(blockId);
        if (block?.kind === "connector" && block.connectorId && block.blockId) {
          pairs.set(`${block.connectorId}:${block.blockId}`, block);
        }
      });
    });
    if (pairs.size === 0) return;
    fetchedRef.current = true;
    setFetching(true);
    Promise.allSettled([...pairs.entries()].map(([key, block]) =>
      window.HQ_API.request(`/api/connectors/${block.connectorId}/blocks/${block.blockId}`)
        .then(d => { itemsCacheRef.current.set(key, d.items || []); })
    )).finally(() => { setFetching(false); setFetchVersion(v => v + 1); });
  }, [open, q, modulePages, blockCatalog]);

  const items = useMemo(() => {
    if (!open) return [];
    const out = [];
    const boardDashboard = new Map(dashboards.flatMap(d => (d.boardIds || []).map(id => [id, d])));
    const catalogById = new Map(blockCatalog.map(b => [b.id, b]));
    modulePages.forEach(board => {
      if (board.active === false) return;
      const dash = boardDashboard.get(board.id);
      out.push({ type: "board", label: board.title, hint: dash ? `Dashboard: ${dash.title}` : t("boards.title"),
        boardId: board.id, dashboardId: dash?.id });
      window.ZoneTree.blockIds(board.tree).forEach(blockId => {
        const block = catalogById.get(blockId);
        if (!block) return;
        if (block.kind === "content") {
          out.push({ type: "block", label: block.title, hint: `${board.title} · ${(block.content || "").slice(0, 400)}`,
            boardId: board.id, dashboardId: dash?.id });
          return;
        }
        if (block.kind !== "connector") return;
        out.push({ type: "block", label: block.title, hint: `${board.title} · ${block.category || "Block"}`,
          boardId: board.id, dashboardId: dash?.id });
        const cached = itemsCacheRef.current.get(`${block.connectorId}:${block.blockId}`);
        (cached || []).forEach(item => out.push({
          type: "item", label: item.title,
          hint: `${board.title} · ${block.title}${item.subtitle ? " · " + item.subtitle : ""}`,
          boardId: board.id, dashboardId: dash?.id, url: item.url,
        }));
      });
    });
    // Static nav actions
    const nav = ["home", "vms", "hosts", "devices", "passwords", "connectors", "modules", "repos-gitlab", "repos-github", "repos-bitbucket", "tags"]
      .map(target => ({ type: "nav", label: t("cmdk.goTo", "Go to {label}", { label: t(`nav.${target}.label`, target) }), target, hint: t(`nav.${target}.desc`, "") }));
    out.push(...nav);
    out.push(...connectorModules.filter(module => module.connectorId !== module.connectorType).map(module => ({
      type: "nav",
      label: `Go to ${module.label}`,
      target: module.route,
      hint: module.connectorType,
    })));
    // VMs
    window.APP_DATA.DEVICES.forEach(d => out.push({
      type: "device",
      label: d.name,
      hint: `${d.vendor} ${d.model} · ${d.mgmtIp} · ${d.site}`,
      device: d,
    }));
    window.APP_DATA.VMS.forEach(v => out.push({
      type: "vm",
      label: v.name,
      hint: `${v.ip} · VLAN ${v.vlanId} ${v.vlanName} · ${v.site}`,
      vm: v,
    }));
    // Hosts
    window.APP_DATA.HOSTS.forEach(h => out.push({
      type: "host",
      label: h.shortName,
      hint: `${h.model} · ${h.site} · ${h.mgmtIp}`,
      host: h,
    }));
    // Passwords
    window.APP_DATA.PASSWORDS.forEach(p => out.push({
      type: "pass",
      label: p.service,
      hint: `${p.user}${p.tags?.length ? " · " + p.tags.join(", ") : ""}`,
      pass: p,
    }));
    // Snippets
    window.APP_DATA.SNIPPETS.forEach(s => out.push({
      type: "snip",
      label: s.title,
      hint: s.lang,
      snip: s,
    }));

    if (!q) return out.slice(0, 12);
    const s = q.toLowerCase();
    return out.filter(it =>
      it.label.toLowerCase().includes(s) ||
      (it.hint || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [q, open, connectorModules, modulePages, dashboards, blockCatalog, fetchVersion, locale]);

  useEffect(() => { setSelIdx(0); }, [q]);

  const runItem = (it) => {
    if (!it) return;
    if (it.type === "nav") onNavigate(it.target);
    if (it.type === "board" || it.type === "block" || it.type === "item") {
      (async () => {
        if (it.dashboardId) {
          try {
            await window.HQ_API.request(`/api/dashboards/${it.dashboardId}`, { method: "PUT", body: { selectedBoardId: it.boardId } });
            window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
          } catch (error) {
            window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.cmdk.switchFailed", "Could not switch tabs: {0}", { 0: error.message }), kind: "error" } }));
          }
          onNavigate(`dashboard:${it.dashboardId}`);
        } else {
          onNavigate(`page:${it.boardId}`);
        }
        if (it.url) window.open(it.url, "_blank", "noopener");
      })();
    }
    if (it.type === "vm") {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Opening ${it.vm.isWindows ? "RDP" : "SSH"} to ${it.vm.name}…`, kind: "info" } }));
    }
    if (it.type === "host") {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Opening SSH to ESXi ${it.host.shortName}…`, kind: "info" } }));
    }
    if (it.type === "device") {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Opening SSH to ${it.device.name}…`, kind: "info" } }));
    }
    if (it.type === "pass") {
      onNavigate("passwords");
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Open the vault to access ${it.pass.service}`, kind: "info" } }));
    }
    if (it.type === "snip") {
      navigator.clipboard?.writeText(it.snip.body);
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Snippet "${it.snip.title}" copied`, kind: "ok" } }));
    }
    onClose();
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(i => Math.min(items.length - 1, i + 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); }
    if (e.key === "Enter")     { e.preventDefault(); runItem(items[selIdx]); }
    if (e.key === "Escape")    { onClose(); }
  };

  if (!open) return null;

  const typeChip = {
    nav:    { label: t("cmdk.chip.nav"),    bg: "var(--muted)",                                          fg: "var(--muted-fg)" },
    vm:     { label: t("cmdk.chip.vm"),     bg: "color-mix(in srgb, var(--accent) 14%, white)",          fg: "var(--accent)" },
    host:   { label: t("cmdk.chip.host"),   bg: "color-mix(in srgb, #10b981 16%, white)",                fg: "#047857" },
    device: { label: t("cmdk.chip.device"), bg: "color-mix(in srgb, #0891b2 16%, white)",                fg: "#0e7490" },
    pass:   { label: t("cmdk.chip.pass"),   bg: "color-mix(in srgb, #f59e0b 18%, white)",                fg: "#a16207" },
    snip:   { label: t("cmdk.chip.snip"),   bg: "color-mix(in srgb, #8b5cf6 16%, white)",                fg: "#6d28d9" },
    board:  { label: t("cmdk.chip.board"),  bg: "color-mix(in srgb, #0ea5e9 16%, white)",                fg: "#0369a1" },
    block:  { label: t("cmdk.chip.block"),  bg: "color-mix(in srgb, #14b8a6 16%, white)",                fg: "#0f766e" },
    item:   { label: t("cmdk.chip.item"),   bg: "color-mix(in srgb, #f97316 16%, white)",                fg: "#9a3412" },
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(28,25,23,0.35)",
      backdropFilter: "blur(2px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: 90, zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxWidth: "92vw", background: "white",
        borderRadius: 10, boxShadow: "0 24px 50px -12px rgba(0,0,0,.25)",
        overflow: "hidden", border: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)", gap: 10 }}>
          <span style={{ color: "var(--muted-fg)", fontSize: 16 }}>⌕</span>
          <input
            ref={inputRef}
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder={t("cmdk.placeholder")}
            style={{ flex: 1, border: 0, outline: 0, fontSize: 15, fontFamily: "inherit", background: "transparent", color: "var(--fg)" }}
          />
          <kbd style={kbd}>ESC</kbd>
        </div>
        <div style={{ maxHeight: 420, overflow: "auto", padding: 6 }}>
          {items.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>{t("cmdk.noResults")}</div>}
          {items.map((it, i) => {
            const chip = typeChip[it.type];
            const selected = i === selIdx;
            return (
              <button
                key={i}
                onMouseEnter={() => setSelIdx(i)}
                onClick={() => runItem(it)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", border: 0, borderRadius: 6, cursor: "pointer",
                  background: selected ? "var(--row-hover)" : "transparent",
                  textAlign: "left", fontFamily: "inherit",
                }}>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
                  padding: "2px 6px", borderRadius: 3,
                  background: chip.bg, color: chip.fg, fontFamily: "var(--font-mono)",
                  width: 32, textAlign: "center", flexShrink: 0,
                }}>{chip.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: "var(--fg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.hint}</div>
                </div>
                {selected && <kbd style={kbd}>↵</kbd>}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 14, fontSize: 11, color: "var(--muted-fg)" }}>
          <span><kbd style={kbd}>↑↓</kbd> {t("cmdk.navigate")}</span>
          <span><kbd style={kbd}>↵</kbd> {t("cmdk.run")}</span>
          {fetching && <span>{t("cmdk.searching")}</span>}
          <span style={{ marginLeft: "auto" }}>{items.length} {t("cmdk.results")}</span>
        </div>
      </div>
    </div>
  );
}

const kbd = {
  display: "inline-block", padding: "2px 6px", fontSize: 10, fontFamily: "var(--font-mono)",
  border: "1px solid var(--border)", borderRadius: 3, background: "var(--muted)", color: "var(--muted-fg)",
};

window.CommandK = CommandK;
