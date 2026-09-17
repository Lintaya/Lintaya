const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { registerBitbucketRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const createHarness = createRouteHarness(registerBitbucketRoutes);
const createEnvelopeHarness = createRouteHarness(registerBitbucketRoutes, { mode: "envelope" });

test("Bitbucket Home blocks read normalized sync fields and honor scope/limit", async () => {
  const harness = createEnvelopeHarness();
  harness.values.set("connector-config-bitbucket", { type: "cloud", token: "secret" });
  harness.values.set("connector-data-bitbucket", {
    syncedAt: "2026-08-16T12:00:00Z",
    commits: [{ id: "c1", title: "fix", author: "dev", date: "2026-08-15T00:00:00Z", projectId: "team/r", projectName: "r", webUrl: "https://bb/c1" }],
    deployments: [{ id: "d1", projectId: "team/r", projectName: "r", environment: "prod", status: "success", sha: "c1", user: "dev", finishedAt: "2026-08-14T00:00:00Z", webUrl: "https://bb/d1" }],
    pullRequests: [{ id: "team/r!1", number: 1, title: "PR", author: "dev", projectId: "team/r", projectName: "r", sourceBranch: "feature", targetBranch: "main", updatedAt: "2026-08-13T00:00:00Z", webUrl: "https://bb/pr/1", draft: false }],
    issues: [{ id: "team/r#2", number: 2, title: "Issue", author: "dev", projectId: "team/r", projectName: "r", updatedAt: "2026-08-12T00:00:00Z", webUrl: "https://bb/i/2", comments: 2 }],
    projects: [{ id: "team/r", name: "r", language: "JS", visibility: "private", lastActivityAt: "2026-08-11T00:00:00Z", webUrl: "https://bb/r", openMRs: 1 }],
  });
  for (const blockId of ["recent-commits", "recent-deployments", "open-pull-requests", "open-issues", "repos-overview"]) {
    const response = await harness.invoke("GET", `/api/connectors/bitbucket/blocks/${blockId}`, { query: { scope: "team/r", limit: "1" } });
    assert.equal(response.status, 200, blockId);
    assert.equal(response.body.items.length, 1, blockId);
    assert.ok(response.body.items[0].id, blockId);
  }
});

test("recent-deployments sorts by finishedAt/createdAt and maps outcome badges", async () => {
  const harness = createEnvelopeHarness();
  harness.values.set("connector-config-bitbucket", { type: "cloud", token: "secret" });
  harness.values.set("connector-data-bitbucket", { syncedAt: "now", deployments: [
    { id: "old", projectName: "r", environment: "prod", status: "success", createdAt: "2026-04-01T00:00:00Z" },
    { id: "running", projectName: "r", environment: "prod", status: "in_progress", finishedAt: "2026-07-01T00:00:00Z" },
    { id: "failed", projectName: "r", environment: "prod", status: "failure", finishedAt: "2026-08-01T00:00:00Z" },
  ] });
  const response = await harness.invoke("GET", "/api/connectors/bitbucket/blocks/recent-deployments");
  assert.deepEqual(response.body.items.map(item => item.id), ["failed", "running", "old"]);
  assert.equal(response.body.items[0].badge.color, "#dc2626");
  assert.equal(response.body.items[1].badge.color, "#ca8a04");
});

test("Bitbucket Home blocks return connector-not-configured when absent", async () => {
  const harness = createHarness();
  for (const blockId of ["recent-commits", "recent-deployments", "open-pull-requests", "open-issues", "repos-overview"]) {
    const response = await harness.invoke("GET", `/api/connectors/bitbucket/blocks/${blockId}`);
    assert.equal(response.status, 400, blockId);
    assert.equal(response.body.error, "connector-not-configured", blockId);
  }
});

test("configuration never returns the stored Bitbucket token", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-bitbucket", {
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "user@example.com",
    workspace: "lintaya",
    token: "must-not-leak",
  });

  const response = await harness.invoke("GET", "/api/connectors/bitbucket/config");
  assert.deepEqual(response.body, {
    configured: true,
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "user@example.com",
    workspace: "lintaya",
    hasToken: true,
  });
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
});

