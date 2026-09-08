// Canonical action API — AGENT-001 (ADR-011). Thin: every route here just
// extracts request data and calls into server/core/actions/{registry,execute}
// — no business logic, no validation, no auditing lives in this file. This
// is deliberately the *only* place REST wires the registry to Express, so a
// future MCP/CLI adapter (AGENT-002) has exactly one contract to call
// against, not this route's internals.
function registerActionsRoutes({ app, requireAuth, registry, publicActionShape, executeAction, resolveConnectorType, sendAppError }) {
  for (const [name, dep] of Object.entries({ app, requireAuth, registry, publicActionShape, executeAction, resolveConnectorType, sendAppError })) {
    if (!dep) throw new TypeError(`registerActionsRoutes requires ${name}`);
  }

  // GET /api/actions — full catalog, every connector type. Discovery only:
  // no config, no secrets, no connection state — see publicActionShape().
  app.get("/api/actions", requireAuth, (req, res) => {
    res.json(registry.listActions().map(publicActionShape));
  });

  // GET /api/connectors/:connectionId/actions — scoped to whichever
  // ConnectorType this specific connection implements (CORE-003). An unknown
  // connectionId resolves to itself and matches no registered type, so this
  // returns an empty list rather than a 404 — same "unconfigured connector,
  // empty catalog" shape GET /api/home/blocks already uses.
  app.get("/api/connectors/:connectionId/actions", requireAuth, (req, res) => {
    const connectorTypeId = resolveConnectorType(req.params.connectionId);
    res.json(registry.listActionsForType(connectorTypeId).map(publicActionShape));
  });

  // POST /api/connectors/:connectionId/actions/:actionId — the one execution
  // path. `pending: true` (a destructive action awaiting a human decision)
  // is a normal, successful-request outcome — 202 Accepted, not routed
  // through sendAppError — the request was valid and understood, it just has
  // not run yet.
  app.post("/api/connectors/:connectionId/actions/:actionId", requireAuth, async (req, res) => {
    const { connectionId, actionId } = req.params;
    const actor = req.get("X-Actor") || undefined;
    try {
      const result = await executeAction({
        connectionId,
        actionId,
        input: req.body,
        actor,
        requestId: req.id,
      });
      res.status(result.pending ? 202 : 200).json(result);
    } catch (err) {
      sendAppError(res, err, req);
    }
  });
}

module.exports = { registerActionsRoutes };
