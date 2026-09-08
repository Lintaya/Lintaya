const assert = require("node:assert/strict");
const test = require("node:test");

const { createConnectorLogger } = require("./connector-logger");
const { connectorKeys, createConnectorStore, getConnectorConfig } = require("./connector-store");
const { publicConnectorConfig, redactText } = require("./secrets");

test("connector store owns predictable config, data, and status keys", () => {
  const values = new Map();
  const store = createConnectorStore({
    id: "github",
    kvGet: (key) => values.has(key) ? { value: values.get(key) } : null,
    kvSet: (key, value) => values.set(key, value),
  });

  assert.deepEqual(connectorKeys("github"), {
    config: "connector-config-github",
    data: "connector-data-github",
    status: "connector-status-github",
  });
  assert.deepEqual(store.getPublicConfig(["token"]), { configured: false });

  store.setConfig({ baseUrl: "https://api.github.com", token: "secret-token" });
  store.setData({ projects: [] });
  store.setStatus({ status: "ok" });

  assert.deepEqual(store.getPublicConfig(["token"]), {
    configured: true,
    baseUrl: "https://api.github.com",
    hasToken: true,
  });
  assert.deepEqual(store.getData(), { projects: [] });
  assert.deepEqual(store.getStatus(), { status: "ok" });
});

test("public config and logger never expose declared secrets", () => {
  const config = publicConnectorConfig({
    username: "lintaya",
    token: "top-secret",
    clientSecret: "another-secret",
  }, { secretFields: ["token", "clientSecret"] });
  assert.deepEqual(config, {
    username: "lintaya",
    hasToken: true,
    hasClientSecret: true,
  });

  const entries = [];
  const log = createConnectorLogger({
    id: "github",
    write: (...entry) => entries.push(entry),
    getSecrets: () => ["top-secret"],
  });
  log("err", "GitHub rejected top-secret");
  log("ok", "Synced", { endpoints: ["/api/repos"] });

  assert.deepEqual(entries, [
    ["github", "err", "GitHub rejected [REDACTED]", undefined],
    ["github", "ok", "Synced", { endpoints: ["/api/repos"] }],
  ]);
  assert.equal(redactText("abc abc", ["abc"]), "[REDACTED] [REDACTED]");
});

test("connector store keeps secret fields out of KV in local mode", () => {
  const values = new Map();
  const secretValues = new Map();
  const secretStore = {
    mode: "local",
    get: (id) => secretValues.get(id) || {},
    set: (id, value) => secretValues.set(id, value),
    clear: (id) => secretValues.delete(id),
  };
  const store = createConnectorStore({
    id: "gitlab2",
    kvGet: (key) => values.has(key) ? { value: values.get(key) } : null,
    kvSet: (key, value) => values.set(key, value),
    secretStore,
    secretFields: ["token"],
  });

  store.setConfig({ baseUrl: "https://gitlab.example", token: "secret-token" });
  assert.deepEqual(values.get("connector-config-gitlab2"), { baseUrl: "https://gitlab.example" });
  assert.deepEqual(secretValues.get("gitlab2"), { token: "secret-token" });
  assert.deepEqual(store.getConfig(), { baseUrl: "https://gitlab.example", token: "secret-token" });
  assert.deepEqual(store.getPublicConfig(["token"]), {
    configured: true,
    baseUrl: "https://gitlab.example",
    hasToken: true,
  });
});

test("connector store migrates legacy plaintext secrets into the secret store on first read", () => {
  const values = new Map();
  // Simulates an installation that ran before SEC-004 and switched to local
  // mode: the secret field is still sitting in plaintext inside
  // connector-config-<id>, and the secret store starts out empty.
  values.set("connector-config-gitlab", { baseUrl: "https://gitlab.example", token: "legacy-plaintext" });
  const secretValues = new Map();
  const secretStore = {
    mode: "local",
    get: (id) => secretValues.get(id) || {},
    set: (id, value) => secretValues.set(id, value),
    clear: (id) => secretValues.delete(id),
  };
  const store = createConnectorStore({
    id: "gitlab",
    kvGet: (key) => values.has(key) ? { value: values.get(key) } : null,
    kvSet: (key, value) => values.set(key, value),
    secretStore,
    secretFields: ["token"],
  });

  // First read: still correct (merges the not-yet-migrated plaintext value)
  // and triggers the one-time move out of plaintext KV storage.
  assert.deepEqual(store.getConfig(), { baseUrl: "https://gitlab.example", token: "legacy-plaintext" });
  assert.deepEqual(values.get("connector-config-gitlab"), { baseUrl: "https://gitlab.example" });
  assert.deepEqual(secretValues.get("gitlab"), { token: "legacy-plaintext" });

  // Second read: now served entirely from the secret store, same value.
  assert.deepEqual(store.getConfig(), { baseUrl: "https://gitlab.example", token: "legacy-plaintext" });
});

test("getConnectorConfig() is equivalent to createConnectorStore(...).getConfig() for direct-reading consumers", () => {
  const values = new Map();
  values.set("connector-config-portainer", { baseUrl: "https://portainer.example" });
  const secretValues = new Map();
  secretValues.set("portainer", { apiKey: "ptr-secret" });
  const secretStore = {
    mode: "local",
    get: (id) => secretValues.get(id) || {},
    set: (id, value) => secretValues.set(id, value),
    clear: (id) => secretValues.delete(id),
  };
  const kvGet = (key) => values.has(key) ? { value: values.get(key) } : null;
  const kvSet = (key, value) => values.set(key, value);

  assert.deepEqual(
    getConnectorConfig("portainer", { kvGet, kvSet, secretStore, secretFields: ["apiKey"] }),
    { baseUrl: "https://portainer.example", apiKey: "ptr-secret" },
  );
  assert.equal(getConnectorConfig("unconfigured", { kvGet, kvSet }), null);
});
