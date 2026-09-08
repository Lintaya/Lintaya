const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { demuxDockerLog, normalizeInspect } = require("../core/services/containers");
const { registerContainersRoutes } = require("./containers");
const { request } = require("./test-http-harness");

function setup(overrides = {}) {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const app = createApp({ token: "test-token" });
  registerContainersRoutes({
    app, requireAuth, kvGet, kvSet, AppError, sendAppError,
    auditActivity: () => (req, res, next) => next(),
    async collectOneVm(vmId) { return { vmId, count: 1, error: null }; },
    async runContainerCollection() { return { polled: 0 }; },
    async resolveVmSshCreds() { return { username: "root", password: "secret", port: 22 }; },
    async sshExec() { return { out: "", err: "" }; },
    portainer: { async token() { return "token"; }, async fetch() { return {}; }, async fetchBuffer() { return Buffer.from(""); } },
    demuxDockerLog, normalizeInspect,
    ...overrides,
  });
  return { app, store, headers: { authorization: "Bearer test-token" } };
}

function seedVm(store) {
  store.set("vcenter-data-vcenter", { vms: [{ vm: "vm-1", name: "app" }], clusterVmMap: { "vm-1": { ipAddress: "10.0.0.5" } } });
}

test("container-monitor validates body and VM inventory", async () => {
  const { app, store, headers } = setup();
  const invalid = await request(app, "PUT", "/api/vms/vm-1/container-monitor", { headers, body: { enabled: "yes" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json().code, "BAD_REQUEST");

  const noInventory = await request(app, "PUT", "/api/vms/vm-1/container-monitor", { headers, body: { enabled: true } });
  assert.equal(noInventory.status, 404);

  seedVm(store);
  const enabled = await request(app, "PUT", "/api/vms/vm-1/container-monitor", { headers, body: { enabled: true } });
  assert.deepEqual(enabled.json(), { ok: true, enabled: true, hosts: ["vm-1"] });
});

test("collection validates a requested VM and hides internal failures", async () => {
  const { app, store, headers } = setup({ async collectOneVm() { throw new Error("credential detail"); } });
  const missing = await request(app, "POST", "/api/containers/collect", { headers, body: { vmId: "vm-1" } });
  assert.equal(missing.status, 404);

  seedVm(store);
  const failed = await request(app, "POST", "/api/containers/collect", { headers, body: { vmId: "vm-1" } });
  assert.equal(failed.status, 500);
  assert.equal(failed.json().detail, "Internal server error");
});

test("container inspection validates sources and does not interpolate unsafe ids", async () => {
  const { app, headers } = setup();
  const source = await request(app, "GET", "/api/containers/inspect?source=other&id=web", { headers });
  assert.equal(source.status, 400);
  assert.equal(source.json().code, "BAD_REQUEST");

  const injection = await request(app, "GET", "/api/containers/logs?source=ssh&vmId=vm-1&id=web;whoami", { headers });
  assert.equal(injection.status, 400);
  assert.equal(injection.json().code, "BAD_REQUEST");
});

test("container remote routes use RFC 9457 for configuration, vault and upstream failures", async () => {
  const unconfigured = setup();
  const noPortainer = await request(unconfigured.app, "GET", "/api/containers/inspect?source=portainer&endpointId=1&id=web", { headers: unconfigured.headers });
  assert.equal(noPortainer.status, 503);
  assert.equal(noPortainer.json().code, "PORTAINER_NOT_CONFIGURED");

  const locked = setup({ async resolveVmSshCreds() { return { error: "vault-locked" }; } });
  seedVm(locked.store);
  const vault = await request(locked.app, "GET", "/api/containers/logs?source=ssh&vmId=vm-1&id=web", { headers: locked.headers });
  assert.equal(vault.status, 401);
  assert.equal(vault.json().code, "VAULT_LOCKED");

  const upstream = setup({ async sshExec() { throw new Error("remote secret detail"); } });
  seedVm(upstream.store);
  const error = await request(upstream.app, "GET", "/api/containers/inspect?source=ssh&vmId=vm-1&id=web", { headers: upstream.headers });
  assert.equal(error.status, 502);
  assert.equal(error.json().code, "UPSTREAM_ERROR");
  assert.equal(error.json().detail, "Unable to inspect container");
});

test("container list keeps the existing unified response shape", async () => {
  const { app, store, headers } = setup();
  seedVm(store);
  store.set("vm-container-hosts", ["vm-1"]);
  store.set("vm-containers-vm-1", { vmName: "app", ip: "10.0.0.5", ts: 1, containers: [{ id: "web", state: "running" }] });
  const response = await request(app, "GET", "/api/containers", { headers });
  assert.deepEqual(response.json(), { containers: [{ id: "web", state: "running", vmId: "vm-1", vmName: "app", hostIp: "10.0.0.5", source: "ssh", collectedAt: 1 }], total: 1, running: 1 });
});
