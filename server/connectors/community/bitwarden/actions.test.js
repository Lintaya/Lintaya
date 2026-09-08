const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerBitwardenActions } = require("./actions");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
  };
}

function setup({ seed = {}, runBw, readVaultItems, healthCheck, apiKeyLogin } = {}) {
  const registry = createActionRegistry();
  registerBitwardenActions({
    registry,
    runBw: runBw || (async () => '{"status":"unlocked"}'),
    readVaultItems: readVaultItems || (() => []),
    healthCheck,
    apiKeyLogin,
    now: () => 0,
    isoNow: () => "2026-08-25T00:00:00.000Z",
  });
  const { kvGet, kvSet } = makeKv(seed);
  const logs = [];
  const connectorLog = (id, level, msg, meta) => logs.push({ id, level, msg, meta });
  const resolveConnectorType = () => "bw";
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog, resolveConnectorType });
  return { executeAction, kvGet, kvSet, logs, registry };
}

test("bw.status works with no config at all (falls back to the public Bitwarden server)", async () => {
  const { executeAction } = setup({
    seed: {},
    runBw: async () => '{"status":"unlocked","userEmail":"a@b.c"}',
    healthCheck: async () => ({ ok: true, statusCode: 200 }),
  });
  const result = await executeAction({ connectionId: "bw", actionId: "status", input: {} });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "ok");
  assert.equal(result.result.serverHealth, true);
  assert.equal(result.result.bwCliStatus, "unlocked");
  assert.equal(result.result.userEmail, "a@b.c");
});

test("bw.status reports a locked CLI without failing the connector (server reachability decides ok)", async () => {
  const { executeAction } = setup({
    runBw: async () => '{"status":"locked"}',
    healthCheck: async () => ({ ok: true, statusCode: 200 }),
  });
  const result = await executeAction({ connectionId: "bw", actionId: "status", input: {} });
  assert.equal(result.result.status, "ok");
  assert.equal(result.result.bwCliStatus, "locked");
});

test("bw.status fails when the server itself is unreachable", async () => {
  const { executeAction } = setup({
    runBw: async () => { throw new Error("bw missing"); },
    healthCheck: async () => ({ ok: false, error: "ECONNREFUSED" }),
  });
  const result = await executeAction({ connectionId: "bw", actionId: "status", input: {} });
  assert.equal(result.result.status, "error");
  assert.equal(result.result.serverHealth, false);
});

test("bw.sync auto-logs in only when a key is configured and the CLI has no session", async () => {
  let logins = 0;
  let statusCalls = 0;
  const { executeAction } = setup({
    seed: { "connector-config-bw": { serverUrl: "https://vault.example", clientId: "id", clientSecret: "secret" } },
    runBw: async (args) => {
      if (args[0] === "status") {
        statusCalls += 1;
        return statusCalls === 1 ? '{"status":"unauthenticated"}' : '{"status":"unlocked","userEmail":"a@b.c"}';
      }
      return "";
    },
    apiKeyLogin: async () => { logins += 1; return "ok"; },
    healthCheck: async () => ({ ok: true, statusCode: 200 }),
    readVaultItems: () => [{ id: "1" }, { id: "2" }, { id: "3" }],
  });
  const result = await executeAction({ connectionId: "bw", actionId: "sync", input: {} });
  assert.equal(logins, 1);
  assert.deepEqual(result.result, {
    itemsSynced: 3,
    syncedAt: "2026-08-25T00:00:00.000Z",
    bwStatus: "unlocked",
    userEmail: "a@b.c",
    serverHealth: true,
  });
});

test("bw.sync does not auto-login when the CLI already has a session", async () => {
  let logins = 0;
  const { executeAction } = setup({
    seed: { "connector-config-bw": { clientId: "id", clientSecret: "secret" } },
    runBw: async (args) => (args[0] === "status" ? '{"status":"unlocked"}' : ""),
    apiKeyLogin: async () => { logins += 1; return "ok"; },
    healthCheck: async () => ({ ok: true, statusCode: 200 }),
  });
  await executeAction({ connectionId: "bw", actionId: "sync", input: {} });
  assert.equal(logins, 0);
});

test("bw.sync does not auto-login when no API key is configured", async () => {
  let logins = 0;
  const { executeAction } = setup({
    seed: {},
    runBw: async (args) => (args[0] === "status" ? '{"status":"unauthenticated"}' : ""),
    apiKeyLogin: async () => { logins += 1; return "ok"; },
    healthCheck: async () => ({ ok: true, statusCode: 200 }),
  });
  await executeAction({ connectionId: "bw", actionId: "sync", input: {} });
  assert.equal(logins, 0);
});

test("clientSecret never leaks into a thrown error from bw.sync", async () => {
  const { AppError } = require("../../../core/errors");
  const { configureDefaultSecretStore } = require("../../../core/services/secret-store");
  const LEGACY = { mode: "legacy", get: () => ({}), set() {}, clear() {} };
  const rows = new Map();
  configureDefaultSecretStore({
    mode: "local",
    get: (id) => rows.get(id) || {},
    set: (id, value) => rows.set(id, value),
    clear: (id) => rows.delete(id),
    getSecretFields: () => ["clientSecret"],
  });
  try {
    const { executeAction } = setup({
      seed: { "connector-config-bw": { clientId: "id", clientSecret: "super-secret-value" } },
      runBw: async () => { throw new Error("CLI rejected super-secret-value as invalid"); },
      healthCheck: async () => ({ ok: true, statusCode: 200 }),
    });
    await assert.rejects(
      executeAction({ connectionId: "bw", actionId: "sync", input: {} }),
      (err) => err instanceof AppError && !err.message.includes("super-secret-value"),
    );
  } finally {
    configureDefaultSecretStore(LEGACY);
  }
});

test("registerBitwardenActions requires runBw and readVaultItems", () => {
  const registry = createActionRegistry();
  assert.throws(() => registerBitwardenActions({ registry, readVaultItems: () => [] }), /requires runBw/);
  assert.throws(() => registerBitwardenActions({ registry, runBw: async () => "{}" }), /requires readVaultItems/);
});

test("registerBitwardenActions registers status and sync with requiresConfig: false on both", () => {
  const registry = createActionRegistry();
  registerBitwardenActions({ registry, runBw: async () => "{}", readVaultItems: () => [] });
  const actions = registry.listActionsForType("bw");
  assert.deepEqual(actions.map((a) => a.id).sort(), ["status", "sync"]);
  assert.ok(actions.every((a) => a.requiresConfig === false));
});
