const assert = require("node:assert/strict");
const test = require("node:test");

const { registerBitwardenRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const CFG = { serverUrl: "https://vault.test", email: "a@b.c", clientId: "CID", clientSecret: "CSECRET" };

const createHarness = createRouteHarness(registerBitwardenRoutes, {
  setup: () => {
    const bwCalls = [];
    return {
      defaults: {
        runBw: async (args) => { bwCalls.push(args); return '{"status":"unlocked","userEmail":"a@b.c"}'; },
        readVaultItems: () => [],
        healthCheck: async () => ({ ok: true, statusCode: 200 }),
        apiKeyLogin: async () => "logged in",
        now: () => NOW,
        log: () => {},
        warn: () => {},
      },
      extra: { bwCalls },
    };
  },
});

test("registration insists on the injected CLI runner and vault reader", () => {
  const base = {
    app: { get() {}, post() {} },
    requireAuth: () => {},
    kvGet: () => null,
    kvSet: () => {},
    connectorLog: () => {},
    runBw: async () => "{}",
    readVaultItems: () => [],
  };
  assert.throws(() => registerBitwardenRoutes({ ...base, runBw: undefined }), /requires runBw/);
  assert.throws(() => registerBitwardenRoutes({ ...base, readVaultItems: undefined }), /requires readVaultItems/);
});

test("configuration never returns the client secret", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-bw", { ...CFG, clientSecret: "must-not-leak" });
  const response = await harness.invoke("GET", "/api/connectors/bw/config");
  assert.equal(response.body.hasClientKey, true);
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
});

test("configuration requires a server URL and strips trailing slashes", async () => {
  const harness = createHarness();
  assert.equal((await harness.invoke("POST", "/api/connectors/bw/config", {})).status, 400);

  await harness.invoke("POST", "/api/connectors/bw/config", { serverUrl: "https://vault.test///" });
  assert.equal(harness.values.get("connector-config-bw").serverUrl, "https://vault.test");
  assert.deepEqual(harness.bwCalls.at(-1), ["config", "server", "https://vault.test"]);
});

test("configuration is saved even when the CLI cannot be pointed at the server", async () => {
  // The CLI may be missing or the server down; the config is still worth keeping.
  const harness = createHarness({
    runBw: async () => { throw new Error("bw: command not found"); },
  });
  const response = await harness.invoke("POST", "/api/connectors/bw/config", { serverUrl: "https://vault.test" });
  assert.equal(response.body.ok, true);
  assert.equal(harness.values.get("connector-config-bw").serverUrl, "https://vault.test");
});

test("a locked vault is not a failed connector", async () => {
  const harness = createHarness({
    runBw: async () => '{"status":"locked"}',
    healthCheck: async () => ({ ok: true, statusCode: 200 }),
  });
  harness.values.set("connector-config-bw", CFG);

  const response = await harness.invoke("POST", "/api/connectors/bw/test");
  assert.equal(response.status, 200, "server reachability decides the verdict");
  assert.equal(response.body.ok, true);
  assert.equal(harness.values.get("connector-status-bw").bwCliStatus, "locked");
});

test("an unreachable server fails the test even when the CLI answers", async () => {
  const harness = createHarness({
    healthCheck: async () => ({ ok: false, error: "ECONNREFUSED" }),
  });
  harness.values.set("connector-config-bw", CFG);

  const response = await harness.invoke("POST", "/api/connectors/bw/test");
  assert.equal(response.status, 502);
  assert.equal(harness.values.get("connector-status-bw").lastError, "ECONNREFUSED");
});

test("a broken CLI still produces a test verdict from server health", async () => {
  const harness = createHarness({
    runBw: async () => { throw new Error("bw missing"); },
  });
  harness.values.set("connector-config-bw", CFG);

  const response = await harness.invoke("POST", "/api/connectors/bw/test");
  assert.equal(response.body.ok, true, "the server is up, which is what the test measures");
  assert.equal(response.body.bwStatus.status, "error");
});

test("sync auto-logs in only when a key exists and there is no session", async () => {
  let logins = 0;
  const harness = createHarness({
    runBw: async () => '{"status":"unauthenticated"}',
    apiKeyLogin: async () => { logins += 1; return "ok"; },
  });
  harness.values.set("connector-config-bw", CFG);

  await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(logins, 1);
});

test("sync does not log in again when the CLI already has a session", async () => {
  let logins = 0;
  const harness = createHarness({
    runBw: async () => '{"status":"locked"}',
    apiKeyLogin: async () => { logins += 1; return "ok"; },
  });
  harness.values.set("connector-config-bw", CFG);

  await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(logins, 0, "a locked vault already has a session — logging in again would be wrong");
});

test("sync never attempts a login without an API key", async () => {
  let logins = 0;
  const harness = createHarness({
    runBw: async () => '{"status":"unauthenticated"}',
    apiKeyLogin: async () => { logins += 1; return "ok"; },
  });
  harness.values.set("connector-config-bw", { serverUrl: "https://vault.test" });

  await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(logins, 0);
});

test("the item count comes from the vault module's cache", async () => {
  const harness = createHarness({
    readVaultItems: () => [{ id: "1" }, { id: "2" }, { id: "3" }],
  });
  harness.values.set("connector-config-bw", CFG);

  const response = await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(response.body.itemsSynced, 3);
  assert.equal(harness.values.get("connector-status-bw").itemsSynced, 3);
});

test("a sync survives the shared context handing over a logger object", async () => {
  // Same defect vCenter had: the context carries core's logger, not a bare
  // function, and this router took it as one — so every real sync threw
  // "info is not a function". The harness passing a function is why no test
  // caught it, so this one passes the shape production passes.
  const lines = [];
  const harness = createHarness({
    log: { info: (message) => lines.push(message), warn: () => {} },
    readVaultItems: () => [{ id: "1" }, { id: "2" }],
  });
  harness.values.set("connector-config-bw", CFG);

  const response = await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(response.body.itemsSynced, 2, "the sync completed instead of throwing");
  assert.ok(lines.length > 0, "and it reported through the object logger");
});

test("a never-unlocked vault reports zero items rather than failing", async () => {
  const harness = createHarness({ readVaultItems: () => null });
  harness.values.set("connector-config-bw", CFG);
  const response = await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(response.body.itemsSynced, 0);
});

test("sync failures redact the client secret", async () => {
  const harness = createHarness({
    runBw: async () => { throw new Error("rejected CSECRET as invalid"); },
  });
  harness.values.set("connector-config-bw", CFG);

  const response = await harness.invoke("POST", "/api/connectors/bw/sync");
  assert.equal(response.status, 502);
  assert.equal(response.body.error.includes("CSECRET"), false);
  assert.equal(harness.values.get("connector-status-bw").lastError.includes("CSECRET"), false);
  assert.equal(harness.logs.at(-1).message.includes("CSECRET"), false);
});

test("an unconfigured connector still tests against the default local server", async () => {
  const harness = createHarness();
  const response = await harness.invoke("POST", "/api/connectors/bw/test");
  assert.equal(response.body.ok, true);
  assert.equal(
    harness.values.get("connector-status-bw").serverUrl,
    "https://localhost:8443",
    "with no config and no serverUrl from the CLI, the local default is recorded",
  );
});
