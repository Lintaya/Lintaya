const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerPortainerActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, fetch, token, sync } = {}) {
  const registry = createActionRegistry();
  registerPortainerActions({ registry, fetch, token, sync, now: () => 0, isoNow: () => "2026-08-25T00:00:00.000Z" });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = () => "portainer";
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

test("portainer.status fetches a token then the endpoint list", async () => {
  const { executeAction } = setup({
    seed: { "connector-config-portainer": { baseUrl: "https://portainer.example", apiKey: "k" } },
    token: async (cfg) => `token-for-${cfg.baseUrl}`,
    fetch: async (cfg, path, authToken) => { assert.equal(authToken, "token-for-https://portainer.example"); assert.equal(path, "/api/endpoints"); return [{ id: 1 }, { id: 2 }]; },
  });
  const result = await executeAction({ connectionId: "portainer", actionId: "status", input: {} });
  assert.deepEqual(result.result, { status: "ok", latency: "0ms", endpoints: 2 });
});

test("portainer.sync writes connector-data/connector-status", async () => {
  const { executeAction, kvGet } = setup({
    seed: { "connector-config-portainer": { baseUrl: "https://portainer.example", apiKey: "k" } },
    sync: async () => ({ endpoints: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 7 }),
  });
  const result = await executeAction({ connectionId: "portainer", actionId: "sync", input: {} });
  assert.deepEqual(result.result, { endpointCount: 3, containerCount: 7, syncedAt: "2026-08-25T00:00:00.000Z" });
  const status = kvGet("connector-status-portainer").value;
  assert.equal(status.itemsSynced, 7);
});

test("registerPortainerActions registers exactly status and sync", () => {
  const registry = createActionRegistry();
  registerPortainerActions({ registry, token: async () => "t", fetch: async () => [], sync: async () => ({ endpoints: [], total: 0 }) });
  const actions = registry.listActionsForType("portainer");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["status", "sync"]);
  assert.equal(registry.getAction("portainer", "status").effect, "read");
  assert.equal(registry.getAction("portainer", "sync").effect, "write");
});
