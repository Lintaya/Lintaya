const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerVmsRoutes } = require("./vms");
const { request } = require("./test-http-harness");

function setup() {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditActivity = () => (req, res, next) => next();

  const app = createApp({ token: "test-token" });
  registerVmsRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError });
  const headers = { authorization: "Bearer test-token" };
  return { app, headers };
}

test("PUT /api/vms/vlan-map replaces the whole map and reports the count", async () => {
  const { app, headers } = setup();
  const res = await request(app, "PUT", "/api/vms/vlan-map", { headers, body: { "vm-1": 10, "vm-2": 20 } });
  assert.deepEqual(res.json(), { ok: true, count: 2 });

  const get = await request(app, "GET", "/api/vms/vlan-map", { headers });
  assert.deepEqual(get.json(), { "vm-1": { vlanId: 10 }, "vm-2": { vlanId: 20 } });
});

test("PUT /api/vms/vlan-map returns RFC 9457 errors for invalid map content", async () => {
  const { app, headers } = setup();
  const shape = await request(app, "PUT", "/api/vms/vlan-map", { headers, body: [] });
  assert.equal(shape.status, 400);
  assert.equal(shape.json().code, "BAD_REQUEST");
  assert.match(shape.headers["content-type"], /^application\/problem\+json/);

  const vlan = await request(app, "PUT", "/api/vms/vlan-map", { headers, body: { "vm-1": { vlanId: 4095 } } });
  assert.equal(vlan.status, 422);
  assert.equal(vlan.json().code, "UNPROCESSABLE_CONTENT");
});

test("PUT /api/vms/:id/vault links with sshUser/sshPort and unlinks", async () => {
  const { app, headers } = setup();
  const linked = await request(app, "PUT", "/api/vms/vm-1/vault", { headers, body: { vaultItemId: "vault-1", sshUser: "root", sshPort: "2222" } });
  assert.deepEqual(linked.json().map["vm-1"], { vaultItemId: "vault-1", sshUser: "root", sshPort: 2222, jump: null });

  const unlinked = await request(app, "PUT", "/api/vms/vm-1/vault", { headers, body: {} });
  assert.deepEqual(unlinked.json().map, {});
});

test("PUT /api/vms/:id/vault preserves sshUser when a later request omits it", async () => {
  const { app, headers } = setup();
  await request(app, "PUT", "/api/vms/vm-1/vault", { headers, body: { vaultItemId: "vault-1", sshUser: "root" } });
  const second = await request(app, "PUT", "/api/vms/vm-1/vault", { headers, body: { vaultItemId: "vault-1" } });
  assert.equal(second.json().map["vm-1"].sshUser, "root");
});

test("PUT /api/vms/:id/vault parses a jump host pasted as user@host:port", async () => {
  const { app, headers } = setup();
  const res = await request(app, "PUT", "/api/vms/vm-1/vault", {
    headers,
    body: { vaultItemId: "vault-1", jump: { host: "bastion@10.0.0.5:2200" } },
  });
  assert.deepEqual(res.json().map["vm-1"].jump, { host: "10.0.0.5", port: 2200, user: "bastion", vaultItemId: null });
});

test("PUT /api/vms/:id/vault validates operational SSH inputs", async () => {
  const { app, headers } = setup();
  const port = await request(app, "PUT", "/api/vms/vm-1/vault", {
    headers, body: { vaultItemId: "vault-1", sshPort: 70000 },
  });
  assert.equal(port.status, 422);
  assert.equal(port.json().code, "UNPROCESSABLE_CONTENT");

  const jump = await request(app, "PUT", "/api/vms/vm-1/vault", {
    headers, body: { vaultItemId: "vault-1", jump: { host: "" } },
  });
  assert.equal(jump.status, 422);
  assert.equal(jump.json().code, "UNPROCESSABLE_CONTENT");
});
