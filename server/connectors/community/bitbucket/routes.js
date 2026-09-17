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
  registerBlockRoute,
  redactText,
} = require("../../sdk");

const {
  config: CONFIG_KEY,
  data: DATA_KEY,
  status: STATUS_KEY,
} = connectorKeys("bitbucket");

function bitbucketErrorDetails(error, cfg) {
  if (error.status === 401) return {
    code: "connectors.bitbucket.credentialsRejected", params: {},
    message: "Bitbucket connection test failed: credentials rejected; use the Atlassian account email and a Bitbucket-scoped API token.",
  };
  if (error.status === 403) {
    const scope = cfg.workspace ? "read:repository:bitbucket" : "read:workspace:bitbucket";
    return { code: "connectors.bitbucket.missingScope", params: { scope }, message: `Bitbucket connection test failed: credentials accepted but required scope is missing (${scope}).` };
  }
  if (error.status === 404 && cfg.workspace) return {
    code: "connectors.bitbucket.workspaceNotFound", params: { workspace: cfg.workspace },
    message: `Bitbucket connection test failed: workspace "${cfg.workspace}" was not found or is inaccessible.`,
  };
  return { code: null, params: {}, message: error.message };
}

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
    if (normalizedType === "cloud" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(username).trim())) {
      log("err", "Config save failed: Cloud username must be an Atlassian account email");
      return res.status(400).json({ error: "Cloud username must be an Atlassian account email", errorCode: "connectors.bitbucket.usernameEmailInvalid", errorParams: {} });
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
          : await request(cfg, "/user/workspaces?pagelen=1");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const label = cfg.type === "server"
        ? (result?.displayName || "Bitbucket Server")
        : (result?.size != null ? `${result.size} repositories accessible` : "Bitbucket Cloud");
      const userCode = result?.size != null ? "connectors.bitbucket.repositoriesAccessible" : null;
      const userParams = result?.size != null ? { count: result.size } : {};
      store.setStatus({
        status: "ok",
        latency,
        lastTest: isoNow(),
        lastError: null,
        user: label, userCode, userParams,
      });
      log("ok", `Test OK · ${label} · ${latency}`);
      return res.json({ ok: true, latency, user: label, userCode, userParams });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const details = bitbucketErrorDetails(error, cfg);
      const message = redactText(details.message, [cfg.token]);
      store.setStatus({
        status: "error",
        latency,
        lastTest: isoNow(),
        lastError: message,
        lastErrorCode: details.code,
        lastErrorParams: details.params,
      });
      log("err", `Test FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message, errorCode: details.code, errorParams: details.params, latency });
    }
  }));

  app.post(`/api/connectors/${id}/sync`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const startedAt = now();
    try {
      const { projects, deployments, commits, pullRequests, issues } = await sync(cfg, { request });
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();
      const deploymentCount = deployments.length;
      const commitCount = commits.length;
      const total = projects.length + deploymentCount + commitCount;

      store.setData({ projects, deployments, commits, pullRequests: pullRequests || [], issues: issues || [], syncedAt });
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
      const details = bitbucketErrorDetails(error, cfg);
      const message = redactText(details.message, [cfg.token]);
      store.setStatus({
        status: "error",
        latency,
        lastSync: isoNow(),
        lastError: message, lastErrorCode: details.code, lastErrorParams: details.params,
      });
      log("err", `Sync FAIL · ${message}`);
      return res.status(502).json({ error: message, errorCode: details.code, errorParams: details.params });
    }
  }));

  const blockData = (req, field, sortField, mapper, scoped = true) => {
    if (!store.getConfig()) return null;
    const data = store.getData(); const { scope, limit } = req?.query || {};
    const sortValue = item => field === "deployments" ? (item.finishedAt || item.createdAt) : item[sortField];
    let items = [...(data?.[field] || [])].sort((a, b) => new Date(sortValue(b) || 0) - new Date(sortValue(a) || 0));
    if (scoped && scope) items = items.filter(item => String(item.projectId) === String(scope));
    return { items: items.slice(0, Number(limit) || 30).map(mapper), updatedAt: data?.syncedAt || null };
  };
  registerBlockRoute({ app, requireAuth, id, blockId: "recent-commits", getBlock: req => blockData(req, "commits", "date", c => ({ id: c.id, title: c.title, subtitle: `${c.id} · ${c.author || "—"} · ${c.projectName}`, timestamp: c.date, url: c.webUrl })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "recent-deployments", getBlock: req => blockData(req, "deployments", "finishedAt", d => ({ id: String(d.id), title: `${d.projectName} → ${d.environment}`, subtitle: `${d.status}${d.user ? ` · ${d.user}` : ""}${d.sha ? ` · ${d.sha}` : ""}`, timestamp: d.finishedAt || d.createdAt, url: d.webUrl, badge: { text: d.status, color: ({ success: "#16a34a", failure: "#dc2626", error: "#dc2626", in_progress: "#ca8a04", pending: "#ca8a04", queued: "#ca8a04" })[d.status] || "#64748b" } })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "open-pull-requests", getBlock: req => blockData(req, "pullRequests", "updatedAt", pr => ({ id: pr.id, title: pr.title, subtitle: `#${pr.number} · ${pr.author || "—"} · ${pr.projectName} · ${pr.sourceBranch} → ${pr.targetBranch}`, timestamp: pr.updatedAt, url: pr.webUrl, badge: pr.draft ? { text: "draft", color: "#64748b" } : { text: "open", color: "#16a34a" } })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "open-issues", getBlock: req => blockData(req, "issues", "updatedAt", issue => ({ id: issue.id, title: issue.title, subtitle: `#${issue.number} · ${issue.author || "—"} · ${issue.projectName}${issue.labels?.length ? " · " + issue.labels.join(", ") : ""}`, timestamp: issue.updatedAt, url: issue.webUrl, ...(issue.comments > 0 ? { badge: { text: `${issue.comments} 💬`, color: "#64748b" } } : {}) })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "repos-overview", getBlock: req => blockData(req, "projects", "lastActivityAt", p => ({ id: p.id, title: p.name, subtitle: [p.language, p.visibility, p.pipelineStatus ? `CI: ${p.pipelineStatus}` : null].filter(Boolean).join(" · "), timestamp: p.lastActivityAt, url: p.webUrl, ...(p.openMRs > 0 ? { badge: { text: `${p.openMRs} PR${p.openMRs === 1 ? "" : "s"}`, color: "#2563eb" } } : {}) }), false) });
}

module.exports = {
  CONFIG_KEY,
  DATA_KEY,
  STATUS_KEY,
  registerBitbucketRoutes,
};
