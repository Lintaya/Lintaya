const { randomUUID } = require("node:crypto");
const { normalizeAssignedTags, applyAssignedTags } = require("./tags");

const DASHBOARD_SCHEMA_VERSION = 1;

function normalizeBoardIds(value) {
  if (!Array.isArray(value)) return null;
  const boardIds = value.map(id => typeof id === "string" ? id.trim() : "");
  if (boardIds.some(id => !id) || new Set(boardIds).size !== boardIds.length) return null;
  return boardIds;
}

function normalizeSelection(value, boardIds) {
  if (value === undefined) return boardIds[0] || null;
  if (value === null) return null;
  if (typeof value !== "string" || !boardIds.includes(value)) return undefined;
  return value;
}

// Extraída para que la ruta REST y el ejecutor de tools del Asistente
// (server/core/assistant-tools.js) creen un Dashboard exactamente igual.
function createDashboardRecord({ kvGet, kvSet }, { title, icon, active, showInSidebar, boardIds: rawBoardIds, selectedBoardId: rawSelected, tags }) {
  const boardIds = normalizeBoardIds(rawBoardIds ?? []);
  if (!title || !String(title).trim() || !boardIds) {
    throw new Error("title-and-valid-board-ids-required");
  }
  const selectedBoardId = normalizeSelection(rawSelected, boardIds);
  if (selectedBoardId === undefined) {
    throw new Error("selected-board-must-belong-to-dashboard");
  }
  // Etiquetar es opcional; solo se rechaza lo que no es una lista de ids.
  const assigned = normalizeAssignedTags(tags);
  if (assigned === null) throw new Error("invalid-tags");
  const dashboards = kvGet("dashboards")?.value || [];
  const now = new Date().toISOString();
  const dashboard = applyAssignedTags({
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    id: `dashboard-${randomUUID()}`,
    title: String(title).trim(),
    icon: icon ? String(icon) : "grid",
    active: active !== false,
    showInSidebar: showInSidebar !== false,
    boardIds,
    selectedBoardId,
    createdAt: now,
    updatedAt: now,
  }, assigned);
  kvSet("dashboards", [...dashboards, dashboard]);
  return dashboard;
}

// A Dashboard is deliberately only an ordered collection of Board references.
// Board trees and Block definitions remain owned by their existing KV records.
// References are not checked against module-pages here: unresolved ids must
// survive deletion, temporary deactivation and future import/relink workflows.
function registerDashboardsRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError }) {
  app.get("/api/dashboards", requireAuth, (req, res) => {
    res.json(kvGet("dashboards")?.value || []);
  });

  app.post("/api/dashboards", requireAuth, auditActivity({ provider: "dashboards", action: "Crear Dashboard" }), (req, res) => {
    let dashboard;
    try {
      dashboard = createDashboardRecord({ kvGet, kvSet }, req.body || {});
    } catch (err) {
      return sendAppError(res, AppError.badRequest(err.message), req);
    }
    res.locals.auditMessage = `Crear Dashboard "${dashboard.title}"`;
    res.json(dashboard);
  });

  app.put("/api/dashboards/:id", requireAuth, auditActivity({ provider: "dashboards", action: "Editar Dashboard" }), (req, res) => {
    const dashboards = kvGet("dashboards")?.value || [];
    const existing = dashboards.find(dashboard => dashboard.id === req.params.id);
    if (!existing) return sendAppError(res, AppError.notFound("not-found"), req);

    const boardIds = req.body?.boardIds === undefined
      ? existing.boardIds
      : normalizeBoardIds(req.body.boardIds);
    if (!boardIds) return sendAppError(res, AppError.badRequest("valid-board-ids-required"), req);

    let selectedBoardId;
    if (req.body?.selectedBoardId !== undefined) {
      selectedBoardId = normalizeSelection(req.body.selectedBoardId, boardIds);
    } else if (boardIds.includes(existing.selectedBoardId)) {
      selectedBoardId = existing.selectedBoardId;
    } else {
      selectedBoardId = boardIds[0] || null;
    }
    if (selectedBoardId === undefined) {
      return sendAppError(res, AppError.badRequest("selected-board-must-belong-to-dashboard"), req);
    }

    const { title, icon, active, showInSidebar, tags } = req.body || {};
    if (title !== undefined && !String(title).trim()) {
      return sendAppError(res, AppError.badRequest("title-required"), req);
    }
    const assigned = normalizeAssignedTags(tags);
    if (assigned === null) return sendAppError(res, AppError.badRequest("invalid-tags"), req);
    const updated = applyAssignedTags({
      ...existing,
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(icon !== undefined ? { icon: String(icon) } : {}),
      ...(active !== undefined ? { active: active !== false } : {}),
      ...(showInSidebar !== undefined ? { showInSidebar: showInSidebar !== false } : {}),
      boardIds,
      selectedBoardId,
      updatedAt: new Date().toISOString(),
    }, assigned);
    kvSet("dashboards", dashboards.map(dashboard => dashboard.id === req.params.id ? updated : dashboard));
    res.locals.auditMessage = `Editar Dashboard "${updated.title}"`;
    res.json(updated);
  });

  app.delete("/api/dashboards/:id", requireAuth, auditActivity({ provider: "dashboards", action: "Borrar Dashboard" }), (req, res) => {
    const dashboards = kvGet("dashboards")?.value || [];
    const removed = dashboards.find(dashboard => dashboard.id === req.params.id);
    if (!removed) return sendAppError(res, AppError.notFound("not-found"), req);
    kvSet("dashboards", dashboards.filter(dashboard => dashboard.id !== req.params.id));
    res.locals.auditMessage = `Borrar Dashboard "${removed.title}"`;
    res.json({ ok: true });
  });
}

module.exports = { DASHBOARD_SCHEMA_VERSION, registerDashboardsRoutes, createDashboardRecord };
