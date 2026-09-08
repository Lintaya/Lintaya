const assert = require("node:assert/strict");
const test = require("node:test");

const { registerPlaneRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const CFG = { baseUrl: "https://plane.test", apiKey: "plane-key", workspace: "acme" };

const createHarness = createRouteHarness(registerPlaneRoutes, {
  methods: ["get", "post", "patch", "delete"],
  mode: "envelope",
  setup: () => {
    const calls = [];
    return {
      defaults: {
        now: () => NOW,
        request: async (baseUrl, apiKey, path, method = "GET", body = null) => {
          calls.push({ path, method, body });
          return { id: "created-1", name: "Result", identifier: "RES" };
        },
        sync: async () => ({ projects: [], issues: [], members: [], currentUserId: null }),
      },
      extra: { calls },
    };
  },
});

test("configuration never returns the stored API key", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", { ...CFG, apiKey: "must-not-leak" });
  const response = await harness.invoke("GET", "/api/connectors/plane/config");
  assert.equal(response.body.hasApiKey, true);
  assert.equal(response.body.workspace, "acme");
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
});

test("configuration demands an API key and a workspace", async () => {
  const harness = createHarness();
  assert.equal((await harness.invoke("POST", "/api/connectors/plane/config", { body: { apiKey: "k" } })).status, 400);
  assert.equal((await harness.invoke("POST", "/api/connectors/plane/config", { body: { workspace: "w" } })).status, 400);
});

test("configuration normalizes the base URL and trims the workspace", async () => {
  const harness = createHarness();
  await harness.invoke("POST", "/api/connectors/plane/config", {
    body: { baseUrl: "https://plane.test/api/v1/", apiKey: "k", workspace: "  acme  " },
  });
  const stored = harness.values.get("connector-config-plane");
  assert.equal(stored.baseUrl, "https://plane.test", "the API prefix is stripped so paths cannot double up");
  assert.equal(stored.workspace, "acme");
});

test("test falls back to /users/me when the token cannot list projects", async () => {
  const seen = [];
  const harness = createHarness({
    request: async (baseUrl, apiKey, path) => {
      seen.push(path);
      if (path.endsWith("/projects/")) { const e = new Error("HTTP 403"); e.status = 403; throw e; }
      return { id: "me" };
    },
  });
  harness.values.set("connector-config-plane", CFG);

  const response = await harness.invoke("POST", "/api/connectors/plane/test");
  assert.equal(response.body.ok, true);
  assert.ok(seen.some((p) => p.endsWith("/users/me/")), "the fallback was attempted");
});

test("test surfaces a bad key as a token hint, and does not retry on other errors", async () => {
  const harness = createHarness({
    request: async () => { const e = new Error("HTTP 401"); e.status = 401; throw e; },
  });
  harness.values.set("connector-config-plane", CFG);
  const response = await harness.invoke("POST", "/api/connectors/plane/test");
  assert.equal(response.status, 502);
  assert.match(response.body.error, /Invalid API key/);

  const other = createHarness({
    request: async () => { const e = new Error("HTTP 500 boom"); e.status = 500; throw e; },
  });
  other.values.set("connector-config-plane", CFG);
  const bubbled = await other.invoke("POST", "/api/connectors/plane/test");
  assert.match(bubbled.body.error, /500/, "a server error is not masked as an auth problem");
});

test("sync persists the resolved viewer id back into config", async () => {
  const harness = createHarness({
    sync: async () => ({
      projects: [{ id: "p1" }],
      issues: [{ id: "i1" }, { id: "i2" }],
      members: [{ id: "u1" }],
      currentUserId: "me-1",
    }),
  });
  harness.values.set("connector-config-plane", CFG);

  const response = await harness.invoke("POST", "/api/connectors/plane/sync");
  assert.equal(response.body.total, 3);
  assert.equal(harness.values.get("connector-config-plane").userId, "me-1");
  assert.equal(harness.values.get("connector-status-plane").itemsSynced, 3);
  assert.match(harness.logs.at(-1).message, /1 projects, 2 issues/);
});

