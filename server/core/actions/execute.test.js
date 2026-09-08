const assert = require("node:assert/strict");
const { test } = require("node:test");

const { AppError } = require("../errors");
const { configureDefaultSecretStore } = require("../services/secret-store");
const { createActionRegistry } = require("./registry");
const { createActionExecutor } = require("./execute");

// createConnectorStore() reads/writes the process-wide default secret store
// (server.js configures the real one at boot; nothing here does that), so
// each test that needs one swaps it in and restores the no-op legacy default
// afterward — same pattern connectors.test.js already uses for the same
// reason.
const LEGACY_SECRET_STORE = { mode: "legacy", get: () => ({}), set() {}, clear() {} };
function withSecretStore(store, fn) {
  configureDefaultSecretStore(store);
  return Promise.resolve().then(fn).finally(() => configureDefaultSecretStore(LEGACY_SECRET_STORE));
}

// A real (if tiny) stateful store, not a no-op stub — createConnectorStore's
// lazy plaintext→secret-store migration reads back what it just wrote on the
// very same call; a `.get()` that always returns `{}` would make a secret
// field vanish after its first read instead of round-tripping, which would
// make the redaction tests below pass for the wrong reason.
function statefulLocalSecretStore(secretFields) {
  const rows = new Map();
  return {
    mode: "local",
    get: (id) => rows.get(id) || {},
    set: (id, value) => rows.set(id, value),
    clear: (id) => rows.delete(id),
    getSecretFields: () => secretFields,
  };
}

