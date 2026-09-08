const assert = require("node:assert/strict");
const test = require("node:test");

const { registerGitlabRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const createHarness = createRouteHarness(registerGitlabRoutes);
// Only the ?scope=/?limit= test needs query access — "value" mode (the rest of
// this file) hardcodes req.query to {}, so that one test uses its own envelope harness.
const createEnvelopeHarness = createRouteHarness(registerGitlabRoutes, { mode: "envelope" });

test("configuration never returns the stored GitLab token", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-gitlab", {
    baseUrl: "https://gitlab.example.test",
    token: "must-not-leak",
  });

  const response = await harness.invoke("GET", "/api/connectors/gitlab/config");
  assert.deepEqual(response.body, {
    configured: true,
    baseUrl: "https://gitlab.example.test",
    hasToken: true,
  });
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
});

test("configuration validates and normalizes the GitLab base URL", async () => {
  const harness = createHarness();
  const missing = await harness.invoke("POST", "/api/connectors/gitlab/config", {
    baseUrl: "https://gitlab.example.test",
  });
  assert.equal(missing.status, 400);

  const invalid = await harness.invoke("POST", "/api/connectors/gitlab/config", {
    baseUrl: "file:///tmp/gitlab",
    token: "test-token",
  });
  assert.equal(invalid.status, 400);

  const saved = await harness.invoke("POST", "/api/connectors/gitlab/config", {
    baseUrl: "https://gitlab.example.test///",
    token: " test-token ",
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(harness.values.get("connector-config-gitlab"), {
    baseUrl: "https://gitlab.example.test",
    token: "test-token",
  });
});

test("connection test persists GitLab status", async () => {
  let currentTime = 1000;
  const harness = createHarness({
    request: async () => ({ username: "lintaya-bot" }),
    now: () => { currentTime += 25; return currentTime; },
    isoNow: () => "2026-08-16T12:00:00.000Z",
  });
  harness.values.set("connector-config-gitlab", {
    baseUrl: "https://gitlab.example.test",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/gitlab/test");
  assert.deepEqual(response.body, { ok: true, latency: "25ms", user: "lintaya-bot" });
  assert.equal(harness.values.get("connector-status-gitlab").status, "ok");
  assert.equal(harness.logs[0].id, "gitlab");
});

test("GitLab errors redact tokens from responses, status, and logs", async () => {
  const harness = createHarness({
    request: async () => { throw new Error("service echoed test-token"); },
  });
  harness.values.set("connector-config-gitlab", {
    baseUrl: "https://gitlab.example.test",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/gitlab/test");
  assert.equal(response.status, 502);
  assert.equal(response.body.error, "service echoed [REDACTED]");
  assert.equal(
    harness.values.get("connector-status-gitlab").lastError,
    "service echoed [REDACTED]",
  );
  assert.equal(harness.logs[0].message.includes("test-token"), false);
});

test("sync preserves the existing GitLab response and KV contracts", async () => {
  let currentTime = 2000;
  const harness = createHarness({
    sync: async () => ({
      projects: [{ id: 42 }],
      deployments: [{ id: 10 }],
      commits: [{ id: "abcdef12" }],
    }),
    now: () => { currentTime += 40; return currentTime; },
    isoNow: () => "2026-08-16T12:10:00.000Z",
  });
  harness.values.set("connector-config-gitlab", {
    baseUrl: "https://gitlab.example.test",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/gitlab/sync");
  assert.equal(response.status, 200);
  assert.equal(response.body.projectCount, 1);
  assert.equal(response.body.deploymentCount, 1);
  assert.equal(response.body.commitCount, 1);
  assert.equal(response.body.total, 3);
  assert.equal(harness.values.get("connector-data-gitlab").syncedAt, "2026-08-16T12:10:00.000Z");
  assert.equal(harness.values.get("connector-status-gitlab").itemsSynced, 3);
});

test("Home block maps synced commits to the normalized shape, newest first", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-gitlab", {
    baseUrl: "https://gitlab.example.test",
    token: "test-token",
  });
  harness.values.set("connector-data-gitlab", {
    commits: [
      { id: "aaa111", title: "older fix", author: "dev", date: "2026-08-01T10:00:00Z", projectName: "hq", webUrl: "https://gitlab.example.test/hq/-/commit/aaa111" },
      { id: "bbb222", title: "newer feature", author: null, date: "2026-08-15T10:00:00Z", projectName: "hq", webUrl: "https://gitlab.example.test/hq/-/commit/bbb222" },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const response = await harness.invoke("GET", "/api/connectors/gitlab/blocks/recent-commits");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    items: [
      {
        id: "bbb222",
        title: "newer feature",
        subtitle: "bbb222 · — · hq",
        timestamp: "2026-08-15T10:00:00Z",
        url: "https://gitlab.example.test/hq/-/commit/bbb222",
      },
      {
        id: "aaa111",
        title: "older fix",
        subtitle: "aaa111 · dev · hq",
        timestamp: "2026-08-01T10:00:00Z",
        url: "https://gitlab.example.test/hq/-/commit/aaa111",
      },
    ],
    updatedAt: "2026-08-16T12:10:00.000Z",
  });
});

test("Home block honors ?scope= (by projectId) and ?limit=", async () => {
  const harness = createEnvelopeHarness();
  harness.values.set("connector-config-gitlab", {
    baseUrl: "https://gitlab.example.test",
    token: "test-token",
  });
  harness.values.set("connector-data-gitlab", {
    commits: [
      { id: "aaa111", title: "hq fix", date: "2026-08-01T10:00:00Z", projectId: 1, projectName: "hq" },
      { id: "bbb222", title: "hq feature", date: "2026-08-15T10:00:00Z", projectId: 1, projectName: "hq" },
      { id: "ccc333", title: "cli fix", date: "2026-08-10T10:00:00Z", projectId: 2, projectName: "cli" },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const scoped = await harness.invoke("GET", "/api/connectors/gitlab/blocks/recent-commits", { query: { scope: "1" } });
  assert.deepEqual(scoped.body.items.map(i => i.id), ["bbb222", "aaa111"], "only the scoped project's commits, still newest first");

  const limited = await harness.invoke("GET", "/api/connectors/gitlab/blocks/recent-commits", { query: { limit: "1" } });
  assert.deepEqual(limited.body.items.map(i => i.id), ["bbb222"]);
});

test("Home block requires GitLab to be configured", async () => {
  const harness = createHarness();
  const response = await harness.invoke("GET", "/api/connectors/gitlab/blocks/recent-commits");
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "connector-not-configured");
});
