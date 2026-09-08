const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerVaultMapRoutes } = require("./vault-map");
const { request } = require("./test-http-harness");

function setup() {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditActivity = () => (req, res, next) => next();

  const app = createApp({ token: "test-token" });
  registerVaultMapRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, entity: "connectors", kvKey: "connector-vault-map", label: "conector" });
  const headers = { authorization: "Bearer test-token" };
  return { app, headers, store };
}

test("GET /api/connectors/vault-map defaults to an empty map", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/connectors/vault-map", { headers });
  assert.deepEqual(res.json(), {});
});

test("PUT /api/connectors/:id/vault links and unlinks, and GET reflects it", async () => {
  const { app, headers } = setup();
  const linked = await request(app, "PUT", "/api/connectors/gitlab/vault", { headers, body: { vaultItemId: "vault-1" } });
  assert.deepEqual(linked.json(), { ok: true });

  const afterLink = await request(app, "GET", "/api/connectors/vault-map", { headers });
  assert.deepEqual(afterLink.json(), { gitlab: "vault-1" });

  await request(app, "PUT", "/api/connectors/gitlab/vault", { headers, body: {} });
  const afterUnlink = await request(app, "GET", "/api/connectors/vault-map", { headers });
  assert.deepEqual(afterUnlink.json(), {});
});

test("PUT rejects a non-object body and an invalid vault item using RFC 9457", async () => {
  const { app, headers } = setup();
  const invalidBody = await request(app, "PUT", "/api/connectors/gitlab/vault", { headers, body: [] });
  assert.equal(invalidBody.status, 400);
  assert.match(invalidBody.headers["content-type"], /^application\/problem\+json/);
  assert.equal(invalidBody.json().code, "BAD_REQUEST");

  const invalidItem = await request(app, "PUT", "/api/connectors/gitlab/vault", { headers, body: { vaultItemId: 42 } });
  assert.equal(invalidItem.status, 422);
  assert.equal(invalidItem.json().code, "UNPROCESSABLE_CONTENT");
});

test("a corrupt persisted map fails closed without exposing its value", async () => {
  const { app, headers, store } = setup();
  store.set("connector-vault-map", ["not", "a", "map"]);
  const response = await request(app, "GET", "/api/connectors/vault-map", { headers });
  assert.equal(response.status, 500);
  assert.equal(response.json().detail, "Internal server error");
  assert.equal(JSON.stringify(response.json()).includes("not"), false);
});
