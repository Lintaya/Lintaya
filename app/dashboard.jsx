// Dashboard Phase 2 — a lightweight container of ordered Board references.
// It never copies Board trees: rendering delegates to CustomPageView so every
// placement, close and resize continues to persist on the referenced Board.
const { useState, useEffect, useRef } = React;
const dsh = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

const dashboardButton = {
  height: 32, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 7,
  background: "var(--surface)", color: "var(--fg)", cursor: "pointer", font: "inherit", fontSize: 12,
};

// Same "search + dropdown + single table" family as Boards (app.jsx) and
// Blocks (block-catalog.jsx) — FilterChip/action-button aren't shared across
// files in this codebase, so each catalog keeps its own copy.
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

function DashboardStatusPill({ ok, label }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
      background: ok ? "color-mix(in srgb, var(--ok) 14%, white)" : "var(--muted)",
      color: ok ? "var(--ok)" : "var(--muted-fg)",
    }}>{label}</span>
  );
}

function DashboardActionButton({ label, icon, onClick, disabled = false, danger = false }) {
  const restingColor = disabled ? "var(--muted-fg)" : danger ? "var(--err)" : "var(--muted-fg)";
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(); }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = "var(--row-hover)"; e.currentTarget.style.color = danger ? "var(--err)" : "var(--fg)"; } }}
      onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = restingColor; }}
      style={{
        width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--border)", background: "white", borderRadius: 6,
        cursor: disabled ? "default" : "pointer", color: restingColor, opacity: disabled ? 0.65 : 1,
      }}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>{icon}</span>
    </button>
  );
}

