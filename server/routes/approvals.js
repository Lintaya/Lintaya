// SEC-003 REST adapter.  Human resolution happens here, but the executor
// remains the only place that may consume an approved destructive action.
const { AppError } = require("../core/errors");

function humanApprover(req) {
  // Agents identify themselves with X-Actor. They may request work, but this
  // local-first initial version intentionally refuses agent-labelled requests
  // at the resolution endpoints. A future Team/RBAC identity replaces the
  // stable local-human principal; it must preserve this separation.
  if (req.get("X-Actor")) throw AppError.forbidden("approval-requires-human");
  return "human:local";
}

// Assistant write-tool proposals (create_board, create_content_block,
// add_connector_block, create_dashboard — server/core/assistant-tools.js)
// share this same ledger instead of a separate one, so "things awaiting my
// confirmation" has one place — but they are not connector actions and
// aren't destructive, so they're never routed through executeAction/the
// Action Registry. connectorTypeId "assistant" is the tag that tells this
// route which path to take; approve() below is the only place that branches
// on it.
const ASSISTANT_CONNECTOR_TYPE_ID = "assistant";

function registerApprovalRoutes({ app, requireAuth, approvalStore, executeAction, runWriteTool, kvGet, kvSet, sendAppError }) {
  for (const [name, dep] of Object.entries({ app, requireAuth, approvalStore, executeAction, sendAppError })) {
    if (!dep) throw new TypeError(`registerApprovalRoutes requires ${name}`);
  }

  app.get("/api/approvals", requireAuth, (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      res.json(approvalStore.list(status));
    } catch (err) { sendAppError(res, err, req); }
  });

  app.get("/api/approvals/:approvalId", requireAuth, (req, res) => {
    try {
      const approval = approvalStore.get(req.params.approvalId);
      if (!approval) throw AppError.notFound("approval-not-found");
      res.json({ ...approval, events: approvalStore.events(approval.id) });
    } catch (err) { sendAppError(res, err, req); }
  });

  app.post("/api/approvals/:approvalId/reject", requireAuth, (req, res) => {
    try {
      const { approval } = approvalStore.resolve(req.params.approvalId, "reject", humanApprover(req));
      res.json({ ok: true, approval });
    } catch (err) { sendAppError(res, err, req); }
  });

  app.post("/api/approvals/:approvalId/approve", requireAuth, async (req, res) => {
    try {
      const { row } = approvalStore.resolve(req.params.approvalId, "approve", humanApprover(req));

      if (row.connector_type_id === ASSISTANT_CONNECTOR_TYPE_ID) {
        if (!runWriteTool) throw AppError.unavailable("assistant-tools-unavailable");
        const input = JSON.parse(row.input_json);
        // consume() is what moves the row from "approved" to "executing" —
        // finish() below is a no-op against any other status (see
        // approval-store.js), same two-step the connector/executeAction path
        // uses just below.
        approvalStore.consume(row.id, {
          connectionId: row.connection_id, connectorTypeId: row.connector_type_id,
          actionId: row.action_id, input,
        });
        try {
          const created = runWriteTool(row.action_id, input, { kvGet, kvSet });
          approvalStore.finish(row.id, true);
          return res.json({ ok: true, approval: approvalStore.get(row.id), result: { ok: true, result: created } });
        } catch (err) {
          approvalStore.finish(row.id, false, err.message);
          throw AppError.badRequest(err.message);
        }
      }

      const requester = row.requester.startsWith("agent:") ? row.requester.slice("agent:".length) : undefined;
      const result = await executeAction({
        connectionId: row.connection_id,
        actionId: row.action_id,
        input: JSON.parse(row.input_json),
        actor: requester,
        requestId: req.id,
        approvalId: row.id,
      });
      res.status(result.ok ? 200 : 202).json({ ok: result.ok, approval: approvalStore.get(row.id), result });
    } catch (err) { sendAppError(res, err, req); }
  });
}

module.exports = { registerApprovalRoutes, ASSISTANT_CONNECTOR_TYPE_ID };
