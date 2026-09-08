// Module Builder pages — user-composed custom dashboard pages: a title/icon,
// an active flag (gates routability), an optional showInSidebar flag, and a zone tree
// (see app/zone-tree.js) whose leaves hold ordered stacks of block ids (the
// same ids used by /api/home/blocks and /api/home/custom-blocks). Deliberately
// a separate KV array from home-layout/custom-blocks: those only ever describe
// the single fixed Home page, while a module page is itself a new navigable
// route, resolved client-side as `page:<id>`.
const { randomUUID } = require("node:crypto");
const { normalizeAssignedTags, applyAssignedTags } = require("./tags");

// Extraída para que la ruta REST y el ejecutor de tools del Asistente
// (server/core/assistant-tools.js) creen un Board exactamente igual — una
// sola fuente de verdad para el shape/validación, no dos copias.
function createBoardRecord({ kvGet, kvSet }, { title, icon, active, showInSidebar, tree, tags }) {
  if (!title || !tree || typeof tree !== "object") {
    throw new Error("title-and-tree-required");
  }
  // Etiquetar es opcional: un Board sin etiquetas es el caso normal, así que
  // solo se rechaza lo que no es una lista de ids.
  const assigned = normalizeAssignedTags(tags);
  if (assigned === null) throw new Error("invalid-tags");
  const pages = kvGet("module-pages")?.value || [];
  const now = new Date().toISOString();
  const page = applyAssignedTags({
    id: `page-${randomUUID()}`,
    title: String(title),
    icon: icon ? String(icon) : "grid",
    active: active !== false,
    showInSidebar: showInSidebar !== false,
    tree,
    createdAt: now,
    updatedAt: now,
  }, assigned);
  kvSet("module-pages", [...pages, page]);
  return page;
}

function registerModulePagesRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError }) {
  app.get("/api/module-pages", requireAuth, (req, res) => {
    res.json(kvGet("module-pages")?.value || []);
  });

  app.post("/api/module-pages", requireAuth, auditActivity({ provider: "module-pages", action: "Crear página" }), (req, res) => {
    let page;
    try {
      page = createBoardRecord({ kvGet, kvSet }, req.body || {});
    } catch (err) {
      return sendAppError(res, AppError.badRequest(err.message), req);
    }
    res.locals.auditMessage = `Crear página "${page.title}"`;
    res.json(page);
  });

  app.put("/api/module-pages/:id", requireAuth, auditActivity({ provider: "module-pages", action: "Editar página" }), (req, res) => {
    const pages = kvGet("module-pages")?.value || [];
    const existing = pages.find(p => p.id === req.params.id);
    if (!existing) return sendAppError(res, AppError.notFound("not-found"), req);
    const { title, icon, active, showInSidebar, tree, tags } = req.body || {};
    const assigned = normalizeAssignedTags(tags);
    if (assigned === null) return sendAppError(res, AppError.badRequest("invalid-tags"), req);
    const updated = applyAssignedTags({
      ...existing,
      ...(title !== undefined ? { title: String(title) } : {}),
      ...(icon !== undefined ? { icon: String(icon) } : {}),
      ...(active !== undefined ? { active: active !== false } : {}),
      ...(showInSidebar !== undefined ? { showInSidebar: showInSidebar !== false } : {}),
      ...(tree !== undefined ? { tree } : {}),
      updatedAt: new Date().toISOString(),
    }, assigned);
    kvSet("module-pages", pages.map(p => p.id === req.params.id ? updated : p));
    res.locals.auditMessage = `Editar página "${updated.title}"`;
    res.json(updated);
  });

  app.delete("/api/module-pages/:id", requireAuth, auditActivity({ provider: "module-pages", action: "Borrar página" }), (req, res) => {
    const pages = kvGet("module-pages")?.value || [];
    const removed = pages.find(p => p.id === req.params.id);
    if (!removed) return sendAppError(res, AppError.notFound("not-found"), req);
    kvSet("module-pages", pages.filter(p => p.id !== req.params.id));
    res.locals.auditMessage = `Borrar página "${removed.title}"`;
    res.json({ ok: true });
  });
}

module.exports = { registerModulePagesRoutes, createBoardRecord };