test("sync failures redact the API key", async () => {
  const harness = createHarness({
    sync: async () => { throw new Error("rejected token plane-key outright"); },
  });
  harness.values.set("connector-config-plane", CFG);
  const response = await harness.invoke("POST", "/api/connectors/plane/sync");
  assert.equal(response.status, 502);
  assert.equal(response.body.error.includes("plane-key"), false);
  assert.match(response.body.error, /\[REDACTED\]/);
});

test("closing an issue moves it to whichever state is in the completed group", async () => {
  const harness = createHarness({
    request: async (baseUrl, apiKey, path, method, body) => {
      if (path.endsWith("/states/")) {
        return { results: [{ id: "s1", name: "Backlog", group: "backlog" }, { id: "s9", name: "Shipped", group: "completed" }] };
      }
      assert.equal(method, "PATCH");
      assert.deepEqual(body, { state: "s9" }, "it patches to the completed state's id");
      return { id: "i1" };
    },
  });
  harness.values.set("connector-config-plane", CFG);

  const response = await harness.invoke("POST", "/api/connectors/plane/issues/:projectId/:issueId/close", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.body.state, "Shipped");
});

test("closing fails clearly when the project has no completed state", async () => {
  const harness = createHarness({
    request: async () => ({ results: [{ id: "s1", name: "Backlog", group: "backlog" }] }),
  });
  harness.values.set("connector-config-plane", CFG);
  const response = await harness.invoke("POST", "/api/connectors/plane/issues/:projectId/:issueId/close", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "no-completed-state-found");
});

test("starting an issue moves it to whichever state is in the started group", async () => {
  const harness = createHarness({
    request: async (baseUrl, apiKey, path, method, body) => {
      if (path.endsWith("/states/")) {
        return { results: [{ id: "s1", name: "Backlog", group: "backlog" }, { id: "s5", name: "In Progress", group: "started" }] };
      }
      assert.equal(method, "PATCH");
      assert.deepEqual(body, { state: "s5" }, "it patches to the started state's id");
      return { id: "i1" };
    },
  });
  harness.values.set("connector-config-plane", CFG);

  const response = await harness.invoke("POST", "/api/connectors/plane/issues/:projectId/:issueId/start", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.body.state, "In Progress");
});

test("starting fails clearly when the project has no started state", async () => {
  const harness = createHarness({
    request: async () => ({ results: [{ id: "s1", name: "Backlog", group: "backlog" }] }),
  });
  harness.values.set("connector-config-plane", CFG);
  const response = await harness.invoke("POST", "/api/connectors/plane/issues/:projectId/:issueId/start", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "no-started-state-found");
});

test("legacy issue deletion delegates to the canonical destructive action and never calls Plane", async () => {
  let actionCall = null;
  const harness = createHarness({
    executeAction: async (input) => {
      actionCall = input;
      return { ok: false, pending: true, error: "pending-approval", approval: { id: "apr-1" } };
    },
  });
  harness.values.set("connector-config-plane", CFG);

  const response = await harness.invoke("DELETE", "/api/connectors/plane/issues/:projectId/:issueId", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.pending, true);
  assert.deepEqual(actionCall, {
    connectionId: "plane",
    actionId: "delete-issue",
    input: { projectId: "p1", issueId: "i1" },
    actor: undefined,
    requestId: undefined,
  });
  assert.equal(harness.calls.length, 0, "the compatibility route must not call the provider directly");
});

test("legacy issue deletion fails closed when Approval Center is unavailable", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", CFG);
  const response = await harness.invoke("DELETE", "/api/connectors/plane/issues/:projectId/:issueId", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "approval-center-unavailable" });
});

test("legacy issue deletion still requires a configured connection before queuing approval", async () => {
  const harness = createHarness({ executeAction: async () => { throw new Error("must not execute"); } });
  const response = await harness.invoke("DELETE", "/api/connectors/plane/issues/:projectId/:issueId", {
    params: { projectId: "p1", issueId: "i1" },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "not-configured" });
});

