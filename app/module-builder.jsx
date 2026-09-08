// Module Builder — lets the user create a brand-new custom navigable page:
// split it into resizable "zones" (tiling-window-manager style) and stack
// existing blocks (the same ones usable on Home — connector blocks + custom
// blocks from the Block Builder) into each zone. Saved pages are persisted via
// server/routes/module-pages.js and rendered live by app/custom-page-view.jsx,
// picked up in the sidebar by app/app.jsx once active and allowed there. Uses window.ZoneTree
// (app/zone-tree.js) for the layout algorithm and window.ConnectorBlockPanel
// (app/home.jsx) for real, synced, paginated block previews — no separate
// data-fetching path here.
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const mbt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback;

const PAGE_ICON_KEYS = ["grid", "gauge", "server", "code", "mail", "bell", "chart", "shield", "network", "folder", "clock", "users"];
const PAGE_ICON_FALLBACK = "grid";

// Toggle icon for showing/hiding the zone-layout canvas (next to "Board").
const LAYOUT_TOGGLE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="8" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" />
  </svg>
);

function pageIcon(key) {
  return (window.ICONS && window.ICONS[key]) || (window.ICONS && window.ICONS[PAGE_ICON_FALLBACK]) || null;
}

function connectorSwatch(connectorId, size = 20) {
  const s = (window.BLOCK_CONNECTOR_STYLE && window.BLOCK_CONNECTOR_STYLE[connectorId]) || { icon: "?", color: "var(--muted-fg)" };
  return (
    <span style={{ width: size, height: size, borderRadius: 5, background: s.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
      {s.icon}
    </span>
  );
}

function allUsedBlocks(zones) {
  return zones.flatMap(z => z.blocks.map(id => ({ id, zone: z.n, k: z.k })));
}

// ── Zone editor — the tiling layout canvas, shared visual language between
// "add blocks" mode (click a zone to target it, then pick from the catalog)
// and "edit zones" mode (click to split, drag borders to resize). ──────────
function ZoneEditor({ tree, setTree, mode, sel, setSel, flip, catalog }) {
  const ref = useRef(null);
  const { zones, grips } = useMemo(() => window.ZoneTree.flatten(tree), [tree]);
  const findBlock = id => catalog.find(b => b.id === id);

  // Pointer events + explicit cursor/user-select override during the drag —
  // matches the two other drag-resize handles already in this app (Sidebar's
  // onSidebarResizeStart, repos.jsx's useReposResizableWidth/ResizeHandle), while
  // also working with touch/pen on mobile. Without
  // disabling user-select, dragging over the block titles inside a zone starts
  // a native text selection instead of tracking the resize.
  const onGripDown = (e, g) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = ref.current.getBoundingClientRect();
    document.body.style.cursor = g.dir === "v" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const move = ev => {
      const pct = g.dir === "v" ? ((ev.clientX - r.left) / r.width) * 100 : ((ev.clientY - r.top) / r.height) * 100;
      setTree(t => window.ZoneTree.setRatio(t, g.k, Math.min(0.85, Math.max(0.15, (pct - g.at) / g.span))));
    };
    const up = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onZoneKeyDown = (e, zoneKey) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (mode === "zones") setTree(t => window.ZoneTree.splitZone(t, zoneKey, flip ? "h" : "v"));
    else setSel(zoneKey);
  };

  const onGripKeyDown = (e, grip) => {
    const decrease = grip.dir === "v" ? e.key === "ArrowLeft" : e.key === "ArrowUp";
    const increase = grip.dir === "v" ? e.key === "ArrowRight" : e.key === "ArrowDown";
    if (!decrease && !increase) return;
    e.preventDefault();
    const currentRatio = ((grip.dir === "v" ? grip.x : grip.y) - grip.at) / grip.span;
    const nextRatio = Math.min(0.85, Math.max(0.15, currentRatio + (increase ? 0.05 : -0.05)));
    setTree(t => window.ZoneTree.setRatio(t, grip.k, nextRatio));
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: "16/10", minHeight: 340, background: "white", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      {zones.map(z => {
        const isSel = sel === z.k;
        const pick = mode === "blocks";
        return (
          <div key={z.k} role="group" tabIndex={0}
            aria-label={window.I18N.t(mode === "zones" ? "ui.boards.zoneSplitLabel" : "ui.boards.zoneSelectLabel", "Zone {zone}. {count} blocks.", { zone: z.n, count: z.blocks.length })}
            onClick={() => { if (mode === "zones") setTree(t => window.ZoneTree.splitZone(t, z.k, flip ? "h" : "v")); else setSel(z.k); }}
            onKeyDown={e => onZoneKeyDown(e, z.k)}
            style={{
              position: "absolute", left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`,
              border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
              background: isSel ? "color-mix(in srgb, var(--accent) 10%, transparent)" : pick ? "color-mix(in srgb, var(--accent) 4%, transparent)" : "transparent",
              borderRadius: 6, display: "flex", flexDirection: "column", overflow: "hidden",
              cursor: pick || mode === "zones" ? "pointer" : "default",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 6px 3px", flexShrink: 0 }}>
              <span style={{ fontSize: 8.5, letterSpacing: 1.2, color: "var(--muted-fg)", textTransform: "uppercase", fontWeight: 700 }}>{window.I18N.t("ui.boards.zone", "Zone")} {z.n}</span>
              {z.blocks.length > 0 && <span style={{ fontSize: 8.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{z.blocks.length}</span>}
              <span style={{ flex: 1 }} />
              {mode === "zones" && zones.length > 1 && (
                <button type="button" aria-label={`Remove zone ${z.n}`} onClick={e => { e.stopPropagation(); setTree(t => window.ZoneTree.removeZone(t, z.k)); }} title={window.I18N.t("ui.boards.removeZone", "Remove zone")}
                  style={{ width: 17, height: 17, border: "1px solid var(--border)", background: "white", borderRadius: 4, cursor: "pointer", color: "var(--muted-fg)", fontSize: 10, lineHeight: 1, flexShrink: 0 }}>×</button>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 5px 5px", display: "flex", flexDirection: "column", gap: 3 }}>
              {z.blocks.map((id, i) => {
                const b = findBlock(id);
                return (
                  <div key={i} onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 5px", background: "white", border: "1px solid var(--border)", borderRadius: 5, flexShrink: 0 }}>
                    {connectorSwatch(b?.connectorId)}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 10.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b?.title || id}</span>
                      {b?.scope && <span style={{ display: "block", fontSize: 8.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.scope}</span>}
                    </span>
                    {mode === "blocks" && (
                      <>
                        <button type="button" aria-label={`Move ${b?.title || id} up`} disabled={i === 0} title={window.I18N.t("ui.moveUp", "Move up")} onClick={() => setTree(t => window.ZoneTree.moveBlock(t, z.k, i, -1))} style={miniBtnStyle}>▲</button>
                        <button type="button" aria-label={`Move ${b?.title || id} down`} disabled={i === z.blocks.length - 1} title={window.I18N.t("ui.moveDown", "Move down")} onClick={() => setTree(t => window.ZoneTree.moveBlock(t, z.k, i, 1))} style={miniBtnStyle}>▼</button>
                        <button type="button" aria-label={`Remove ${b?.title || id} from zone ${z.n}`} title={window.I18N.t("ui.boards.removeBlock", "Remove block")} onClick={() => setTree(t => window.ZoneTree.removeBlockAndCompact(t, z.k, i))} style={miniBtnStyle}>×</button>
                      </>
                    )}
                  </div>
                );
              })}
              {mode === "blocks" && isSel && z.blocks.length === 0 && (
                <div style={{ margin: "auto", fontSize: 10, color: "var(--muted-fg)", textAlign: "center" }}>{window.I18N.t("ui.boards.chooseBlock", "+ choose a block on the right")}</div>
              )}
              {mode === "blocks" && !isSel && z.blocks.length === 0 && (
                <div style={{ margin: "auto", fontSize: 10, color: "var(--muted-fg)" }}>{window.I18N.t("ui.boards.clickAdd", "click to add")}</div>
              )}
              {mode === "zones" && z.blocks.length === 0 && (
                <div style={{ margin: "auto", fontSize: 10, color: "var(--muted-fg)" }}>{window.I18N.t("ui.boards.emptyZone", "empty")}</div>
              )}
            </div>
          </div>
        );
      })}
      {grips.map(g => <ZoneGrip key={g.k} grip={g} onDown={onGripDown} onKeyDown={onGripKeyDown} />)}
    </div>
  );
}

// Half of the gap window.ZoneTree.flatten() leaves between two split zones
// (must match the G constant in app/zone-tree.js) — used only to re-center
// the grip's hit target on the middle of that gap instead of its start edge.
const ZONE_GAP_HALF = 0.6;

// Draggable border between two zones — resizing works in either mode (it's
// orthogonal to "which zone is selected"/"click to split"). Deliberately more
// visible at rest than the app's ResizeHandle (repos.jsx) it's styled after:
// that one sits on its own dedicated divider, but this one sits right next to
// zone borders that use the exact same --border color, so an equally-subtle
// resting state was indistinguishable from a plain border and effectively
// undiscoverable. Highlights to var(--accent) on hover/drag.
function ZoneGrip({ grip, onDown, onKeyDown }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const vertical = grip.dir === "v";
  const center = (vertical ? grip.x : grip.y) + ZONE_GAP_HALF;
  const ratio = Math.round((((vertical ? grip.x : grip.y) - grip.at) / grip.span) * 100);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={`Resize zones. Use ${vertical ? "left and right" : "up and down"} arrow keys.`}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={ratio}
      onPointerDown={e => onDown(e, grip)}
      onKeyDown={e => onKeyDown(e, grip)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      title={window.I18N.t("ui.boards.resize", "Drag to resize")}
      style={{
        position: "absolute", zIndex: 3, cursor: vertical ? "col-resize" : "row-resize",
        display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none",
        outline: focused ? "2px solid var(--brand-glass-active)" : "none", outlineOffset: -2, borderRadius: 4,
        ...(vertical
          ? { left: `calc(${center}% - 7px)`, top: `${grip.y}%`, height: `${grip.len}%`, width: 14 }
          : { top: `calc(${center}% - 7px)`, left: `${grip.x}%`, width: `${grip.len}%`, height: 14 }),
      }}>
      <div style={{
        background: hover || focused ? "var(--accent)" : "var(--muted-fg)", opacity: hover || focused ? 1 : 0.4,
        borderRadius: 2, transition: "background .1s, opacity .1s",
        ...(vertical ? { width: 4, height: "100%" } : { height: 4, width: "100%" }),
      }} />
    </div>
  );
}

const miniBtnStyle = { width: 16, height: 18, border: "1px solid var(--border)", background: "white", borderRadius: 3, cursor: "pointer", color: "var(--muted-fg)", fontSize: 9, lineHeight: 1, flexShrink: 0, padding: 0 };

// Draggable width for the editor's side panels — same hook/handle shape as
// repos.jsx's useReposResizableWidth/ResizeHandle (duplicated locally rather
// than shared across files: this repo has no cross-file imports).
// Named uniquely per file on purpose — these are plain global <script> tags
// sharing one window scope, not ES modules, so a name shared with another
// file's version gets silently overwritten by whichever <script> tag loads
// last (bit us for real: block-builder.jsx's own resize handle was actually
// running repos.jsx's differently-shaped version for a while).
function useModuleBuilderResizableWidth(storageKey, defaultWidth, min = 220, max = 460) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= min && saved <= max ? saved : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback((e, sign = 1) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = ev => {
      currentWidth = Math.min(max, Math.max(min, startWidth + sign * (ev.clientX - startX)));
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

function ModuleBuilderResizeHandle({ onMouseDown }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={window.I18N.t("connectors.resizeHandle", "Drag to resize")}
      style={{
        width: 5, flexShrink: 0, cursor: "col-resize",
        background: hover ? "var(--accent)" : "transparent",
        borderRight: hover ? "none" : "1px solid var(--border)",
        transition: "background .1s",
      }}
    />
  );
}

// Mobile stand-in for the 3-column layout — same pattern as
// BlockBuilderAccordionSection in block-builder.jsx: one section open at a
// time instead of side-by-side columns, which have no room under ~700px.
function ModuleBuilderAccordionSection({ title, open, onToggle, children }) {
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

// ── Compact preview of the page being built, using the real block panels
// (same component the final saved page renders with). ──────────────────────
// Same blockItemHandlers exception as custom-page-view.jsx / home.jsx: an
// Outline doc opens its detail modal instead of ConnectorBlockPanel's plain
// target="_blank" fallback, so the live preview doesn't surprise-navigate
// the whole tab away when you click a doc while building the board.
function DraftPreview({ tree, catalog, fillHeight = false }) {
  const presentationTree = useMemo(() => window.ZoneTree.compactTree(tree), [tree]);
  const { zones } = useMemo(() => window.ZoneTree.flatten(presentationTree), [presentationTree]);
  const [modalDoc, setModalDoc] = useState(null);
  const blockItemHandlers = {
    "outline.recent-docs": item => setModalDoc({
      id: item.id, title: item.title, updatedBy: item.subtitle,
      updatedAt: item.timestamp, absoluteUrl: item.url,
    }),
  };
  return (
    <div style={{ position: "relative", width: "100%", ...(fillHeight ? { flex: 1, minHeight: 0 } : { aspectRatio: "16/11" }), border: "1px solid var(--border)", borderRadius: 8, background: "var(--muted)", padding: 5 }}>
      {zones.map(z => (
        <div key={z.k} style={{ position: "absolute", left: `calc(${z.x}% + 5px)`, top: `calc(${z.y}% + 5px)`, width: `calc(${z.w}% - 10px)`, height: `calc(${z.h}% - 10px)`, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
          {z.blocks.length === 0
            ? <div style={{ flex: 1, border: "1px dashed var(--border)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--muted-fg)", textAlign: "center", padding: "0 3px" }}>{window.I18N.t("ui.boards.zone", "Zone")} {z.n} {window.I18N.t("ui.boards.emptyZone", "empty")}</div>
            : z.blocks.map((id, i) => {
              const b = catalog.find(x => x.id === id);
              return b ? <window.ConnectorBlockPanel key={id + i} block={b} onItemClick={blockItemHandlers[b.id]}
                panelProps={{
                  contentScroll: true,
                  fillHeight: false,
                  contentScrollLabel: window.I18N.t("ui.boards.contentLabel", "Content of {0}. Use arrow keys, Page Up, or Page Down to scroll", { 0: b.title }),
                }} /> : (
                <div key={id + i} style={{ padding: 8, border: "1px dashed var(--border)", borderRadius: 6, fontSize: 9, color: "var(--muted-fg)" }}>{mbt("moduleBuilder.unavailable", "Block unavailable")}</div>
              );
            })}
        </div>
      ))}
      {modalDoc && <window.DocumentDetailModal doc={modalDoc} onClose={() => setModalDoc(null)} />}
    </div>
  );
}

function BoardToggleButton({ pressed, onToggle, labelOn, labelOff, titleOn, titleOff, ariaLabel }) {
  return (
    <button type="button" aria-pressed={pressed} aria-label={ariaLabel} onClick={onToggle} title={pressed ? titleOn : titleOff} style={{
      height: 28, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 600,
      border: `1px solid ${pressed ? "var(--accent)" : "var(--border)"}`,
      background: pressed ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "white",
      color: pressed ? "var(--accent)" : "var(--muted-fg)", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
    }}>
      <span aria-hidden="true" style={{ width: 22, height: 13, borderRadius: 99, padding: 1.5, flexShrink: 0, background: pressed ? "var(--accent)" : "var(--border)", display: "inline-flex", justifyContent: pressed ? "flex-end" : "flex-start" }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: "#fff", display: "block" }} />
      </span>
      {pressed ? labelOn : labelOff}
    </button>
  );
}

// ── Editor view — identity/visibility + zone layout + block catalog. ──────
function PageEditor({ page, catalog, connections = [], onCancel, onSaved }) {
  const isNew = !page;
  const [title, setTitle]   = useState(page?.title || "");
  const [icon, setIcon]     = useState(page?.icon || PAGE_ICON_FALLBACK);
  const [active, setActive] = useState(page ? page.active : true);
  // Missing means visible for every Board saved before this additive field.
  const [showInSidebar, setShowInSidebar] = useState(page ? page.showInSidebar !== false : true);
  const [tags, setTags] = useState(page?.tags || []);
  const [tree, setTree]     = useState(() => {
    if (page?.tree) { window.ZoneTree.seedUidFrom(page.tree); return page.tree; }
    return window.ZoneTree.PRESETS.columns();
  });
  const [mode, setMode]   = useState("blocks"); // "blocks" | "zones"
  const [sel, setSel]     = useState(() => window.ZoneTree.firstZoneKey(tree));
  const [flip, setFlip]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [leftWidth, onLeftHandleDown]   = useModuleBuilderResizableWidth("hq.moduleBuilderLeftWidth", 280);
  const [rightWidth, onRightHandleDown] = useModuleBuilderResizableWidth("hq.moduleBuilderRightWidth", 280);
  // Lets the user close the zone-editing canvas to give the live preview the
  // full width — reopened via the small layout icon next to "Board".
  const [showLayout, setShowLayout] = useState(true);
  const [showIconModal, setShowIconModal] = useState(false);
  // Same breakpoint and reasoning as BlockBuilder: the 3-column layout
  // (fixed 280px identity + flexible layout + fixed 280px preview) needs
  // ~570px just for its two fixed-width columns, so under ~700px the row
  // overflows and only the identity column is visible. Below that we switch
  // to a single-open-at-a-time accordion instead.
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 700);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [openSection, setOpenSection] = useState("identity");

  useEffect(() => {
    const kd = e => { if (e.key === "Shift") setFlip(true); };
    const ku = e => { if (e.key === "Shift") setFlip(false); };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, []);

  useEffect(() => {
    if (!showIconModal) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setShowIconModal(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showIconModal]);

  const { zones } = useMemo(() => window.ZoneTree.flatten(tree), [tree]);
  const zoneKeySignature = zones.map(zone => zone.k).join("|");
  useEffect(() => {
    if (!zones.some(zone => zone.k === sel)) setSel(zones[0]?.k || null);
  }, [zoneKeySignature]);
  const used = useMemo(() => allUsedBlocks(zones), [zones]);
  const usedMap = useMemo(() => Object.fromEntries(used.map(u => [u.id, u])), [used]);
  const emptyZones = zones.filter(z => z.blocks.length === 0).length;
  const selZone = zones.find(z => z.k === sel);

  // Search + connector filter for the block catalog list — with 17+ blocks
  // (growing as connectors are added) the unfiltered list outgrows the
  // sidebar fast, same problem the other listing pages had.
  const [blockSearch, setBlockSearch] = useState("");
  const [blockConnFilter, setBlockConnFilter] = useState("all");
  const catalogConnectors = useMemo(
    () => {
      const names = new Map(connections.map(connection => [connection.id, connection.name || connection.displayName || connection.id]));
      return [...new Set(catalog.map(block => block.connectorId).filter(Boolean))]
        .map(id => ({ id, name: names.get(id) || id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [catalog, connections],
  );
  const filteredCatalog = useMemo(() => {
    const term = blockSearch.trim().toLowerCase();
    return catalog.filter(b =>
      (blockConnFilter === "all" || b.connectorId === blockConnFilter) &&
      (!term || b.title.toLowerCase().includes(term) || (b.scope || "").toLowerCase().includes(term))
    );
  }, [catalog, blockSearch, blockConnFilter]);
  // Starts smaller than the app's usual 25/50/100 default — this list lives
  // in a narrow sidebar, not a full-width table.
  const blocksPagination = usePagination(filteredCatalog, { key: "board-builder-blocks", defaultPageSize: 15 });

  const usePreset = k => {
    const next = window.ZoneTree.PRESETS[k]();
    setTree(next);
    setSel(window.ZoneTree.firstZoneKey(next));
  };

  const addBlock = id => {
    if (!sel) return;
    const previousZoneKeys = new Set(zones.map(zone => zone.k));
    const next = window.ZoneTree.addBlockAsPane(tree, sel, id);
    const addedZone = window.ZoneTree.flatten(next).zones.find(zone => !previousZoneKeys.has(zone.k));
    setTree(next);
    // Continue adding from the new pane. The first Block in an empty Board
    // keeps the existing key, so there is no new zone to select in that case.
    setSel(addedZone?.k || sel);
  };

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const persistedTree = window.ZoneTree.compactTree(tree);
      const body = { title: title.trim(), icon, active, showInSidebar, tree: persistedTree, tags };
      const saved = isNew
        ? await window.HQ_API.request("/api/module-pages", { method: "POST", body })
        : await window.HQ_API.request(`/api/module-pages/${page.id}`, { method: "PUT", body });
      window.dispatchEvent(new CustomEvent("hq:module-pages-changed"));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.boards.saved", "Board \"{0}\" saved", { 0: saved.title }), kind: "ok" } }));
      onSaved();
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.boards.saveFailedPrefix", "Could not save the board:") + " " + e.message, kind: "error" } }));
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: 10.5, fontWeight: 600, color: "var(--muted-fg)", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 };
  const inputStyle = { width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "white", color: "var(--fg)", font: "inherit", fontSize: 12.5, outline: "none" };

  // Shared between the desktop 3-column layout and the mobile accordion
  // below — same content, just wrapped differently depending on `mobile`.
  const identityContent = (
    <>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
          <label htmlFor="board-builder-title" style={{ ...labelStyle, marginBottom: 0 }}>Board</label>
          {!mobile && !showLayout && (
            <button onClick={() => setShowLayout(true)} title={window.I18N.t("ui.boards.showLayout", "Show layout")} style={{
              width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--border)", background: "white", borderRadius: 5, cursor: "pointer", color: "var(--muted-fg)", flexShrink: 0,
            }}>
              {LAYOUT_TOGGLE_ICON}
            </button>
          )}
        </div>
        <input id="board-builder-title" value={title} onChange={e => setTitle(e.target.value)} placeholder={window.I18N.t("ui.boards.titleHint", "Board title")} style={inputStyle} />
      </div>

      <div>
        <div style={labelStyle}>{window.I18N.t("ui.icon", "Icon")}</div>
        <div role="group" aria-label="Board icon" style={{ display: "flex", gap: 5 }}>
          {/* El ícono elegido siempre aparece primero acá — así queda a
              la vista aunque se haya elegido desde el modal "Más íconos". */}
          {[icon, ...PAGE_ICON_KEYS.filter(k => k !== icon)].slice(0, 3).map(k => {
            const on = icon === k;
            return (
              <button key={k} type="button" aria-label={`Use ${k} as board icon`} aria-pressed={on} onClick={() => setIcon(k)} title={k} style={{
                flex: 1, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                color: on ? "var(--accent)" : "var(--muted-fg)", borderRadius: 6, cursor: "pointer",
              }}>
                {pageIcon(k)}
              </button>
            );
          })}
          <button type="button" aria-label="Choose another board icon" onClick={() => setShowIconModal(true)} title={window.I18N.t("ui.moreIcons", "More icons")} style={{
            flex: 1, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15,
            border: "1px solid var(--border)", background: "white", borderRadius: 6, cursor: "pointer",
          }}>⋯</button>
        </div>
      </div>

      <div>
        <div style={labelStyle}>{window.I18N.t("tags.optional", "Tags (optional)")}</div>
        {window.TagPicker && <window.TagPicker value={tags} onChange={setTags}/>}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
          <span style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>{mbt("moduleBuilder.available", "Available blocks")}</span>
          <span style={{ fontSize: 9.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{used.length}/{catalog.length}</span>
        </div>

        {mode === "zones" ? (
          <div style={{ padding: "7px 9px", border: "1px solid var(--border)", background: "var(--muted)", borderRadius: 7, fontSize: 10.5, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 8 }}>
            {mbt("moduleBuilder.switchToAdd", "Switch to")} <b style={{ color: "var(--fg)" }}>{mbt("moduleBuilder.addBlocks", "Add blocks")}</b> {mbt("moduleBuilder.toStack", "to stack them.")}
          </div>
        ) : selZone ? (
          <div style={{ padding: "7px 9px", border: "1px solid var(--accent)", background: "color-mix(in srgb, var(--accent) 7%, transparent)", borderRadius: 7, fontSize: 10.5, lineHeight: 1.5, marginBottom: 8 }}>{window.I18N.t("ui.boards.addingTo", "Adding to")} <b>{window.I18N.t("ui.boards.zone", "Zone")} {selZone.n}</b> · {selZone.blocks.length} block(s).
            {selZone.blocks.length > 0 && <> {window.I18N.t("ui.boards.siblingHelp", "The next Block will open a resizable panel.")}</>}
          </div>
        ) : (
          <div style={{ padding: "7px 9px", border: "1px solid var(--border)", background: "var(--muted)", borderRadius: 7, fontSize: 10.5, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 8 }}>{window.I18N.t("ui.boards.selectZone", "Select a zone in the layout to get started.")} </div>
        )}

        {catalog.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--muted-fg)" }}>{mbt("moduleBuilder.noBlocks", "No blocks available — configure a connector or create one in Blocks.")}</div>
        )}

        {catalog.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 8, top: 7, color: "var(--muted-fg)", fontSize: 11.5 }}>⌕</span>
              <input placeholder={window.I18N.t("ui.blocks.search", "Search blocks…")} value={blockSearch} onChange={e => setBlockSearch(e.target.value)}
                style={{ width: "100%", height: 26, padding: "0 8px 0 24px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, fontFamily: "inherit", background: "white", outline: "none" }}
                onFocus={e => e.target.style.borderColor = "var(--accent)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"} />
            </div>
            {catalogConnectors.length > 1 && (
              <select aria-label={window.I18N.t("logs.connector", "Connector")} value={blockConnFilter} onChange={e => setBlockConnFilter(e.target.value)}
                style={{ width: "100%", height: 26, padding: "0 6px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, fontFamily: "inherit", background: "white", color: "var(--fg)", outline: "none" }}>
                <option value="all">{window.I18N.t("ui.allConnectors", "All connectors")}</option>
                {catalogConnectors.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
              </select>
            )}
          </div>
        )}

        {catalog.length > 0 && filteredCatalog.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--muted-fg)", marginBottom: 8 }}>{window.I18N.t("ui.boards.noMatches", "No results — adjust the search or filter.")}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {blocksPagination.pageItems.map(b => {
            const u = usedMap[b.id];
            const canAdd = mode === "blocks" && !!sel && !u;
            return (
              <button key={b.id} type="button" disabled={!canAdd}
                onClick={() => addBlock(b.id)}
                title={u ? window.I18N.t("ui.boards.alreadyPlaced", "Already in Zone {0} — remove it there to move it", { 0: u.zone }) : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", textAlign: "left",
                  border: `1px solid ${u ? "var(--accent)" : "var(--border)"}`,
                  background: u ? "color-mix(in srgb, var(--accent) 7%, transparent)" : "white",
                  borderRadius: 6, cursor: canAdd ? "pointer" : "default", opacity: canAdd || u ? 1 : 0.65,
                }}>
                {connectorSwatch(b.connectorId, 21)}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.title}</span>
                  {b.scope && <span style={{ display: "block", fontSize: 9, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.scope}</span>}
                </span>
                {u && <span style={{ color: "var(--accent)", fontSize: 9.5, fontWeight: 600, flexShrink: 0 }}>✓ Z{u.zone}</span>}
              </button>
            );
          })}
        </div>
        {filteredCatalog.length > 0 && <PaginationBar {...blocksPagination} pageSizeOptions={[15, 25, 50]} compact />}
      </div>
    </>
  );

  const layoutContent = (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 210 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{window.I18N.t("ui.boards.layout", "Board layout")}</div>
          <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5 }}>
            {mode === "zones"
              ? <>{window.I18N.t("ui.boards.splitHelp", "click a zone to split · hold Shift to change the axis · drag borders to resize")}</>
              : <>{window.I18N.t("ui.boards.selectHelp", "click a zone to select it · adding to an occupied zone creates another resizable panel")}</>}
          </div>
        </div>
        <div role="group" aria-label="Board editing mode" style={{ display: "flex", gap: 2, padding: 2, background: "white", border: "1px solid var(--border)", borderRadius: 7 }}>
          {[["blocks", window.I18N.t("ui.boards.addBlocks", "Add blocks")], ["zones", window.I18N.t("ui.boards.editZones", "Edit zones")]].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); setSel(null); }} style={{
              height: 24, padding: "0 10px", border: 0, borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: mode === k ? "var(--accent)" : "transparent", color: mode === k ? "#fff" : "var(--muted-fg)",
            }}>{l}</button>
          ))}
        </div>
        {!mobile && (
          <button type="button" aria-label="Hide board layout" onClick={() => setShowLayout(false)} title={window.I18N.t("ui.boards.closeLayout", "Close layout — show only the preview")} style={{
            width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: "1px solid var(--border)", background: "white", borderRadius: 6, cursor: "pointer", color: "var(--muted-fg)", fontSize: 15, lineHeight: 1, flexShrink: 0,
          }}>×</button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: "var(--muted-fg)", marginRight: 2 }}>Presets</span>
        {window.ZoneTree.PRESET_LIST.map(([k, l]) => (
          <button key={k} type="button" onClick={() => usePreset(k)} style={{ height: 26, padding: "0 10px", border: "1px solid var(--border)", background: "white", borderRadius: 6, fontSize: 11.5, cursor: "pointer", color: "var(--muted-fg)" }}>{window.I18N.t(`ui.boards.preset.${k}`, l)}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{zones.length} {window.I18N.t("ui.boards.zones", "zones ·")} {used.length} blocks</span>
      </div>

      <ZoneEditor tree={tree} setTree={setTree} mode={mode} sel={sel} setSel={setSel} flip={flip} catalog={catalog} />

      {emptyZones > 0 && (
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--warn, #d97706)" }}>{emptyZones} {window.I18N.t("ui.boards.emptyZones", "zone(s) without blocks — they will be compacted when removing or saving.")}</div>
      )}
    </>
  );

  const previewContent = (
    <>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{window.I18N.t("tags.preview", "Preview")}</div>
      <DraftPreview tree={tree} catalog={catalog} fillHeight={!mobile} />
    </>
  );

  return (
    <section aria-label={isNew ? "Create board" : "Edit board"} data-lintaya-entity="board" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, minHeight: "var(--header-h)", padding: "8px 18px 8px 4px", borderBottom: "1px solid var(--border)", background: "white", flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ alignSelf: "stretch", display: "flex", alignItems: "flex-end", padding: "0 14px 6px", borderBottom: "2px solid var(--accent)" }}>
          <h1 style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>{isNew ? window.I18N.t("ui.boards.new", "New Board") : window.I18N.t("ui.boards.edit", "Edit · {0}", { 0: page.title })}</h1>
        </div>
        <span style={{ flex: 1 }} />
        <BoardToggleButton pressed={active} onToggle={() => setActive(value => !value)}
          labelOn={window.I18N.t("ui.active", "Active")} labelOff={window.I18N.t("ui.boards.inactive", "Inactive")}
          titleOn={window.I18N.t("ui.boards.available", "Board available to open")} titleOff={window.I18N.t("ui.boards.inactiveHelp", "Inactive Board · editing only")}
          ariaLabel={active ? window.I18N.t("ui.boards.disable", "Disable Board") : window.I18N.t("ui.boards.enable", "Enable Board")} />
        <BoardToggleButton pressed={showInSidebar} onToggle={() => setShowInSidebar(value => !value)}
          labelOn={window.I18N.t("ui.boards.inSidebar", "In sidebar")} labelOff={window.I18N.t("ui.boards.outsideSidebar", "Outside sidebar")}
          titleOn={window.I18N.t("ui.boards.showSidebarHelp", "Show this Board in the sidebar")} titleOff={window.I18N.t("ui.boards.hiddenSidebarHelp", "Hidden from the sidebar; still available in Boards")}
          ariaLabel={showInSidebar ? window.I18N.t("ui.boards.hideSidebar", "Hide Board from sidebar") : window.I18N.t("ui.boards.showSidebar", "Show Board in sidebar")} />
        <button disabled={!title.trim() || saving} onClick={save} style={{
          height: 28, padding: "0 16px", border: 0, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: !title.trim() || saving ? "default" : "pointer",
          background: !title.trim() ? "var(--muted)" : "var(--accent)", color: !title.trim() ? "var(--muted-fg)" : "#fff",
        }}>
          {saving ? window.I18N.t("ui.saving", "Saving…") : window.I18N.t("ui.boards.saveApply", "Save and apply")}
        </button>
        <button type="button" onClick={onCancel} aria-label={window.I18N.t("ui.boards.closeEditor", "Close editor without saving")} title={window.I18N.t("ui.boards.closeWithoutSaving", "Close without saving")}
          style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--border)", background: "white", color: "var(--muted-fg)", borderRadius: 6, fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" }}>×</button>
      </header>

      {mobile ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "white" }}>
          <ModuleBuilderAccordionSection title={window.I18N.t("ui.boards.identity", "Identity and blocks")} open={openSection === "identity"} onToggle={() => setOpenSection(s => s === "identity" ? null : "identity")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{identityContent}</div>
          </ModuleBuilderAccordionSection>
          <ModuleBuilderAccordionSection title="Layout" open={openSection === "layout"} onToggle={() => setOpenSection(s => s === "layout" ? null : "layout")}>
            {layoutContent}
          </ModuleBuilderAccordionSection>
          <ModuleBuilderAccordionSection title={window.I18N.t("tags.preview", "Preview")} open={openSection === "preview"} onToggle={() => setOpenSection(s => s === "preview" ? null : "preview")}>
            {previewContent}
          </ModuleBuilderAccordionSection>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          {/* izquierda: identidad + catálogo de blocks */}
          <aside aria-label="Board identity and available blocks" style={{ width: leftWidth, flexShrink: 0, background: "white", padding: "16px 16px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
            {identityContent}
          </aside>
          <ModuleBuilderResizeHandle onMouseDown={e => onLeftHandleDown(e, 1)} />

          {/* centro: layout */}
          {showLayout && <section aria-label={window.I18N.t("ui.boards.layout", "Board layout")} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "16px 18px 24px" }}>
            {layoutContent}
          </section>}
          {showLayout && <ModuleBuilderResizeHandle onMouseDown={e => onRightHandleDown(e, -1)} />}

          {/* derecha: preview — toma todo el ancho restante cuando el layout está cerrado */}
          <aside aria-label="Board preview" style={{
            ...(showLayout ? { width: rightWidth, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
            background: "var(--muted)", padding: "16px 14px 24px", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0,
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
          <div role="dialog" aria-modal="true" aria-label="Choose a board icon" style={{
            background: "var(--surface)", borderRadius: 12, width: "min(340px, 94vw)",
            boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{window.I18N.t("ui.chooseIcon", "Choose an icon")}</span>
              <button type="button" aria-label="Close icon picker" onClick={() => setShowIconModal(false)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 16, padding: 2, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
              {PAGE_ICON_KEYS.map(k => {
                const on = icon === k;
                return (
                  <button key={k} onClick={() => { setIcon(k); setShowIconModal(false); }} title={k} style={{
                    height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                    background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "white",
                    color: on ? "var(--accent)" : "var(--muted-fg)", borderRadius: 6, cursor: "pointer",
                  }}>{pageIcon(k)}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────
// No list view here anymore — editing/deleting boards lives entirely on the
// Boards page (app.jsx's ConnectorModulesPage, "Mis boards" section). This
// component is only ever entered with an explicit intent: "New Board" or a
// card's "Editar" (app.jsx sets window.__moduleBuilderIntent before
// navigating here — same convention Sidebar's openPinnedRepo already uses
// via window.__pendingRepoOpen, handing a target off across a route change
// without real URL params). Cancel/Save both return to that same page.
function ModuleBuilder({ onNavigate }) {
  window.I18N?.useLocale();
  const [catalog, setCatalog] = useState([]);
  const [connections, setConnections] = useState([]);
  const [launch] = useState(() => {
    const intent = window.__moduleBuilderIntent;
    window.__moduleBuilderIntent = undefined;
    if (intent?.board && intent.returnRoute) {
      return { editing: intent.board, returnRoute: intent.returnRoute };
    }
    return {
      editing: (intent && typeof intent === "object") ? intent : null,
      returnRoute: "modules",
    };
  });

  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/home/blocks").catch(() => []),
      window.HQ_API.request("/api/home/custom-blocks").catch(() => []),
      window.HQ_API.request("/api/connectors").catch(() => []),
    ]).then(([connectorBlocks, customBlocks, connectionList]) => {
      setConnections(Array.isArray(connectionList) ? connectionList : []);
      // Un custom block marcado "Oculta" (active:false) no se ofrece para
      // boards nuevos; si ya estaba puesto en uno guardado, ZoneEditor/
      // DraftPreview ya saben mostrar "Block no disponible" para un id que
      // el catálogo no resuelve — mismo fallback que un block borrado.
      const visibleCustom = (customBlocks || []).filter(b => b.active !== false);
      setCatalog([...(connectorBlocks || []), ...visibleCustom]);
    });
  }, []);

  return (
    <PageEditor
      page={launch.editing}
      catalog={catalog}
      connections={connections}
      onCancel={() => onNavigate(launch.returnRoute)}
      onSaved={() => onNavigate(launch.returnRoute)}
    />
  );
}

window.ModuleBuilderView = ModuleBuilder;

window.BoardDraftPreview = DraftPreview;

// The Dashboard editor (dashboard.jsx) is the same three-column editor over a
// different entity, so it reuses this chrome instead of growing a second copy
// that drifts. Exported under names of their own: the local names above stay
// unique per file, for the reason spelled out on useModuleBuilderResizableWidth.
window.BoardToggleButton = BoardToggleButton;
window.BoardEditorResizeHandle = ModuleBuilderResizeHandle;
window.useBoardEditorResizableWidth = useModuleBuilderResizableWidth;
window.BoardEditorAccordionSection = ModuleBuilderAccordionSection;
