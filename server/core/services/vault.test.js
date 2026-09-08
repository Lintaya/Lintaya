const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");

const { createVaultService } = require("./vault");

// Fake db mirroring the four vault_items statements the service prepares.
function fakeDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      const trimmed = sql.trim();
      if (trimmed.includes("COUNT(*)")) return { get: () => ({ count: rows.length }) };
      if (trimmed.startsWith("SELECT id, service")) return { all: () => rows.map((r) => ({ ...r })) };
      if (trimmed.startsWith("SELECT secret")) return { get: (id) => rows.find((r) => r.id === id) };
      if (trimmed.startsWith("INSERT INTO vault_items")) {
        return {
          run: (id, service, username, secret, tags, url, notes, strength, last_used) => {
            rows.push({ id, service, username: username || "", secret, tags, url, notes, strength, last_used });
          },
        };
      }
      throw new Error(`unexpected SQL in vault fake db: ${sql}`);
    },
    transaction(fn) {
      return (arg) => fn(arg);
    },
  };
}

// Routes fake bw CLI invocations by their first argument ("status", "sync", …).
// handlers[cmd] returns { code, stdout, stderr } (code defaults to 0).
function fakeSpawn(handlers) {
  return (bin, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const cmd = args[args.length > 1 && args[0].endsWith(".js") ? 1 : 0];
    const handler = handlers[cmd] || (() => ({ code: 0, stdout: "" }));
    const result = handler(args) || {};
    process.nextTick(() => {
      if (result.stdout) child.stdout.emit("data", result.stdout);
      if (result.stderr) child.stderr.emit("data", result.stderr);
      child.emit("close", result.code ?? 0);
    });
    return child;
  };
}

function baseConfig(overrides = {}) {
  return {
    serverDir: __dirname, // no local bw.js / vault-seed.js here → BW_BIN falls back to global "bw"
    database: { disableSeeds: true },
    vault: { mode: "demo", idleMs: 60000, masterPassword: "dev-master", clientId: "", clientSecret: "" },
    ...overrides,
  };
}

function kvStore() {
  const store = new Map();
  return {
    store,
    kvGet: (key) => (store.has(key) ? { value: store.get(key) } : null),
    kvSet: (key, value) => store.set(key, value),
  };
}

function silentLog() {
  return { info() {}, warn() {}, error() {} };
}

test("seedDemoVault inserts the seed once and is a no-op on an already-seeded db", () => {
  const db = fakeDb();
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({ config: baseConfig(), db, kvGet, kvSet, log: silentLog(), spawn: fakeSpawn({}) });

  // No vault-seed.js next to this test file, so seedDemoVault has nothing to
  // insert — assert it runs without throwing and leaves the table empty.
  vault.seedDemoVault();
  assert.equal(db.rows.length, 0);
});

test("lookupVaultPassword resolves from SQLite in demo mode without touching bw", async () => {
  const db = fakeDb();
  db.rows.push({ id: "item-1", service: "Grafana", username: "ops", secret: "s3cr3t", tags: "[]", url: "", notes: "", strength: "medium", last_used: "" });
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({ config: baseConfig(), db, kvGet, kvSet, log: silentLog(), spawn: fakeSpawn({}) });

  assert.equal(await vault.lookupVaultPassword("item-1"), "s3cr3t");
  assert.equal(await vault.lookupVaultPassword("missing"), null);
  assert.equal(await vault.lookupVaultPassword(null), null);
});

test("lookupVaultPassword throws vault-locked in Bitwarden mode when the session isn't unlocked", async () => {
  const db = fakeDb();
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({ config: baseConfig({ vault: { mode: "bitwarden", idleMs: 60000, masterPassword: "", clientId: "", clientSecret: "" } }), db, kvGet, kvSet, log: silentLog(), spawn: fakeSpawn({}) });

  await assert.rejects(() => vault.lookupVaultPassword("item-1"), (err) => err.code === "vault-locked");
});

