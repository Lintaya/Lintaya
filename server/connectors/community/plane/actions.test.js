const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerPlaneActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, request } = {}) {
  const registry = createActionRegistry();
  registerPlaneActions({ registry, request });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = (id) => (id.startsWith("plane") ? "plane" : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

function issue(overrides = {}) {
  return {
    id: "iss-1", title: "Fix the thing", identifier: "BAU-1", projectId: "proj-1", projectName: "BAU",
    priority: "high", state: "In Progress", stateGroup: "started", assignees: ["user-1"],
    dueDate: null, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z",
    ...overrides,
  };
}

test("plane.list-issues reads from cached data — never calls the network", async () => {
  let requestCalled = false;
  const { executeAction } = setup({
    seed: {
      "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" },
      "connector-data-plane": { issues: [issue()], syncedAt: "2026-08-24T00:00:00Z", currentUserId: "user-1" },
    },
    request: async () => { requestCalled = true; return {}; },
  });
  const result = await executeAction({ connectionId: "plane", actionId: "list-issues", input: {} });
  assert.equal(result.ok, true);
  assert.equal(result.result.total, 1);
  assert.equal(result.result.issues[0].identifier, "BAU-1");
  assert.equal(requestCalled, false);
});

test("plane.list-issues filters completed/cancelled issues out by default", async () => {
  const { executeAction } = setup({
    seed: {
      "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" },
      "connector-data-plane": {
        issues: [issue({ id: "a", stateGroup: "started" }), issue({ id: "b", stateGroup: "completed" })],
        syncedAt: null, currentUserId: null,
      },
    },
  });
  const result = await executeAction({ connectionId: "plane", actionId: "list-issues", input: {} });
  assert.equal(result.result.total, 1);
  assert.equal(result.result.issues[0].id, "a");
});

test("plane.list-issues with active:false includes completed issues too", async () => {
  const { executeAction } = setup({
    seed: {
      "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" },
      "connector-data-plane": {
        issues: [issue({ id: "a", stateGroup: "started" }), issue({ id: "b", stateGroup: "completed" })],
        syncedAt: null, currentUserId: null,
      },
    },
  });
  const result = await executeAction({ connectionId: "plane", actionId: "list-issues", input: { active: false } });
  assert.equal(result.result.total, 2);
});

test("plane.list-issues filters by project and priority", async () => {
  const { executeAction } = setup({
    seed: {
      "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" },
      "connector-data-plane": {
        issues: [
          issue({ id: "a", projectId: "proj-1", priority: "high" }),
          issue({ id: "b", projectId: "proj-2", priority: "high" }),
          issue({ id: "c", projectId: "proj-1", priority: "low" }),
        ],
        syncedAt: null, currentUserId: null,
      },
    },
  });
  const result = await executeAction({ connectionId: "plane", actionId: "list-issues", input: { project: "proj-1", priority: "high" } });
  assert.equal(result.result.total, 1);
  assert.equal(result.result.issues[0].id, "a");
});

test("plane.create-issue calls the real client function with the projectId from input, not a URL param", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" } },
    request: async (baseUrl, apiKey, path, method, body) => {
      calledWith = { baseUrl, apiKey, path, method, body };
      return { id: "new-issue-id", sequence_id: 42 };
    },
  });
  const result = await executeAction({
    connectionId: "plane",
    actionId: "create-issue",
    input: { projectId: "proj-1", name: "Nueva tarea", priority: "high" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { id: "new-issue-id", sequenceId: 42 });
  assert.equal(calledWith.method, "POST");
  assert.equal(calledWith.path, "/api/v1/workspaces/ws/projects/proj-1/issues/");
  assert.deepEqual(calledWith.body, { name: "Nueva tarea", priority: "high" });
});

test("plane.create-issue requires projectId and name", async () => {
  const { AppError } = require("../../../core/errors");
  const { executeAction } = setup({
    seed: { "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" } },
    request: async () => ({ id: "x" }),
  });
  await assert.rejects(
    executeAction({ connectionId: "plane", actionId: "create-issue", input: { name: "sin proyecto" } }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "invalid-input",
  );
});

test("plane.create-issue is a write action and gets audited", async () => {
  const { executeAction, logs } = setup({
    seed: { "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" } },
    request: async () => ({ id: "x", sequence_id: 1 }),
  });
  await executeAction({ connectionId: "plane", actionId: "create-issue", input: { projectId: "p", name: "n" } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].meta.effect, "write");
});

test("plane.delete-issue is destructive: it queues approval and never calls Plane", async () => {
  let requestCalled = false;
  const { executeAction, logs } = setup({
    seed: { "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" } },
    request: async () => { requestCalled = true; return {}; },
  });
  const result = await executeAction({
    connectionId: "plane",
    actionId: "delete-issue",
    input: { projectId: "proj-1", issueId: "issue-1" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.error, "pending-approval");
  assert.equal(requestCalled, false);
  assert.equal(logs.at(-1).meta.effect, "destructive");
});

test("plane.delete-issue requires both the project and issue ids", async () => {
  const { AppError } = require("../../../core/errors");
  const { executeAction } = setup({
    seed: { "connector-config-plane": { baseUrl: "https://plane.example", apiKey: "k", workspace: "ws" } },
  });
  await assert.rejects(
    executeAction({ connectionId: "plane", actionId: "delete-issue", input: { projectId: "proj-1" } }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "invalid-input",
  );
});

test("registerPlaneActions registers cached reads, writes, and the destructive delete", () => {
  const registry = createActionRegistry();
  registerPlaneActions({ registry, request: async () => ({}) });
  const actions = registry.listActionsForType("plane");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["create-issue", "delete-issue", "list-issues"]);
  assert.equal(registry.getAction("plane", "list-issues").effect, "read");
  assert.equal(registry.getAction("plane", "create-issue").effect, "write");
  assert.equal(registry.getAction("plane", "delete-issue").effect, "destructive");
});
