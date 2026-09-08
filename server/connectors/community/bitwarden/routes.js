const {
  buildStatusRecord,
  bwApiKeyLogin,
  bwHealthCheck,
  hasApiKey,
  readCliStatus,
  serverUrlOf,
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
  status: STATUS_KEY,
} = connectorKeys("bw");

const SECRET_FIELDS = ["clientSecret"];

// `runBw` and `readVaultItems` are injected rather than imported: the CLI runner
// and the vault session live in server.js and back the whole /api/vault module
// (70+ call sites), so this connector consumes them instead of owning them.
// Inverting that would make a core subsystem depend on a connector package.
function registerBitwardenRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    runBw,
    readVaultItems,
    binary,
    healthCheck = bwHealthCheck,
    apiKeyLogin = bwApiKeyLogin,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    // El contexto compartido entrega el logger del core, no una función
    // suelta (ADR-014 Fase 1 lo agregó para las rutas live de vCenter). Este
    // router es anterior y renombraba `log` a `info` esperando poder
    // llamarlo, así que cada sync moría en "info is not a function" antes de
    // reportar nada. Se aceptan las dos formas.
    // `contextLog` y no `log`: más abajo `log` ya es el registro de actividad
    // de esta conexión (createConnectorLogger), que es otra cosa.
    log: contextLog,
    warn = (message) => console.warn(message),
  } = options || {};
  const info = typeof contextLog === "function"
    ? contextLog
    : (message) => (typeof contextLog?.info === "function" ? contextLog.info(message) : console.log(message));

  for (const [name, dependency] of Object.entries({
    app, requireAuth, kvGet, kvSet, connectorLog, runBw, readVaultItems,
  })) {
    if (!dependency) throw new TypeError(`registerBitwardenRoutes requires ${name}`);
  }

  const store = createConnectorStore({ id: "bw", kvGet, kvSet });
  const log = createConnectorLogger({
    id: "bw",
    write: connectorLog,
    getSecrets: () => SECRET_FIELDS.map((field) => store.getConfig()?.[field]),
  });
  const safe = (cfg, message) => redactText(message, SECRET_FIELDS.map((field) => cfg?.[field]));

  app.get("/api/connectors/bw/config", requireAuth, (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.json({ configured: false });
    // The client secret is never returned — only whether a key pair exists.
    return res.json({
      configured: true,
      serverUrl: cfg.serverUrl || "",
      email: cfg.email || "",
      hasClientKey: hasApiKey(cfg),
    });
  });

  app.post("/api/connectors/bw/config", requireAuth, guardAsyncRoute(async (req, res) => {
    const { serverUrl, email, clientId, clientSecret } = req.body || {};
    if (!serverUrl) return res.status(400).json({ error: "missing-serverUrl" });

    const cfg = {
      serverUrl: String(serverUrl).replace(/\/+$/, ""),
      email: email || "",
      clientId: clientId || "",
      clientSecret: clientSecret || "",
    };
    store.setConfig(cfg);

    // Pointing the CLI at the server is best-effort: the configuration is worth
    // keeping even when the CLI is missing or the server is down.
    try {
      await runBw(["config", "server", cfg.serverUrl]);
      info(`[bw] server configured: ${cfg.serverUrl}`);
    } catch (error) {
      warn(`[bw] config server failed: ${safe(cfg, error.message)}`);
    }

    return res.json({ ok: true });
  }));

  app.post("/api/connectors/bw/test", requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    const serverUrl = serverUrlOf(cfg);
    const startedAt = now();

    const health = await healthCheck(serverUrl);
    const cliStatus = await readCliStatus(runBw, "error");
    const latency = `${Math.max(0, now() - startedAt)}ms`;
    // Server reachability decides the verdict: the CLI being locked or logged out
    // is a normal state, not a broken connector.
    const ok = health.ok;

    const record = buildStatusRecord({ ok, latency, health, cliStatus, serverUrl });
    record.lastTest = isoNow();
    record.lastSync = cliStatus?.lastSync || null;
    store.setStatus(record);
    log(ok ? "ok" : "err", `Test ${ok ? "OK" : "FAIL"} · CLI ${cliStatus?.status || "?"} · ${latency}`);

    const result = { ok, latency, serverHealth: health, bwStatus: cliStatus };
    return ok ? res.json(result) : res.status(502).json(result);
  }));

  app.post("/api/connectors/bw/sync", requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    const serverUrl = serverUrlOf(cfg);
    const startedAt = now();

    try {
      if (cfg?.serverUrl) {
        await runBw(["config", "server", cfg.serverUrl]).catch(() => {});
      }

      // Only log in when a key is configured AND the CLI has no session at all.
      if (hasApiKey(cfg)) {
        const current = await readCliStatus(runBw, "unauthenticated");
        if (current.status === "unauthenticated") {
          await apiKeyLogin(cfg, { binary });
          info("[bw] auto-login succeeded");
        }
      }

      const cliStatus = JSON.parse(await runBw(["status"]));
      // Item count comes from what the vault module cached when the user last
      // unlocked; this connector never needs the vault open itself.
      const items = readVaultItems();
      const itemCount = Array.isArray(items) ? items.length : 0;

      const health = await healthCheck(serverUrl);
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();

      const record = buildStatusRecord({
        ok: true, latency, health, cliStatus, serverUrl, itemCount,
      });
      record.lastSync = syncedAt;
      record.lastSyncBW = cliStatus.lastSync || null;
      store.setStatus(record);

      info(`[bw] sync: CLI status=${cliStatus.status}, items=${itemCount}, server=${health.ok ? "ok" : "unreachable"}`);
      log("ok", `Sync OK · CLI ${cliStatus.status} · ${itemCount} items · ${latency}`);
      return res.json({
        ok: true, latency, syncedAt,
        bwStatus: cliStatus.status,
        userEmail: cliStatus.userEmail || null,
        itemsSynced: itemCount,
        serverHealth: health.ok,
      });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = safe(cfg, error.message);
      store.setStatus({
        status: "error", lastSync: isoNow(), latency, itemsSynced: 0, lastError: message,
      });
      log("err", `Sync FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message });
    }
  }));
}

module.exports = {
  CONFIG_KEY,
  SECRET_FIELDS,
  STATUS_KEY,
  registerBitwardenRoutes,
};
