// Home dashboard: which widgets are shown, in which column/order, plus
// free-text note widgets. Layout used to live in localStorage only (per
// browser); now persisted server-side so it follows the account instead.
const { listConnectorBlocks } = require("../connectors/registry");

const HOME_LAYOUT_DEFAULT = { left: ["qportal", "alerts", "gitlab.recent-commits"], right: ["plane", "outline.recent-docs"] };

function registerHomeRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, getConnectorInstances, stmtConnGet }) {
  app.get("/api/home/layout", requireAuth, (req, res) => {
    res.json(kvGet("home-layout")?.value || HOME_LAYOUT_DEFAULT);
  });

  // Catalog of Home blocks contributed by connectors (declared in each
  // manifest.json). Only blocks whose connector is both configured and
  // enabled are offered — an unconfigured connector has no data to show, and
  // a disabled one was turned off on purpose (see POST
  // /api/connectors/:id/enabled in routes/connectors.js), so its block
  // shouldn't keep showing (possibly stale) data on the dashboard either.
  //
  // listConnectorBlocks() only ever returns one template per connector
  // *type* (it walks the manifest registry, not actual instances) — for an
  // instantiable type (gitlab, outlook-local, …) that under-counts real
  // blocks: each extra instance (a second GitLab connection, a second
  // Outlook-local account) already serves its own live data at
  // /api/connectors/<instanceId>/blocks/<blockId> (see loader.js's
  // registerConnectorInstance, which re-registers every route — including
  // the block route — under the new instance's own id), so it deserves its
  // own catalog entry too. Same instance-expansion routes/connectors.js's
  // listConnectorModules() already does for nav modules — this mirrors it
  // for blocks so a second account isn't invisible on Home.
  app.get("/api/home/blocks", requireAuth, (req, res) => {
    const enabledMap = kvGet("connector-enabled")?.value || {};
    // The user-facing label per connection lives here, not in the connectors
    // row: most types have no row at all, and a row that does exist keeps the
    // manifest name (see routes/connectors.js). Reading only the row showed a
    // second GitHub account as a plain "GitHub".
    const nameMap = kvGet("connector-names")?.value || {};
    const isAvailable = (instanceId) =>
      !!kvGet(`connector-config-${instanceId}`)?.value && enabledMap[instanceId] !== false;

    const blocks = [];
    for (const template of listConnectorBlocks()) {
      const typeId = template.connectorId;
      const instanceIds = [typeId, ...(getConnectorInstances?.(typeId) || [])];
      for (const instanceId of instanceIds) {
        if (!isAvailable(instanceId)) continue;
        const isExtraInstance = instanceId !== typeId;
        const instanceName = nameMap[instanceId] || stmtConnGet?.get(instanceId)?.name || instanceId;
        blocks.push({
          ...template,
          id: isExtraInstance ? `${instanceId}.${template.blockId}` : template.id,
          connectorId: instanceId,
          // The type stays around separately — the frontend's connector icon/
          // color lookup (block-catalog.jsx's BLOCK_CONNECTOR_STYLE) is keyed
          // by type, not by instance id, and a second account has no logo of
          // its own to look up.
          connectorType: typeId,
          connectorName: instanceName,
          title: isExtraInstance ? `${template.title} · ${instanceName}` : template.title,
        });
      }
    }
    res.json(blocks);
  });

  app.post("/api/home/layout", requireAuth, (req, res) => {
    const { left, right } = req.body || {};
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return sendAppError(res, AppError.badRequest("left-and-right-must-be-arrays"), req);
    }
    kvSet("home-layout", { left, right });
    res.json({ ok: true });
  });

  app.get("/api/home/notes", requireAuth, (req, res) => {
    res.json(kvGet("home-notes")?.value || []);
  });

  app.post("/api/home/notes", requireAuth, auditActivity({ provider: "home", action: "Crear nota" }), (req, res) => {
    const { title, body } = req.body || {};
    const notes = kvGet("home-notes")?.value || [];
    const note = { id: `note-${Date.now()}`, title: title || "", body: body || "", createdAt: new Date().toISOString() };
    kvSet("home-notes", [...notes, note]);
    res.locals.auditMessage = `Crear nota "${note.title || "(sin título)"}"`;
    res.json(note);
  });

  app.put("/api/home/notes/:id", requireAuth, auditActivity({ provider: "home", action: "Editar nota" }), (req, res) => {
    const notes = kvGet("home-notes")?.value || [];
    const idx = notes.findIndex(n => n.id === req.params.id);
    if (idx === -1) return sendAppError(res, AppError.notFound("not-found"), req);
    notes[idx] = { ...notes[idx], ...req.body, updatedAt: new Date().toISOString() };
    kvSet("home-notes", notes);
    res.locals.auditMessage = `Editar nota "${notes[idx].title || "(sin título)"}"`;
    res.json(notes[idx]);
  });

  app.delete("/api/home/notes/:id", requireAuth, auditActivity({ provider: "home", action: "Borrar nota" }), (req, res) => {
    const all = kvGet("home-notes")?.value || [];
    const removed = all.find(n => n.id === req.params.id);
    const notes = all.filter(n => n.id !== req.params.id);
    kvSet("home-notes", notes);
    // Drop any reference to this note from the layout too, so removing a note
    // doesn't leave a dangling id pointing at nothing.
    const layout = kvGet("home-layout")?.value || HOME_LAYOUT_DEFAULT;
    kvSet("home-layout", {
      left: layout.left.filter(id => id !== req.params.id),
      right: layout.right.filter(id => id !== req.params.id),
    });
    res.locals.auditMessage = `Borrar nota "${removed?.title || "(sin título)"}"`;
    res.json({ ok: true });
  });
}

module.exports = { registerHomeRoutes, HOME_LAYOUT_DEFAULT };
