const assert = require("node:assert/strict");
const test = require("node:test");

const { registerBitbucketRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const createHarness = createRouteHarness(registerBitbucketRoutes);

test("configuration never returns the stored Bitbucket token", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-bitbucket", {
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "lintaya",
    workspace: "lintaya",
    token: "must-not-leak",
  });

  const response = await harness.invoke("GET", "/api/connectors/bitbucket/config");
  assert.deepEqual(response.body, {
    configured: true,
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "lintaya",
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
    username: " lintaya ",
    workspace: " team ",
    token: " test-token ",
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(harness.values.get("connector-config-bitbucket"), {
    type: "cloud",
    baseUrl: "https://api.bitbucket.org/2.0",
    username: "lintaya",
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
    user: "3 repo(s) accesibles",
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