async function exportDashboardPackage(dashboard) {
  const result = await window.HQ_API.request("/api/workspace-packages/export", {
    method: "POST", body: { dashboardIds: [dashboard.id] },
  });
  const summary = result.summary;
  const authored = summary.containsAuthoredContent
    ? window.I18N.t("ui.dashboards.authored", "\n\nIncludes content written by you:\n{titles}", { titles: summary.authoredBlockTitles.map(title => `• ${title}`).join("\n") })
    : window.I18N.t("ui.dashboards.noAuthored", "\n\nDoes not include Blocks with content written by you.");
  const approved = confirm(
    window.I18N.t("ui.dashboards.exportConfirm", "Export “{title}”\n\n{dashboards} Dashboard · {boards} Boards · {blocks} content Blocks · {requirements} connector requirements{authored}\n\nSecrets, caches, synchronized data, and local IDs are not exported.", { title: dashboard.title, dashboards: summary.dashboards, boards: summary.boards, blocks: summary.customBlocks, requirements: summary.connectorRequirements, authored }),
  );
  if (!approved) return false;
  const blob = new Blob([JSON.stringify(result.package, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `lintaya-${dashboard.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dashboard"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return true;
}

function DashboardEditor({ dashboard, boards, onSaved, onCancel }) {
  const [title, setTitle] = useState(dashboard?.title || "");
  const [active, setActive] = useState(dashboard?.active !== false);
  const [showInSidebar, setShowInSidebar] = useState(dashboard?.showInSidebar !== false);
  const [boardIds, setBoardIds] = useState(dashboard?.boardIds || []);
  const [tags, setTags] = useState(dashboard?.tags || []);
  const [saving, setSaving] = useState(false);

  const toggleBoard = id => setBoardIds(current => current.includes(id)
    ? current.filter(item => item !== id)
    : [...current, id]);
  const move = (index, delta) => setBoardIds(current => {
    const target = index + delta;
    if (target < 0 || target >= current.length) return current;
    const next = current.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const save = async event => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const body = { title: title.trim(), icon, active, showInSidebar, boardIds, tags };
      const saved = await window.HQ_API.request(
        dashboard ? `/api/dashboards/${dashboard.id}` : "/api/dashboards",
        { method: dashboard ? "PUT" : "POST", body },
      );
      window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.saved", "Dashboard “{0}” saved", { 0: saved.title }), kind: "ok" } }));
      onSaved(saved);
    } catch (error) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.saveFailed", "Could not save: {0}", { 0: error.message }), kind: "error" } }));
    } finally { setSaving(false); }
  };

  const [icon, setIcon] = useState(dashboard?.icon || "grid");
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState(boardIds[0] || null);
  const [catalog, setCatalog] = useState([]);
  const dragId = useRef(null);
  // Same three-column chrome as the Board editor, down to the drag handles and
  // the accordion it collapses into when the columns no longer fit.
  const [leftWidth, onLeftHandleDown] = window.useBoardEditorResizableWidth("hq.dashboardEditorLeftWidth", 280);
  const [rightWidth, onRightHandleDown] = window.useBoardEditorResizableWidth("hq.dashboardEditorRightWidth", 380, 260, 620);
  const [mobile, setMobile] = useState(() => window.innerWidth < 700);
  const [openSection, setOpenSection] = useState("identity");
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([window.HQ_API.request("/api/home/blocks"), window.HQ_API.request("/api/home/custom-blocks")])
      .then(([fixed, custom]) => { if (live) setCatalog([...fixed, ...custom]); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const selectedBoard = boards.find(b => b.id === (boardIds.includes(previewId) ? previewId : boardIds[0]));
  const add = id => { setBoardIds(ids => ids.includes(id) ? ids : [...ids, id]); setPreviewId(id); };
  const drop = (event, target) => {
    event.preventDefault(); event.stopPropagation();
    const id = dragId.current;
    if (!id || !boards.some(b => b.id === id)) return;
    setBoardIds(ids => { const next = ids.filter(item => item !== id); const at = next.indexOf(target); next.splice(at < 0 ? next.length : at, 0, id); return next; });
    setPreviewId(id); dragId.current = null;
  };
  const label = { fontSize: 11, color: "var(--muted-fg)", marginBottom: 10, display: "block" };

  const identityContent = <>
    <div>
      <label style={label} htmlFor="dashboard-title">{dsh("dashboards.name", "Name")}</label>
      <input id="dashboard-title" required autoFocus value={title} onChange={e=>setTitle(e.target.value)} style={{...dashboardButton,width:"100%"}}/>
    </div>
    <fieldset style={{border:0,padding:0,margin:0}}><legend style={label}>{dsh("tags.optional", "Tags (optional)")}</legend>
      {window.TagPicker && <window.TagPicker value={tags} onChange={setTags}/>}
    </fieldset>
    <fieldset style={{border:0,padding:0,margin:0}}><legend style={label}>{dsh("common.icon", "Icon")}</legend>
      {["grid","gauge","server","layers"].map(key=><button key={key} type="button" aria-label={key} aria-pressed={icon===key} onClick={()=>setIcon(key)} style={{...dashboardButton,marginRight:4,background:icon===key?"var(--muted)":"var(--surface)"}}>{({grid:"▦",gauge:"◴",server:"▤",layers:"▱"})[key]}</button>)}
    </fieldset>
    <div>
      <label style={label} htmlFor="dashboard-board-search">{dsh("dashboards.boardsOrder", "Boards and tab order")}</label>
      {/* Mismo buscador que el catálogo de blocks del editor de Board y el de
          conectores del de Block: lupa dentro, fondo blanco y borde que se
          ilumina al enfocar. Antes heredaba dashboardButton, que además le
          ponía cursor:pointer a un campo donde se escribe. */}
      <div style={{position:"relative",marginBottom:10}}>
        <span style={{position:"absolute",left:9,top:8,color:"var(--muted-fg)",fontSize:12,pointerEvents:"none"}}>⌕</span>
        <input id="dashboard-board-search" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder={dsh("boards.search", "Search board…")}
          style={{width:"100%",height:28,padding:"0 10px 0 27px",border:"1px solid var(--border)",borderRadius:6,fontSize:12,fontFamily:"inherit",background:"white",color:"var(--fg)",outline:"none",boxSizing:"border-box"}}
          onFocus={e=>e.target.style.borderColor="var(--accent)"}
          onBlur={e=>e.target.style.borderColor="var(--border)"}/>
      </div>
      {boards.filter(b=>b.title.toLowerCase().includes(search.toLowerCase())).map(b=><button key={b.id} type="button" draggable onDragStart={()=>{dragId.current=b.id;}} onDragEnd={()=>{dragId.current=null;}} onClick={()=>add(b.id)} style={{...dashboardButton,display:"block",width:"100%",height:"auto",padding:10,marginBottom:6,textAlign:"left"}}>{boardIds.includes(b.id)?"✓ ":"+ "}{b.title}</button>)}
    </div>
  </>;

  const orderContent = <>
    <h2 style={label}>{dsh("dashboards.boardsOrder", "Boards and tab order")}</h2>
    {boardIds.map((id,index)=><div key={id} draggable onDragStart={()=>{dragId.current=id;}} onDragEnd={()=>{dragId.current=null;}} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,id)} style={{padding:10,border:"1px solid var(--border)",borderRadius:7,marginBottom:8,display:"flex",gap:5,alignItems:"center",background:"var(--surface)"}}>
      <button type="button" onClick={()=>setPreviewId(id)} style={{...dashboardButton,flex:1,height:"auto",border:0,textAlign:"left"}}>{index+1}. {boards.find(b=>b.id===id)?.title || id}</button>
      <button type="button" disabled={index===0} onClick={()=>move(index,-1)} aria-label={dsh("ui.moveUp", "Move up")} style={dashboardButton}>↑</button>
      <button type="button" disabled={index===boardIds.length-1} onClick={()=>move(index,1)} aria-label={dsh("ui.moveDown", "Move down")} style={dashboardButton}>↓</button>
      <button type="button" onClick={()=>toggleBoard(id)} aria-label={dsh("common.remove", "Remove Board")} style={dashboardButton}>×</button>
    </div>)}
  </>;

  const previewContent = <>
    <div style={label}>{dsh("tags.preview", "Preview")} · {title}</div>
    <div style={{display:"flex",gap:5,overflowX:"auto",flexShrink:0,marginBottom:10}}>{boardIds.map(id=><button key={id} type="button" aria-pressed={selectedBoard?.id===id} onClick={()=>setPreviewId(id)} style={dashboardButton}>{boards.find(b=>b.id===id)?.title || id}</button>)}</div>
    {selectedBoard?.tree && window.BoardDraftPreview ? <window.BoardDraftPreview key={selectedBoard.id} tree={selectedBoard.tree} catalog={catalog} fillHeight={!mobile}/> : <p>{dsh("dashboards.createBoardFirst", "Create a Board from Boards first.")}</p>}
  </>;

  return <form onSubmit={event => { event.preventDefault(); save(event); }} className="dashboard-editor" data-lintaya-entity="dashboard"
    aria-label={dashboard ? dsh("ui.dashboards.editTitle", "Edit Dashboard") : dsh("dashboards.new", "New Dashboard")}
    style={{height:"100%",display:"flex",flexDirection:"column"}}>
    <header style={{display:"flex",alignItems:"center",gap:10,rowGap:6,minHeight:"var(--header-h)",padding:"8px 18px 8px 4px",borderBottom:"1px solid var(--border)",background:"var(--surface)",flexShrink:0,flexWrap:"wrap"}}>
      <h1 style={{fontSize:13,fontWeight:500,lineHeight:1.15,margin:0,alignSelf: "stretch", display: "flex", alignItems: "flex-end", padding: "0 14px 6px", borderBottom: "2px solid var(--accent)"}}>{dashboard ? dsh("ui.dashboards.editTitle", "Edit Dashboard") : dsh("dashboards.new", "New Dashboard")}</h1>
      <span style={{flex:1}}/>
      <window.BoardToggleButton pressed={active} onToggle={() => setActive(value => !value)}
        labelOn={dsh("ui.active", "Active")} labelOff={dsh("ui.dashboards.inactive", "Inactive")}
        titleOn={dsh("ui.dashboards.available", "Dashboard available to open")} titleOff={dsh("ui.dashboards.inactiveHelp", "Inactive Dashboard · editing only")}
        ariaLabel={active ? dsh("ui.dashboards.disable", "Disable Dashboard") : dsh("ui.dashboards.enable", "Enable Dashboard")}/>
      <window.BoardToggleButton pressed={showInSidebar} onToggle={() => setShowInSidebar(value => !value)}
        labelOn={dsh("ui.dashboards.inSidebar", "In sidebar")} labelOff={dsh("ui.dashboards.outsideSidebar", "Outside sidebar")}
        titleOn={dsh("ui.dashboards.showSidebarHelp", "Show this Dashboard in the sidebar")} titleOff={dsh("ui.dashboards.hiddenSidebarHelp", "Hidden from the sidebar; still available in Dashboards")}
        ariaLabel={showInSidebar ? dsh("ui.dashboards.hideSidebar", "Hide Dashboard from sidebar") : dsh("ui.dashboards.showSidebar", "Show in sidebar")}/>
      <button disabled={saving || !title.trim()} style={{
        height:28,padding:"0 16px",border:0,borderRadius:6,fontSize:12,fontWeight:600,cursor:!title.trim()||saving?"default":"pointer",
        background:!title.trim()?"var(--muted)":"var(--accent)",color:!title.trim()?"var(--muted-fg)":"#fff",fontFamily:"inherit",
      }}>{saving ? dsh("ui.saving", "Saving…") : dsh("ui.boards.saveApply", "Save and apply")}</button>
      <button type="button" onClick={onCancel} aria-label={dsh("ui.boards.closeEditor", "Close editor without saving")} title={dsh("ui.boards.closeWithoutSaving", "Close without saving")}
        style={{width:28,height:28,padding:0,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--muted-fg)",borderRadius:6,fontSize:18,lineHeight:1,cursor:"pointer",fontFamily:"inherit"}}>×</button>
    </header>

    {mobile ? (
      <div style={{flex:1,minHeight:0,overflowY:"auto",background:"var(--surface)"}}>
        <window.BoardEditorAccordionSection title={dsh("ui.dashboards.identity", "Identity and Boards")} open={openSection === "identity"} onToggle={() => setOpenSection(s => s === "identity" ? null : "identity")}>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>{identityContent}</div>
        </window.BoardEditorAccordionSection>
        <window.BoardEditorAccordionSection title={dsh("dashboards.boardsOrder", "Boards and tab order")} open={openSection === "order"} onToggle={() => setOpenSection(s => s === "order" ? null : "order")}>
          <div onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,null)}>{orderContent}</div>
        </window.BoardEditorAccordionSection>
        <window.BoardEditorAccordionSection title={dsh("tags.preview", "Preview")} open={openSection === "preview"} onToggle={() => setOpenSection(s => s === "preview" ? null : "preview")}>
          {previewContent}
        </window.BoardEditorAccordionSection>
      </div>
    ) : (
      <div className="dashboard-editor-columns" style={{flex:1,minHeight:0,display:"flex",overflow:"hidden"}}>
        <aside aria-label={dsh("ui.dashboards.identity", "Identity and Boards")} style={{width:leftWidth,flexShrink:0,background:"var(--surface)",padding:"16px 16px 24px",overflowY:"auto",display:"flex",flexDirection:"column",gap:16}}>
          {identityContent}
        </aside>
        <window.BoardEditorResizeHandle onMouseDown={e => onLeftHandleDown(e, 1)}/>

        <section aria-label={dsh("dashboards.boardsOrder", "Boards and tab order")} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,null)} style={{flex:1,minWidth:0,overflowY:"auto",padding:"16px 18px 24px"}}>
          {orderContent}
        </section>
        <window.BoardEditorResizeHandle onMouseDown={e => onRightHandleDown(e, -1)}/>

        <aside aria-label={dsh("tags.preview", "Preview")} style={{width:rightWidth,flexShrink:0,background:"var(--muted)",padding:"16px 14px 24px",overflow:"hidden",display:"flex",flexDirection:"column",minHeight:0}}>
          {previewContent}
        </aside>
      </div>
    )}
  </form>;
}

function DashboardCatalogView({ dashboards, boards, onNavigate }) {
  window.I18N?.useLocale();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [q, setQ] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [confirmDashboard, setConfirmDashboard] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importPackage, setImportPackage] = useState(null);
  const [importName, setImportName] = useState("");
  const [importError, setImportError] = useState("");
  const [importNames, setImportNames] = useState({});
  const [importActions, setImportActions] = useState({});
  const [importMappings, setImportMappings] = useState({});
  const [applyingImport, setApplyingImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);
  const previewImport = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    setImportPreview(null);
    setImportName(file.name);
    if (file.size > 2 * 1024 * 1024) return setImportError(window.I18N.t("ui.dashboards.tooLarge", "The package exceeds the 2 MB limit."));
    setImporting(true);
    try {
      const packageValue = JSON.parse(await file.text());
      const preview = await window.HQ_API.request("/api/workspace-packages/import/preview", { method: "POST", body: { package: packageValue } });
      setImportPreview(preview);
      setImportPackage(packageValue);
      setImportNames(Object.fromEntries(preview.resources.map(item => [item.key, item.suggestedTitle])));
      setImportActions(Object.fromEntries(preview.resources.map(item => [item.key, { mode: "create" }])));
      setImportMappings(Object.fromEntries(preview.requirements.filter(item => item.connectionId).map(item => [item.key, item.connectionId])));
    } catch (error) {
      setImportError(error instanceof SyntaxError ? window.I18N.t("ui.dashboards.invalidJson", "The file does not contain valid JSON.") : (error.message || window.I18N.t("ui.dashboards.validateFailed", "Could not validate the package.")));
    } finally { setImporting(false); }
  };
  const namesValid = importPreview?.resources.every(item => importActions[item.key]?.mode === "reuse" || String(importNames[item.key] || "").trim()) ?? false;
  const mappingsValid = importPreview?.requirements.every(item => importMappings[item.key] && item.candidates.some(candidate => candidate.id === importMappings[item.key])) ?? false;
  const applyImport = async () => {
    if (!importPackage || !namesValid || !mappingsValid) return;
    if (!confirm(window.I18N.t("ui.dashboards.confirmImport", "Apply this import? Resources marked for reuse will keep their local data; the rest will be created with new IDs."))) return;
    setApplyingImport(true);
    setImportError("");
    try {
      const response = await window.HQ_API.request("/api/workspace-packages/import", {
        method: "POST", body: { package: importPackage, names: importNames, resourceActions: importActions, connectionMappings: importMappings, sourceFile: importName },
      });
      const total = response.results.blocks.length + response.results.boards.length + response.results.dashboards.length;
      setImportPreview(null); setImportPackage(null); setImportName(""); setImportNames({}); setImportActions({}); setImportMappings({});
      window.dispatchEvent(new CustomEvent("hq:custom-blocks-changed"));
      window.dispatchEvent(new CustomEvent("hq:module-pages-changed"));
      window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.imported", "Import completed: {0} resources processed", { 0: total }), kind: "ok" } }));
    } catch (error) { setImportError(error.message || window.I18N.t("ui.dashboards.importFailed", "Could not apply the import.")); }
    finally { setApplyingImport(false); }
  };
  // Sin window.confirm(): Chrome lo suprime en display-mode:standalone, así
  // que instalada como PWA este borrado se cancelaba solo, en silencio.
  const remove = async dashboard => {
    await window.HQ_API.request(`/api/dashboards/${dashboard.id}`, { method: "DELETE" });
    window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
  };

  const term = q.trim().toLowerCase();
  const matches = dashboard =>
    (estadoFilter === "all" || (estadoFilter === "active" ? dashboard.active : !dashboard.active)) &&
    (tagFilter === "all" || (dashboard.tags || []).includes(tagFilter)) &&
    (!term || dashboard.title.toLowerCase().includes(term));
  const tagOptions = window.tagFilterOptions ? window.tagFilterOptions(dashboards) : [];
  const rows = dashboards.filter(matches);
  const pagination = window.usePagination(rows, { key: "dashboards-catalog" });

  // The editor takes over the whole view, the way the Board editor owns the
  // module-builder route. Rendering it inline used to force `position: fixed`
  // to escape the catalog, which covered the sidebar along with everything else.
  if (creating || editing) {
    const close = () => { setCreating(false); setEditing(null); };
    return <DashboardEditor dashboard={editing} boards={boards} onCancel={close} onSaved={close} />;
  }

  return (
    <section style={{ padding: "20px", width: "100%", maxWidth: 1480, margin: "0 auto" }} aria-labelledby="dashboards-title">
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1 }}><h1 id="dashboards-title" style={{ margin: 0, fontSize: 22 }}>{dsh("dashboards.title", "Dashboards")}</h1><p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 12.5 }}>{dsh("dashboards.subtitle", "Group Boards as tabs without duplicating their content.")}</p></div>
        <input ref={importInputRef} type="file" accept="application/json,.json" onChange={previewImport} style={{ display: "none" }} aria-label={window.I18N.t("ui.dashboards.selectPackage", "Select a Lintaya package")} />
        <button type="button" disabled={importing} onClick={() => importInputRef.current?.click()} style={dashboardButton}>{importing ? window.I18N.t("ui.dashboards.validating", "Validating…") : window.I18N.t("connectors.view.import", "Import")}</button>
        <button type="button" onClick={() => { setCreating(true); setEditing(null); }} style={{ ...dashboardButton, border: 0, background: "var(--accent)", color: "#fff" }}>{dsh("dashboards.new", "New Dashboard")}</button>
      </header>
      {(importPreview || importError) && <section aria-labelledby="import-preview-title" style={{ border: `1px solid ${importError ? "var(--err)" : "var(--border)"}`, borderRadius: 9, padding: 12, marginBottom: 14, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1 }}><strong id="import-preview-title" style={{ fontSize: 13 }}>{dsh("dashboards.importPreview", "Import preview")}</strong>{importName && <span style={{ display: "block", color: "var(--muted-fg)", fontSize: 11.5 }}>{importName} {window.I18N.t("ui.dashboards.notSaved", "· nothing has been saved yet")}</span>}</div>
          <button type="button" aria-label={window.I18N.t("ui.dashboards.closePreview", "Close import preview")} title={window.I18N.t("connectors.import.close", "Close")} onClick={() => { setImportPreview(null); setImportPackage(null); setImportError(""); setImportName(""); setImportNames({}); setImportActions({}); setImportMappings({}); }} style={{ ...dashboardButton, width: 32, padding: 0, fontSize: 17 }}>×</button>
        </div>
        {importError ? <p role="alert" style={{ color: "var(--err)", margin: "10px 0 0", fontSize: 12 }}>{importError}</p> : <>
          <p style={{ margin: "10px 0 6px", fontSize: 12 }}>{importPreview.summary.dashboards} Dashboard · {importPreview.summary.boards} Boards · {importPreview.summary.customBlocks} {window.I18N.t("ui.dashboards.contentBlocks", "Content Blocks ·")} {importPreview.summary.connectorRequirements} {window.I18N.t("ui.dashboards.requirements", "connector requirements")}</p>
          {importPreview.summary.containsAuthoredContent && <p style={{ margin: "6px 0", color: "var(--warn, #9a6700)", fontSize: 11.5 }}>{window.I18N.t("ui.dashboards.authoredWarning", "The package contains content written by another user. Review it before applying.")}</p>}
          {importPreview.conflicts.length > 0 && <div style={{ marginTop: 9 }}><strong style={{ fontSize: 11.5 }}>{dsh("dashboards.conflicts", "Name conflicts")}</strong><ul style={{ margin: "5px 0 0", paddingLeft: 20, fontSize: 11.5 }}>{importPreview.conflicts.map(item => <li key={`${item.resourceType}:${item.key}`}>{item.title} · {item.resourceType}</li>)}</ul></div>}
          {importPreview.resources.length > 0 && <fieldset style={{ margin: "10px 0 0", padding: 10, border: "1px solid var(--border)", borderRadius: 7 }}>
            <legend style={{ padding: "0 5px", fontSize: 11.5, fontWeight: 650 }}>{dsh("dashboards.importNames", "Names on import")}</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 8 }}>
              {importPreview.resources.map(item => <label key={item.key} style={{ display: "grid", gap: 3, fontSize: 11.5 }}>
                <span>{item.resourceType === "block" ? "Block" : item.resourceType === "board" ? "Board" : "Dashboard"} · {item.title}</span>
                {item.existingOptions.length > 0 && item.reusable && <select value={importActions[item.key]?.mode === "reuse" ? `reuse:${importActions[item.key].existingId}` : "create"}
                  aria-label={window.I18N.t("ui.dashboards.actionFor", "Action for {0}", { 0: item.title })} onChange={event => {
                    const [mode, existingId] = event.target.value.split(":");
                    setImportActions(current => ({ ...current, [item.key]: mode === "reuse" ? { mode, existingId } : { mode: "create" } }));
                  }} style={{ height: 32, border: "1px solid var(--border)", borderRadius: 6, padding: "0 8px", background: "var(--bg)", color: "var(--fg)", font: "inherit", fontSize: 12 }}>
                  <option value="create">{dsh("dashboards.createCopy", "Create new copy")}</option>
                  {item.existingOptions.map(option => <option key={option.id} value={`reuse:${option.id}`}>{window.I18N.t("ui.dashboards.reuse", "Reuse:")} {option.title}</option>)}
                </select>}
                <input value={importNames[item.key] || ""} maxLength="200" disabled={importActions[item.key]?.mode === "reuse"} aria-label={window.I18N.t("ui.dashboards.importName", "Import name for {0}", { 0: item.title })}
                  onChange={event => setImportNames(current => ({ ...current, [item.key]: event.target.value }))}
                  style={{ height: 32, border: "1px solid var(--border)", borderRadius: 6, padding: "0 9px", background: "var(--bg)", color: "var(--fg)", font: "inherit", fontSize: 12, opacity: importActions[item.key]?.mode === "reuse" ? .55 : 1 }} />
              </label>)}
            </div>
          </fieldset>}
          {importPreview.requirements.length > 0 && <fieldset style={{ margin: "10px 0 0", padding: 10, border: "1px solid var(--border)", borderRadius: 7 }}><legend style={{ padding: "0 5px", fontSize: 11.5, fontWeight: 650 }}>{dsh("dashboards.requiredConnections", "Required connections")}</legend><div style={{ display: "grid", gap: 7 }}>{importPreview.requirements.map(item => <label key={item.key} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) minmax(180px, 1fr)", alignItems: "center", gap: 8, fontSize: 11.5 }}><span>{item.connectorTypeId} / {item.blockId}</span><select value={importMappings[item.key] || ""} aria-label={window.I18N.t("ui.dashboards.connectionFor", "Connection for {0} {1}", { 0: item.connectorTypeId, 1: item.blockId })} onChange={event => setImportMappings(current => ({ ...current, [item.key]: event.target.value }))} style={{ height: 32, border: "1px solid var(--border)", borderRadius: 6, padding: "0 8px", background: "var(--bg)", color: "var(--fg)", font: "inherit", fontSize: 12 }}><option value="">{dsh("dashboards.selectConnection", "Select a connection")}</option>{item.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>)}</div></fieldset>}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 9, marginTop: 12 }}>
            <span aria-live="polite" style={{ flex: 1, minWidth: 200, color: "var(--muted-fg)", fontSize: 11.5 }}>{!namesValid ? window.I18N.t("ui.dashboards.namesRequired", "Enter names for the new resources.") : !mappingsValid ? window.I18N.t("ui.dashboards.connectionsRequired", "Select all required connections.") : window.I18N.t("ui.dashboards.ready", "Ready to create or reuse based on your selection.")}</span>
            <button type="button" disabled={!namesValid || !mappingsValid || applyingImport} onClick={applyImport} style={{ ...dashboardButton, border: 0, background: "var(--accent)", color: "#fff", opacity: !namesValid || !mappingsValid ? .55 : 1 }}>{applyingImport ? window.I18N.t("connectors.import.importing", "Importing…") : window.I18N.t("ui.dashboards.applyImport", "Apply import")}</button>
          </div>
        </>}
      </section>}
      {dashboards.length === 0 ? (
        <div style={{ minHeight: 240, border: "1px dashed var(--border)", borderRadius: 10, display: "grid", placeItems: "center", textAlign: "center", color: "var(--muted-fg)", padding: 20 }}>
          <div><strong style={{ display: "block", color: "var(--fg)", marginBottom: 5 }}>{dsh("dashboards.empty", "No dashboards")}</strong>{dsh("dashboards.emptyBody", "Create one to organize several Boards as tabs.")}</div>
        </div>
      ) : <>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "nowrap", overflowX: "auto" }}>
          <div style={{ position: "relative", flex: "0 0 220px" }}>
            <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)", fontSize: 13 }}>⌕</span>
            <input placeholder={dsh("dashboards.search", "Search dashboard…")} value={q} onChange={e => setQ(e.target.value)}
              style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "white", outline: "none" }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"} />
          </div>
          <FilterChip label={dsh("dashboards.status", "Status")} value={estadoFilter}
            options={[["all", dsh("dashboards.all", "All")], ["active", dsh("dashboards.active", "Active")], ["inactive", dsh("dashboards.inactive", "Inactive")]]}
            onChange={setEstadoFilter} />
          {tagOptions.length > 0 && (
            <FilterChip label={dsh("tags.title", "Tags")} value={tagFilter} options={[["all", dsh("dashboards.all", "All")], ...tagOptions]} onChange={setTagFilter} />
          )}
          <div style={{ marginLeft: "auto", flexShrink: 0, fontSize: 12, color: "var(--muted-fg)", whiteSpace: "nowrap" }}>
            <b style={{ color: "var(--fg)" }}>{rows.length}</b> / {dashboards.length}
          </div>
        </div>


        <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", overflow: "hidden" }}>
          <table className="dashboards-catalog-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--muted)", color: "var(--muted-fg)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase" }}>
                <th className="dashboards-catalog-icon" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}></th>
                <th className="dashboards-catalog-title" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{dsh("dashboards.title", "Dashboards")}</th>
                <th className="dashboards-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{dsh("dashboards.boardsCol", "Boards")}</th>
                <th className="dashboards-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{dsh("dashboards.status", "Status")}</th>
                <th className="dashboards-catalog-actions" style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>{dsh("dashboards.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ padding: "28px 14px", textAlign: "center", color: "var(--muted-fg)", fontSize: 12.5 }}>
                  {dsh("dashboards.noResults", "No results — adjust the search.")}
                </td></tr>
              )}
              {pagination.pageItems.map((dashboard, i) => (
                <tr key={dashboard.id}
                  style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent", cursor: dashboard.active ? "pointer" : "default", opacity: dashboard.active ? 1 : 0.65 }}
                  onClick={() => dashboard.active && onNavigate(`dashboard:${dashboard.id}`)}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent"}>
                  <td className="dashboards-catalog-icon" style={{ padding: "8px 12px" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{window.ICONS?.grid}</div>
                  </td>
                  <td className="dashboards-catalog-title" style={{ padding: "8px 12px", fontWeight: 500 }}>{dashboard.title}{dashboard.showInSidebar === false ? " · fuera del sidebar" : ""}</td>
                  <td className="dashboards-catalog-secondary" style={{ padding: "8px 12px", color: "var(--muted-fg)" }}>{dashboard.boardIds.length}</td>
                  <td className="dashboards-catalog-secondary" style={{ padding: "8px 12px" }}>
                    <DashboardStatusPill ok={dashboard.active} label={dashboard.active ? dsh("dashboards.active", "Active") : dsh("dashboards.inactive", "Inactive")} />
                  </td>
                  <td className="dashboards-catalog-actions" style={{ padding: "8px 12px", textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end", whiteSpace: "nowrap" }}>
                    <DashboardActionButton label={`Exportar ${dashboard.title}`} disabled={exportingId === dashboard.id}
                      onClick={async () => {
                        setExportingId(dashboard.id);
                        try { await exportDashboardPackage(dashboard); }
                        catch (error) { window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.exportFailed", "Could not export: {0}", { 0: error.message }), kind: "error" } })); }
                        finally { setExportingId(null); }
                      }}
                      icon={<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></svg>} />
                    <DashboardActionButton label={window.I18N.t("ui.editNamed", "Edit {0}", { 0: dashboard.title })} icon={window.ICONS?.edit}
                      onClick={() => { setEditing(dashboard); setCreating(false); }} />
                    {dashboard.active && (
                      <DashboardActionButton label={`Ver ${dashboard.title}`} icon={window.ICONS?.view}
                        onClick={() => onNavigate(`dashboard:${dashboard.id}`)} />
                    )}
                    <DashboardActionButton label={window.I18N.t("ui.deleteNamed", "Delete {0}", { 0: dashboard.title })} icon={window.ICONS?.trash} danger
                      onClick={() => setConfirmDashboard(dashboard)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <window.PaginationBar {...pagination} />}
      </>}

      {confirmDashboard && (
        <window.ConfirmModal
          title={window.I18N.t("ui.confirm.deleteTitle", "Confirm deletion")}
          message={window.I18N.t("ui.dashboards.confirmDelete", "Delete Dashboard “{0}”? Its Boards and Blocks will not be deleted.", { 0: confirmDashboard.title })}
          onConfirm={() => remove(confirmDashboard)}
          onClose={() => setConfirmDashboard(null)} />
      )}
    </section>
  );
}

function DashboardWorkspaceView({ dashboard, boards, blockCatalog, onNavigate }) {
  const tabsRef = useRef([]);
  const closePresentationRef = useRef(null);
  const suppressTabClickRef = useRef(false);
  const [presenting, setPresenting] = useState(false);
  const [showPresentationBlockHeaders, setShowPresentationBlockHeaders] = useState(true);
  const [draggedBoardId, setDraggedBoardId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const resolved = dashboard.boardIds.map(id => ({ id, board: boards.find(item => item.id === id) || null }));
  const selectedId = dashboard.selectedBoardId && dashboard.boardIds.includes(dashboard.selectedBoardId)
    ? dashboard.selectedBoardId : dashboard.boardIds[0] || null;
  const selected = resolved.find(item => item.id === selectedId);
  const selectedIndex = Math.max(0, resolved.findIndex(item => item.id === selectedId));

  const select = async id => {
    if (id === selectedId) return;
    try {
      await window.HQ_API.request(`/api/dashboards/${dashboard.id}`, { method: "PUT", body: { selectedBoardId: id } });
      window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
    } catch (error) {
      // A Dashboard can be removed from another tab or through the API. Do not
      // leave a stale workspace whose tabs silently stop responding.
      window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
      if (String(error.message || "").includes("404")) onNavigate("dashboards");
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.saveTabFailed", "Could not save the tab: {0}", { 0: error.message }), kind: "error" } }));
    }
  };
  const persistOrder = async (sourceId, targetId) => {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = dashboard.boardIds.indexOf(sourceId);
    const targetIndex = dashboard.boardIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const boardIds = dashboard.boardIds.slice();
    const [moved] = boardIds.splice(sourceIndex, 1);
    boardIds.splice(targetIndex, 0, moved);
    try {
      await window.HQ_API.request(`/api/dashboards/${dashboard.id}`, { method: "PUT", body: { boardIds } });
      window.dispatchEvent(new CustomEvent("hq:dashboards-changed"));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.orderSaved", "Tab order saved"), kind: "ok" } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.saveOrderFailed", "Could not save the order: {0}", { 0: error.message }), kind: "error" } }));
    }
  };
  const startTabDrag = (event, sourceId) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    let moved = false;
    const onMove = moveEvent => {
      if (!moved && Math.abs(moveEvent.clientX - startX) < 6) return;
      moved = true;
      moveEvent.preventDefault();
      setDraggedBoardId(sourceId);
    };
    const onEnd = endEvent => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      setDraggedBoardId(null);
      if (!moved) return;
      suppressTabClickRef.current = true;
      setTimeout(() => { suppressTabClickRef.current = false; }, 0);
      const centers = tabsRef.current.map(element => {
        const rect = element?.getBoundingClientRect();
        return rect ? rect.left + rect.width / 2 : Number.POSITIVE_INFINITY;
      });
      let targetIndex = 0;
      centers.forEach((center, index) => {
        if (Math.abs(center - endEvent.clientX) < Math.abs(centers[targetIndex] - endEvent.clientX)) targetIndex = index;
      });
      persistOrder(sourceId, resolved[targetIndex]?.id);
    };
    const onCancel = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      setDraggedBoardId(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onCancel);
  };
  const onTabKeyDown = (event, index) => {
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const target = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (target < 0 || target >= resolved.length) return;
      event.preventDefault();
      persistOrder(resolved[index].id, resolved[target].id);
      return;
    }
    let target = null;
    if (event.key === "ArrowRight") target = (index + 1) % resolved.length;
    if (event.key === "ArrowLeft") target = (index - 1 + resolved.length) % resolved.length;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = resolved.length - 1;
    if (target === null) return;
    event.preventDefault();
    tabsRef.current[target]?.focus();
    select(resolved[target].id);
  };
  const advancePresentation = delta => {
    const target = selectedIndex + delta;
    if (target < 0 || target >= resolved.length) return;
    select(resolved[target].id);
  };
  useEffect(() => {
    if (!presenting) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closePresentationRef.current?.focus();
    const onKeyDown = event => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
      if (event.key === "Escape") { event.preventDefault(); setPresenting(false); }
      if (event.key === "ArrowRight") { event.preventDefault(); advancePresentation(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); advancePresentation(-1); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [presenting, selectedIndex, resolved.length]);

  const boardSurface = presentationMode => !selected ? (
    <div style={{ margin: 20, minHeight: 260, border: "1px dashed var(--border)", borderRadius: 10, display: "grid", placeItems: "center", textAlign: "center", padding: 20 }}><div><strong>{dsh("dashboards.emptyTitle", "Empty dashboard")}</strong><p style={{ color: "var(--muted-fg)", fontSize: 12 }}>{dsh("dashboards.emptyAction", "Add Boards from Manage.")}</p></div></div>
  ) : !selected.board || selected.board.active === false ? (
    <div style={{ margin: 20, minHeight: 260, border: "1px dashed var(--border)", borderRadius: 10, display: "grid", placeItems: "center", textAlign: "center", padding: 20 }}><div><strong>{dsh("dashboards.unavailable", "Board unavailable")}</strong><p style={{ color: "var(--muted-fg)", fontSize: 12 }}>{dsh("dashboards.unavailableBody", "The reference is preserved so it can be restored or linked during an import.")}</p></div></div>
  ) : (
    <window.CustomPageView key={`${selected.board.id}:${presentationMode ? "presentation" : "workspace"}`}
      page={selected.board} blockCatalog={blockCatalog} presentation={presentationMode} embedded={!presentationMode}
      showBlockHeaders={!presentationMode || showPresentationBlockHeaders}
      onEdit={page => { window.__moduleBuilderIntent = { board: page, returnRoute: `dashboard:${dashboard.id}` }; onNavigate("module-builder"); }} />
  );
  return (
    <section aria-labelledby={`dashboard-title-${dashboard.id}`} style={{ width: "100%", minWidth: 0 }}>
      <header style={{ padding: "16px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <h1 id={`dashboard-title-${dashboard.id}`} style={{ flex: 1, margin: 0, fontSize: 22 }}>{dashboard.title}</h1>
          <button type="button" onClick={() => onNavigate("dashboards")} style={dashboardButton}>{dsh("dashboards.manage", "Manage")}</button>
          <button type="button" aria-label={`Exportar Dashboard ${dashboard.title}`} title={window.I18N.t("ui.dashboards.export", "Export Dashboard")} disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try { await exportDashboardPackage(dashboard); }
              catch (error) { window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.dashboards.exportFailed", "Could not export: {0}", { 0: error.message }), kind: "error" } })); }
              finally { setExporting(false); }
            }}
            style={{ ...dashboardButton, width: 34, padding: 0, display: "inline-grid", placeItems: "center" }}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></svg>
          </button>
          <button type="button" title={dsh("boards.edit", "Edit Board")}
            aria-label={selected?.board
              ? dsh("boards.editNamed", "Edit Board {title}", { title: selected.board.title })
              : dsh("boards.edit", "Edit Board")}
            disabled={!selected?.board || selected.board.active === false}
            onClick={() => { if (selected?.board) { window.__moduleBuilderIntent = { board: selected.board, returnRoute: `dashboard:${dashboard.id}` }; onNavigate("module-builder"); } }}
            style={{ ...dashboardButton, width: 34, padding: 0, display: "inline-grid", placeItems: "center" }}>{window.ICONS?.edit}</button>
          <button type="button" aria-label={`Presentar ${dashboard.title}`} title={window.I18N.t("ui.dashboards.present", "Present Dashboard")} disabled={resolved.length === 0}
            onClick={() => { setShowPresentationBlockHeaders(true); setPresenting(true); }} style={{ ...dashboardButton, width: 34, padding: 0, display: "inline-grid", placeItems: "center" }}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
        </div>
        <div role="tablist" aria-label={`Boards de ${dashboard.title}`} className="dashboard-tabs" style={{ display: "flex", gap: 4, overflowX: "auto", scrollbarWidth: "thin", borderBottom: "1px solid var(--border)" }}>
          {resolved.map((item, index) => {
            const current = item.id === selectedId;
            const label = item.board?.title || window.I18N.t("dashboards.unavailable", "Board unavailable");
            return <button key={item.id} ref={element => { tabsRef.current[index] = element; }} type="button" role="tab" aria-selected={current}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" onPointerDown={event => startTabDrag(event, item.id)}
              aria-controls={`dashboard-panel-${dashboard.id}`} tabIndex={current ? 0 : -1}
              onClick={event => { if (suppressTabClickRef.current) event.preventDefault(); else select(item.id); }} onKeyDown={event => onTabKeyDown(event, index)}
              title={window.I18N.t("ui.dashboards.reorder", "{0} · drag to reorder", { 0: item.board ? label : window.I18N.t("ui.dashboards.unavailable", "{0} is unavailable", { 0: item.id }) })}
              style={{ flex: "0 0 auto", minHeight: 38, padding: "0 14px", border: 0, borderBottom: current ? "2px solid var(--accent)" : "2px solid transparent", background: draggedBoardId === item.id ? "var(--brand-glass-active)" : "transparent", opacity: draggedBoardId === item.id ? 0.65 : 1, color: current ? "var(--accent)" : "var(--muted-fg)", font: "inherit", fontSize: 12, fontWeight: current ? 650 : 500, cursor: draggedBoardId === item.id ? "grabbing" : "pointer", touchAction: "pan-y" }}>{label}</button>;
          })}
        </div>
      </header>
      <div id={`dashboard-panel-${dashboard.id}`} role="tabpanel" style={{ minWidth: 0 }}>
        {boardSurface(false)}
      </div>
      {presenting && <section role="dialog" aria-modal="true" aria-label={window.I18N.t("ui.dashboards.presentation", "Presentation of {0}", { 0: dashboard.title })} style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--bg)", color: "var(--fg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ minHeight: "var(--header-h)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <div style={{ flex: 1, minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected?.board?.title || window.I18N.t("dashboards.unavailable", "Board unavailable")}</strong><span aria-live="polite" style={{ color: "var(--muted-fg)", fontSize: 11 }}>{resolved.length ? `${selectedIndex + 1} de ${resolved.length} · ${dashboard.title}` : dashboard.title}</span></div>
          <button type="button" aria-pressed={!showPresentationBlockHeaders}
            aria-label={showPresentationBlockHeaders ? dsh("dashboards.hideBlockHeaders", "Ocultar títulos de bloques") : dsh("dashboards.showBlockHeaders", "Mostrar títulos de bloques")}
            title={showPresentationBlockHeaders ? dsh("dashboards.hideBlockHeaders", "Ocultar títulos de bloques") : dsh("dashboards.showBlockHeaders", "Mostrar títulos de bloques")}
            onClick={() => setShowPresentationBlockHeaders(current => !current)}
            style={{ ...dashboardButton, width: 36, padding: 0, display: "inline-grid", placeItems: "center", color: !showPresentationBlockHeaders ? "var(--accent)" : "var(--fg)" }}>
            {showPresentationBlockHeaders ? (
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            ) : (
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 18 18"/><path d="M10.6 5.2A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a16.5 16.5 0 0 1-2 3"/><path d="M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10.5 10.5 0 0 0 4.1-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
            )}
          </button>
          <button type="button" aria-label={window.I18N.t("ui.dashboards.previous", "Previous Board")} title={window.I18N.t("ui.dashboards.previousKey", "Previous · Left arrow")} disabled={selectedIndex <= 0} onClick={() => advancePresentation(-1)} style={{ ...dashboardButton, width: 36, padding: 0 }}>←</button>
          <button type="button" aria-label={window.I18N.t("ui.dashboards.next", "Next Board")} title={window.I18N.t("ui.dashboards.nextKey", "Next · Right arrow")} disabled={selectedIndex >= resolved.length - 1} onClick={() => advancePresentation(1)} style={{ ...dashboardButton, width: 36, padding: 0 }}>→</button>
          <button ref={closePresentationRef} type="button" aria-label={window.I18N.t("ui.dashboards.exit", "Exit presentation")} title={window.I18N.t("ui.dashboards.exitKey", "Exit · Escape")} onClick={() => setPresenting(false)} style={{ ...dashboardButton, width: 36, padding: 0, fontSize: 18 }}>×</button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{boardSurface(true)}</div>
      </section>}
    </section>
  );
}

window.DashboardCatalogView = DashboardCatalogView;
window.DashboardWorkspaceView = DashboardWorkspaceView;


