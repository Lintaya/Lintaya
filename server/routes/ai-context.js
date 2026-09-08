// AI Context routes - public endpoint for agents to discover capabilities
const { generateAIContext } = require("../core/ai-context");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function registerAIContextRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, connectors = [] }) {
  // Public endpoint - no auth required
  app.get("/api/ai-context", (req, res) => {
    try {
      const context = generateAIContext({ connectors });
      res.json(context);
    } catch (error) {
      sendAppError(res, AppError.internal("Unable to generate AI context", { cause: error }), req);
    }
  });

  // Get stored context (for editing in UI)
  app.get("/api/ai-context/stored", requireAuth, (req, res) => {
    try {
      const stored = kvGet("ai-context")?.value || {};
      if (!isPlainObject(stored)) {
        return sendAppError(res, AppError.internal("Stored AI context is invalid"), req);
      }
      return res.json(stored);
    } catch (error) {
      return sendAppError(res, AppError.internal("Unable to load stored AI context", { cause: error }), req);
    }
  });

  // Update stored context (for editing in UI)
  app.put("/api/ai-context", requireAuth, auditActivity({ provider: "settings", action: "Actualizar AI context" }), (req, res) => {
    if (!isPlainObject(req.body)) {
      return sendAppError(res, AppError.badRequest("AI context must be a JSON object."), req);
    }
    try {
      const current = kvGet("ai-context")?.value || {};
      if (!isPlainObject(current)) {
        return sendAppError(res, AppError.internal("Stored AI context is invalid"), req);
      }
      const updated = { ...current, ...req.body };
      kvSet("ai-context", updated);
      res.locals.auditMessage = `Actualizar AI context — ${Object.keys(req.body).length} campos`;
      return res.json({ ok: true, context: updated });
    } catch (error) {
      return sendAppError(res, AppError.internal("Unable to save AI context", { cause: error }), req);
    }
  });
}

module.exports = { registerAIContextRoutes };
