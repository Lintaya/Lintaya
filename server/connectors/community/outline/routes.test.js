const assert = require("node:assert/strict");
const test = require("node:test");

const { registerOutlineRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const createHarness = createRouteHarness(registerOutlineRoutes, {
  methods: ["get", "post", "patch"],
  mode: "envelope",
});

function configure(harness, apiKey = "outline-secret-value") {
  harness.values.set("connector-config-outline", {
    baseUrl: "https://outline.example.test",
    apiKey,
  });
}

test("configuration never returns the stored Outline API key", async () => {
  const harness = createHarness();
  configure(harness, "must-not-leak");

  const response = await harness.invoke("GET", "/api/connectors/outline/config");
  assert.deepEqual(response.body, {
    configured: true,
    baseUrl: "https://outline.example.test",
    hasKey: true,
  });
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
});

test("configuration validates and normalizes the Outline base URL", async () => {
  const harness = createHarness();
  const missing = await harness.invoke("POST", "/api/connectors/outline/config", {
    body: { baseUrl: "https://outline.example.test" },
  });
  assert.equal(missing.status, 400);

  const invalid = await harness.invoke("POST", "/api/connectors/outline/config", {
    body: { baseUrl: "file:///outline", apiKey: "test-key" },
  });
  assert.equal(invalid.status, 400);

  const saved = await harness.invoke("POST", "/api/connectors/outline/config", {
    body: { baseUrl: " https://outline.example.test/team/// ", apiKey: " test-key " },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(harness.values.get("connector-config-outline"), {
    baseUrl: "https://outline.example.test/team",
    apiKey: "test-key",
  });
});

test("connection test persists the existing Outline status contract", async () => {
  let currentTime = 1000;
  const harness = createHarness({
    request: async () => ({ data: { user: { name: "Ada" }, team: { name: "Lintaya" } } }),
    now: () => { currentTime += 25; return currentTime; },
    isoNow: () => "2026-08-16T12:00:00.000Z",
  });
  configure(harness);

  const response = await harness.invoke("POST", "/api/connectors/outline/test");
  assert.deepEqual(response.body, { ok: true, latency: "25ms", user: "Ada", team: "Lintaya" });
  assert.equal(harness.values.get("connector-status-outline").status, "ok");
  assert.equal(harness.logs[0].id, "outline");
});

test("Outline errors redact the API key from responses, status, and logs", async () => {
  const harness = createHarness({
    request: async () => { throw new Error("upstream echoed outline-secret-value"); },
  });
  configure(harness);

  const response = await harness.invoke("POST", "/api/connectors/outline/test");
  assert.equal(response.status, 502);
  assert.equal(response.body.error, "upstream echoed [REDACTED]");
  assert.equal(harness.values.get("connector-status-outline").lastError.includes("outline-secret-value"), false);
  assert.equal(harness.logs[0].message.includes("outline-secret-value"), false);
});

test("document detail keeps the public response shape", async () => {
  const harness = createHarness({
    request: async () => ({ data: {
      id: "doc-1", title: "Guide", text: "Text", collectionId: "coll-1", url: "/doc/guide",
      createdAt: "created", updatedAt: "updated", updatedBy: { name: "Editor" }, createdBy: { name: "Author" },
    } }),
  });
  configure(harness);

  const response = await harness.invoke("GET", "/api/connectors/outline/documents/:id", {
    params: { id: "doc-1" },
  });
  assert.equal(response.body.id, "doc-1");
  assert.equal(response.body.updatedBy, "Editor");
  assert.equal(response.body.createdBy, "Author");
});

test("document creation and update routes preserve their contracts", async () => {
  const calls = [];
  const harness = createHarness({
    request: async (baseUrl, apiKey, path, body) => {
      calls.push({ path, body });
      if (path === "/api/documents.create") return { data: { id: "doc-1", title: body.title, url: "/doc/1" } };
      if (path === "/api/documents.update") return { data: { id: body.id, title: body.title, updatedAt: "updated" } };
      return { success: true };
    },
  });
  configure(harness);

  const created = await harness.invoke("POST", "/api/connectors/outline/documents", {
    body: { collectionId: "coll-1", title: "New", text: "Body", parentDocumentId: "parent-1" },
  });
  assert.deepEqual(created.body, { ok: true, id: "doc-1", title: "New", url: "/doc/1" });
  assert.equal(calls[0].body.publish, true);
  assert.equal(calls[0].body.parentDocumentId, "parent-1");

  const emptyUpdate = await harness.invoke("PATCH", "/api/connectors/outline/documents/:id", {
    params: { id: "doc-1" }, body: {},
  });
  assert.equal(emptyUpdate.status, 400);

  const updated = await harness.invoke("PATCH", "/api/connectors/outline/documents/:id", {
    params: { id: "doc-1" }, body: { title: "Updated" },
  });
  assert.equal(updated.body.updatedAt, "updated");

});

test("legacy document trash delegates to the canonical destructive action and never calls Outline", async () => {
  let actionCall = null;
  const harness = createHarness({
    request: async () => { throw new Error("the provider must not be called"); },
    executeAction: async (input) => {
      actionCall = input;
      return { ok: false, pending: true, error: "pending-approval", approval: { id: "apr-1" } };
    },
  });
  configure(harness);

  const response = await harness.invoke("POST", "/api/connectors/outline/documents/:id/delete", {
    params: { id: "doc-1" },
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.pending, true);
  assert.deepEqual(actionCall, {
    connectionId: "outline",
    actionId: "delete-document",
    input: { id: "doc-1" },
    actor: undefined,
    requestId: undefined,
  });
});

test("legacy document trash fails closed when Approval Center is unavailable", async () => {
  const harness = createHarness();
  configure(harness);
  const response = await harness.invoke("POST", "/api/connectors/outline/documents/:id/delete", {
    params: { id: "doc-1" },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "approval-center-unavailable" });
});

test("legacy document trash still requires a configured connection before queuing approval", async () => {
  const harness = createHarness({ executeAction: async () => { throw new Error("must not execute"); } });
  const response = await harness.invoke("POST", "/api/connectors/outline/documents/:id/delete", {
    params: { id: "doc-1" },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "connector-not-configured" });
});

test("sync preserves the existing Outline response and KV contracts", async () => {
  let currentTime = 2000;
  const harness = createHarness({
    sync: async () => ({
      collections: [{ id: "coll-1", documentCount: 1 }],
      documents: [{ id: "doc-1" }],
    }),
    now: () => { currentTime += 40; return currentTime; },
    isoNow: () => "2026-08-16T12:10:00.000Z",
  });
  configure(harness);

  const response = await harness.invoke("POST", "/api/connectors/outline/sync");
  assert.equal(response.body.collectionCount, 1);
  assert.equal(response.body.documentCount, 1);
  assert.equal(response.body.total, 2);
  assert.equal(harness.values.get("connector-data-outline").syncedAt, "2026-08-16T12:10:00.000Z");
  assert.equal(harness.values.get("connector-status-outline").itemsSynced, 2);
});

test("Home block maps synced documents to the normalized shape with absolute URLs", async () => {
  const harness = createHarness();
  configure(harness);
  harness.values.set("connector-data-outline", {
    documents: [
      { id: "doc-1", title: "Runbook", url: "/doc/runbook-abc", updatedAt: "2026-08-01T10:00:00Z", updatedBy: "Ana" },
      { id: "doc-2", title: "", url: null, updatedAt: "2026-08-15T10:00:00Z", updatedBy: null },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const response = await harness.invoke("GET", "/api/connectors/outline/blocks/recent-docs");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    items: [
      {
        id: "doc-2",
        title: "Sin título",
        timestamp: "2026-08-15T10:00:00Z",
      },
      {
        id: "doc-1",
        title: "Runbook",
        subtitle: "Ana",
        timestamp: "2026-08-01T10:00:00Z",
        url: "https://outline.example.test/doc/runbook-abc",
      },
    ],
    updatedAt: "2026-08-16T12:10:00.000Z",
  });
});

test("Home block honors ?scope= (by collectionId) and ?limit=", async () => {
  const harness = createHarness();
  configure(harness);
  harness.values.set("connector-data-outline", {
    documents: [
      { id: "doc-1", title: "Runbook", collectionId: "col-a", url: "/doc/1", updatedAt: "2026-08-01T10:00:00Z" },
      { id: "doc-2", title: "Onboarding", collectionId: "col-a", url: "/doc/2", updatedAt: "2026-08-15T10:00:00Z" },
      { id: "doc-3", title: "Roadmap", collectionId: "col-b", url: "/doc/3", updatedAt: "2026-08-10T10:00:00Z" },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const scoped = await harness.invoke("GET", "/api/connectors/outline/blocks/recent-docs", { query: { scope: "col-a" } });
  assert.deepEqual(scoped.body.items.map((d) => d.id), ["doc-2", "doc-1"], "only col-a, newest first");

  const limited = await harness.invoke("GET", "/api/connectors/outline/blocks/recent-docs", { query: { limit: "1" } });
  assert.deepEqual(limited.body.items.map((d) => d.id), ["doc-2"]);
});

test("Home block requires Outline to be configured", async () => {
  const harness = createHarness();
  const response = await harness.invoke("GET", "/api/connectors/outline/blocks/recent-docs");
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "connector-not-configured");
});
