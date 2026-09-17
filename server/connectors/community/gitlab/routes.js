const {
  buildGitlabUrl,
  gitlabRequest,
  syncGitlab,
} = require("./client");
const {
  connectorKeys,
  createConnectorLogger,
  createConnectorStore,
  guardAsyncRoute,
  redactText,
  registerBlockRoute,
} = require("../../sdk");

const {
  config: CONFIG_KEY,
  data: DATA_KEY,
  status: STATUS_KEY,
} = connectorKeys("gitlab");

function registerGitlabRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    request = gitlabRequest,
    sync = syncGitlab,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    // Permite registrar una segunda conexión GitLab bajo otro id reutilizando
    // este mismo módulo, en vez de duplicar el archivo (ver
    // server/connectors/community/gitlab2 y ADR-008/CONN-017 en
    // el roadmap interno). El resto de la función no conoce ni le
    // importa el id concreto.
    id = "gitlab",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerGitlabRoutes requires ${name}`);
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
    const { baseUrl, token } = req.body || {};
    if (!baseUrl || !String(baseUrl).trim() || !token || !String(token).trim()) {
      log("err", "Config save failed: baseUrl and token are required");
      return res.status(400).json({ error: "baseUrl and token are required" });
    }
    const normalizedBaseUrl = String(baseUrl).trim().replace(/\/+$/, "");
    try {
      buildGitlabUrl(normalizedBaseUrl, "");
    } catch {
      log("err", "Config save failed: baseUrl must be a valid HTTP(S) URL");
      return res.status(400).json({ error: "baseUrl must be a valid HTTP(S) URL" });
    }
    store.setConfig({
      baseUrl: normalizedBaseUrl,
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
      const user = await request(cfg.baseUrl, cfg.token, "/api/v4/user");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const status = {
        status: "ok",
        latency,
        lastTest: isoNow(),
        lastError: null,
        user: user?.username || null,
      };
      store.setStatus(status);
      log("ok", `Test OK · usuario "${user?.username}" · ${latency}`);
      return res.json({ ok: true, latency, user: user?.username || null });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const rawMessage = [401, 403].includes(error.status)
        ? "Token inválido — revisa el Personal Access Token"
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
      log(
        "ok",
        `Sync OK · ${projects.length} proyectos, ${deploymentCount} despliegues, ${commitCount} commits · ${latency}`,
      );
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

  // Home block "recent-commits" (declared in manifest.json): the synced
  // commits mapped to the normalized block shape.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "recent-commits",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const { scope, limit } = req?.query || {};
      let commits = [...(data?.commits || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
      if (scope) commits = commits.filter(c => String(c.projectId) === String(scope));
      commits = commits.slice(0, Number(limit) || 30);
      return {
        items: commits.map(c => ({
          id: c.id,
          title: c.title,
          subtitle: `${c.id} · ${c.author || "—"} · ${c.projectName}`,
          timestamp: c.date,
          url: c.webUrl,
        })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });

  // Los bloques leen la misma instantánea sincronizada para no disparar
  // consultas remotas al renderizar Home; scope filtra por proyecto local.
  const DEPLOYMENT_STATUS_COLOR = { success: "#16a34a", failure: "#dc2626", in_progress: "#ca8a04", pending: "#ca8a04" };
  const blockData = (req, field, sortValue, mapper, scoped = true) => {
    if (!store.getConfig()) return null;
    const data = store.getData(); const { scope, limit } = req?.query || {};
    let items = [...(data?.[field] || [])].sort((a, b) => new Date(sortValue(b) || 0) - new Date(sortValue(a) || 0));
    if (scoped && scope) items = items.filter(item => String(item.projectId) === String(scope));
    return { items: items.slice(0, Number(limit) || 30).map(mapper), updatedAt: data?.syncedAt || null };
  };
  registerBlockRoute({ app, requireAuth, id, blockId: "recent-deployments", getBlock: req => blockData(req, "deployments", d => d.finishedAt || d.createdAt, d => ({ id: String(d.id), title: `${d.projectName} → ${d.environment}`, subtitle: `${d.status}${d.user ? ` · ${d.user}` : ""}${d.sha ? ` · ${d.sha}` : ""}`, timestamp: d.finishedAt || d.createdAt, url: d.webUrl, badge: { text: d.status, color: DEPLOYMENT_STATUS_COLOR[d.status] || "#64748b" } })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "open-pull-requests", getBlock: req => blockData(req, "pullRequests", pr => pr.updatedAt, pr => ({ id: pr.id, title: pr.title, subtitle: `#${pr.number} · ${pr.author || "—"} · ${pr.projectName} · ${pr.sourceBranch} → ${pr.targetBranch}`, timestamp: pr.updatedAt, url: pr.webUrl, badge: pr.draft ? { text: "draft", color: "#64748b" } : { text: "open", color: "#16a34a" } })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "open-issues", getBlock: req => blockData(req, "issues", issue => issue.updatedAt, issue => ({ id: issue.id, title: issue.title, subtitle: `#${issue.number} · ${issue.author || "—"} · ${issue.projectName}${issue.labels?.length ? " · " + issue.labels.join(", ") : ""}`, timestamp: issue.updatedAt, url: issue.webUrl, ...(issue.comments > 0 ? { badge: { text: `${issue.comments} ðŸ’¬`, color: "#64748b" } } : {}) })) });
  registerBlockRoute({ app, requireAuth, id, blockId: "repos-overview", getBlock: req => blockData(req, "projects", p => p.lastActivityAt, p => ({ id: p.id, title: p.name, subtitle: [p.language, p.visibility, p.pipelineStatus ? `CI: ${p.pipelineStatus}` : null].filter(Boolean).join(" · "), timestamp: p.lastActivityAt, url: p.webUrl, ...(p.openMRs > 0 ? { badge: { text: `${p.openMRs} PR${p.openMRs === 1 ? "" : "s"}`, color: "#2563eb" } } : {}) }), false) });
}

module.exports = {
  CONFIG_KEY,
  DATA_KEY,
  STATUS_KEY,
  registerGitlabRoutes,
};
