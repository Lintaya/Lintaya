const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { createActionRegistry, publicActionShape } = require("../core/actions/registry");
const { createActionExecutor } = require("../core/actions/execute");
const { registerActionsRoutes } = require("./actions");
const { request } = require("./test-http-harness");

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

function setup({ actions = [readAction()], seed = {} } = {}) {
  const registry = createActionRegistry();
  for (const action of actions) registry.registerAction(action);
  const store = new Map(Object.entries(seed));
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = (id) => (id.startsWith("gitlab") ? "gitlab" : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });

  const app = createApp({ token: "test-token" });
  registerActionsRoutes({ app, requireAuth, registry, publicActionShape, executeAction, resolveConnectorType, sendAppError });
  const headers = { authorization: "Bearer test-token" };
  return { app, headers, store, logs };
}

test("GET /api/actions lists the full catalog without handler functions", async () => {
  const { app, headers } = setup({
    actions: [readAction(), readAction({ id: "sync", effect: "write" })],
  });
  const res = await request(app, "GET", "/api/actions", { headers });
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.length, 2);
  assert.ok(body.every((a) => a.handler === undefined));
  assert.deepEqual(body.map((a) => a.id).sort(), ["status", "sync"]);
});

test("GET /api/actions requires auth", async () => {
  const { app } = setup();
  const res = await request(app, "GET", "/api/actions", {});
  assert.equal(res.status, 401);
});

test("GET /api/connectors/:connectionId/actions scopes to the connection's type", async () => {
  const { app, headers } = setup({
    actions: [readAction(), readAction({ id: "list-issues", connectorTypeId: "plane", effect: "read" })],
  });
  const res = await request(app, "GET", "/api/connectors/gitlab/actions", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json().map((a) => a.id), ["status"]);
});

test("GET /api/connectors/:connectionId/actions returns an empty list for a connection with no registered actions", async () => {
  const { app, headers } = setup({ actions: [readAction({ connectorTypeId: "plane" })] });
  const res = await request(app, "GET", "/api/connectors/gitlab/actions", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), []);
});

test("POST .../actions/:actionId executes a read action and returns 200 with the normalized shape", async () => {
  const { app, headers } = setup({ seed: { "connector-config-gitlab": { token: "t" } } });
  const res = await request(app, "POST", "/api/connectors/gitlab/actions/status", { headers, body: {} });
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.actionId, "gitlab.status");
  assert.deepEqual(body.result, { status: "ok" });
  assert.ok(body.requestId);
});

test("POST .../actions/:actionId on a destructive action returns 202 pending-approval without executing", async () => {
  let called = false;
  const { app, headers } = setup({
    actions: [readAction({ id: "delete-project", effect: "destructive", handler: async () => { called = true; return {}; } })],
    seed: { "connector-config-gitlab": { token: "t" } },
  });
  const res = await request(app, "POST", "/api/connectors/gitlab/actions/delete-project", { headers, body: {} });
  assert.equal(res.status, 202);
  assert.equal(res.json().error, "pending-approval");
  assert.equal(called, false);
});

test("POST .../actions/:actionId with an unknown actionId responds RFC 9457 404", async () => {
  const { app, headers } = setup({ seed: { "connector-config-gitlab": { token: "t" } } });
  const res = await request(app, "POST", "/api/connectors/gitlab/actions/nope", { headers, body: {} });
  assert.equal(res.status, 404);
  assert.equal(res.json().code, "NOT_FOUND");
});

test("POST .../actions/:actionId with invalid input responds RFC 9457 400 carrying schema errors", async () => {
  const { app, headers } = setup({ seed: { "connector-config-gitlab": { token: "t" } } });
  const res = await request(app, "POST", "/api/connectors/gitlab/actions/status", { headers, body: { unexpected: true } });
  assert.equal(res.status, 400);
  const body = res.json();
  assert.equal(body.code, "BAD_REQUEST");
  assert.ok(Array.isArray(body.details.errors));
});

test("X-Actor header reaches the audit log entry", async () => {
  const { app, headers, logs } = setup({ seed: { "connector-config-gitlab": { token: "t" } } });
  const res = await request(app, "POST", "/api/connectors/gitlab/actions/status", {
    headers: { ...headers, "x-actor": "claude-sonnet-5" },
    body: {},
  });
  assert.equal(res.status, 200);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].meta.actor, "claude-sonnet-5");
});

test("legacy AppError instance (e.g. internal, unexposed) still reaches the client as RFC 9457 without a stack leak", async () => {
  const { app, headers } = setup({
    actions: [readAction({ handler: async () => { throw AppError.internal("boom"); } })],
    seed: { "connector-config-gitlab": { token: "t" } },
  });
  const res = await request(app, "POST", "/api/connectors/gitlab/actions/status", { headers, body: {} });
  assert.equal(res.status, 500);
  assert.equal(res.json().detail, "Internal server error");
});
