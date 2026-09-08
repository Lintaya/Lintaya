const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerVaultRoutes } = require("./vault");
const { request } = require("./test-http-harness");

function fakeVault(overrides = {}) {
  const secrets = new Map([["demo-1", "s3cr3t"]]);
  return {
    VAULT_MODE: "demo",
    VAULT_MASTER_PASSWORD: "dev-master",
    vaultSession: { unlocked: false, mode: null, bwSession: null, timeout: null },
    selectVaultSecret: { get: (id) => (secrets.has(id) ? { secret: secrets.get(id) } : undefined) },
    markVaultUnlocked(mode, bwSession = null) {
      this.vaultSession.unlocked = true;
      this.vaultSession.mode = mode;
      this.vaultSession.bwSession = bwSession;
    },
    armVaultTimer() {},
    async lockVaultSession() {
      this.vaultSession.unlocked = false;
      this.vaultSession.mode = null;
      this.vaultSession.bwSession = null;
    },
    async bw() { throw new Error("bw() not stubbed for this test"); },
    async syncBitwardenItems() { return 0; },
    getVaultMetadata() { return []; },
    ...overrides,
  };
}

function setup(vaultOverrides) {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditActivity = () => (req, res, next) => next();
  const log = { warn() {}, info() {} };
  const vault = fakeVault(vaultOverrides);

  const app = createApp({ token: "test-token" });
  registerVaultRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, vault, AppError, sendAppError, log });
  const headers = { authorization: "Bearer test-token" };
  return { app, headers, vault, kvGet };
}

test("GET /api/vault/status reflects the session and configured mode", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/vault/status", { headers });
  assert.deepEqual(res.json(), { unlocked: false, mode: "demo" });
});

test("POST /api/vault/get before unlock returns a 401 Problem Details with code VAULT_LOCKED", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/vault/get", { headers, body: { itemId: "demo-1" } });
  assert.equal(res.status, 401);
  const body = res.json();
  assert.equal(body.code, "VAULT_LOCKED");
  assert.equal(body.type, "urn:lintaya:problem:vault-locked");
});

test("POST /api/vault/unlock rejects a wrong master password in demo mode", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/vault/unlock", { headers, body: { masterPassword: "nope" } });
  assert.equal(res.status, 401);
  assert.equal(res.json().code, "WRONG_MASTER_PASSWORD");
});

test("POST /api/vault/unlock with no master password configured returns 503 VAULT_MASTER_PASSWORD_NOT_CONFIGURED", async () => {
  const { app, headers } = setup({ VAULT_MASTER_PASSWORD: "" });
  const res = await request(app, "POST", "/api/vault/unlock", { headers, body: { masterPassword: "anything" } });
  assert.equal(res.status, 503);
  assert.equal(res.json().code, "VAULT_MASTER_PASSWORD_NOT_CONFIGURED");
});

test("unlock then get returns the demo secret and marks it used", async () => {
  const { app, headers, kvGet } = setup();
  const unlocked = await request(app, "POST", "/api/vault/unlock", { headers, body: { masterPassword: "dev-master" } });
  assert.deepEqual(unlocked.json(), { ok: true, unlocked: true, mode: "demo" });

  const got = await request(app, "POST", "/api/vault/get", { headers, body: { itemId: "demo-1" } });
  assert.deepEqual(got.json(), { password: "s3cr3t" });
  assert.ok(kvGet("vault-last-used").value["demo-1"]);
});

test("get on an unknown item returns 404 NOT_FOUND", async () => {
  const { app, headers } = setup();
  await request(app, "POST", "/api/vault/unlock", { headers, body: { masterPassword: "dev-master" } });
  const res = await request(app, "POST", "/api/vault/get", { headers, body: { itemId: "missing" } });
  assert.equal(res.status, 404);
  assert.equal(res.json().code, "NOT_FOUND");
});

test("create is rejected outside Bitwarden mode with 400 BAD_REQUEST", async () => {
  const { app, headers } = setup();
  await request(app, "POST", "/api/vault/unlock", { headers, body: { masterPassword: "dev-master" } });
  const res = await request(app, "POST", "/api/vault/create", { headers, body: { service: "x" } });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});

test("Bitwarden unlock surfaces a missing CLI as 503 BW_CLI_NOT_INSTALLED", async () => {
  const { app, headers } = setup({
    VAULT_MODE: "bitwarden",
    async bw() { const e = new Error("spawn bw ENOENT"); throw e; },
  });
  const res = await request(app, "POST", "/api/vault/unlock", { headers, body: { masterPassword: "x" } });
  assert.equal(res.status, 503);
  assert.equal(res.json().code, "BW_CLI_NOT_INSTALLED");
});

test("POST /api/vault/lock always succeeds and locks the session", async () => {
  const { app, headers, vault } = setup();
  vault.vaultSession.unlocked = true;
  const res = await request(app, "POST", "/api/vault/lock", { headers });
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(vault.vaultSession.unlocked, false);
});
