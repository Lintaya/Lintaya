const { publicConnectorConfig } = require("./secrets");
const { getDefaultSecretStore } = require("./secret-store");

function connectorKeys(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id || "")) {
    throw new TypeError("connector id must use lowercase letters, numbers, and hyphens");
  }
  return {
    config: `connector-config-${id}`,
    data: `connector-data-${id}`,
    status: `connector-status-${id}`,
  };
}

function createConnectorStore(options = {}) {
  const { id, kvGet, kvSet } = options;
  if (typeof kvGet !== "function" || typeof kvSet !== "function") {
    throw new TypeError("createConnectorStore requires kvGet and kvSet");
  }
  const keys = connectorKeys(id);
  const secretStore = options.secretStore || getDefaultSecretStore();
  const secretFields = new Set(options.secretFields || secretStore.getSecretFields?.(id) || []);
  const read = (key) => kvGet(key)?.value ?? null;
  const write = (key, value) => kvSet(key, value);
  const readConfig = () => {
    const config = read(keys.config);
    if (!config) return null;
    if (!secretFields.size || secretStore.mode === "legacy") return config;
    const storedSecrets = secretStore.get(id);
    const legacySecrets = {};
    for (const field of secretFields) {
      if (!Object.prototype.hasOwnProperty.call(storedSecrets, field)
        && Object.prototype.hasOwnProperty.call(config, field)
        && config[field] !== undefined && config[field] !== null && config[field] !== "") {
        legacySecrets[field] = config[field];
      }
    }
    if (Object.keys(legacySecrets).length) {
      // One-time, lazy migration: the first connector access moves legacy
      // plaintext fields into the encrypted store without changing callers.
      writeConfig({ ...config, ...legacySecrets });
      return { ...config, ...storedSecrets, ...legacySecrets };
    }
    return { ...config, ...storedSecrets };
  };
  const writeConfig = (value) => {
    if (!value) {
      write(keys.config, null);
      if (secretFields.size && secretStore.mode !== "legacy") secretStore.clear(id);
      return;
    }
    if (!secretFields.size || secretStore.mode === "legacy") {
      write(keys.config, value);
      return;
    }
    const publicConfig = { ...value };
    const secretConfig = {};
    for (const field of secretFields) {
      if (Object.prototype.hasOwnProperty.call(publicConfig, field)) {
        if (publicConfig[field] !== undefined && publicConfig[field] !== null && publicConfig[field] !== "") {
          secretConfig[field] = publicConfig[field];
        }
        delete publicConfig[field];
      }
    }
    write(keys.config, publicConfig);
    if (Object.keys(secretConfig).length) secretStore.set(id, { ...secretStore.get(id), ...secretConfig });
  };

  return Object.freeze({
    id,
    keys,
    getConfig: readConfig,
    setConfig: writeConfig,
    getData: () => read(keys.data),
    setData: (value) => write(keys.data, value),
    getStatus: () => read(keys.status),
    setStatus: (value) => write(keys.status, value),
    getPublicConfig(secretFields = []) {
      const config = readConfig();
      if (!config) return { configured: false };
      return {
        configured: true,
        ...publicConnectorConfig(config, { secretFields }),
      };
    },
  });
}

// Shared helper for the many consumers that only ever need a read-only,
// secret-aware view of a connection's config (repos.js, live-vcenter.js,
// vcenter-diagnostics.js, containers.js, vault.js) — equivalent to
// `createConnectorStore({ id, kvGet, kvSet }).getConfig()` without every
// caller re-deriving that call. Uses the default secret store (and its
// schema-driven secret-field detection) unless one is passed explicitly.
function getConnectorConfig(id, options = {}) {
  return createConnectorStore({ id, ...options }).getConfig();
}

module.exports = { connectorKeys, createConnectorStore, getConnectorConfig };
