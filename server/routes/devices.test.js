const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerDevicesRoutes } = require("./devices");
const { request } = require("./test-http-harness");

function setup() {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditActivity = () => (req, res, next) => next();

  const app = createApp({ token: "test-token" });
  registerDevicesRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError });
  const headers = { authorization: "Bearer test-token" };
  return { app, store, headers };
}

test("POST /api/devices requires name, kind and mgmtIp", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/devices", { headers, body: { name: "sw1" } });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});

test("POST /api/devices creates a device with defaults filled in", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/devices", { headers, body: { name: "sw1", kind: "switch-core", mgmtIp: "10.0.0.1" } });
  assert.equal(res.status, 200);
  const dev = res.json();
  assert.equal(dev.sshUser, "admin");
  assert.equal(dev.sshPort, 22);
  assert.equal(dev.enableMode, true, "switch-core should default enableMode to true");
  assert.equal(dev.site, "MEX");

  const list = await request(app, "GET", "/api/devices", { headers });
  assert.equal(list.json().length, 1);
});

test("PUT /api/devices/:id updates fields and 404s for an unknown id", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/devices", { headers, body: { name: "sw1", kind: "switch", mgmtIp: "10.0.0.1" } });
  const id = created.json().id;

  const edited = await request(app, "PUT", `/api/devices/${id}`, { headers, body: { name: "sw1-renamed", tags: "a, b" } });
  assert.equal(edited.json().name, "sw1-renamed");
  assert.deepEqual(edited.json().tags, ["a", "b"]);

  const missing = await request(app, "PUT", "/api/devices/nope", { headers, body: { name: "x" } });
  assert.equal(missing.status, 404);
});

test("DELETE /api/devices/:id removes the device and its vault-map entry", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/devices", { headers, body: { name: "sw1", kind: "switch", mgmtIp: "10.0.0.1" } });
  const id = created.json().id;
  await request(app, "PUT", `/api/devices/${id}/vault`, { headers, body: { vaultItemId: "vault-1" } });

  const deleted = await request(app, "DELETE", `/api/devices/${id}`, { headers });
  assert.deepEqual(deleted.json(), { ok: true });

  const devices = await request(app, "GET", "/api/devices", { headers });
  assert.equal(devices.json().length, 0);
  const vaultMap = await request(app, "GET", "/api/devices/vault-map", { headers });
  assert.deepEqual(vaultMap.json(), {});
});

test("PUT /api/devices/:id/vault links and unlinks a vault item", async () => {
  const { app, headers } = setup();
  const linked = await request(app, "PUT", "/api/devices/dev-1/vault", { headers, body: { vaultItemId: "vault-9" } });
  assert.deepEqual(linked.json().map, { "dev-1": "vault-9" });

  const unlinked = await request(app, "PUT", "/api/devices/dev-1/vault", { headers, body: {} });
  assert.deepEqual(unlinked.json().map, {});
});
