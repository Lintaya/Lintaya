const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerGithubActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, request, sync } = {}) {
  const registry = createActionRegistry();
  registerGithubActions({ registry, request, sync, now: () => 0, isoNow: () => "2026-08-25T00:00:00.000Z" });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = (id) => (id.startsWith("github") ? "github" : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

test("github.status calls the real client function and returns a normalized shape", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-github": { baseUrl: "https://api.github.com", token: "t" } },
    request: async (baseUrl, token, path) => { calledWith = { baseUrl, token, path }; return { login: "lintaya-bot" }; },
  });
  const result = await executeAction({ connectionId: "github", actionId: "status", input: {} });
  assert.equal(result.ok, true);
  assert.equal(result.actionId, "github.status");
  assert.deepEqual(result.result, { status: "ok", latency: "0ms", user: "lintaya-bot" });
  assert.deepEqual(calledWith, { baseUrl: "https://api.github.com", token: "t", path: "/user" });
});

test("github.sync writes connector-data/connector-status the same way the legacy route does", async () => {
  const { executeAction, kvGet } = setup({
    seed: { "connector-config-github": { baseUrl: "https://api.github.com", token: "t" } },
    sync: async () => ({
      projects: [{ id: 1 }, { id: 2 }, { id: 3 }],
      deployments: [{ id: 10 }],
      commits: [{ id: "abc" }, { id: "def" }],
    }),
  });
  const result = await executeAction({ connectionId: "github", actionId: "sync", input: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, {
    projectCount: 3,
    deploymentCount: 1,
    commitCount: 2,
    syncedAt: "2026-08-25T00:00:00.000Z",
  });
  const data = kvGet("connector-data-github").value;
  assert.equal(data.projects.length, 3);
  const status = kvGet("connector-status-github").value;
  assert.equal(status.status, "ok");
  assert.equal(status.itemsSynced, 6);
});

test("github.sync works identically against a second instance, isolated from the base connection", async () => {
  const { executeAction, kvGet } = setup({
    seed: {
      "connector-config-github": { baseUrl: "https://api.github.com", token: "base-token" },
      "connector-config-github2": { baseUrl: "https://api.github.com", token: "extra-token" },
    },
    sync: async (cfg) => ({
      projects: cfg.token === "extra-token" ? [{ id: 99 }] : [],
      deployments: [],
      commits: [],
    }),
  });
  const result = await executeAction({ connectionId: "github2", actionId: "sync", input: {} });
  assert.equal(result.connectorTypeId, "github");
  assert.equal(result.connectionId, "github2");
  assert.equal(result.result.projectCount, 1);
  assert.equal(kvGet("connector-data-github"), null, "the base connection's data must stay untouched");
});

test("github.status rejects unexpected input per its inputSchema", async () => {
  const { AppError } = require("../../../core/errors");
  const { executeAction } = setup({
    seed: { "connector-config-github": { token: "t" } },
    request: async () => ({ login: "x" }),
  });
  await assert.rejects(
    executeAction({ connectionId: "github", actionId: "status", input: { unexpected: true } }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "invalid-input",
  );
});

test("registerGithubActions registers exactly its four actions, all under connectorTypeId github", () => {
  const registry = createActionRegistry();
  registerGithubActions({ registry, request: async () => ({}), sync: async () => ({ projects: [], deployments: [], commits: [] }) });
  const actions = registry.listActionsForType("github");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["approve-pull-request", "create-repository", "status", "sync"]);
  assert.equal(registry.getAction("github", "status").effect, "read");
  assert.equal(registry.getAction("github", "sync").effect, "write");
  assert.equal(registry.getAction("github", "create-repository").effect, "write");
  // Aprobar escribe en el proveedor, pero no destruye nada y se puede retirar
  // desde GitHub: "write", no "destructive", que exigiria Approval Center.
  assert.equal(registry.getAction("github", "approve-pull-request").effect, "write");
});

test("github.approve-pull-request submits an APPROVE review and validates its input", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-github": { baseUrl: "https://api.github.com", token: "t" } },
    request: async (baseUrl, token, path, method, body) => {
      calledWith = { path, method, body };
      return { id: 99, state: "APPROVED", user: { login: "reviewer" },
        submitted_at: "2026-09-11T10:00:00Z", html_url: "https://github.com/octo/lintaya/pull/10#pullrequestreview-99" };
    },
  });

  const result = await executeAction({
    connectionId: "github", actionId: "approve-pull-request",
    input: { project: "octo/lintaya", number: 10, body: "looks good" },
  });

  assert.deepEqual(calledWith, {
    path: "/repos/octo/lintaya/pulls/10/reviews",
    method: "POST",
    body: { event: "APPROVE", body: "looks good" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.state, "APPROVED");
  assert.equal(result.result.reviewer, "reviewer");

  // Sin repositorio no hay a quien aprobar: el esquema tiene que frenarlo antes
  // de que salga una peticion.
  calledWith = null;
  await assert.rejects(
    () => executeAction({ connectionId: "github", actionId: "approve-pull-request", input: { number: 10 } }),
    (error) => error.code === "BAD_REQUEST",
  );
  assert.equal(calledWith, null, "una entrada invalida no llega al proveedor");
});

test("github.create-repository posts through the real client function", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-github": { baseUrl: "https://api.github.com", token: "t" } },
    request: async (baseUrl, token, path, method, body) => {
      calledWith = { path, method, body };
      return { id: 7, name: "lintaya", full_name: "octo/lintaya", private: true,
        html_url: "https://github.com/octo/lintaya", clone_url: "https://github.com/octo/lintaya.git",
        ssh_url: "git@github.com:octo/lintaya.git", default_branch: "main" };
    },
  });

  const result = await executeAction({
    connectionId: "github",
    actionId: "create-repository",
    input: { name: "lintaya", private: true },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.fullName, "octo/lintaya");
  assert.equal(result.result.private, true);
  assert.equal(calledWith.path, "/user/repos");
  assert.equal(calledWith.method, "POST");
  assert.equal(calledWith.body.auto_init, false);
});

test("github.create-repository refuses to run without an explicit visibility", async () => {
  let requested = false;
  const { executeAction } = setup({
    seed: { "connector-config-github": { baseUrl: "https://api.github.com", token: "t" } },
    request: async () => { requested = true; return {}; },
  });

  // Schema validation rejects it, so the caller has to say private true or
  // false and nothing reaches GitHub in the meantime.
  await assert.rejects(
    () => executeAction({ connectionId: "github", actionId: "create-repository", input: { name: "lintaya" } }),
    (error) => error.code === "BAD_REQUEST",
  );
  assert.equal(requested, false);
});
