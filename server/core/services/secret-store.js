const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function secretKeyFor(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id || "")) {
    throw new TypeError("connector id must use lowercase letters, numbers, and hyphens");
  }
  return `connector-secrets-${id}`;
}

function deriveKey(value) {
  if (typeof value !== "string" || value.length < 16) {
    throw new TypeError("local secret store requires a key of at least 16 characters");
  }
  return crypto.scryptSync(value, "lintaya-connector-secrets-v1", 32);
}

function createLocalSecretStore({ kvGet, kvSet, key }) {
  const encryptionKey = deriveKey(key);

  function read(id) {
    const record = kvGet(secretKeyFor(id))?.value;
    if (!record) return {};
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        encryptionKey,
        Buffer.from(record.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      const value = JSON.parse(plaintext);
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      throw new Error("connector secret payload could not be decrypted");
    }
  }

  function write(id, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value || {}), "utf8"),
      cipher.final(),
    ]);
    kvSet(secretKeyFor(id), {
      version: 1,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    });
  }

  return Object.freeze({
    mode: "local",
    get: read,
    set(id, value) { write(id, value); },
    clear(id) { kvSet(secretKeyFor(id), null); },
  });
}

function createLegacySecretStore() {
  return Object.freeze({
    mode: "legacy",
    get: () => ({}),
    set() {},
    clear() {},
  });
}

// One Bitwarden Secure Note per connection (`lintaya-connector-secrets-<id>`,
// notes = JSON-encoded secret fields) holds connector secrets in the same
// vault the Passwords module already uses, via the same `bw` CLI the vault
// service wraps (see server/core/services/vault.js). This mode is entirely
// opt-in (LINTAYA_SECRET_STORE=bitwarden) and never runs at boot — `get`/
// `set`/`clear` only touch the CLI when a connector's config is actually
// read or written, so a locked or absent vault never blocks server startup.
function bwItemName(id) {
  return `lintaya-connector-secrets-${id}`;
}

function detectBwBin() {
  // Same local-CLI-first resolution as vault.js's detectBwBin (kept
  // independent, not imported, so this module has no dependency on the
  // vault service — only on the `bw` binary it also wraps).
  const localJs = path.join(__dirname, "..", "..", "node_modules", "@bitwarden", "cli", "build", "bw.js");
  if (fs.existsSync(localJs)) return { bin: process.execPath, script: localJs };
  return { bin: "bw", script: null };
}

// Synchronous by design: createConnectorStore()'s getConfig()/setConfig()
// are called synchronously throughout the codebase (every connector's
// routes.js, plus the consumers migrated in this change), so the SecretStore
// contract (get/set/clear) must stay synchronous for every mode, including
// this one. `bw` itself only ever runs one command at a time here.
function defaultBwRunner() {
  const bwBin = detectBwBin();
  return function run(args, session) {
    const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    if (session) env.BW_SESSION = session;
    const spawnArgs = bwBin.script ? [bwBin.script, ...args] : args;
    const result = spawnSync(bwBin.bin, spawnArgs, { env, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || `bw exited with code ${result.status}`).trim());
    }
    return (result.stdout || "").trim();
  };
}

function vaultLockedError() {
  const error = new Error("bitwarden vault is locked");
  error.code = "vault-locked";
  return error;
}

function createBitwardenSecretStore(options = {}) {
  const { getSession } = options;
  if (typeof getSession !== "function") {
    throw new TypeError("bitwarden secret store requires a getSession() function");
  }
  const run = options.run || defaultBwRunner();

  function requireSession() {
    const session = getSession();
    if (!session) throw vaultLockedError();
    return session;
  }

  function findItemId(session, id) {
    const raw = run(["list", "items", "--search", bwItemName(id), "--nointeraction"], session);
    let items;
    try { items = JSON.parse(raw || "[]"); } catch { items = []; }
    const match = Array.isArray(items)
      ? items.find((item) => item?.name === bwItemName(id) && item?.type === 2)
      : null;
    return match ? match.id : null;
  }

  function read(id) {
    const session = requireSession();
    const itemId = findItemId(session, id);
    if (!itemId) return {};
    const raw = run(["get", "notes", itemId], session);
    if (!raw) return {};
    try {
      const value = JSON.parse(raw);
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      throw new Error("connector secret payload could not be parsed");
    }
  }

  function write(id, value) {
    const session = requireSession();
    const payload = JSON.stringify(value || {});
    const existingId = findItemId(session, id);
    if (existingId) {
      const raw = run(["get", "item", existingId], session);
      let item;
      try { item = JSON.parse(raw); } catch { item = null; }
      if (!item) item = { type: 2, name: bwItemName(id), secureNote: { type: 0 } };
      item.notes = payload;
      const encoded = Buffer.from(JSON.stringify(item), "utf8").toString("base64");
      run(["edit", "item", existingId, encoded], session);
      return;
    }
    const item = { type: 2, name: bwItemName(id), notes: payload, secureNote: { type: 0 } };
    const encoded = Buffer.from(JSON.stringify(item), "utf8").toString("base64");
    run(["create", "item", encoded], session);
  }

  function remove(id) {
    const session = requireSession();
    const existingId = findItemId(session, id);
    if (existingId) run(["delete", "item", existingId], session);
  }

  return Object.freeze({
    mode: "bitwarden",
    get: read,
    set(id, value) { write(id, value); },
    clear: remove,
  });
}

function createSecretStore(options = {}) {
  const mode = options.mode || "legacy";
  if (mode === "local") return createLocalSecretStore(options);
  if (mode === "bitwarden") return createBitwardenSecretStore(options);
  if (mode === "legacy") return createLegacySecretStore();
  throw new TypeError(`unsupported connector secret store mode: ${mode}`);
}

let defaultSecretStore = createLegacySecretStore();

function configureDefaultSecretStore(store) {
  if (!store || typeof store.get !== "function" || typeof store.set !== "function") {
    throw new TypeError("configureDefaultSecretStore requires a SecretStore");
  }
  defaultSecretStore = store;
}

function getDefaultSecretStore() {
  return defaultSecretStore;
}

module.exports = {
  createSecretStore,
  createBitwardenSecretStore,
  configureDefaultSecretStore,
  getDefaultSecretStore,
  secretKeyFor,
};
