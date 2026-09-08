const {
  CLOUD_BASE_URL,
  bitbucketRequest,
  resolveBitbucketRequestTarget,
  syncBitbucket,
} = require("./client");
const {
  buildHttpUrl,
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
} = connectorKeys("bitbucket");

function registerBitbucketRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    request = bitbucketRequest,
    sync = syncBitbucket,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    // Segunda+ conexión Bitbucket reutilizando este módulo bajo otro id — ver
    // server/connectors/loader.js (manifest "instantiable") y ADR-008/CONN-017.
    id = "bitbucket",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerBitbucketRoutes requires ${name}`);
  }

  const store = createConnectorStore({ id, kvGet, kvSet });
  const log = createConnectorLogger({
    id,
    write: connectorLog,
    getSecrets: () => [store.getConfig()?.token],
  });

  app.get(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    return res.json(store.getPublicConfig(["token"]));
  });

  app.post(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const { type, baseUrl, username, workspace, token } = req.body || {};
    if (!token || !String(token).trim()) {
      log("err", "Config save failed: token is required");
      return res.status(400).json({ error: "token is required" });
    }
    const normalizedType = type === "server" ? "server" : "cloud";
    if (normalizedType === "server" && (!baseUrl || !String(baseUrl).trim())) {
      log("err", "Config save failed: baseUrl is required for Bitbucket Server");
      return res.status(400).json({ error: "baseUrl is required for Bitbucket Server" });
    }
    if (normalizedType === "cloud" && (!username || !String(username).trim())) {
      log("err", "Config save failed: username is required for Bitbucket Cloud");
      return res.status(400).json({ error: "username is required for Bitbucket Cloud" });
    }

    const normalizedBaseUrl = normalizedType === "server"
      ? String(baseUrl).trim().replace(/\/+$/, "")
      : CLOUD_BASE_URL;
    try {
      const target = resolveBitbucketRequestTarget(
        { type: normalizedType, baseUrl: normalizedBaseUrl },
        "",
      );
      buildHttpUrl(target.baseUrl, target.path);
    } catch {
      log("err", "Config save failed: baseUrl must be a valid HTTP(S) URL");
      return res.status(400).json({ error: "baseUrl must be a valid HTTP(S) URL" });
    }

    store.setConfig({
      type: normalizedType,
      baseUrl: normalizedBaseUrl,
      username: normalizedType === "cloud" ? String(username).trim() : null,
      workspace: normalizedType === "cloud" && workspace ? String(workspace).trim() || null : null,
      token: String(token).trim(),
    });
    log("ok", "Config saved");
    return res.json({ ok: true });
  });

  app.post(`/api/connectors/${id}/test`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ ok: false, error: "connector-not-configured" });
    const startedAt = now();
    try {
      const result = cfg.type === "server"
        ? await request(cfg, "/rest/api/1.0/application-properties")
        : cfg.workspace
          ? await request(cfg, `/repositories/${encodeURIComponent(cfg.workspace)}?pagelen=1`)
          : await request(cfg, "/user/permissions/repositories?pagelen=1");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const label = cfg.type === "server"
        ? (result?.displayName || "Bitbucket Server")
        : (result?.size != null ? `${result.size} repo(s) accesibles` : "Bitbucket Cloud");
      store.setStatus({
        status: "ok",
        latency,
        lastTest: isoNow(),
        lastError: null,
        user: label,
      });
      log("ok", `Test OK · ${label} · ${latency}`);
      return res.json({ ok: true, latency, user: label });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const rawMessage = [401, 403].includes(error.status)
        ? "Credenciales inválidas — revisa token, usuario y scopes"
        : error.message;
      const message = redactText(rawMessage, [cfg.token]);
      store.setStatus({
        status: "error",
        latency,
        lastTest: isoNow(),
        lastError: message,
      });
      log("err", `Test FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message, latency });
    }
  }));

  app.post(`/api/connectors/${id}/sync`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const startedAt = now();
    try {
      const { projects, deployments, commits } = await sync(cfg, { request });
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();
      const deploymentCount = deployments.length;
      const commitCount = commits.length;
      const total = projects.length + deploymentCount + commitCount;

      store.setData({ projects, deployments, commits, syncedAt });
      store.setStatus({
        status: "ok",
        latency,
        lastSync: syncedAt,
        lastError: null,
        itemsSynced: total,
      });
      log("ok", `Sync OK · ${projects.length} repos, ${commitCount} commits · ${latency}`);
      return res.json({
        ok: true,
        latency,
        syncedAt,
        projectCount: projects.length,
        deploymentCount,
        commitCount,
        total,
        projects,
        deployments: deployments.slice(0, 30),
        commits: commits.slice(0, 30),
      });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = redactText(error.message, [cfg.token]);
      store.setStatus({
        status: "error",
        latency,
        lastSync: isoNow(),
        lastError: message,
      });
      log("err", `Sync FAIL · ${message}`);
      return res.status(502).json({ error: message });
    }
  }));
}

module.exports = {
  CONFIG_KEY,
  DATA_KEY,
  STATUS_KEY,
  registerBitbucketRoutes,
};
