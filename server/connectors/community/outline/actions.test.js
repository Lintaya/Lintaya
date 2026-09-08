const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerOutlineActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, request } = {}) {
  const registry = createActionRegistry();
  registerOutlineActions({ registry, request });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = (id) => (id.startsWith("outline") ? "outline" : id);
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

function doc(overrides = {}) {
  return { id: "doc-1", title: "Catálogo", collectionId: "col-1", url: "/doc/abc", updatedAt: "2026-08-01T00:00:00Z", updatedBy: "Ender", ...overrides };
}

test("outline.list-documents reads from cached data — never calls the network", async () => {
  let called = false;
  const { executeAction } = setup({
    seed: {
      "connector-config-outline": { baseUrl: "https://outline.example", apiKey: "k" },
      "connector-data-outline": { documents: [doc()], syncedAt: "2026-08-24T00:00:00Z" },
    },
    request: async () => { called = true; return {}; },
  });
  const result = await executeAction({ connectionId: "outline", actionId: "list-documents", input: {} });
  assert.equal(result.ok, true);
  assert.equal(result.result.total, 1);
  assert.equal(result.result.documents[0].title, "Catálogo");
  assert.equal(called, false);
});

test("outline.list-documents filters by collectionId and respects limit", async () => {
  const { executeAction } = setup({
    seed: {
      "connector-config-outline": { baseUrl: "https://outline.example", apiKey: "k" },
      "connector-data-outline": {
        documents: [doc({ id: "a", collectionId: "col-1" }), doc({ id: "b", collectionId: "col-2" }), doc({ id: "c", collectionId: "col-1" })],
        syncedAt: null,
      },
    },
  });
  const result = await executeAction({ connectionId: "outline", actionId: "list-documents", input: { collectionId: "col-1", limit: 1 } });
  assert.equal(result.result.total, 1);
  assert.equal(result.result.documents[0].collectionId, "col-1");
});

test("outline.create-document calls the real client function and returns the created document", async () => {
  let calledWith = null;
  const { executeAction } = setup({
    seed: { "connector-config-outline": { baseUrl: "https://outline.example", apiKey: "k" } },
    request: async (baseUrl, apiKey, path, body) => {
      calledWith = { baseUrl, apiKey, path, body };
      return { data: { id: "new-doc", title: "Nuevo", url: "/doc/new" } };
    },
  });
  const result = await executeAction({
    connectionId: "outline",
    actionId: "create-document",
    input: { collectionId: "col-1", title: "Nuevo" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { id: "new-doc", title: "Nuevo", url: "/doc/new" });
  assert.equal(calledWith.path, "/api/documents.create");
  assert.deepEqual(calledWith.body, { collectionId: "col-1", title: "Nuevo", text: "", publish: true });
});

test("outline.delete-document is destructive: returns pending-approval and never calls the network", async () => {
  let called = false;
  const { executeAction, logs } = setup({
    seed: { "connector-config-outline": { baseUrl: "https://outline.example", apiKey: "k" } },
    request: async () => { called = true; return {}; },
  });
  const result = await executeAction({ connectionId: "outline", actionId: "delete-document", input: { id: "doc-1" } });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.error, "pending-approval");
  assert.equal(logs[0].meta.effect, "destructive");
});

test("outline.delete-document requires id", async () => {
  const { AppError } = require("../../../core/errors");
  const { executeAction } = setup({ seed: { "connector-config-outline": { baseUrl: "https://outline.example", apiKey: "k" } } });
  await assert.rejects(
    executeAction({ connectionId: "outline", actionId: "delete-document", input: {} }),
    (err) => err instanceof AppError && err.status === 400 && err.message === "invalid-input",
  );
});

test("registerOutlineActions registers list-documents (read), create-document (write), delete-document (destructive)", () => {
  const registry = createActionRegistry();
  registerOutlineActions({ registry, request: async () => ({}) });
  const actions = registry.listActionsForType("outline");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["create-document", "delete-document", "list-documents"]);
  assert.equal(registry.getAction("outline", "list-documents").effect, "read");
  assert.equal(registry.getAction("outline", "create-document").effect, "write");
  assert.equal(registry.getAction("outline", "delete-document").effect, "destructive");
});