function makeKv() {
  const rows = new Map();
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ actions = [], connectionType = "gitlab" } = {}) {
  const registry = createActionRegistry();
  for (const action of actions) registry.registerAction(action);
  const { kvGet, kvSet } = makeKv();
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  // "gitlab2" resolving to "gitlab" mirrors CORE-003's resolveConnectorType()
  // behavior for an extra instance — good enough for these tests without
  // pulling in the real KV-scan/column implementation.
  const resolveConnectorType = (id) => (id.startsWith(connectionType) ? connectionType : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { registry, kvGet, kvSet, logs, executeAction, connectorLog, resolveConnectorType };
}

function readAction(overrides = {}) {
  return {
    id: "status",
    connectorTypeId: "gitlab",
    title: "Status",
    effect: "read",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: { type: "object", required: ["status"], properties: { status: { type: "string" } } },
    handler: async () => ({ status: "ok" }),
    ...overrides,
  };
}

test("executes a read action and returns the normalized response shape", async () => {
  const { executeAction, kvSet } = setup({ actions: [readAction()] });
  kvSet("connector-config-gitlab", { baseUrl: "https://gitlab.example", token: "t" });
  const result = await executeAction({ connectionId: "gitlab", actionId: "status", input: {}, requestId: "req-1" });
  assert.deepEqual(result, {
    ok: true,
    actionId: "gitlab.status",
    connectionId: "gitlab",
    connectorTypeId: "gitlab",
    result: { status: "ok" },
    requestId: "req-1",
  });
});

test("audits a successful call via connectorLog, with actor/requestId/effect/duration in meta", async () => {
  const { executeAction, kvSet, logs } = setup({ actions: [readAction()] });
  kvSet("connector-config-gitlab", { token: "t" });
  await executeAction({ connectionId: "gitlab", actionId: "status", input: {}, actor: "claude-sonnet-5", requestId: "req-2" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, "gitlab");
  assert.equal(logs[0].level, "ok");
  assert.equal(logs[0].meta.actionId, "status");
  assert.equal(logs[0].meta.effect, "read");
  assert.equal(logs[0].meta.actor, "claude-sonnet-5");
  assert.equal(logs[0].meta.requestId, "req-2");
  assert.equal(logs[0].meta.approvalId, null);
  assert.equal(typeof logs[0].meta.duration, "number");
});

test("an unknown action throws action-not-found (404)", async () => {
  const { executeAction } = setup({ actions: [readAction()] });
  await assert.rejects(
    executeAction({ connectionId: "gitlab", actionId: "nope", input: {} }),
    (err) => err instanceof AppError && err.status === 404 && err.message === "action-not-found",
  );
});

test("invalid input throws invalid-input (400) carrying schema errors in details", async () => {
  const { executeAction, kvSet } = setup({
    actions: [readAction({ inputSchema: { type: "object", required: ["scope"], properties: { scope: { type: "string" } } } })],
  });
  kvSet("connector-config-gitlab", { token: "t" });
  await assert.rejects(
    executeAction({ connectionId: "gitlab", actionId: "status", input: {} }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "invalid-input" && Array.isArray(err.details.errors) && err.details.errors.length > 0,
  );
});

test("an action on an unconfigured connection throws connector-not-configured (400) and never calls the handler", async () => {
  let called = false;
  const { executeAction } = setup({
    actions: [readAction({ handler: async () => { called = true; return { status: "ok" }; } })],
  });
  await assert.rejects(
    executeAction({ connectionId: "gitlab", actionId: "status", input: {} }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "connector-not-configured",
  );
  assert.equal(called, false);
});

test("requiresConfig: false lets an action run on a connection with no config at all — the outlook-local case", async () => {
  let seenConfig = "not-called";
  const { executeAction } = setup({
    actions: [readAction({
      requiresConfig: false,
      handler: async ({ services }) => { seenConfig = services.store.getConfig(); return { status: "ok" }; },
    })],
  });
  const result = await executeAction({ connectionId: "gitlab", actionId: "status", input: {} });
  assert.equal(result.ok, true);
  assert.equal(seenConfig, null, "the handler must still see the real (absent) config, not a fabricated one");
});

test("a destructive action returns pending-approval and never calls the handler", async () => {
  let called = false;
  const { executeAction, kvSet, logs } = setup({
    actions: [readAction({ id: "delete-project", effect: "destructive", handler: async () => { called = true; return {}; } })],
  });
  kvSet("connector-config-gitlab", { token: "t" });
  const result = await executeAction({ connectionId: "gitlab", actionId: "delete-project", input: {} });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.error, "pending-approval");
  assert.equal(result.actionId, "gitlab.delete-project");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "warn");
  assert.equal(logs[0].meta.effect, "destructive");
  assert.equal(logs[0].meta.approvalId, null);
});

test("an action with no declared effect is treated as destructive at execution time too (registry default carries through)", async () => {
  const action = readAction({ id: "mystery" });
  delete action.effect;
  let called = false;
  action.handler = async () => { called = true; return { status: "ok" }; };
  const { executeAction, kvSet } = setup({ actions: [action] });
  kvSet("connector-config-gitlab", { token: "t" });
  const result = await executeAction({ connectionId: "gitlab", actionId: "mystery", input: {} });
  assert.equal(called, false);
  assert.equal(result.pending, true);
});

test("a handler returning a shape that violates outputSchema throws an unexposed internal error (500)", async () => {
  const { executeAction, kvSet } = setup({
    actions: [readAction({ handler: async () => ({ wrong: "shape" }) })],
  });
  kvSet("connector-config-gitlab", { token: "t" });
  await assert.rejects(
    executeAction({ connectionId: "gitlab", actionId: "status", input: {} }),
    (err) => err instanceof AppError && err.status === 500 && err.expose === false,
  );
});

test("a handler's own AppError (e.g. a provider-specific 4xx) passes through unchanged", async () => {
  const { executeAction, kvSet } = setup({
    actions: [readAction({ handler: async () => { throw AppError.unprocessable("provider rejected the request"); } })],
  });
  kvSet("connector-config-gitlab", { token: "t" });
  await assert.rejects(
    executeAction({ connectionId: "gitlab", actionId: "status", input: {} }),
    (err) => err instanceof AppError && err.status === 422 && err.message === "provider rejected the request",
  );
});

test("secrets never leak into a thrown error's exposed message when a handler throws", async () => {
  await withSecretStore(statefulLocalSecretStore(["token"]), async () => {
    const { executeAction, kvSet } = setup({
      actions: [readAction({ handler: async () => { throw new Error("request to https://gitlab.example?token=super-secret-value failed"); } })],
    });
    kvSet("connector-config-gitlab", { token: "super-secret-value" });
    await assert.rejects(
      executeAction({ connectionId: "gitlab", actionId: "status", input: {} }),
      (err) => err instanceof AppError && !err.message.includes("super-secret-value") && err.message.includes("[REDACTED]"),
    );
  });
});

test("secrets never leak into the audit log when a handler throws", async () => {
  await withSecretStore(statefulLocalSecretStore(["token"]), async () => {
    const { executeAction, kvSet, logs } = setup({
      actions: [readAction({ handler: async () => { throw new Error("failed with token=super-secret-value in the URL"); } })],
    });
    kvSet("connector-config-gitlab", { token: "super-secret-value" });
    await assert.rejects(executeAction({ connectionId: "gitlab", actionId: "status", input: {} }));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, "err");
    assert.ok(!logs[0].msg.includes("super-secret-value"));
    assert.ok(logs[0].msg.includes("[REDACTED]"));
  });
});

test("two connections of the same type get independent services — no shared/cached store", async () => {
  const seen = [];
  const { executeAction, kvSet } = setup({
    actions: [readAction({
      handler: async ({ connection, services }) => {
        seen.push({ id: connection.id, token: services.store.getConfig().token });
        return { status: "ok" };
      },
    })],
  });
  kvSet("connector-config-gitlab", { token: "token-a" });
  kvSet("connector-config-gitlab2", { token: "token-b" });
  await executeAction({ connectionId: "gitlab", actionId: "status", input: {} });
  await executeAction({ connectionId: "gitlab2", actionId: "status", input: {} });
  assert.equal(seen[0].id, "gitlab");
  assert.equal(seen[0].token, "token-a");
  assert.equal(seen[1].id, "gitlab2");
  assert.equal(seen[1].token, "token-b");
});

test("connectorTypeId in the response is derived from the connection, not the caller", async () => {
  const { executeAction, kvSet } = setup({ actions: [readAction()] });
  kvSet("connector-config-gitlab2", { token: "t" });
  const result = await executeAction({ connectionId: "gitlab2", actionId: "status", input: {} });
  assert.equal(result.connectionId, "gitlab2");
  assert.equal(result.connectorTypeId, "gitlab");
  assert.equal(result.actionId, "gitlab.status");
});

test("createActionExecutor requires all its dependencies", () => {
  const registry = createActionRegistry();
  const { kvGet, kvSet } = makeKv();
  const connectorLog = () => {};
  const resolveConnectorType = (id) => id;
  for (const missing of ["registry", "kvGet", "kvSet", "connectorLog", "resolveConnectorType"]) {
    const deps = { registry, kvGet, kvSet, connectorLog, resolveConnectorType };
    delete deps[missing];
    assert.throws(() => createActionExecutor(deps), new RegExp(missing));
  }
});