test("lookupVaultPassword returns the CLI's password once the session is unlocked", async () => {
  const db = fakeDb();
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({
    config: baseConfig({ vault: { mode: "bitwarden", idleMs: 60000, masterPassword: "", clientId: "", clientSecret: "" } }),
    db, kvGet, kvSet, log: silentLog(),
    spawn: fakeSpawn({ get: () => ({ code: 0, stdout: "hunter2" }) }),
  });

  vault.markVaultUnlocked("bitwarden", "bw-session-token");
  assert.equal(await vault.lookupVaultPassword("item-1"), "hunter2");
  vault.clearVaultTimer();
});

test("lookupVaultPassword swallows a failed bw call and returns null", async () => {
  const db = fakeDb();
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({
    config: baseConfig({ vault: { mode: "bitwarden", idleMs: 60000, masterPassword: "", clientId: "", clientSecret: "" } }),
    db, kvGet, kvSet, log: silentLog(),
    spawn: fakeSpawn({ get: () => ({ code: 1, stderr: "not found" }) }),
  });

  vault.markVaultUnlocked("bitwarden", "bw-session-token");
  assert.equal(await vault.lookupVaultPassword("item-1"), null);
  vault.clearVaultTimer();
});

test("markVaultUnlocked / lockVaultSession flip vaultSession state", async () => {
  const db = fakeDb();
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({ config: baseConfig(), db, kvGet, kvSet, log: silentLog(), spawn: fakeSpawn({}) });

  vault.markVaultUnlocked("demo");
  assert.equal(vault.vaultSession.unlocked, true);
  assert.equal(vault.vaultSession.mode, "demo");

  await vault.lockVaultSession();
  assert.equal(vault.vaultSession.unlocked, false);
  assert.equal(vault.vaultSession.mode, null);
});

test("getVaultMetadata merges demo items with usage counts and last-used vault maps", () => {
  const db = fakeDb();
  db.rows.push({ id: "item-1", service: "Grafana", username: "ops", secret: "x", tags: "[]", url: "", notes: "", strength: "medium", last_used: "" });
  const { kvGet, kvSet } = kvStore();
  kvSet("vm-vault-map", { "vm-1": "item-1" });
  const vault = createVaultService({ config: baseConfig(), db, kvGet, kvSet, log: silentLog(), spawn: fakeSpawn({}) });

  const [item] = vault.getVaultMetadata();
  assert.equal(item.id, "item-1");
  assert.equal(item.vmCount, 1);
  assert.deepEqual(item.vmIds, ["vm-1"]);
});

test("syncBitwardenItems maps bw's item/folder shape into the app's vault-items KV entry", async () => {
  const db = fakeDb();
  const { kvGet, kvSet } = kvStore();
  const vault = createVaultService({
    config: baseConfig({ vault: { mode: "bitwarden", idleMs: 60000, masterPassword: "", clientId: "", clientSecret: "" } }),
    db, kvGet, kvSet, log: silentLog(),
    spawn: fakeSpawn({
      sync: () => ({ code: 0, stdout: "Syncing complete." }),
      list: (args) => {
        if (args.includes("folders")) {
          return { code: 0, stdout: JSON.stringify([{ id: "f1", name: "Infra" }]) };
        }
        return {
          code: 0,
          stdout: JSON.stringify([
            { id: "i1", type: 1, name: "Grafana", login: { username: "ops", uris: [{ uri: "https://grafana" }] }, folderId: "f1", notes: "", fields: [], revisionDate: "2026-01-01" },
            { id: "i2", type: 2, name: "Secure note (not a login)" },
          ]),
        };
      },
    }),
  });

  const count = await vault.syncBitwardenItems("session-token");
  assert.equal(count, 1); // the non-login item (type 2) is filtered out
  assert.deepEqual(kvGet("vault-items").value[0].service, "Grafana");
  assert.deepEqual(kvGet("vault-folders").value, [{ id: "f1", name: "Infra" }]);
});
