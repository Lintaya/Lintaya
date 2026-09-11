// Interactive renderer for a Board created by Module Builder. The persisted
// contract stays `page.tree`: split nodes own a direction+ratio and zone leaves
// own ordered Block ids. This view edits only those placement references via
// PUT /api/module-pages/:id; it never deletes a global Block or provider data.
// Empty leaves are compacted for presentation, so a surviving sibling fills
// the released space instead of leaving a fixed empty cell.
const { useState, useEffect, useRef, useCallback } = React;
const cpt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

const BOARD_MIN_RATIO = 0.15;
const BOARD_MAX_RATIO = 0.85;
const BOARD_MOBILE_BREAKPOINT = 700;

function clampBoardRatio(value) {
  return Math.min(BOARD_MAX_RATIO, Math.max(BOARD_MIN_RATIO, value));
}

function BoardResizeSeparator({ vertical, ratio, onPointerDown, onKeyDown, className }) {
  const [active, setActive] = useState(false);
  const percent = Math.round(ratio * 100);
  return (
    <div
      className={className}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={window.I18N.t("ui.boards.resizeLabel", "Resize zones. Use the {0} arrow keys.", { 0: vertical ? window.I18N.t("ui.boards.horizontal", "left and right") : window.I18N.t("ui.boards.vertical", "up and down") })}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={percent}
      onPointerDown={event => { setActive(true); onPointerDown(event, () => setActive(false)); }}
      onKeyDown={onKeyDown}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      title={window.I18N.t("ui.resize", "Drag to resize · arrow keys also work")}
      style={{
        position: "relative", flex: "0 0 auto", zIndex: 4,
        width: vertical ? 12 : "100%", height: vertical ? "100%" : 12,
        minWidth: vertical ? 12 : 0, minHeight: vertical ? 0 : 12,
        cursor: vertical ? "col-resize" : "row-resize", touchAction: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        outline: active ? "2px solid var(--brand-glass-active)" : "none",
        outlineOffset: -2, borderRadius: 4,
      }}>
      <span aria-hidden="true" style={{
        display: "block", borderRadius: 99,
        background: active ? "var(--accent)" : "var(--border)",
        transition: "background .12s",
        width: vertical ? 3 : 42, height: vertical ? 42 : 3,
      }} />
    </div>
  );
}

