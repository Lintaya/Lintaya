const {
  portainerFetch,
  portainerToken,
  syncPortainer,
} = require("./client");
const {
  connectorKeys,
  createConnectorLogger,
  createConnectorStore,
  guardAsyncRoute,
  redactText,
} = require("../../sdk");

const {
  config: CONFIG_KEY,
  data: DATA_KEY,
  status: STATUS_KEY,
} = connectorKeys("portainer");

const SECRET_FIELDS = ["apiKey", "password"];

function registerPortainerRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    fetch = portainerFetch,
    token = portainerToken,
    sync = syncPortainer,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    // Segunda+ conexión Portainer reutilizando este módulo bajo otro id — ver
    // server/connectors/loader.js (manifest "instantiable") y ADR-008/CONN-017.
    id = "portainer",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerPortainerRoutes requires ${name}`);
  }

  const store = createConnectorStore({ id, kvGet, kvSet });
  const log = createConnectorLogger({
    id,
    write: connectorLog,
    getSecrets: () => {
      const cfg = store.getConfig();
      return SECRET_FIELDS.map((field) => cfg?.[field]);
    },
  });

  const secretsOf = (cfg) => SECRET_FIELDS.map((field) => cfg?.[field]);

  app.get(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.json({ configured: false });
    return res.json({
      configured: true,
      baseUrl: cfg.baseUrl,
      auth: cfg.apiKey ? "apikey" : (cfg.username ? "userpass" : "none"),
      username: cfg.username || "",
      hasApiKey: !!cfg.apiKey,
    });
  });

  app.post(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const { baseUrl, apiKey, username, password } = req.body || {};
    if (!baseUrl) {
      log("err", "Config save failed: baseUrl is required");
      return res.status(400).json({ error: "baseUrl is required" });
    }
    if (!apiKey && !(username && password)) {
      log("err", "Config save failed: provide an API key or username+password");
      return res.status(400).json({ error: "provide an API key or username+password" });
    }
    store.setConfig({
      baseUrl: String(baseUrl).replace(/\/+$/, ""),
      apiKey: apiKey || "",
      username: username || "",
      password: password || "",
    });
    log("ok", "Config saved");
    return res.json({ ok: true });
  });

  app.post(`/api/connectors/${id}/test`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ ok: false, error: "connector-not-configured" });
    const startedAt = now();
    try {
      const authToken = await token(cfg);
      const endpoints = await fetch(cfg, "/api/endpoints", authToken);
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const count = Array.isArray(endpoints) ? endpoints.length : 0;
      store.setStatus({ status: "ok", latency, lastTest: isoNow(), lastError: null });
      log("ok", `Test OK · ${count} endpoints · ${latency}`);
      return res.json({ ok: true, latency, endpoints: count });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const rawMessage = [401, 403].includes(error.status)
        ? "Credenciales inválidas — revisa la API key o el usuario/contraseña"
        : error.message;
      const message = redactText(rawMessage, secretsOf(cfg));
      store.setStatus({ status: "error", latency, lastTest: isoNow(), lastError: message });
      log("err", `Test FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message, latency });
    }
  }));

  app.post(`/api/connectors/${id}/sync`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const startedAt = now();
    try {
      const { endpoints, total } = await sync(cfg, { fetch, token });
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();

      store.setData({ endpoints, syncedAt });
      store.setStatus({ status: "ok", latency, lastSync: syncedAt, lastError: null, itemsSynced: total });
      log("ok", `Sync OK · ${endpoints.length} endpoints, ${total} containers · ${latency}`);
      return res.json({ ok: true, latency, syncedAt, endpoints: endpoints.length, containers: total });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = redactText(error.message, secretsOf(cfg));
      store.setStatus({ status: "error", latency, lastSync: isoNow(), lastError: message });
      log("err", `Sync FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message, latency });
    }
  }));
}

module.exports = {
  CONFIG_KEY,
  DATA_KEY,
  SECRET_FIELDS,
  STATUS_KEY,
  registerPortainerRoutes,
};