test("configuration validates Cloud and Server requirements", async () => {
  const harness = createHarness();
  const cloudMissingUsername = await harness.invoke("POST", "/api/connectors/bitbucket/config", {
    type: "cloud",
    token: "test-token",
  });
  assert.equal(cloudMissingUsername.status, 400);

  const serverMissingUrl = await harness.invoke("POST", "/api/connectors/bitbucket/config", {
    type: "server",
    token: "test-token",
  });
  assert.equal(serverMissingUrl.status, 400);

  const invalidUrl = await harness.invoke("POST", "/api/connectors/bitbucket/config", {
    type: "server",
    baseUrl: "file:///tmp/bitbucket",
    token: "test-token",
  });
  assert.equal(invalidUrl.status, 400);

  const saved = await harness.invoke("POST", "/api/connectors/bitbucket/config", {
    type: "cloud",
    username: " user@example.com ",
    workspace: " team ",
    token: " test-token ",
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(harness.values.get("connector-config-bitbucket"), {
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "user@example.com",
    workspace: "team",
    token: "test-token",
  });
});

test("connection test uses the configured Cloud workspace and persists status", async () => {
  const paths = [];
  let currentTime = 1000;
  const harness = createHarness({
    request: async (cfg, path) => { paths.push(path); return { size: 3 }; },
    now: () => { currentTime += 25; return currentTime; },
    isoNow: () => "2026-08-16T12:00:00.000Z",
  });
  harness.values.set("connector-config-bitbucket", {
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "lintaya",
    workspace: "team",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/bitbucket/test");
  assert.equal(paths[0], "/repositories/team?pagelen=1");
  assert.deepEqual(response.body, {
    ok: true,
    latency: "25ms",
    user: "3 repositories accessible", userCode: "connectors.bitbucket.repositoriesAccessible", userParams: { count: 3 },
  });
  assert.equal(harness.values.get("connector-status-bitbucket").status, "ok");
  assert.equal(harness.logs[0].id, "bitbucket");
});

test("Bitbucket errors redact tokens from responses, status, and logs", async () => {
  const harness = createHarness({
    request: async () => { throw new Error("service echoed test-token"); },
  });
  harness.values.set("connector-config-bitbucket", {
    type: "server",
    baseUrl: "https://bitbucket.example.test",
    username: null,
    workspace: null,
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/bitbucket/test");
  assert.equal(response.status, 502);
  assert.equal(response.body.error, "service echoed [REDACTED]");
  assert.equal(
    harness.values.get("connector-status-bitbucket").lastError,
    "service echoed [REDACTED]",
  );
  assert.equal(harness.logs[0].message.includes("test-token"), false);
});

test("Bitbucket test returns localized error codes and parameters for 401, 403, and 404", async () => {
  for (const [status, expectedCode, expectedParams] of [
    [401, "connectors.bitbucket.credentialsRejected", {}],
    [403, "connectors.bitbucket.missingScope", { scope: "read:repository:bitbucket" }],
    [404, "connectors.bitbucket.workspaceNotFound", { workspace: "team" }],
  ]) {
    const secret = "secret-token";
    const harness = createHarness({ request: async () => { const error = new Error(`provider ${secret}`); error.status = status; throw error; } });
    harness.values.set("connector-config-bitbucket", { type: "cloud", baseUrl: "https://api.bitbucket.org/2.0", username: "user@example.com", workspace: "team", token: secret });
    const response = await harness.invoke("POST", "/api/connectors/bitbucket/test");
    assert.equal(response.body.errorCode, expectedCode);
    assert.deepEqual(response.body.errorParams, expectedParams);
    const stored = harness.values.get("connector-status-bitbucket");
    assert.equal(stored.lastErrorCode, expectedCode);
    assert.deepEqual(stored.lastErrorParams, expectedParams);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
    assert.equal(JSON.stringify(stored).includes(secret), false);
    assert.equal(JSON.stringify(harness.logs).includes(secret), false);
  }
});

test("Bitbucket sync persists coded 401 and 403 failures", async () => {
  for (const [status, code, params] of [[401, "connectors.bitbucket.credentialsRejected", {}], [403, "connectors.bitbucket.missingScope", { scope: "read:repository:bitbucket" }]]) {
    const harness = createHarness({ sync: async () => { const error = new Error("sync failure"); error.status = status; throw error; } });
    harness.values.set("connector-config-bitbucket", { type: "cloud", baseUrl: "https://api.bitbucket.org/2.0", username: "user@example.com", workspace: "team", token: "secret" });
    const response = await harness.invoke("POST", "/api/connectors/bitbucket/sync");
    assert.equal(response.body.errorCode, code);
    assert.deepEqual(response.body.errorParams, params);
    const stored = harness.values.get("connector-status-bitbucket");
    assert.equal(stored.lastErrorCode, code);
    assert.deepEqual(stored.lastErrorParams, params);
  }
});

test("Cloud config rejects a non-email username with a stable localized error code", async () => {
  const harness = createHarness();
  const response = await harness.invoke("POST", "/api/connectors/bitbucket/config", { type: "cloud", username: "bitbucket-user", token: "secret-token" });
  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, "connectors.bitbucket.usernameEmailInvalid");
  assert.deepEqual(response.body.errorParams, {});
  assert.equal(JSON.stringify(response.body).includes("secret-token"), false);
});

test("every Bitbucket error code has Spanish and English translations", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../../app/i18n.js"), "utf8");
  for (const key of ["connectors.bitbucket.credentialsRejected", "connectors.bitbucket.missingScope", "connectors.bitbucket.workspaceNotFound", "connectors.bitbucket.usernameEmailInvalid"]) {
    assert.ok((source.match(new RegExp(key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "g")) || []).length >= 2, key);
  }
});

test("sync preserves the existing Bitbucket response and KV contracts", async () => {
  let currentTime = 2000;
  const harness = createHarness({
    sync: async () => ({
      projects: [{ id: "team/example" }],
      deployments: [],
      commits: [{ id: "abcdef12" }],
    }),
    now: () => { currentTime += 40; return currentTime; },
    isoNow: () => "2026-08-16T12:10:00.000Z",
  });
  harness.values.set("connector-config-bitbucket", {
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "lintaya",
    workspace: "team",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/bitbucket/sync");
  assert.equal(response.status, 200);
  assert.equal(response.body.projectCount, 1);
  assert.equal(response.body.deploymentCount, 0);
  assert.equal(response.body.commitCount, 1);
  assert.equal(response.body.total, 2);
  assert.equal(harness.values.get("connector-data-bitbucket").syncedAt, "2026-08-16T12:10:00.000Z");
  assert.equal(harness.values.get("connector-status-bitbucket").itemsSynced, 2);
});
