const {
  DEFAULT_BASE_URL,
  buildGithubUrl,
  createGithubRepository,
  githubRequest,
  syncGithub,
} = require("./client");
const {
  connectorKeys,
  createConnectorLogger,
  createConnectorStore,
  guardAsyncRoute,
  redactText,
  registerBlockRoute,
} = require("../../sdk");

// Color por estado para el badge de "recent-deployments" — mismo criterio que
// normalizeGithubRunStatus (client.js) pero acá basta un mapeo plano, GitHub
// devuelve el estado del deployment como string libre (state/environment).
const DEPLOYMENT_STATUS_COLOR = {
  success: "#16a34a",
  failure: "#dc2626",
  error: "#dc2626",
  in_progress: "#ca8a04",
  pending: "#ca8a04",
  queued: "#ca8a04",
};

const {
  config: CONFIG_KEY,
  data: DATA_KEY,
  status: STATUS_KEY,
} = connectorKeys("github");

function registerGithubRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    request = githubRequest,
    sync = syncGithub,
    createRepository = createGithubRepository,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    // Segunda+ conexión GitHub reutilizando este módulo bajo otro id — ver
    // server/connectors/loader.js (manifest "instantiable") y ADR-008/CONN-017.
    id = "github",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerGithubRoutes requires ${name}`);
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
    if (!token || !String(token).trim()) {
      log("err", "Config save failed: token is required");
      return res.status(400).json({ error: "token is required" });
    }
    const normalizedBaseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    try {
      buildGithubUrl(normalizedBaseUrl, "");
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
      const user = await request(cfg.baseUrl, cfg.token, "/user");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const status = {
        status: "ok",
        latency,
        lastTest: isoNow(),
        lastError: null,
        user: user?.login || null,
      };
      store.setStatus(status);
      log("ok", `Test OK · usuario "${user?.login}" · ${latency}`);
      return res.json({ ok: true, latency, user: user?.login || null });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const rawMessage = error.status === 401
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
      const { projects, deployments, commits, pullRequests, issues, stargazers } = await sync(cfg, { request });
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();
      const deploymentCount = deployments.length;
      const commitCount = commits.length;
      const total = projects.length + deploymentCount + commitCount;

      store.setData({ projects, deployments, commits, pullRequests: pullRequests || [], issues: issues || [], stargazers: stargazers || [], syncedAt });
      store.setStatus({
        status: "ok",
        latency,
        lastSync: syncedAt,
        lastError: null,
        itemsSynced: total,
      });
      log(
        "ok",
        `Sync OK · ${projects.length} repos, ${deploymentCount} deployments, ${commitCount} commits · ${latency}`,
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

  // Crear un repositorio en la cuenta (o la organización) del token. No toca el
  // estado del conector: crear un repo no dice nada sobre la salud de la
  // conexión, y sobreescribir el status haría que un 422 por nombre repetido se
  // vea como un conector caído.
  app.post(`/api/connectors/${id}/repositories`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });

    const { name, description, org, autoInit } = req.body || {};
    if (!name || !String(name).trim()) {
      log("err", "Create repository failed: name is required");
      return res.status(400).json({ error: "name is required" });
    }
    // Visibilidad explícita a propósito. Si se dedujera de un campo ausente, la
    // primera llamada distraída publicaría un repositorio, y eso no se deshace:
    // para cuando alguien lo note ya pudo ser clonado, forkeado e indexado.
    if (typeof req.body?.private !== "boolean") {
      log("err", "Create repository failed: private must be true or false");
      return res.status(400).json({ error: "private must be a boolean — say so explicitly" });
    }

    const startedAt = now();
    try {
      const repository = await createRepository(
        cfg,
        { name, description, org, private: req.body.private, autoInit },
        { request },
      );
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      log(
        "ok",
        `Repositorio creado · ${repository.fullName || repository.name} · ${repository.private ? "privado" : "PÚBLICO"} · ${latency}`,
      );
      return res.status(201).json({ ok: true, latency, repository });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const rawMessage = error.status === 422
        ? "GitHub rechazó la creación — lo más común es que ese nombre ya exista en la cuenta"
        : error.status === 403
          ? "El token no tiene permiso para crear repositorios ahí (revisa el scope y el acceso a la organización)"
          : error.status === 401
            ? "Token inválido — revisa el Personal Access Token"
            : error.message;
      const message = redactText(rawMessage, [cfg.token]);
      log("err", `Create repository FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message, latency });
    }
  }));

  // Detalle de un commit, para el modal del block "recent-commits". El item de
  // un block solo lleva { id, title, subtitle, timestamp, url, badge }: no hay
  // donde meter el repositorio, y meterlo en el id cambiaria un shape que ya
  // esta publicado y fijado por tests. Asi que el sha se resuelve aqui, contra
  // los commits que el propio sync guardo, que ya saben de que repo son.
  // Quién le dio estrella a un repo, y cuándo. GitHub dejó de servir esta
  // lista sin autenticación, así que va con el token del conector. Solo para
  // repos ya sincronizados: esta ruta no es un proxy a cualquier repo ajeno.
  // La cabecera star+json es la que añade `starred_at`; sin ella GitHub
  // devuelve solo los usuarios.
  app.get(`/api/connectors/${id}/projects/:projectId/stargazers`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const projectId = String(req.params.projectId || "");
    const known = (store.getData()?.projects || []).find(project => project.id === projectId);
    if (!known) return res.status(404).json({ error: "project-not-synced" });

    const PER_PAGE = 100;
    const MAX_PAGES = 10;
    const stargazers = [];
    let truncated = false;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await request(cfg.baseUrl, cfg.token,
        `/repos/${projectId}/stargazers?per_page=${PER_PAGE}&page=${page}`, "GET", null,
        { Accept: "application/vnd.github.star+json" });
      const list = Array.isArray(batch) ? batch : [];
      stargazers.push(...list);
      if (list.length < PER_PAGE) break;
      if (page === MAX_PAGES) truncated = true;
    }
    const items = stargazers
      .map(entry => ({
        login: entry.user?.login || null,
        avatarUrl: entry.user?.avatar_url || null,
        url: entry.user?.html_url || null,
        starredAt: entry.starred_at || null,
      }))
      .filter(entry => entry.login)
      .sort((a, b) => Date.parse(b.starredAt || 0) - Date.parse(a.starredAt || 0));
    return res.json({ projectId, total: items.length, truncated, stargazers: items });
  }));

  app.get(`/api/connectors/${id}/commits/:sha`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const sha = String(req.params.sha || "");
    // El block guarda el sha corto y GitHub acepta tanto corto como completo,
    // asi que se comparan por prefijo en ambos sentidos.
    const known = (store.getData()?.commits || []).find(commit => {
      const stored = String(commit.id || "");
      return stored === sha || stored.startsWith(sha) || sha.startsWith(stored);
    });
    if (!known) return res.status(404).json({ error: "commit-not-synced" });

    const commit = await request(cfg.baseUrl, cfg.token, `/repos/${known.projectId}/commits/${sha}`);
    const message = commit.commit?.message || "";
    const corte = message.indexOf("\n");
    return res.json({
      sha: (commit.sha || sha).slice(0, 8),
      fullSha: commit.sha || null,
      title: corte < 0 ? message : message.slice(0, corte),
      // El cuerpo del mensaje es donde vive el "por que" de un commit, que es
      // justo lo que la fila del block no cabe a mostrar.
      body: corte < 0 ? "" : message.slice(corte + 1).trim(),
      author: commit.commit?.author?.name || null,
      authorLogin: commit.author?.login || null,
      authorAvatar: commit.author?.avatar_url || null,
      date: commit.commit?.author?.date || null,
      projectId: known.projectId,
      projectName: known.projectName,
      webUrl: commit.html_url || known.webUrl || null,
      verified: !!commit.commit?.verification?.verified,
      parents: (commit.parents || []).map(parent => String(parent.sha || "").slice(0, 8)).filter(Boolean),
      stats: {
        additions: commit.stats?.additions ?? null,
        deletions: commit.stats?.deletions ?? null,
      },
      files: (commit.files || []).map(file => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
    });
  }));

  // Home block "recent-commits" (declared in manifest.json) — mismo shape
  // que el equivalente de GitLab (routes.js), leyendo los commits que ya
  // guarda /sync más arriba en vez de pegarle a la API de nuevo.
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

  // Home block "recent-deployments" (declared in manifest.json) — deploys
  // recientes con su estado, para un dashboard de ops.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "recent-deployments",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const { scope, limit } = req?.query || {};
      let deployments = [...(data?.deployments || [])]
        .sort((a, b) => new Date(b.finishedAt || b.createdAt) - new Date(a.finishedAt || a.createdAt));
      if (scope) deployments = deployments.filter(d => String(d.projectId) === String(scope));
      deployments = deployments.slice(0, Number(limit) || 30);
      return {
        items: deployments.map(d => ({
          id: String(d.id),
          title: `${d.projectName} → ${d.environment}`,
          subtitle: `${d.status} · ${d.user || "—"} · ${d.sha || "—"}`,
          timestamp: d.finishedAt || d.createdAt,
          url: d.webUrl,
          badge: { text: d.status, color: DEPLOYMENT_STATUS_COLOR[d.status] || "#64748b" },
        })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });

  // Home block "open-pull-requests" (declared in manifest.json) — lo que está
  // esperando revisión. Al hacer click, Home abre su modal de detalle en vez
  // del enlace externo (ver blockItemHandlers en app/home.jsx), igual que hace
  // el block de documentos de Outline.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "open-pull-requests",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const { scope, limit } = req?.query || {};
      let pullRequests = [...(data?.pullRequests || [])]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      if (scope) pullRequests = pullRequests.filter(pr => String(pr.projectId) === String(scope));
      pullRequests = pullRequests.slice(0, Number(limit) || 30);
      return {
        items: pullRequests.map(pr => ({
          id: pr.id,
          title: pr.title,
          subtitle: `#${pr.number} · ${pr.author || "—"} · ${pr.projectName} · ${pr.sourceBranch} → ${pr.targetBranch}`,
          timestamp: pr.updatedAt,
          url: pr.webUrl,
          badge: pr.draft
            ? { text: "draft", color: "#64748b" }
            : { text: "open", color: "#16a34a" },
        })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });

  // Home block "open-issues" — lo que esta pedido y sin hacer. Al hacer click,
  // Home abre su modal de detalle igual que con los pull requests.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "open-issues",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const { scope, limit } = req?.query || {};
      let issues = [...(data?.issues || [])]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      if (scope) issues = issues.filter(issue => String(issue.projectId) === String(scope));
      issues = issues.slice(0, Number(limit) || 30);
      return {
        items: issues.map(issue => ({
          id: issue.id,
          title: issue.title,
          subtitle: `#${issue.number} · ${issue.author || "—"} · ${issue.projectName}${issue.labels?.length ? " · " + issue.labels.join(", ") : ""}`,
          timestamp: issue.updatedAt,
          url: issue.webUrl,
          ...(issue.comments > 0 ? { badge: { text: `${issue.comments} 💬`, color: "#64748b" } } : {}),
        })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });

  // Home block "repos-overview" (declared in manifest.json) — mis repos,
  // ordenados por última actividad.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "repos-overview",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const { limit } = req?.query || {};
      let projects = [...(data?.projects || [])]
        .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
      projects = projects.slice(0, Number(limit) || 30);
      return {
        items: projects.map(p => ({
          id: p.id,
          title: p.name,
          subtitle: [p.language, p.visibility, p.pipelineStatus ? `CI: ${p.pipelineStatus}` : null].filter(Boolean).join(" · "),
          timestamp: p.lastActivityAt,
          url: p.webUrl,
          ...(p.openMRs > 0 ? { badge: { text: `${p.openMRs} PR${p.openMRs === 1 ? "" : "s"}`, color: "#2563eb" } } : {}),
        })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });

  // Estrellas de tus repos públicos propios. Dos formas según el alcance:
  //   - Todos (sin ?scope=): una fila por repo con su ★ N, de más a menos.
  //     En Home, pulsar la fila abre quién le dio estrella (StargazersModal).
  //   - Un repo (?scope=owner/repo): una fila por persona, la más reciente
  //     primero, enlazando a su perfil.
  // Todo sale de lo que guardó el sync (el conteo viene en /user/repos y las
  // personas en collectStargazers, client.js), así que pintar el block no
  // llama a GitHub. Fuera los privados, donde solo da estrella quien ya tiene
  // acceso, y los forks, que son proyectos ajenos.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "stars",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const { scope, limit } = req?.query || {};
      const max = Number(limit) || 30;
      const projects = (data?.projects || [])
        .filter(p => p.visibility === "public" && !p.fork && Number.isFinite(p.stars));

      if (scope) {
        const project = projects.find(p => p.id === scope);
        const people = project
          ? (data?.stargazers || []).filter(s => s.projectId === scope)
          : [];
        return {
          items: [...people]
            .sort((a, b) => Date.parse(b.starredAt || 0) - Date.parse(a.starredAt || 0))
            .slice(0, max)
            .map(s => ({
              id: `${s.projectId}:${s.login}`,
              title: s.login,
              subtitle: `\u2605 ${s.projectName}`,
              timestamp: s.starredAt,
              url: s.url,
            })),
          updatedAt: data?.syncedAt || null,
          emptyMessage: project ? "Nadie le ha dado estrella todavía." : "Este repo no es público, o no es tuyo: aquí solo salen tus repos públicos.",
        };
      }

      return {
        items: [...projects]
          .sort((a, b) => (b.stars - a.stars) || String(a.name).localeCompare(String(b.name)))
          .slice(0, max)
          .map(p => ({
            id: p.id,
            title: p.name,
            subtitle: p.description || p.path,
            url: p.webUrl ? `${p.webUrl}/stargazers` : null,
            badge: { text: `\u2605 ${p.stars}`, color: "#b45309" },
          })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });
}

module.exports = {
  CONFIG_KEY,
  DATA_KEY,
  STATUS_KEY,
  registerGithubRoutes,
};