test("creating a project upper-cases the identifier and defaults the network", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", CFG);
  await harness.invoke("POST", "/api/connectors/plane/projects", {
    body: { name: "Edge Sites", identifier: "esid" },
  });
  assert.deepEqual(harness.calls.at(-1).body, { name: "Edge Sites", identifier: "ESID", network: 2 });
});

test("editing a project passes the body straight through, unlike issues/modules it has no name translation", async () => {
  const harness = createHarness({
    request: async (baseUrl, apiKey, path, method, body) => {
      assert.equal(path, "/api/v1/workspaces/acme/projects/p1/");
      assert.equal(method, "PATCH");
      assert.deepEqual(body, { description: "Enova - ConfigGuard\n\nRepositorio: https://gitlab.internal/configguard/configguard" });
      return { id: "p1", name: "Enova ConfigGuard", description: body.description };
    },
  });
  harness.values.set("connector-config-plane", CFG);

  const response = await harness.invoke("PATCH", "/api/connectors/plane/projects/:projectId", {
    params: { projectId: "p1" },
    body: { description: "Enova - ConfigGuard\n\nRepositorio: https://gitlab.internal/configguard/configguard" },
  });
  assert.equal(response.body.ok, true);
  assert.equal(response.body.id, "p1");
  assert.match(response.body.description, /Repositorio: https:\/\/gitlab\.internal/);
});

test("write routes validate their required fields before calling Plane", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", CFG);
  const before = harness.calls.length;

  const cases = [
    ["POST", "/api/connectors/plane/projects", { body: { name: "x" } }, /identifier/],
    ["POST", "/api/connectors/plane/issues/:projectId", { body: {}, params: { projectId: "p" } }, /name-required/],
    ["POST", "/api/connectors/plane/projects/:projectId/members", { body: {}, params: { projectId: "p" } }, /memberId/],
    ["POST", "/api/connectors/plane/projects/:projectId/modules", { body: {}, params: { projectId: "p" } }, /name-required/],
    ["POST", "/api/connectors/plane/issues/:projectId/:issueId/comment", { body: {}, params: {} }, /comment-required/],
    ["PATCH", "/api/connectors/plane/issues/:projectId/:issueId", { body: {}, params: {} }, /no-fields/],
    ["PATCH", "/api/connectors/plane/projects/:projectId/modules/:moduleId", { body: {}, params: {} }, /no-fields/],
    ["PATCH", "/api/connectors/plane/projects/:projectId", { body: {}, params: {} }, /no-fields/],
    ["POST", "/api/connectors/plane/projects/:projectId/modules/:moduleId/issues", { body: { issueIds: [] }, params: {} }, /issueIds/],
  ];

  for (const [method, path, payload, pattern] of cases) {
    const response = await harness.invoke(method, path, payload);
    assert.equal(response.status, 400, `${method} ${path} should reject`);
    assert.match(response.body.error, pattern);
  }
  assert.equal(harness.calls.length, before, "no remote call was made for any invalid body");
});

test("every route refuses to act before the connector is configured", async () => {
  const harness = createHarness();
  const paths = [
    ["POST", "/api/connectors/plane/test"],
    ["POST", "/api/connectors/plane/sync"],
    ["GET", "/api/connectors/plane/probe"],
    ["GET", "/api/connectors/plane/issues/:projectId/:issueId"],
    ["POST", "/api/connectors/plane/projects"],
    ["PATCH", "/api/connectors/plane/issues/:projectId/:issueId"],
  ];
  for (const [method, path] of paths) {
    const response = await harness.invoke(method, path, { body: {}, params: {} });
    assert.equal(response.status, 400, `${method} ${path} should require config`);
  }
});

