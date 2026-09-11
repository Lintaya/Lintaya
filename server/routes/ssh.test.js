const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AppError, sendAppError } = require("../core/errors");
const { registerSshRoutes } = require("./ssh");

function setup({ lookupVaultPassword = async () => "secret", seed = {} } = {}) {
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers.at(-1)); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers.at(-1)); },
  };
  const httpServer = new EventEmitter();
  const clients = [];
  class FakeSSHClient extends EventEmitter {
    constructor() { super(); clients.push(this); }
    connect(options) { this.options = options; queueMicrotask(() => this.emit("ready")); }
    shell(_options, callback) {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.write = (value) => { stream.written = (stream.written || "") + value; };
      stream.end = () => { stream.ended = true; };
      stream.setWindow = () => {};
      this.stream = stream;
      callback(null, stream);
    }
    forwardOut(_sourceHost, _sourcePort, _targetHost, _targetPort, callback) {
      this.forwarded = { targetHost: _targetHost, targetPort: _targetPort };
      callback(null, new EventEmitter());
    }
    end() { this.ended = true; }
  }
  const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-ssh-"));
  registerSshRoutes({
    app, httpServer, requireAuth(_req, _res, next) { next(); },
    kvGet(key) { return Object.hasOwn(seed, key) ? { value: seed[key] } : null; }, log: { info() {} }, token: "test-token", serverDir,
    SSHClient: FakeSSHClient, lookupVaultPassword, AppError, sendAppError,
  });
  const invoke = (method, route, body = {}) => new Promise((resolve, reject) => {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler, `Missing ${method} ${route}`);
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    Promise.resolve(handler({ body, params: {} }, res)).catch(reject);
  });
  return { clients, httpServer, invoke, routes, serverDir };
}

test("SSH session validates an IP before opening a connection", async (t) => {
  const harness = setup();
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const result = await harness.invoke("POST", "/api/ssh/session");
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "BAD_REQUEST");
  assert.equal(result.body.detail, "ip required");
  assert.equal(harness.clients.length, 0);
});

test("SSH session opens an interactive terminal with the shared safe algorithms", async (t) => {
  const harness = setup();
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const result = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "ops", vaultItemId: "vault-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.status, 200);
  assert.equal(result.body.reattach, false);
  assert.equal(harness.clients.length, 1);
  assert.equal(harness.clients[0].options.host, "10.0.0.4");
  assert.equal(harness.clients[0].options.username, "ops");
  assert.ok(harness.clients[0].options.algorithms.kex.includes("diffie-hellman-group1-sha1"));
  assert.equal(harness.clients[0].stream.listenerCount("data"), 1);
  assert.equal(harness.httpServer.listenerCount("upgrade"), 1);
});

test("SSH log route registration keeps a traversal-safe filename endpoint", async (t) => {
  const harness = setup();
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const handler = harness.routes.get("GET /api/ssh/logs/:filename");
  const result = await new Promise((resolve) => {
    handler({ params: { filename: "../../outside.log" } }, {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    });
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.code, "NOT_FOUND");
});

test("a locked Vault fails before creating an SSH client", async (t) => {
  const error = Object.assign(new Error("vault-locked"), { code: "vault-locked" });
  const harness = setup({ lookupVaultPassword: async () => { throw error; } });
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const result = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", vaultItemId: "vault-1" });
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "UNAUTHORIZED");
  assert.equal(harness.clients.length, 0);
});

test("a VM vault mapping supplies credential, user, port and jump host", async (t) => {
  const requestedItems = [];
  const harness = setup({
    lookupVaultPassword: async (id) => { requestedItems.push(id); return `${id}-secret`; },
    seed: {
      "vm-vault-map": {
        "vm-1": {
          vaultItemId: "target-vault",
          sshUser: "operator",
          sshPort: 2222,
          jump: { host: "bastion.example.test", port: 2200, user: "jump-user", vaultItemId: "jump-vault" },
        },
      },
    },
  });
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const result = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", vmId: "vm-1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.status, 200);
  assert.deepEqual(requestedItems, ["target-vault", "jump-vault"]);
  assert.equal(harness.clients.length, 2);
  assert.equal(harness.clients[1].options.host, "bastion.example.test");
  assert.equal(harness.clients[1].options.username, "jump-user");
  assert.deepEqual(harness.clients[1].forwarded, { targetHost: "10.0.0.4", targetPort: 2222 });
  assert.equal(harness.clients[0].options.username, "operator");
  assert.equal(harness.clients[0].options.sock instanceof EventEmitter, true);
});

// Reattach used to be keyed on (ip, username) alone and ran before any
// credential was resolved, so a request carrying neither a password nor a
// vaultItemId — with the vault locked — was handed a shell somebody else had
// authenticated.
test("an uncredentialed request is never handed somebody else's live session", async (t) => {
  const harness = setup();
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const opened = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "root", vaultItemId: "vault-1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.body.reattach, false);

  const stolen = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "root" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stolen.body.reattach, false, "discovery must not reattach without a credential");
  assert.notEqual(stolen.body.sessionId, opened.body.sessionId);
});

test("a wrong credential does not reattach to a live session", async (t) => {
  const harness = setup({ lookupVaultPassword: async (id) => `${id}-secret` });
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const opened = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "root", vaultItemId: "vault-1" });
  await new Promise(resolve => setImmediate(resolve));

  const wrong = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "root", vaultItemId: "vault-2" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wrong.body.reattach, false);
  assert.notEqual(wrong.body.sessionId, opened.body.sessionId);
});

test("the same credential, or the session id itself, still reattaches", async (t) => {
  const harness = setup({ lookupVaultPassword: async (id) => `${id}-secret` });
  t.after(() => fs.rmSync(harness.serverDir, { recursive: true, force: true }));
  const opened = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "root", vaultItemId: "vault-1" });
  await new Promise(resolve => setImmediate(resolve));

  const byCredential = await harness.invoke("POST", "/api/ssh/session", { ip: "10.0.0.4", username: "root", vaultItemId: "vault-1" });
  assert.equal(byCredential.body.reattach, true);
  assert.equal(byCredential.body.sessionId, opened.body.sessionId);

  // Holding the id is the capability, so this path works with the vault locked.
  const locked = setup({ lookupVaultPassword: async () => { throw Object.assign(new Error("locked"), { code: "vault-locked" }); } });
  t.after(() => fs.rmSync(locked.serverDir, { recursive: true, force: true }));
  const direct = await locked.invoke("POST", "/api/ssh/session", { ip: "10.0.0.9", username: "root", password: "typed" });
  await new Promise(resolve => setImmediate(resolve));
  const byId = await locked.invoke("POST", "/api/ssh/session", { ip: "10.0.0.9", username: "root", sessionId: direct.body.sessionId });
  assert.equal(byId.body.reattach, true);
  assert.equal(byId.body.sessionId, direct.body.sessionId);
});
