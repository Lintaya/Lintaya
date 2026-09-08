const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");
const { createApp, requireAuth } = require("../app");
const { MAIN_MIGRATIONS, migrate } = require("../core/database");
const { sendAppError } = require("../core/errors");
const { createActionRegistry, publicActionShape } = require("../core/actions/registry");
const { createActionExecutor } = require("../core/actions/execute");
const { createApprovalStore } = require("../core/services/approval-store");
const { registerActionsRoutes } = require("./actions");
const { registerApprovalRoutes } = require("./approvals");
const { request } = require("./test-http-harness");

function setup() {
  const db = new Database(":memory:");
  migrate(db, MAIN_MIGRATIONS);
  const approvalStore = createApprovalStore({ db });
  const registry = createActionRegistry();
  let calls = 0;
  registry.registerAction({
    id: "delete-document", connectorTypeId: "outline", title: "Delete document", effect: "destructive",
    inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } },
    outputSchema: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean" } } },
    handler: async () => { calls++; return { deleted: true }; },
  });
  const kv = new Map([["connector-config-outline", { apiKey: "kept-in-secret-store" }]]);
  const executeAction = createActionExecutor({
    registry, kvGet: (key) => kv.has(key) ? { value: kv.get(key) } : null, kvSet: (key, value) => kv.set(key, value),
    connectorLog: () => {}, resolveConnectorType: () => "outline", approvalStore,
  });
  const app = createApp({ token: "test-token" });
  registerActionsRoutes({ app, requireAuth, registry, publicActionShape, executeAction, resolveConnectorType: () => "outline", sendAppError });
  registerApprovalRoutes({ app, requireAuth, approvalStore, executeAction, sendAppError });
  return { app, headers: { authorization: "Bearer test-token" }, calls, getCalls: () => calls, db };
}

test("a destructive action becomes a pending approval and runs only after a human approves it", async () => {
  const env = setup();
  const created = await request(env.app, "POST", "/api/connectors/outline/actions/delete-document", { headers: { ...env.headers, "x-actor": "codex" }, body: { id: "doc-1" } });
  assert.equal(created.status, 202);
  const pending = created.json().approval;
  assert.equal(pending.status, "pending");
  assert.equal(env.getCalls(), 0);
  const queue = await request(env.app, "GET", "/api/approvals", { headers: env.headers });
  assert.equal(queue.json().length, 1);
  const approved = await request(env.app, "POST", `/api/approvals/${pending.id}/approve`, { headers: env.headers, body: {} });
  assert.equal(approved.status, 200);
  assert.equal(approved.json().approval.status, "succeeded");
  assert.equal(env.getCalls(), 1);
  env.db.close();
});

test("an agent cannot resolve an approval and rejection never calls the provider", async () => {
  const env = setup();
  const created = await request(env.app, "POST", "/api/connectors/outline/actions/delete-document", { headers: { ...env.headers, "x-actor": "codex" }, body: { id: "doc-1" } });
  const id = created.json().approval.id;
  const forbidden = await request(env.app, "POST", `/api/approvals/${id}/approve`, { headers: { ...env.headers, "x-actor": "codex" }, body: {} });
  assert.equal(forbidden.status, 403);
  const rejected = await request(env.app, "POST", `/api/approvals/${id}/reject`, { headers: env.headers, body: {} });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json().approval.status, "rejected");
  assert.equal(env.getCalls(), 0);
  env.db.close();
});