test("cached readers serve from stored data without touching the network", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", CFG);
  harness.values.set("connector-data-plane", {
    members: [{ id: "u1", name: "Ana" }],
    issues: [
      { id: "a", priority: "low", stateGroup: "started", assignees: ["me"], updatedAt: "2026-08-01" },
      { id: "b", priority: "urgent", stateGroup: "started", assignees: ["other"], updatedAt: "2026-08-02" },
    ],
    modules: [
      { id: "m1", name: "Gestores", projectId: "p1" },
      { id: "m2", name: "Otro módulo", projectId: "p2" },
    ],
    currentUserId: "me",
    syncedAt: "2026-08-16T00:00:00.000Z",
  });

  const members = await harness.invoke("GET", "/api/connectors/plane/members");
  assert.equal(members.body.members[0].name, "Ana");

  const issues = await harness.invoke("GET", "/api/connectors/plane/issues", { query: { mine: "true" } });
  assert.deepEqual(issues.body.issues.map((i) => i.id), ["a"]);
  assert.equal(issues.body.currentUserId, "me");

  const modules = await harness.invoke("GET", "/api/connectors/plane/modules");
  assert.equal(modules.body.modules.length, 2, "unfiltered returns every project's modules");

  const scoped = await harness.invoke("GET", "/api/connectors/plane/modules", { query: { project: "p1" } });
  assert.deepEqual(scoped.body.modules.map((m) => m.name), ["Gestores"], "?project scopes to that project only");

  assert.equal(harness.calls.length, 0, "cached reads make no remote calls");
});

test("the probe reports a failure as data instead of throwing", async () => {
  const harness = createHarness({
    request: async () => { const e = new Error("HTTP 404: missing"); e.status = 404; throw e; },
  });
  harness.values.set("connector-config-plane", CFG);
  const response = await harness.invoke("GET", "/api/connectors/plane/probe", { query: { path: "/api/v1/nope/" } });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.status, 404);
});

test("Home block lists my active issues with priority badges", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", CFG);
  harness.values.set("connector-data-plane", {
    currentUserId: "user-1",
    syncedAt: "2026-08-16T12:00:00.000Z",
    issues: [
      { id: "i1", title: "Urgente mía", priority: "urgent", stateGroup: "started", assignees: ["user-1"], identifier: "HQ-1", projectName: "HQ", createdAt: "2026-08-10T00:00:00Z" },
      { id: "i2", title: "De otra persona", priority: "high", stateGroup: "started", assignees: ["user-2"], identifier: "HQ-2", projectName: "HQ" },
      { id: "i3", title: "Completada mía", priority: "high", stateGroup: "completed", assignees: ["user-1"], identifier: "HQ-3", projectName: "HQ" },
    ],
  });

  const response = await harness.invoke("GET", "/api/connectors/plane/blocks/my-issues");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items, [
    {
      id: "i1",
      title: "Urgente mía",
      subtitle: "HQ-1 · HQ",
      timestamp: "2026-08-10T00:00:00Z",
      badge: { text: "urgent", color: "#dc2626" },
    },
  ]);
  assert.equal(response.body.updatedAt, "2026-08-16T12:00:00.000Z");
});

test("Home block honors ?scope= (by projectId) and ?limit=, still scoped to the viewer", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-plane", CFG);
  harness.values.set("connector-data-plane", {
    currentUserId: "user-1",
    issues: [
      { id: "i1", title: "p1 old", projectId: "p1", priority: "low", stateGroup: "started", assignees: ["user-1"], identifier: "A-1", projectName: "A", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" },
      { id: "i2", title: "p1 new", projectId: "p1", priority: "low", stateGroup: "started", assignees: ["user-1"], identifier: "A-2", projectName: "A", createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z" },
      { id: "i3", title: "p2 mine", projectId: "p2", priority: "low", stateGroup: "started", assignees: ["user-1"], identifier: "B-1", projectName: "B", createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z" },
      { id: "i4", title: "p1 someone else's", projectId: "p1", priority: "low", stateGroup: "started", assignees: ["user-2"], identifier: "A-3", projectName: "A" },
    ],
  });

  const scoped = await harness.invoke("GET", "/api/connectors/plane/blocks/my-issues", { query: { scope: "p1" } });
  assert.deepEqual(scoped.body.items.map((i) => i.id), ["i2", "i1"], "only p1, mine, newest first — i3 (p2) and i4 (not mine) excluded");

  const limited = await harness.invoke("GET", "/api/connectors/plane/blocks/my-issues", { query: { scope: "p1", limit: "1" } });
  assert.deepEqual(limited.body.items.map((i) => i.id), ["i2"]);
});