function BoardTreeNode({ node, mobile, catalog, closeRefs, onClose, onRatioPreview, onRatioCommit, blockItemHandlers, showBlockHeaders = true }) {
  const splitRef = useRef(null);

  if (node.t === "z") {
    return (
      <section aria-label={window.I18N.t("ui.boards.zoneLabel", "Board zone with {0} Blocks", { 0: (node.blocks || []).length })} style={{
        minWidth: 0, minHeight: 0, width: "100%", height: mobile ? "auto" : "100%",
        overflow: mobile ? "visible" : "hidden",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        {(node.blocks || []).map((blockId, index) => {
          const block = catalog.find(item => item.id === blockId);
          const title = block?.title || blockId;
          const placementKey = `${node.k}:${index}`;
          const buttonRef = element => {
            if (element) closeRefs.current[placementKey] = element;
            else delete closeRefs.current[placementKey];
          };
          if (!block) {
            return (
              <div key={`${node.k}:${blockId}:${index}`} style={{
                minWidth: 0, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
                border: "1px dashed var(--border)", borderRadius: 8, background: "var(--surface)",
                color: "var(--muted-fg)", fontSize: 12,
              }}>
                <span style={{ flex: 1 }}>{cpt("boards.blockUnavailable", "Block unavailable — the connector or custom block it used was deleted.")}</span>
                <button ref={buttonRef} type="button" aria-label={window.I18N.t("ui.boards.closeBlock", "Close {0} from this Board", { 0: title })}
                  title={window.I18N.t("ui.boards.removeHelp", "Remove from Board; does not delete the global Block")}
                  onClick={() => onClose(node.k, index, blockId, title)}
                  style={{ border: 0, background: "none", color: "var(--muted-fg)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
              </div>
            );
          }
          return (
            <window.ConnectorBlockPanel
              key={`${node.k}:${blockId}:${index}`}
              block={block}
              onItemClick={blockItemHandlers[block.id]}
              panelProps={{
                onRemove: () => onClose(node.k, index, blockId, title),
                removeLabel: window.I18N.t("ui.boards.closeBlock", "Close {0} from this Board", { 0: title }),
                removeTitle: window.I18N.t("ui.boards.removeLibraryHelp", "Remove from Board; the Block will remain available in the library"),
                removeButtonRef: buttonRef,
                contentScroll: !mobile,
                fillHeight: false,
                contentScrollLabel: window.I18N.t("ui.boards.contentLabel", "Content of {0}. Use arrow keys, Page Up, or Page Down to scroll", { 0: title }),
                hideHeader: !showBlockHeaders,
              }}
            />
          );
        })}
      </section>
    );
  }

  const visualDir = mobile ? "h" : node.dir;
  const vertical = visualDir === "v";
  const ratio = clampBoardRatio(Number(node.ratio) || 0.5);

  const startResize = (event, finishVisualState) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) { finishVisualState(); return; }
    let latest = ratio;
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const move = pointerEvent => {
      latest = clampBoardRatio(vertical
        ? (pointerEvent.clientX - rect.left) / Math.max(rect.width, 1)
        : (pointerEvent.clientY - rect.top) / Math.max(rect.height, 1));
      onRatioPreview(node.k, latest);
    };
    const end = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      finishVisualState();
      onRatioCommit(node.k, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const resizeWithKeyboard = event => {
    const decrease = vertical ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase = vertical ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    onRatioCommit(node.k, clampBoardRatio(ratio + (increase ? 0.05 : -0.05)));
  };

  // The workspace owns a real desktop height, so panes must be allowed to
  // shrink below their content height. Otherwise a Block's natural height
  // overrides the stored flex ratio: the separator can report 85% while the
  // first pane remains stuck at 150px. The pane clips overflow while the saved
  // split ratio remains authoritative.
  const paneStyle = {
    minWidth: 0, minHeight: 0,
    overflow: mobile ? "visible" : "hidden",
  };
  const firstPaneFlex = mobile ? "0 0 auto" : `${ratio} 1 0`;
  const secondPaneFlex = mobile ? "0 0 auto" : `${1 - ratio} 1 0`;

  return (
    <div ref={splitRef} style={{
      minWidth: 0, minHeight: 0, height: mobile ? "auto" : "100%", width: "100%",
      display: "flex", flexDirection: vertical ? "row" : "column", alignItems: "stretch",
    }}>
      <div style={{ ...paneStyle, flex: firstPaneFlex }}>
        <BoardTreeNode node={node.a} mobile={mobile} catalog={catalog} closeRefs={closeRefs}
          onClose={onClose} onRatioPreview={onRatioPreview} onRatioCommit={onRatioCommit}
          blockItemHandlers={blockItemHandlers} showBlockHeaders={showBlockHeaders} />
      </div>
      <BoardResizeSeparator vertical={vertical} ratio={ratio} onPointerDown={startResize} onKeyDown={resizeWithKeyboard} />
      <div style={{ ...paneStyle, flex: secondPaneFlex }}>
        <BoardTreeNode node={node.b} mobile={mobile} catalog={catalog} closeRefs={closeRefs}
          onClose={onClose} onRatioPreview={onRatioPreview} onRatioCommit={onRatioCommit}
          blockItemHandlers={blockItemHandlers} showBlockHeaders={showBlockHeaders} />
      </div>
    </div>
  );
}

function CustomPageView({ page, blockCatalog = [], onEdit, presentation = false, embedded = false, showBlockHeaders = true }) {
  window.I18N?.useLocale();
  const [tree, setTree] = useState(() => window.ZoneTree.compactTree(page.tree));
  const treeRef = useRef(tree);
  const syncedUpdatedAt = useRef(page.updatedAt);

  // `page` is refetched (app/app.jsx) on hq:module-pages-changed, but this
  // component's own `tree` only ever changes through applyTree — so an edit
  // made elsewhere (Board Builder's "Guardar y aplicar" on this same Board)
  // never reached it, and the render stayed stale until a full page reload.
  // Resync whenever the persisted record actually moved forward; guarded by
  // updatedAt so this component's own round-tripped save doesn't re-render
  // with a "new" but identical tree on every keystroke-level resize commit.
  useEffect(() => {
    if (page.updatedAt === syncedUpdatedAt.current) return;
    syncedUpdatedAt.current = page.updatedAt;
    const next = window.ZoneTree.compactTree(page.tree);
    treeRef.current = next;
    setTree(next);
  }, [page.updatedAt, page.tree]);
  const saveQueue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const closeRefs = useRef({});
  const emptyActionRef = useRef(null);
  const focusAfterClose = useRef(null);
  const [saveState, setSaveState] = useState("idle");
  const [modalDoc, setModalDoc] = useState(null);
  const sectionRef = useRef(null);
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < BOARD_MOBILE_BREAKPOINT);

  // Measure this Board's own rendered width, not the viewport — the sidebar
  // and the AI Chat panel both eat into it, so a Board can be phone-narrow on
  // a wide desktop window. Without this, a nested horizontal split (zone 2
  // next to zone 1) just kept shrinking both zones instead of stacking them,
  // because window.innerWidth never crossed BOARD_MOBILE_BREAKPOINT.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (typeof width === "number") setMobile(width < BOARD_MOBILE_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!focusAfterClose.current) return;
    const target = focusAfterClose.current;
    focusAfterClose.current = null;
    const frame = requestAnimationFrame(() => {
      if (target === "empty") emptyActionRef.current?.focus();
      else Object.values(closeRefs.current).find(Boolean)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [tree]);

  const persistTree = useCallback((next, successMessage) => {
    let failed = false;
    pendingSaves.current += 1;
    setSaveState("saving");
    saveQueue.current = saveQueue.current
      .then(() => window.HQ_API.request(`/api/module-pages/${page.id}`, { method: "PUT", body: { tree: next } }))
      .then(() => {
        window.dispatchEvent(new CustomEvent("hq:module-pages-changed"));
        if (successMessage) {
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: successMessage, kind: "ok" } }));
        }
      })
      .catch(error => {
        failed = true;
        setSaveState("error");
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.boards.saveError", "Could not save the Board: {0}", { 0: error.message }), kind: "error" } }));
      })
      .finally(() => {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) setSaveState(failed ? "error" : "saved");
      });
  }, [page.id]);

  const applyTree = useCallback((next, persist = false, successMessage = "") => {
    treeRef.current = next;
    setTree(next);
    if (persist) persistTree(next, successMessage);
  }, [persistTree]);

  const closeBlock = useCallback((zoneKey, index, blockId, title) => {
    const next = window.ZoneTree.removeBlockAndCompact(treeRef.current, zoneKey, index);
    focusAfterClose.current = window.ZoneTree.countBlocks(next) ? "first" : "empty";
    applyTree(next, true, window.I18N.t("ui.boards.removed", "{0} was removed from “{1}”; it remains available in the library", { 0: title, 1: page.title }));
  }, [applyTree, page.title]);

  const previewRatio = useCallback((splitKey, ratio) => {
    applyTree(window.ZoneTree.setRatio(treeRef.current, splitKey, ratio), false);
  }, [applyTree]);

  const commitRatio = useCallback((splitKey, ratio) => {
    const next = window.ZoneTree.setRatio(treeRef.current, splitKey, ratio);
    applyTree(next, true);
  }, [applyTree]);

  const blockItemHandlers = {
    "outline.recent-docs": item => setModalDoc({
      id: item.id, title: item.title, updatedBy: item.subtitle,
      updatedAt: item.timestamp, absoluteUrl: item.url,
    }),
  };

  const blockCount = window.ZoneTree.countBlocks(tree);
  const openEditor = () => onEdit?.({ ...page, tree });

  return (
    <section ref={sectionRef} aria-labelledby={`board-title-${page.id}`} data-lintaya-entity="board" style={{
      padding: presentation ? 12 : mobile ? "14px 12px 84px" : 20, width: "100%", maxWidth: presentation ? "none" : 1480, margin: "0 auto",
    }}>
      {!presentation && !embedded && <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <h1 id={`board-title-${page.id}`} style={{ flex: 1, minWidth: 0, fontSize: 22, fontWeight: 650, letterSpacing: -0.25, margin: 0 }}>{page.title}</h1>
        <span role="status" aria-live="polite" style={{ fontSize: 10.5, color: saveState === "error" ? "var(--err)" : "var(--muted-fg)" }}>
          {saveState === "saving" ? window.I18N.t("ui.saving", "Saving…") : saveState === "saved" ? window.I18N.t("ui.savedPlain", "Saved") : saveState === "error" ? window.I18N.t("ui.boards.saveErrorLabel", "Save failed") : ""}
        </span>
        <button type="button" onClick={openEditor} style={{
          height: 30, padding: "0 11px", border: "1px solid var(--border)", background: "var(--surface)",
          color: "var(--fg)", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
        }}>{cpt("boards.edit", "Edit Board")}</button>
      </header>}

      {blockCount === 0 ? (
        <section aria-label={window.I18N.t("ui.boards.empty", "Empty Board")} style={{
          minHeight: 280, padding: 24, border: "1px dashed var(--border)", borderRadius: 12,
          background: "var(--surface)", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", textAlign: "center", gap: 10,
        }}>
          <div aria-hidden="true" style={{ fontSize: 28, color: "var(--muted-fg)" }}>▦</div>
          <h2 style={{ margin: 0, fontSize: 16 }}>{cpt("boards.noBlocks", "This Board has no blocks")}</h2>
          <p style={{ maxWidth: 440, margin: 0, color: "var(--muted-fg)", fontSize: 12.5 }}>{window.I18N.t("ui.boards.emptyHelp", "Add content from the library. Closing a Block here never deletes it from the library.")} </p>
          <button ref={emptyActionRef} type="button" onClick={openEditor} style={{
            marginTop: 4, height: 34, padding: "0 14px", border: 0, borderRadius: 7,
            background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12.5,
          }}>{cpt("boards.addBlocks", "Add blocks")}</button>
        </section>
      ) : (
        <div style={{
          minWidth: 0, minHeight: mobile ? 0 : 480, width: "100%",
          height: mobile ? "auto" : presentation ? "calc(100dvh - 104px)" : embedded ? "calc(100dvh - 116px)" : "calc(100dvh - 88px)",
          padding: mobile ? 0 : 2, display: "flex", alignItems: "stretch",
        }}>
          <BoardTreeNode node={tree} mobile={mobile} catalog={blockCatalog} closeRefs={closeRefs}
            onClose={closeBlock} onRatioPreview={previewRatio} onRatioCommit={commitRatio}
            blockItemHandlers={blockItemHandlers} showBlockHeaders={showBlockHeaders} />
        </div>
      )}

      {modalDoc && <window.DocumentDetailModal doc={modalDoc} onClose={() => setModalDoc(null)} />}
    </section>
  );
}

window.CustomPageView = CustomPageView;
// Home reusa el separador de zonas para que ambas pantallas se vean y se
// manejen igual; su geometria no depende del arbol de zonas del Dashboard.
window.BoardResizeSeparator = BoardResizeSeparator;
