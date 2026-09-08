const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerGitlabActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, request, sync } = {}) {
  const registry = createActionRegistry();
  registerGitlabActions({ registry, request, sync, now: () => 0, isoNow: () => "2026-08-25T00:00:00.000Z" });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = (id) => (id.startsWith("gitlab") ? "gitlab" : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

test("gitlab.status calls the real client function and returns a normalized shape", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-gitlab": { baseUrl: "https://gitlab.example", token: "t" } },
    request: async (baseUrl, token, path) => { calledWith = { baseUrl, token, path }; return { username: "lintaya-bot" }; },
  });
  const result = await executeAction({ connectionId: "gitlab", actionId: "status", input: {} });
  assert.equal(result.ok, true);
  assert.equal(result.actionId, "gitlab.status");
  assert.deepEqual(result.result, { status: "ok", latency: "0ms", user: "lintaya-bot" });
  assert.deepEqual(calledWith, { baseUrl: "https://gitlab.example", token: "t", path: "/api/v4/user" });
});

test("gitlab.sync writes connector-data/connector-status the same way the legacy route does", async () => {
  const { executeAction, kvGet } = setup({
    seed: { "connector-config-gitlab": { baseUrl: "https://gitlab.example", token: "t" } },
    sync: async () => ({
      projects: [{ id: 1 }, { id: 2 }],
      deployments: [{ id: 10 }],
      commits: [{ id: "abc" }, { id: "def" }, { id: "ghi" }],
    }),
  });
  const result = await executeAction({ connectionId: "gitlab", actionId: "sync", input: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, {
    projectCount: 2,
    deploymentCount: 1,
    commitCount: 3,
    syncedAt: "2026-08-25T00:00:00.000Z",
  });
  const data = kvGet("connector-data-gitlab").value;
  assert.equal(data.projects.length, 2);
  assert.equal(data.syncedAt, "2026-08-25T00:00:00.000Z");
  const status = kvGet("connector-status-gitlab").value;
  assert.equal(status.status, "ok");
  assert.equal(status.itemsSynced, 6);
});

test("gitlab.sync works identically against a second instance (gitlab2), isolated from the base connection", async () => {
  const { executeAction, kvGet } = setup({
    seed: {
      "connector-config-gitlab": { baseUrl: "https://gitlab.example", token: "base-token" },
      "connector-config-gitlab2": { baseUrl: "https://gitlab2.example", token: "extra-token" },
    },
    sync: async (cfg) => ({
      projects: cfg.token === "extra-token" ? [{ id: 99 }] : [],
      deployments: [],
      commits: [],
    }),
  });
  const result = await executeAction({ connectionId: "gitlab2", actionId: "sync", input: {} });
  assert.equal(result.connectorTypeId, "gitlab");
  assert.equal(result.connectionId, "gitlab2");
  assert.equal(result.result.projectCount, 1);
  assert.equal(kvGet("connector-data-gitlab"), null, "the base connection's data must stay untouched");
});

test("gitlab.status rejects unexpected input per its inputSchema", async () => {
  const { AppError } = require("../../../core/errors");
  const { executeAction } = setup({
    seed: { "connector-config-gitlab": { baseUrl: "https://gitlab.example", token: "t" } },
    request: async () => ({ username: "x" }),
  });
  await assert.rejects(
    executeAction({ connectionId: "gitlab", actionId: "status", input: { unexpected: true } }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "invalid-input",
  );
});

test("registerGitlabActions registers exactly status and sync, both under connectorTypeId gitlab", () => {
  const registry = createActionRegistry();
  registerGitlabActions({ registry, request: async () => ({}), sync: async () => ({ projects: [], deployments: [], commits: [] }) });
  const actions = registry.listActionsForType("gitlab");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["status", "sync"]);
  assert.equal(registry.getAction("gitlab", "status").effect, "read");
  assert.equal(registry.getAction("gitlab", "sync").effect, "write");
});
