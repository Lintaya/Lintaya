const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { registerInventoryRoutes } = require("./inventory");
const { request } = require("./test-http-harness");

function setup(seed = {}) {
  const store = new Map(Object.entries(seed));
  const kvGet = key => store.has(key) ? { value: store.get(key) } : null;
  const app = createApp({ token: "test-token" });
  registerInventoryRoutes({ app, requireAuth, kvGet });
  return { app, headers: { authorization: "Bearer test-token" } };
}

test("inventory routes remain authenticated", async () => {
  const { app } = setup();
  for (const path of ["/api/snapshot", "/api/vms", "/api/hosts"]) {
    const response = await request(app, "GET", path);
    assert.equal(response.status, 401, path);
  }
});

test("snapshot preserves its empty and cached response contracts", async () => {
  const empty = setup();
  const emptyResponse = await request(empty.app, "GET", "/api/snapshot", { headers: empty.headers });
  assert.deepEqual(emptyResponse.json(), { message: "Sin datos todavia. Corre los workers para poblar." });

  const cached = setup({ snapshot: { generatedAt: "2026-08-28T00:00:00.000Z", total: 2 } });
  const cachedResponse = await request(cached.app, "GET", "/api/snapshot", { headers: cached.headers });
  assert.deepEqual(cachedResponse.json(), { generatedAt: "2026-08-28T00:00:00.000Z", total: 2 });
});

test("VM and host lists preserve empty defaults and stored arrays", async () => {
  const empty = setup();
  assert.deepEqual((await request(empty.app, "GET", "/api/vms", { headers: empty.headers })).json(), []);
  assert.deepEqual((await request(empty.app, "GET", "/api/hosts", { headers: empty.headers })).json(), []);

  const cached = setup({ vms: [{ id: "vm-1" }], hosts: [{ id: "host-1" }] });
  assert.deepEqual((await request(cached.app, "GET", "/api/vms", { headers: cached.headers })).json(), [{ id: "vm-1" }]);
  assert.deepEqual((await request(cached.app, "GET", "/api/hosts", { headers: cached.headers })).json(), [{ id: "host-1" }]);
});
