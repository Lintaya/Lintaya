const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerBitbucketActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, request, sync } = {}) {
  const registry = createActionRegistry();
  registerBitbucketActions({ registry, request, sync, now: () => 0, isoNow: () => "2026-08-25T00:00:00.000Z" });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = (id) => (id.startsWith("bitbucket") ? "bitbucket" : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

test("bitbucket.status (Cloud, with workspace) hits /repositories/:workspace and labels by repo count", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-bitbucket": { type: "cloud", username: "u", workspace: "lintaya", token: "t" } },
    request: async (cfg, path) => { calledWith = { type: cfg.type, workspace: cfg.workspace, path }; return { size: 3 }; },
  });
  const result = await executeAction({ connectionId: "bitbucket", actionId: "status", input: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { status: "ok", latency: "0ms", user: "3 repo(s) accesibles" });
  assert.equal(calledWith.path, "/repositories/lintaya?pagelen=1");
});

test("bitbucket.status (Cloud, no workspace) falls back to /user/permissions/repositories", async () => {
  let calledPath = null;
  const { executeAction } = setup({
    seed: { "connector-config-bitbucket": { type: "cloud", username: "u", workspace: null, token: "t" } },
    request: async (cfg, path) => { calledPath = path; return { size: 5 }; },
  });
  const result = await executeAction({ connectionId: "bitbucket", actionId: "status", input: {} });
  assert.equal(calledPath, "/user/permissions/repositories?pagelen=1");
  assert.equal(result.result.user, "5 repo(s) accesibles");
});

test("bitbucket.status (Server) hits /rest/api/1.0/application-properties and labels by displayName", async () => {
  let calledPath = null;
  const { executeAction } = setup({
    seed: { "connector-config-bitbucket": { type: "server", baseUrl: "https://bitbucket.example", token: "t" } },
    request: async (cfg, path) => { calledPath = path; return { displayName: "Bitbucket Server 8.1" }; },
  });
  const result = await executeAction({ connectionId: "bitbucket", actionId: "status", input: {} });
  assert.equal(calledPath, "/rest/api/1.0/application-properties");
  assert.equal(result.result.user, "Bitbucket Server 8.1");
});

test("bitbucket.sync writes connector-data/connector-status the same way the legacy route does", async () => {
  const { executeAction, kvGet } = setup({
    seed: { "connector-config-bitbucket": { type: "cloud", username: "u", workspace: "lintaya", token: "t" } },
    sync: async () => ({
      projects: [{ id: 1 }],
      deployments: [],
      commits: [{ id: "a" }, { id: "b" }],
    }),
  });
  const result = await executeAction({ connectionId: "bitbucket", actionId: "sync", input: {} });
  assert.deepEqual(result.result, {
    projectCount: 1,
    deploymentCount: 0,
    commitCount: 2,
    syncedAt: "2026-08-25T00:00:00.000Z",
  });
  const status = kvGet("connector-status-bitbucket").value;
  assert.equal(status.status, "ok");
  assert.equal(status.itemsSynced, 3);
});

test("bitbucket.sync works identically against a second instance, isolated from the base connection", async () => {
  const { executeAction, kvGet } = setup({
    seed: {
      "connector-config-bitbucket": { type: "cloud", username: "u", workspace: "lintaya", token: "base-token" },
      "connector-config-bitbucket2": { type: "cloud", username: "u2", workspace: "team2", token: "extra-token" },
    },
    sync: async (cfg) => ({
      projects: cfg.token === "extra-token" ? [{ id: 99 }] : [],
      deployments: [],
      commits: [],
    }),
  });
  const result = await executeAction({ connectionId: "bitbucket2", actionId: "sync", input: {} });
  assert.equal(result.connectorTypeId, "bitbucket");
  assert.equal(result.result.projectCount, 1);
  assert.equal(kvGet("connector-data-bitbucket"), null, "the base connection's data must stay untouched");
});

test("registerBitbucketActions registers exactly status and sync, both under connectorTypeId bitbucket", () => {
  const registry = createActionRegistry();
  registerBitbucketActions({ registry, request: async () => ({}), sync: async () => ({ projects: [], deployments: [], commits: [] }) });
  const actions = registry.listActionsForType("bitbucket");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["status", "sync"]);
  assert.equal(registry.getAction("bitbucket", "status").effect, "read");
  assert.equal(registry.getAction("bitbucket", "sync").effect, "write");
});
