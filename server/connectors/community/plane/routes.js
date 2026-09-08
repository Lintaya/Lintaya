const {
  API_PREFIX,
  DEFAULT_BASE_URL,
  filterPlaneIssues,
  normalizePlaneBaseUrl,
  planeList,
  planeRequest,
  projectPath,
  syncPlane,
  workspacePath,
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
} = connectorKeys("plane");

function registerPlaneRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    request = planeRequest,
    sync = syncPlane,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    executeAction,
    sendAppError,
    // Segunda+ conexión Plane reutilizando este módulo bajo otro id — ver
    // server/connectors/loader.js (manifest "instantiable") y ADR-008/CONN-017.
    id = "plane",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerPlaneRoutes requires ${name}`);
  }

  const store = createConnectorStore({ id, kvGet, kvSet });
  const log = createConnectorLogger({
    id,
    write: connectorLog,
    getSecrets: () => [store.getConfig()?.apiKey],
  });

  const safe = (cfg, message) => redactText(message, [cfg?.apiKey]);

  // Every write route shares this preamble: resolve config or 400. `label`
  // identifies the action in Logs → Conectores; a failed call logs itself
  // here so handlers only have to log their own success.
  function withConfig(label, handler) {
    return guardAsyncRoute(async (req, res) => {
      const cfg = store.getConfig();
      if (!cfg) return res.status(400).json({ error: "not-configured" });
      try {
        return await handler(req, res, cfg, (path, method, body) =>
          request(cfg.baseUrl, cfg.apiKey, path, method, body));
      } catch (error) {
        const message = safe(cfg, error.message);
        log("err", `${label} falló: ${message}`);
        return res.status(502).json({ error: message });
      }
    });
  }

  app.get(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.json({ configured: false });
    return res.json({
      configured: true,
      baseUrl: cfg.baseUrl,
      workspace: cfg.workspace,
      hasApiKey: !!cfg.apiKey,
    });
  });

  app.post(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const { baseUrl, apiKey, workspace } = req.body || {};
    if (!apiKey || !workspace) {
      log("err", "Config save failed: apiKey and workspace are required");
      return res.status(400).json({ error: "apiKey and workspace are required" });
    }
    store.setConfig({
      baseUrl: normalizePlaneBaseUrl(baseUrl || DEFAULT_BASE_URL),
      apiKey,
      workspace: String(workspace).trim(),
    });
    log("ok", "Config saved");
    return res.json({ ok: true });
  });

  // Debug helper: hits a raw path so a misconfigured instance can be probed.
  app.get(`/api/connectors/${id}/probe`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "not-configured" });
    const apiPath = req.query.path || `${API_PREFIX}/workspaces/`;
    try {
      const data = await request(cfg.baseUrl, cfg.apiKey, apiPath);
      return res.json({ ok: true, path: apiPath, data });
    } catch (error) {
      return res.json({ ok: false, path: apiPath, status: error.status, error: safe(cfg, error.message) });
    }
  }));

  app.post(`/api/connectors/${id}/test`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ ok: false, error: "connector-not-configured" });
    const startedAt = now();
    try {
      try {
        await request(cfg.baseUrl, cfg.apiKey, workspacePath(cfg.workspace, "projects/"));
      } catch (error) {
        // Some instances scope the token away from /projects/ but still answer
        // /users/me/, which is enough to prove the key is valid.
        if (error.status !== 401 && error.status !== 403) throw error;
        await request(cfg.baseUrl, cfg.apiKey, `${API_PREFIX}/users/me/`);
      }
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      store.setStatus({
        status: "ok", latency, lastTest: isoNow(), lastError: null, workspace: cfg.workspace,
      });
      log("ok", `Test OK · workspace "${cfg.workspace}" · ${latency}`);
      return res.json({ ok: true, latency, workspace: cfg.workspace });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = safe(cfg, error.status === 401
        ? "Invalid API key — check your token in Plane Settings → API Tokens"
        : error.message);
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
      const { projects, issues, members, modules, currentUserId } = await sync(cfg, { request });
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();

      // Remember the viewer so "my issues" keeps working between syncs.
      if (currentUserId && currentUserId !== cfg.userId) {
        store.setConfig({ ...cfg, userId: currentUserId });
      }

      store.setData({ projects, issues, members, modules, syncedAt, currentUserId });
      store.setStatus({
        status: "ok", latency, lastSync: syncedAt, lastError: null,
        itemsSynced: projects.length + issues.length, workspace: cfg.workspace,
      });
      log("ok", `Sync OK · ${projects.length} projects, ${issues.length} issues · ${latency}`);
      return res.json({
        ok: true, latency, syncedAt,
        projectCount: projects.length,
        issueCount: issues.length,
        total: projects.length + issues.length,
        projects, members,
      });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = safe(cfg, error.message);
      store.setStatus({ status: "error", latency, lastSync: isoNow(), lastError: message });
      log("err", `Sync FAIL · ${message}`);
      return res.status(502).json({ error: message });
    }
  }));

  app.get(`/api/connectors/${id}/issues/:projectId/:issueId`, requireAuth, withConfig("Ver issue",
    async (req, res, cfg, call) => {
      const data = await call(projectPath(cfg.workspace, req.params.projectId, `issues/${req.params.issueId}/?expand=state`));
      return res.json(data);
    },
  ));

  app.post(`/api/connectors/${id}/issues/:projectId/:issueId/comment`, requireAuth, withConfig("Comentar issue",
    async (req, res, cfg, call) => {
      const { comment } = req.body || {};
      if (!comment) return res.status(400).json({ error: "comment-required" });
      const created = await call(
        projectPath(cfg.workspace, req.params.projectId, `issues/${req.params.issueId}/comments/`),
        "POST",
        { comment_html: comment },
      );
      log("ok", `Comentario agregado · issue ${req.params.issueId}`);
      return res.json({ ok: true, id: created?.id || null });
    },
  ));

  // Closing means moving the issue into whichever state belongs to the
  // "completed" group — Plane has no fixed "done" id.
  app.post(`/api/connectors/${id}/issues/:projectId/:issueId/close`, requireAuth, withConfig("Cerrar issue",
    async (req, res, cfg, call) => {
      const { projectId, issueId } = req.params;
      const states = planeList(await call(projectPath(cfg.workspace, projectId, "states/")));
      const done = states.find((state) => state.group === "completed");
      if (!done) return res.status(400).json({ error: "no-completed-state-found" });
      await call(projectPath(cfg.workspace, projectId, `issues/${issueId}/`), "PATCH", { state: done.id });
      log("ok", `Issue cerrado · ${issueId} → ${done.name}`);
      return res.json({ ok: true, state: done.name });
    },
  ));

  // Mismo patrón que /close pero al grupo "started" — Plane tampoco tiene un
  // id fijo para "En progreso".
  app.post(`/api/connectors/${id}/issues/:projectId/:issueId/start`, requireAuth, withConfig("Iniciar issue",
    async (req, res, cfg, call) => {
      const { projectId, issueId } = req.params;
      const states = planeList(await call(projectPath(cfg.workspace, projectId, "states/")));
      const started = states.find((state) => state.group === "started");
      if (!started) return res.status(400).json({ error: "no-started-state-found" });
      await call(projectPath(cfg.workspace, projectId, `issues/${issueId}/`), "PATCH", { state: started.id });
      log("ok", `Issue iniciado · ${issueId} → ${started.name}`);
      return res.json({ ok: true, state: started.name });
    },
  ));

  // Deletes the issue outright — unlike /close (which just moves it to a
  // "completed" state), this is irreversible. For entries that should never
  // have existed (duplicates, backfill mistakes) rather than ones that are
  // simply done.
  app.delete(`/api/connectors/${id}/issues/:projectId/:issueId`, requireAuth, guardAsyncRoute(async (req, res) => {
    // Compatibility route for older Plane clients. Its previous direct DELETE
    // call is deliberately replaced by the registry so no route can bypass
    // the same approval/audit contract used by REST and MCP actions.
    if (!store.getConfig()) return res.status(400).json({ error: "not-configured" });
    if (typeof executeAction !== "function") {
      return res.status(503).json({ error: "approval-center-unavailable" });
    }
    try {
      const result = await executeAction({
        connectionId: id,
        actionId: "delete-issue",
        input: { projectId: req.params.projectId, issueId: req.params.issueId },
        actor: typeof req.get === "function" ? req.get("X-Actor") || undefined : undefined,
        requestId: req.id,
      });
      return res.status(result.pending ? 202 : 200).json(result);
    } catch (error) {
      if (typeof sendAppError === "function") return sendAppError(res, error, req);
      throw error;
    }
  }));

  app.post(`/api/connectors/${id}/projects`, requireAuth, withConfig("Crear proyecto",
    async (req, res, cfg, call) => {
      const { name, identifier, description, network } = req.body || {};
      if (!name || !identifier) return res.status(400).json({ error: "name-and-identifier-required" });
      const body = {
        name,
        // The identifier prefixes every issue key (ESID-1) and Plane wants it uppercase.
        identifier: String(identifier).toUpperCase(),
        network: network === undefined ? 2 : network,
      };
      if (description) body.description = description;
      const created = await call(workspacePath(cfg.workspace, "projects/"), "POST", body);
      log("ok", `Proyecto creado · ${created?.identifier || "?"} "${created?.name || name}"`);
      return res.json({
        ok: true,
        id: created?.id || null,
        identifier: created?.identifier || null,
        name: created?.name || null,
      });
    },
  ));

  // Plane silently drops assignees who are not project members, so this has to
  // run before assigning anyone to an issue.
  // Unlike issues and modules, the project itself had no edit route — needed to
  // record a cross-connector reference (e.g. "Repositorio: <gitlab-url>") in a
  // project's own description so it is visible in Plane, not just in this app.
  app.patch(`/api/connectors/${id}/projects/:projectId`, requireAuth, withConfig("Editar proyecto",
    async (req, res, cfg, call) => {
      const { projectId } = req.params;
      const body = req.body || {};
      if (!Object.keys(body).length) return res.status(400).json({ error: "no-fields" });
      const updated = await call(projectPath(cfg.workspace, projectId, ""), "PATCH", body);
      log("ok", `Proyecto editado · ${projectId} · campos: ${Object.keys(body).join(", ")}`);
      return res.json({
        ok: true,
        id: updated?.id ?? null,
        name: updated?.name ?? null,
        description: updated?.description ?? null,
      });
    },
  ));

  app.post(`/api/connectors/${id}/projects/:projectId/members`, requireAuth, withConfig("Agregar miembro a proyecto",
    async (req, res, cfg, call) => {
      const { memberId, role } = req.body || {};
      if (!memberId) return res.status(400).json({ error: "memberId-required" });
      const created = await call(
        projectPath(cfg.workspace, req.params.projectId, "members/"),
        "POST",
        { member: memberId, role: role || 15 },
      );
      log("ok", `Miembro agregado · proyecto ${req.params.projectId} · miembro ${memberId}`);
      return res.json({ ok: true, data: created ?? null });
    },
  ));

  app.post(`/api/connectors/${id}/projects/:projectId/modules`, requireAuth, withConfig("Crear módulo",
    async (req, res, cfg, call) => {
      const { name, description } = req.body || {};
      if (!name) return res.status(400).json({ error: "name-required" });
      const body = { name };
      if (description) body.description = description;
      const created = await call(projectPath(cfg.workspace, req.params.projectId, "modules/"), "POST", body);
      log("ok", `Módulo creado · "${created?.name || name}" · proyecto ${req.params.projectId}`);
      return res.json({ ok: true, id: created?.id || null, name: created?.name || null });
    },
  ));

  app.post(`/api/connectors/${id}/projects/:projectId/modules/:moduleId/issues`, requireAuth, withConfig("Agregar issues a módulo",
    async (req, res, cfg, call) => {
      const { projectId, moduleId } = req.params;
      const { issueIds } = req.body || {};
      if (!Array.isArray(issueIds) || !issueIds.length) return res.status(400).json({ error: "issueIds-required" });
      const created = await call(
        projectPath(cfg.workspace, projectId, `modules/${moduleId}/module-issues/`),
        "POST",
        { issues: issueIds },
      );
      log("ok", `${issueIds.length} issue(s) agregado(s) al módulo ${moduleId}`);
      return res.json({ ok: true, data: created ?? null });
    },
  ));

  app.patch(`/api/connectors/${id}/projects/:projectId/modules/:moduleId`, requireAuth, withConfig("Editar módulo",
    async (req, res, cfg, call) => {
      const { projectId, moduleId } = req.params;
      const body = req.body || {};
      if (!Object.keys(body).length) return res.status(400).json({ error: "no-fields" });
      const updated = await call(projectPath(cfg.workspace, projectId, `modules/${moduleId}/`), "PATCH", body);
      log("ok", `Módulo editado · ${moduleId} · campos: ${Object.keys(body).join(", ")}`);
      return res.json({ ok: true, id: updated?.id ?? null, name: updated?.name ?? null });
    },
  ));

  app.post(`/api/connectors/${id}/issues/:projectId`, requireAuth, withConfig("Crear issue",
    async (req, res, cfg, call) => {
      const { name, description, priority, assignees } = req.body || {};
      if (!name) return res.status(400).json({ error: "name-required" });
      const body = { name };
      if (description) body.description_html = description;
      if (priority) body.priority = priority;
      if (Array.isArray(assignees) && assignees.length) body.assignees = assignees;
      const created = await call(projectPath(cfg.workspace, req.params.projectId, "issues/"), "POST", body);
      log("ok", `Issue creado · #${created?.sequence_id ?? "?"} "${name}" · proyecto ${req.params.projectId}`);
      return res.json({ ok: true, id: created?.id || null, sequence_id: created?.sequence_id ?? null });
    },
  ));

  app.patch(`/api/connectors/${id}/issues/:projectId/:issueId`, requireAuth, withConfig("Editar issue",
    async (req, res, cfg, call) => {
      const { projectId, issueId } = req.params;
      const body = req.body || {};
      if (!Object.keys(body).length) return res.status(400).json({ error: "no-fields" });
      const updated = await call(projectPath(cfg.workspace, projectId, `issues/${issueId}/`), "PATCH", body);
      log("ok", `Issue editado · ${issueId} · campos: ${Object.keys(body).join(", ")}`);
      return res.json({
        ok: true,
        start_date: updated?.start_date ?? null,
        target_date: updated?.target_date ?? null,
      });
    },
  ));

  app.get(`/api/connectors/${id}/members`, requireAuth, (req, res) => {
    return res.json({ members: store.getData()?.members || [] });
  });

  // Modules, cached from the last sync (see syncPlane in client.js) — lets the
  // UI/agent look up "does a module named X exist" without a live API call,
  // which the connector had no way to answer before this.
  app.get(`/api/connectors/${id}/modules`, requireAuth, (req, res) => {
    const modules = store.getData()?.modules || [];
    const { project } = req.query || {};
    return res.json({ modules: project ? modules.filter((m) => m.projectId === project) : modules });
  });

  app.get(`/api/connectors/${id}/issues`, requireAuth, (req, res) => {
    const data = store.getData();
    const currentUserId = data?.currentUserId || store.getConfig()?.userId || null;
    const { total, issues } = filterPlaneIssues(data?.issues || [], req.query || {}, currentUserId);
    return res.json({ total, syncedAt: data?.syncedAt || null, currentUserId, issues });
  });

  // Home block "my-issues" (declared in manifest.json): las issues activas
  // asignadas al usuario del token, ya ordenadas por prioridad/fecha.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "my-issues",
    getBlock: (req) => {
      if (!store.getConfig()) return null;
      const data = store.getData();
      const currentUserId = data?.currentUserId || store.getConfig()?.userId || null;
      const { scope, limit } = req?.query || {};
      const { issues } = filterPlaneIssues(
        data?.issues || [],
        { mine: "true", project: scope || null, limit: Number(limit) || 30 },
        currentUserId,
      );
      const priorityColor = { urgent: "#dc2626", high: "#ea580c", medium: "#ca8a04", low: "#2563eb" };
      return {
        items: issues.map(issue => ({
          id: issue.id,
          title: issue.title,
          subtitle: `${issue.identifier} · ${issue.projectName}`,
          timestamp: issue.createdAt || null,
          badge: issue.priority && issue.priority !== "none"
            ? { text: issue.priority, color: priorityColor[issue.priority] }
            : null,
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
  registerPlaneRoutes,
};
