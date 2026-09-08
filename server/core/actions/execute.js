// Action execution — AGENT-001 (ADR-011). This is the one place that
// validates input, resolves a Connection → ConnectorType (CORE-003), builds
// a per-connection services object, audits, and calls a registered action's
// handler. A route (server/routes/actions.js) or, later, an MCP/CLI adapter
// is a thin caller of this — none of them re-implement authorization,
// validation, secret handling, or auditing on their own, which is the whole
// point of ADR-011 (one contract, three callers).
const { AppError } = require("../errors");
const { createConnectorStore } = require("../services/connector-store");
const { createConnectorLogger } = require("../services/connector-logger");
const { getDefaultSecretStore } = require("../services/secret-store");
const { redactText } = require("../services/secrets");
const { validateAgainstSchema } = require("./schemas");

function createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType, approvalStore = null }) {
  for (const [name, dep] of Object.entries({ registry, kvGet, kvSet, connectorLog, resolveConnectorType })) {
    if (!dep) throw new TypeError(`createActionExecutor requires ${name}`);
  }

  return async function executeAction({ connectionId, actionId, input, actor, requestId, approvalId = null }) {
    if (!connectionId) throw AppError.badRequest("connection-id-required");
    if (!actionId) throw AppError.badRequest("action-id-required");

    // The type is derived from the connection, never taken from the caller —
    // this is what makes "an action only runs against connections of its own
    // type" true by construction instead of a check someone could forget.
    const connectorTypeId = resolveConnectorType(connectionId);
    const action = registry.getAction(connectorTypeId, actionId);
    if (!action) throw AppError.notFound("action-not-found");

    const inputCheck = validateAgainstSchema(action.inputSchema, input ?? {});
    if (!inputCheck.valid) {
      throw AppError.badRequest("invalid-input", { errors: inputCheck.errors });
    }

    const connection = { id: connectionId, connectorTypeId };
    const auditBase = { actionId: action.id, effect: action.effect, connectorTypeId, requestId, approvalId: null };
    if (actor) auditBase.actor = actor;

    // Destructive work fails closed. With SEC-003 wired, the first call
    // persists a request and returns 202; only the Approval Center can later
    // call us back with the exact approval id. The optional fallback keeps the
    // isolated AGENT-001 unit harness conservative until it injects a store.
    if (action.effect === "destructive") {
      if (!approvalId) {
        const approval = approvalStore?.request({
          connectionId, connectorTypeId, actionId: action.id, actionTitle: action.title,
          input: input ?? {}, requester: actor ? `agent:${actor}` : "human:local", requestId,
        });
        connectorLog(connectionId, "warn", `${connectorTypeId}.${action.id} — pending approval`, {
          ...auditBase, ...(approval ? { approvalId: approval.id } : {}),
        });
        return {
          ok: false, pending: true, error: "pending-approval", approval: approval || null,
          actionId: `${connectorTypeId}.${action.id}`, connectionId, connectorTypeId, requestId,
        };
      }
      if (!approvalStore) throw AppError.unavailable("approval-center-unavailable");
      approvalStore.consume(approvalId, { connectionId, connectorTypeId, actionId: action.id, input: input ?? {} });
      auditBase.approvalId = approvalId;
    }

    // Built fresh on every call, scoped to this specific connectionId — never
    // cached/shared across connections of the same type. A cached services
    // object here would leak one connection's secrets into a sibling
    // connection's action call (e.g. gitlab's config answering for gitlab2).
    const store = createConnectorStore({ id: connectionId, kvGet, kvSet });
    // Opt-out, not opt-in (defaults true — see registry.js): most connectors
    // have a real credential step and routes.js's own /test, /sync guard on
    // `!cfg` first, so this is the safe default. outlook-local is the one
    // pilot so far that has nothing to configure (it drives whichever
    // Outlook profile is already signed in on this machine, falling back to
    // the default mailbox with no accountSmtp set) and its own routes.js
    // never gates on config presence either — declaring
    // `requiresConfig: false` mirrors that instead of a blanket check
    // breaking a freshly-created instance that never called /config.
    if (action.requiresConfig !== false && !store.getConfig()) {
      throw AppError.badRequest("connector-not-configured");
    }

    const secretStore = getDefaultSecretStore();
    const secretFields = (typeof secretStore.getSecretFields === "function" && secretStore.getSecretFields(connectionId)) || [];
    const secretValues = () => secretFields
      .map((field) => store.getConfig()?.[field])
      .filter((value) => value !== undefined && value !== null && value !== "");
    const log = createConnectorLogger({ id: connectionId, write: connectorLog, getSecrets: secretValues });
    // Raw kvGet/kvSet, alongside store/log — most handlers never touch these
    // (createConnectorStore's connector-{config,data,status}-<id> keys cover
    // the common case), but a connector with a legacy non-standard key (e.g.
    // vCenter's vcenter-data-<id>, kept as-is because mcp-server.js reads it
    // directly — see connectors/enterprise/vcenter/routes.js) needs a way to
    // read/write its real key instead of silently writing to an unused
    // connector-data-<id> that nothing else ever reads.
    const services = { store, log, kvGet, kvSet };

    const startedAt = Date.now();
    let result;
    try {
      result = await action.handler({ connection, input: input ?? {}, services });
    } catch (cause) {
      const duration = Date.now() - startedAt;
      // The handler's own error may come straight from an HTTP client and
      // could echo back request details that include a secret (token in a
      // URL or header dump) — redact before it reaches a log entry or an
      // exposed AppError detail, the same way routes.js's legacy handlers do.
      const safeMessage = redactText(cause?.message || String(cause), secretValues());
      if (approvalId && action.effect === "destructive") approvalStore.finish(approvalId, false, safeMessage);
      log("err", `${connectorTypeId}.${action.id} falló: ${safeMessage}`, { ...auditBase, duration });
      if (cause instanceof AppError) throw cause;
      throw AppError.badGateway(safeMessage, { cause });
    }
    const duration = Date.now() - startedAt;

    const outputCheck = validateAgainstSchema(action.outputSchema, result);
    if (!outputCheck.valid) {
      // A handler returning a shape that violates its own declared
      // outputSchema is a bug in that action, not bad caller input — 500,
      // not 400, and expose:false (the default for AppError.internal) so the
      // ajv error paths (which could theoretically echo back a value) never
      // reach the client.
      log("err", `${connectorTypeId}.${action.id} devolvió un resultado con forma inválida`, { ...auditBase, duration });
      if (approvalId && action.effect === "destructive") approvalStore.finish(approvalId, false, "invalid-action-output");
      throw AppError.internal(`Action "${connectorTypeId}.${action.id}" returned a result that does not match its outputSchema`);
    }

    if (approvalId && action.effect === "destructive") approvalStore.finish(approvalId, true);
    log("ok", `${connectorTypeId}.${action.id} · ${duration}ms`, { ...auditBase, duration });

    return {
      ok: true,
      actionId: `${connectorTypeId}.${action.id}`,
      connectionId,
      connectorTypeId,
      result,
      requestId,
    };
  };
}

module.exports = { createActionExecutor };
