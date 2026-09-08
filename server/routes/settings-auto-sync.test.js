const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { registerSettingsAutoSyncRoutes } = require("./settings-auto-sync");
const { request } = require("./test-http-harness");

function setup(seed = {}) {
  const store = new Map(Object.entries(seed));
  const kvGet = key => store.has(key) ? { value: store.get(key) } : null;
  const kvSet = (key, value) => store.set(key, value);
  const auditActivity = () => (req, res, next) => next();
  const targets = [
    { id: "github", path: "/api/connectors/github/sync", group: "fast" },
    { id: "vcenter", path: "/api/connectors/vcenter/vcenter/sync", group: "slow" },
  ];
  const getOverrides = () => kvGet("connector-sync-intervals")?.value || {};
  const effectiveSyncInterval = (target, config) => getOverrides()[target.id]
    || (target.group === "slow" ? config.slowMinutes : config.fastMinutes);
  const app = createApp({ token: "test-token" });
  registerSettingsAutoSyncRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, getTargets: () => targets, getOverrides, effectiveSyncInterval });
  return { app, headers: { authorization: "Bearer test-token" }, store };
}

test("GET returns compatible defaults, state, targets, and effective overrides", async () => {
  const { app, headers } = setup({
    "auto-sync-state": { github: "2026-08-28T00:00:00.000Z" },
    "connector-sync-intervals": { github: 12 },
  });
  const response = await request(app, "GET", "/api/settings/auto-sync", { headers });
  assert.deepEqual(response.json(), {
    enabled: false,
    fastMinutes: 5,
    slowMinutes: 20,
    lastRun: { github: "2026-08-28T00:00:00.000Z" },
    overrides: { github: 12 },
    targets: [
      { id: "github", path: "/api/connectors/github/sync", group: "fast", effectiveMinutes: 12 },
      { id: "vcenter", path: "/api/connectors/vcenter/vcenter/sync", group: "slow", effectiveMinutes: 20 },
    ],
  });
});

test("POST preserves coercion, defaults, and interval clamps", async () => {
  const { app, headers, store } = setup();
  const response = await request(app, "POST", "/api/settings/auto-sync", {
    headers,
    body: { enabled: "yes", fastMinutes: 999, slowMinutes: 0 },
  });
  assert.deepEqual(response.json(), { ok: true, enabled: true, fastMinutes: 180, slowMinutes: 20 });
  assert.deepEqual(store.get("auto-sync-config"), { enabled: true, fastMinutes: 180, slowMinutes: 20 });
});

test("GET and POST remain authenticated", async () => {
  const { app } = setup();
  assert.equal((await request(app, "GET", "/api/settings/auto-sync")).status, 401);
  assert.equal((await request(app, "POST", "/api/settings/auto-sync", { body: {} })).status, 401);
});
