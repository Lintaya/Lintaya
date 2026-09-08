// Action registry — AGENT-001 (ADR-011). A `createActionRegistry()` instance
// is where every ConnectorType registers the actions it exposes, keyed by
// `${connectorTypeId}.${id}`. Deliberately a factory, not a bare module-level
// singleton (unlike connectors/registry.js's `connectorManifests`, which is
// populated once from disk and never needs resetting) — registry.test.js and
// execute.test.js each need a fresh, isolated registry per test, and a real
// server process only ever needs exactly one instance, built once in
// server.js and threaded through as a dependency like every other service.
const VALID_EFFECTS = new Set(["read", "write", "destructive"]);
const REQUIRED_FIELDS = ["id", "connectorTypeId", "title", "inputSchema", "outputSchema", "handler"];

function keyFor(connectorTypeId, id) {
  return `${connectorTypeId}.${id}`;
}

function createActionRegistry() {
  const actions = new Map();

  // Fails loudly on a malformed registration (missing field, duplicate id,
  // non-function handler) — those are programming errors, caught at boot.
  // `effect` is handled differently on purpose: a *missing or unrecognized*
  // effect does not throw, it defaults to "destructive" (see ADR-010/ADR-011
  // and roadmap section 9 bis — "el default seguro es pedir confirmación de
  // más, no de menos"). A typo'd effect should make the action *more*
  // cautious, never silently fall through as unclassified.
  function registerAction(action) {
    for (const field of REQUIRED_FIELDS) {
      if (action?.[field] === undefined) {
        throw new TypeError(`action registration requires "${field}"`);
      }
    }
    if (typeof action.handler !== "function") {
      throw new TypeError(`action "${action.connectorTypeId}.${action.id}" handler must be a function`);
    }
    const effect = VALID_EFFECTS.has(action.effect) ? action.effect : "destructive";
    const key = keyFor(action.connectorTypeId, action.id);
    if (actions.has(key)) {
      throw new TypeError(`action "${key}" is already registered`);
    }
    const registered = {
      supportsCancellation: false,
      // Opt-out, not opt-in — see execute.js's own comment at the check
      // site. Declared here (not just defaulted in execute.js) so
      // GET /api/actions can show it without every caller having to know
      // "undefined means true".
      requiresConfig: true,
      ...action,
      effect,
    };
    actions.set(key, registered);
    return key;
  }

  function getAction(connectorTypeId, id) {
    return actions.get(keyFor(connectorTypeId, id)) || null;
  }

  function listActions() {
    return [...actions.values()];
  }

  function listActionsForType(connectorTypeId) {
    return listActions().filter((action) => action.connectorTypeId === connectorTypeId);
  }

  return { registerAction, getAction, listActions, listActionsForType };
}

// Strips `handler` (a function — not meaningfully JSON-serializable, and the
// implementation is exactly what a discovery endpoint must not leak) for
// GET /api/actions and GET /api/connectors/:connectionId/actions.
function publicActionShape(action) {
  const { handler, ...rest } = action;
  return rest;
}

module.exports = { createActionRegistry, publicActionShape, VALID_EFFECTS };
