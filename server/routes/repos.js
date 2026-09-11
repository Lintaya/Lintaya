// Repos — clone/link-existing repos across GitLab/GitHub/Bitbucket, browse
// remote/local file trees, git working-copy operations (status/diff/stage/
// commit/fetch/pull/push/checkout), Python venv env prep + a generic runtime
// launcher ("Play"), the network-tools sandbox's own dedicated launcher, and
// VS Code / VS Code Web embedding.
//
// Extracted from server.js's "Repos" block — deliberately deferred out of
// Fase 1 of the routers-by-domain migration (~2000 of server.js's ~5800
// lines, the domain the user relies on most day-to-day — see
// el roadmap interno, entry "Primer corte de Fase 1"). Same
// registerXRoutes(context) mold as every other server/routes/*.js file, just
// bigger: this one owns real runtime state (subprocess handles for VS Code
// Web, the network-tools sandbox, and per-repo "Play" launchers) instead of
// being pure KV CRUD, so most of its helpers live as closures inside the
// register function rather than as free-standing exports.
//
// attachRepoSettings/attachCloneState are returned because
// SIMPLE_CONNECTOR_SHAPE (server.js) — consumed by
// GET /api/connectors/status (server/routes/connectors.js) — calls them to
// decorate each GitLab/GitHub/Bitbucket project with its local clone/pin
// state. reposDb is returned so server.js's shutdown path can close it.
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { openDatabase, REPOSITORY_MIGRATIONS } = require("../core/database");
const { analyzeRepository } = require("../analysis");
const { gitlabRequest } = require("../connectors/community/gitlab");
const { githubRequest, normalizeGithubRunStatus } = require("../connectors/community/github");
const {
  bitbucketRequest,
  bitbucketServerPathToString,
  splitBitbucketId,
} = require("../connectors/community/bitbucket");
const { getConnectorConfig } = require("../core/services/connector-store");
const { gitFailureError } = require("../core/services/git-errors");

function registerReposRoutes({
  app, requireAuth, kvGet, kvSet, auditWrite, connectorLog,
  resolveConnectorType, config, insecureAgent, AppError, sendAppError,
}) {
  // ── GitLab connector ──────────────────────────────────────────────────────
  // Read-only: projects + recent deployments via the GitLab REST API v4.
  const GITLAB_CLONE_ROOT = path.join(config.serverDir, "gitlab-clones");
  const GITLAB_CLONE_STATE_KEY = "gitlab-clone-state";
  const GITHUB_CLONE_STATE_KEY = "github-clone-state";
  // Los clones de GitHub viven en la MISMA carpeta compartida que los de GitLab
  // (GITLAB_CLONE_ROOT, más abajo) — el nombre del constante es histórico, el
  // directorio ya no es exclusivo de GitLab. Los subdirectorios de GitHub se
  // prefijan "github-" para no chocar con los de GitLab (que no llevan prefijo).
  const NETWORK_TOOLS_HOST = config.networkTools.host;
  const NETWORK_TOOLS_PORT = config.networkTools.port;
  const NETWORK_TOOLS_URL = `http://${NETWORK_TOOLS_HOST}:${NETWORK_TOOLS_PORT}`;
  const NETWORK_TOOLS_HEALTH_URL = `${NETWORK_TOOLS_URL}/healthz`;
  const PYTHON_BIN = config.networkTools.python;
  if (!fs.existsSync(GITLAB_CLONE_ROOT)) fs.mkdirSync(GITLAB_CLONE_ROOT, { recursive: true });

  // ── Repos module settings — mini SQLite propia del módulo Repos (visibilidad,
  // ruta de clonado preferida y "pin" al submenú de Repos). Separada de
  // personal-hq.db a propósito: aísla este módulo, no comparte tabla `kv`.
  const reposDb = openDatabase({
    filename: config.database.reposPath,
    migrations: REPOSITORY_MIGRATIONS,
  });
  const selectAllRepoSettings = reposDb.prepare("SELECT * FROM repo_settings");
  const selectOneRepoSetting  = reposDb.prepare("SELECT * FROM repo_settings WHERE project_id = ?");
  const upsertRepoSetting     = reposDb.prepare(`
    INSERT INTO repo_settings (project_id, visible, clone_path, pinned, updated_at)
    VALUES (@project_id, @visible, @clone_path, @pinned, @updated_at)
    ON CONFLICT(project_id) DO UPDATE SET visible = excluded.visible, clone_path = excluded.clone_path, pinned = excluded.pinned, updated_at = excluded.updated_at
  `);
  const DEFAULT_REPO_SETTINGS = { visible: true, clonePath: null, pinned: false };

  function getAllRepoSettings() {
    const map = {};
    for (const row of selectAllRepoSettings.all()) {
      map[row.project_id] = { visible: !!row.visible, clonePath: row.clone_path || null, pinned: !!row.pinned };
    }
    return map;
  }

  function getRepoSetting(projectId) {
    const row = selectOneRepoSetting.get(String(projectId));
    return row ? { visible: !!row.visible, clonePath: row.clone_path || null, pinned: !!row.pinned } : { ...DEFAULT_REPO_SETTINGS };
  }

  function setRepoSetting(projectId, patch) {
    const next = { ...getRepoSetting(projectId), ...patch };
    upsertRepoSetting.run({
      project_id: String(projectId),
      visible: next.visible ? 1 : 0,
      clone_path: next.clonePath || null,
      pinned: next.pinned ? 1 : 0,
      updated_at: Date.now(),
    });
    return next;
  }

  function attachRepoSettings(projects) {
    const all = getAllRepoSettings();
    return (projects || []).map((p) => ({ ...p, settings: all[String(p.id)] || { ...DEFAULT_REPO_SETTINGS } }));
  }
  const networkToolsRuntime = {
    child: null,
    pid: null,
    status: "stopped",
    startedAt: null,
    lastError: null,
    logs: [],
  };

  // VS Code Web (`code serve-web`) — one shared server process, embedded per-repo via the
  // ?folder= query param so we don't need to restart it when switching repos.
  const VSCODE_WEB_HOST = "127.0.0.1";
  const VSCODE_WEB_PORT = config.vscodeWebPort;
  const VSCODE_WEB_URL = `http://${VSCODE_WEB_HOST}:${VSCODE_WEB_PORT}`;
  const vscodeWebRuntime = {
    child: null,
    pid: null,
    status: "stopped",
    startedAt: null,
    lastError: null,
  };

  function sanitizeRepoCloneName(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "repo";
  }

  function resolveGitDir(repoPath) {
    const gitPath = path.join(repoPath, ".git");
    if (!fs.existsSync(gitPath)) return null;
    const st = fs.statSync(gitPath);
    if (st.isDirectory()) return gitPath;
    if (st.isFile()) {
      const txt = fs.readFileSync(gitPath, "utf8");
      const match = txt.match(/gitdir:\s*(.+)/i);
      if (!match) return null;
      const gitDir = path.resolve(repoPath, match[1].trim());
      return fs.existsSync(gitDir) ? gitDir : null;
    }
    return null;
  }

  function readGitBranch(repoPath) {
    try {
      const gitDir = resolveGitDir(repoPath);
      if (!gitDir) return null;
      const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
      const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      if (refMatch) return refMatch[1];
      return head ? `detached:${head.slice(0, 7)}` : null;
    } catch (_) {
      return null;
    }
  }

  function readGitlabCloneDiskState() {
    const state = {};
    if (!fs.existsSync(GITLAB_CLONE_ROOT)) return state;

    for (const entry of fs.readdirSync(GITLAB_CLONE_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(\d+)-/);
      if (!match) continue;
      const projectId = match[1];
      const dirPath = path.join(GITLAB_CLONE_ROOT, entry.name);
      if (!resolveGitDir(dirPath)) continue;
      state[projectId] = {
        projectId,
        status: "cloned",
        path: path.resolve(dirPath),
        branch: readGitBranch(dirPath),
      };
    }

    return state;
  }

  function getGitlabCloneState() {
    const saved = kvGet(GITLAB_CLONE_STATE_KEY)?.value || {};
    const disk = readGitlabCloneDiskState();
    const merged = { ...saved };
    for (const [projectId, info] of Object.entries(disk)) {
      merged[projectId] = { ...(merged[projectId] || {}), ...info };
    }
    return merged;
  }

  function persistGitlabCloneState(projectId, patch) {
    const id = String(projectId);
    const current = kvGet(GITLAB_CLONE_STATE_KEY)?.value || {};
    const next = {
      ...current,
      [id]: { ...(current[id] || {}), ...patch, projectId: id },
    };
    kvSet(GITLAB_CLONE_STATE_KEY, next);
    return next[id];
  }

  // ── Provider-parameterized clone state ──────────────────────────────────────
  // Generalización de las funciones GitLab-only de arriba para que el resto del
  // código (rutas de Repos, sync de status) pueda operar sobre "gitlab" o "github"
  // sin ifs repetidos. GitLab conserva su auto-sanado desde disco (arriba); GitHub
  // por ahora solo lee el kv persistido — no hay riesgo de perder el registro de un
  // clon existente porque toda escritura (clone/link-existing) pasa por
  // persistCloneState, que si guarda.
  // Los clones se indexan por tipo y no por conexión. Un clon pertenece a un
  // repositorio, y ese repositorio es el mismo con cualquier credencial del
  // mismo proveedor: indexarlo por conexión dejaba a una instancia extra sin
  // ver ningún clon, así que una operación git solo podía correr con las
  // credenciales de la conexión base — y si esa base perdía el acceso al repo,
  // no quedaba forma de empujarlo desde la app.
  function cloneStateOwner(provider) {
    return resolveConnectorType(provider) || provider;
  }

  function genericCloneStateKey(provider) {
    const owner = cloneStateOwner(provider);
    return owner === "github" ? GITHUB_CLONE_STATE_KEY : `${owner}-clone-state`;
  }

  function getCloneState(provider) {
    if (cloneStateOwner(provider) === "gitlab") return getGitlabCloneState();
    return kvGet(genericCloneStateKey(provider))?.value || {};
  }

  function persistCloneState(provider, projectId, patch) {
    if (cloneStateOwner(provider) === "gitlab") return persistGitlabCloneState(projectId, patch);
    const id = String(projectId);
    const key = genericCloneStateKey(provider);
    const current = kvGet(key)?.value || {};
    const next = { ...current, [id]: { ...(current[id] || {}), ...patch, projectId: id } };
    kvSet(key, next);
    return next[id];
  }

  function attachCloneState(provider, projects) {
    const cloneState = getCloneState(provider);
    return (projects || []).map((project) => ({
      ...project,
      localClone: normalizeGitlabCloneInfo(cloneState[String(project.id)] || null),
    }));
  }

  function findLocalClone(provider, projectId) {
    const cloneState = getCloneState(provider);
    return normalizeGitlabCloneInfo(cloneState[String(projectId)] || null);
  }

  function detectGitlabRepoEnvironment(repoPath) {
    try {
      if (!repoPath || !fs.existsSync(repoPath)) return false;
      return [
        "pyproject.toml",
        "requirements.txt",
        "setup.py",
        "setup.cfg",
      ].some((name) => fs.existsSync(path.join(repoPath, name)));
    } catch (_) {
      return false;
    }
  }

  // Entrypoint que el launcher genérico de "Play" sabe arrancar. network-tools usa
  // wsgi.py con su propio pathway dedicado (puerto fijo, env vars NT_*, /healthz) —
  // a propósito NO se detecta aquí, para no pisarlo con el launcher genérico.
  function findRepoEntrypoint(repoPath) {
    try {
      if (!repoPath || !fs.existsSync(repoPath)) return null;
      if (fs.existsSync(path.join(repoPath, "manage.py"))) return { file: "manage.py", kind: "django" };
      if (fs.existsSync(path.join(repoPath, "app.py"))) return { file: "app.py", kind: "flask" };
      return null;
    } catch (_) {
      return null;
    }
  }

  function normalizeGitlabCloneInfo(info) {
    if (!info?.path) return info || null;
    const entry = findRepoEntrypoint(info.path);
    return {
      ...info,
      envSupported: typeof info.envSupported === "boolean"
        ? info.envSupported
        : detectGitlabRepoEnvironment(info.path),
      playable: !!entry,
      entrypoint: entry?.file || null,
    };
  }

  function findNetworkToolsClonePath() {
    const candidates = [];
    const saved = kvGet(GITLAB_CLONE_STATE_KEY)?.value || {};
    for (const info of Object.values(saved)) {
      if (info?.path) candidates.push(info.path);
    }
    const disk = readGitlabCloneDiskState();
    for (const info of Object.values(disk)) {
      if (info?.path) candidates.push(info.path);
    }
    if (fs.existsSync(GITLAB_CLONE_ROOT)) {
      for (const entry of fs.readdirSync(GITLAB_CLONE_ROOT, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(GITLAB_CLONE_ROOT, entry.name));
      }
    }

    for (const candidate of candidates) {
      if (!candidate || !/network-tools/i.test(candidate)) continue;
      if (!fs.existsSync(candidate)) continue;
      if (!resolveGitDir(candidate)) continue;
      if (!fs.existsSync(path.join(candidate, "wsgi.py"))) continue;
      return path.resolve(candidate);
    }
    return null;
  }

  async function prepareRepoEnvironment(provider, projectId) {
    const localClone = findLocalClone(provider, projectId);
    if (!localClone?.path) {
      const err = new Error("local-clone-not-found");
      err.code = "ENOCLONE";
      throw err;
    }
    if (!fs.existsSync(PYTHON_BIN)) {
      const err = new Error(`python-runtime-not-found: ${PYTHON_BIN}`);
      err.code = "ENOPYTHON";
      throw err;
    }

    const repoPath = localClone.path;
    const supportsEnv = detectGitlabRepoEnvironment(repoPath);
    if (!supportsEnv) {
      const err = new Error("repo-no-python-project");
      err.code = "ENOPYPROJECT";
      throw err;
    }

    const venvDir = path.join(repoPath, ".venv");
    const venvPython = path.join(venvDir, "Scripts", "python.exe");
    const requirements = path.join(repoPath, "requirements.txt");
    const pyproject = path.join(repoPath, "pyproject.toml");
    const setupPy = path.join(repoPath, "setup.py");
    const setupCfg = path.join(repoPath, "setup.cfg");

    persistCloneState(provider, projectId, {
      envStatus: "preparing",
      envKind: fs.existsSync(requirements)
        ? "requirements"
        : (fs.existsSync(pyproject) || fs.existsSync(setupPy) || fs.existsSync(setupCfg))
          ? "editable"
          : "venv",
      envPath: venvDir,
      envError: null,
      envPreparedAt: localClone.envPreparedAt || null,
      envSupported: true,
    });

    if (!fs.existsSync(venvPython)) {
      await runProcess(PYTHON_BIN, ["-m", "venv", ".venv"], {
        cwd: repoPath,
        env: { PYTHONUNBUFFERED: "1" },
        timeoutMs: 10 * 60 * 1000,
      });
    }

    const venvBin = fs.existsSync(venvPython) ? venvPython : null;
    if (!venvBin) {
      const err = new Error("venv-no-creado");
      err.code = "ENOVENV";
      throw err;
    }

    let installMode = "venv";
    let stdout = "";
    let stderr = "";

    if (fs.existsSync(requirements)) {
      installMode = "requirements";
      const result = await runProcess(venvBin, ["-m", "pip", "install", "-r", "requirements.txt"], {
        cwd: repoPath,
        env: { PYTHONUNBUFFERED: "1" },
        timeoutMs: 20 * 60 * 1000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } else if (fs.existsSync(pyproject) || fs.existsSync(setupPy) || fs.existsSync(setupCfg)) {
      installMode = "editable";
      const result = await runProcess(venvBin, ["-m", "pip", "install", "-e", "."], {
        cwd: repoPath,
        env: { PYTHONUNBUFFERED: "1" },
        timeoutMs: 20 * 60 * 1000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    }

    const prepared = persistCloneState(provider, projectId, {
      envStatus: "ready",
      envKind: installMode,
      envPath: venvDir,
      envPreparedAt: new Date().toISOString(),
      envError: null,
      envSupported: true,
    });

    return {
      ok: true,
      localClone: prepared,
      venvPath: venvDir,
      venvPython,
      installMode,
      stdout,
      stderr,
    };
  }

  function findNetworkToolsPythonBin(clonePath) {
    // El venv propio del repo (con sus dependencias, p. ej. Flask) va antes que
    // el runtime genérico de Codex — ese último no tiene por qué traer los
    // paquetes que este proyecto específico necesita.
    const candidates = [
      config.networkTools.servicePython,
      clonePath ? path.join(clonePath, ".venv", "Scripts", "python.exe") : null,
      clonePath ? path.join(clonePath, "venv", "Scripts", "python.exe") : null,
      config.networkTools.python,
      PYTHON_BIN,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  async function probeNetworkToolsHealth() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(NETWORK_TOOLS_HEALTH_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) return { ok: false, status: resp.status };
      let body = null;
      try { body = await resp.json(); } catch (_) {}
      return { ok: true, status: resp.status, body };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function pushNetworkToolsLog(kind, chunk) {
    const text = String(chunk || "").replace(/\r/g, "");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      networkToolsRuntime.logs.push(`[${kind}] ${line}`);
    }
    if (networkToolsRuntime.logs.length > 200) {
      networkToolsRuntime.logs.splice(0, networkToolsRuntime.logs.length - 200);
    }
  }

  function watchNetworkToolsProcess(child) {
    if (!child) return;
    child.stdout?.on("data", (chunk) => pushNetworkToolsLog("stdout", chunk));
    child.stderr?.on("data", (chunk) => pushNetworkToolsLog("stderr", chunk));
    child.on("error", (err) => {
      networkToolsRuntime.status = "error";
      networkToolsRuntime.lastError = err.message;
      networkToolsRuntime.child = null;
      networkToolsRuntime.pid = null;
      pushNetworkToolsLog("error", err.message);
    });
    child.on("exit", (code, signal) => {
      if (networkToolsRuntime.child === child) {
        networkToolsRuntime.child = null;
        networkToolsRuntime.pid = null;
        networkToolsRuntime.status = code === 0 ? "stopped" : "error";
        networkToolsRuntime.lastError = code === 0 ? null : `exit ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`;
        pushNetworkToolsLog("exit", `process finished (${networkToolsRuntime.lastError || "ok"})`);
      }
    });
  }

  async function waitForNetworkToolsReady(timeoutMs = 15000) {
    const started = Date.now();
    let lastProbe = null;
    while (Date.now() - started < timeoutMs) {
      lastProbe = await probeNetworkToolsHealth();
      if (lastProbe.ok) return lastProbe;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const err = new Error("network-tools-no-responding");
    err.lastProbe = lastProbe;
    throw err;
  }

  async function startNetworkToolsProcess({ parentOrigin } = {}) {
    const clonePath = findNetworkToolsClonePath();
    if (!clonePath) {
      const err = new Error("network-tools-no-local-clone");
      err.code = "ENOCLONE";
      throw err;
    }
    const pythonBin = findNetworkToolsPythonBin(clonePath);
    if (!pythonBin) {
      const err = new Error(`python-runtime-not-found: ${PYTHON_BIN}`);
      err.code = "ENOPYTHON";
      throw err;
    }

    const health = await probeNetworkToolsHealth();
    if (health.ok) {
      networkToolsRuntime.status = "running";
      networkToolsRuntime.lastError = null;
      networkToolsRuntime.startedAt = networkToolsRuntime.startedAt || new Date().toISOString();
      return { clonePath, url: NETWORK_TOOLS_URL, status: "running", alreadyRunning: true, health };
    }

    if (networkToolsRuntime.child && networkToolsRuntime.status === "starting") {
      const ready = await waitForNetworkToolsReady();
      networkToolsRuntime.status = "running";
      return { clonePath, url: NETWORK_TOOLS_URL, status: "running", alreadyRunning: true, health: ready };
    }

    const entrypoint = path.join(clonePath, "wsgi.py");
    const frameAncestors = ["'self'"];
    if (parentOrigin && /^https?:\/\//i.test(parentOrigin)) frameAncestors.push(parentOrigin.replace(/\/$/, ""));
    if (!frameAncestors.some(v => /127\.0\.0\.1:3000|localhost:3000/.test(v))) {
      frameAncestors.push("http://127.0.0.1:3000", "http://localhost:3000");
    }
    const child = spawn(pythonBin, [entrypoint], {
      cwd: clonePath,
      env: {
        ...process.env,
        NT_WEB_HOST: NETWORK_TOOLS_HOST,
        NT_WEB_PORT: String(NETWORK_TOOLS_PORT),
        NT_AUTH_MODE: "permissive",
        NT_AUTH_DEV_IMPERSONATE: "1",
        NT_FRAME_ANCESTORS: frameAncestors.join(" "),
        PYTHONUNBUFFERED: "1",
      },
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    networkToolsRuntime.child = child;
    networkToolsRuntime.pid = child.pid;
    networkToolsRuntime.status = "starting";
    networkToolsRuntime.startedAt = new Date().toISOString();
    networkToolsRuntime.lastError = null;
    watchNetworkToolsProcess(child);

    try {
      const ready = await waitForNetworkToolsReady();
      networkToolsRuntime.status = "running";
      networkToolsRuntime.lastError = null;
      return { clonePath, url: NETWORK_TOOLS_URL, status: "running", alreadyRunning: false, health: ready };
    } catch (err) {
      networkToolsRuntime.status = "error";
      networkToolsRuntime.lastError = err.lastProbe?.error || err.message;
      throw err;
    }
  }

  function stopNetworkToolsProcess() {
    const child = networkToolsRuntime.child;
    const pid = networkToolsRuntime.pid || child?.pid;
    if (child && !child.killed) {
      try { child.kill(); } catch (_) {}
    } else if (pid) {
      try { process.kill(pid); } catch (_) {}
    }
    networkToolsRuntime.child = null;
    networkToolsRuntime.pid = null;
    networkToolsRuntime.status = "stopped";
    networkToolsRuntime.lastError = null;
    return { url: NETWORK_TOOLS_URL };
  }

  function getNetworkToolsRuntimeSnapshot() {
    const clonePath = findNetworkToolsClonePath();
    const localClone = clonePath ? { path: clonePath, branch: readGitBranch(clonePath) } : null;
    return {
      name: "network-tools",
      localClone,
      url: NETWORK_TOOLS_URL,
      healthUrl: NETWORK_TOOLS_HEALTH_URL,
      status: networkToolsRuntime.status,
      pid: networkToolsRuntime.pid,
      startedAt: networkToolsRuntime.startedAt,
      lastError: networkToolsRuntime.lastError,
      logs: networkToolsRuntime.logs.slice(),
    };
  }

  // ── Generic repo launcher — "Play" para cualquier repo local con venv listo y
  // un entrypoint reconocido (app.py Flask / manage.py Django). network-tools NO
  // pasa por aquí: sigue su propio pathway de arriba (puerto fijo, env vars NT_*,
  // /healthz) — findRepoEntrypoint() lo excluye a propósito (usa wsgi.py).
  const repoRuntimes = new Map(); // projectId (string) -> runtime state

  function getRepoRuntime(projectId) {
    const id = String(projectId);
    if (!repoRuntimes.has(id)) {
      repoRuntimes.set(id, {
        child: null, pid: null, status: "stopped", startedAt: null,
        lastError: null, logs: [], port: null, url: null, entrypoint: null,
      });
    }
    return repoRuntimes.get(id);
  }

  function getFreePort() {
    return new Promise((resolve, reject) => {
      const net = require("node:net");
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    });
  }

  function pushRepoLog(rt, kind, chunk) {
    const text = String(chunk || "").replace(/\r/g, "");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      rt.logs.push(`[${kind}] ${line}`);
    }
    if (rt.logs.length > 200) rt.logs.splice(0, rt.logs.length - 200);
  }

  async function probeRepoHealth(port) {
    if (!port) return { ok: false, error: "no-port" };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: true, status: resp.status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function waitForRepoReady(port, timeoutMs = 20000) {
    const started = Date.now();
    let lastProbe = null;
    while (Date.now() - started < timeoutMs) {
      lastProbe = await probeRepoHealth(port);
      if (lastProbe.ok) return lastProbe;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const err = new Error("repo-app-no-responding");
    err.lastProbe = lastProbe;
    throw err;
  }

  function watchRepoProcess(rt, child) {
    child.stdout?.on("data", (chunk) => pushRepoLog(rt, "stdout", chunk));
    child.stderr?.on("data", (chunk) => pushRepoLog(rt, "stderr", chunk));
    child.on("error", (err) => {
      rt.status = "error";
      rt.lastError = err.message;
      rt.child = null;
      rt.pid = null;
      pushRepoLog(rt, "error", err.message);
    });
    child.on("exit", (code, signal) => {
      if (rt.child === child) {
        rt.child = null;
        rt.pid = null;
        rt.status = code === 0 ? "stopped" : "error";
        rt.lastError = code === 0 ? null : `exit ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`;
        pushRepoLog(rt, "exit", `process finished (${rt.lastError || "ok"})`);
      }
    });
  }

  async function startRepoProcess(provider, projectId) {
    const localClone = findLocalClone(provider, projectId);
    if (!localClone?.path) {
      const err = new Error("local-clone-not-found");
      err.code = "ENOCLONE";
      throw err;
    }
    if (localClone.envStatus !== "ready") {
      const err = new Error("env-not-ready");
      err.code = "ENOENV";
      throw err;
    }
    const entry = findRepoEntrypoint(localClone.path);
    if (!entry) {
      const err = new Error("no-entrypoint-found");
      err.code = "ENOENTRYPOINT";
      throw err;
    }
    const pythonBin = findNetworkToolsPythonBin(localClone.path);
    if (!pythonBin) {
      const err = new Error("python-runtime-not-found");
      err.code = "ENOPYTHON";
      throw err;
    }

    const rt = getRepoRuntime(projectId);

    if (rt.port) {
      const health = await probeRepoHealth(rt.port);
      if (health.ok) {
        rt.status = "running";
        rt.lastError = null;
        rt.startedAt = rt.startedAt || new Date().toISOString();
        return { url: rt.url, status: "running", alreadyRunning: true, health };
      }
    }
    if (rt.child && rt.status === "starting") {
      const ready = await waitForRepoReady(rt.port);
      rt.status = "running";
      return { url: rt.url, status: "running", alreadyRunning: true, health: ready };
    }

    const port = await getFreePort();
    const url = `http://127.0.0.1:${port}`;
    const args = entry.kind === "django" ? [entry.file, "runserver", `127.0.0.1:${port}`] : [entry.file];
    const child = spawn(pythonBin, args, {
      cwd: localClone.path,
      env: { ...process.env, PORT: String(port), FLASK_RUN_PORT: String(port), PYTHONUNBUFFERED: "1" },
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    rt.child = child;
    rt.pid = child.pid;
    rt.status = "starting";
    rt.startedAt = new Date().toISOString();
    rt.lastError = null;
    rt.port = port;
    rt.url = url;
    rt.entrypoint = entry.file;
    watchRepoProcess(rt, child);

    try {
      const ready = await waitForRepoReady(port);
      rt.status = "running";
      rt.lastError = null;
      return { url, status: "running", alreadyRunning: false, health: ready };
    } catch (err) {
      rt.status = "error";
      rt.lastError = err.lastProbe?.error || err.message;
      throw err;
    }
  }

  function stopRepoProcess(projectId) {
    const rt = getRepoRuntime(projectId);
    if (rt.child && !rt.child.killed) {
      try { rt.child.kill(); } catch (_) {}
    } else if (rt.pid) {
      try { process.kill(rt.pid); } catch (_) {}
    }
    rt.child = null;
    rt.pid = null;
    rt.status = "stopped";
    rt.lastError = null;
    return { url: rt.url };
  }

  function getRepoRuntimeSnapshot(projectId) {
    const rt = getRepoRuntime(projectId);
    return {
      status: rt.status, pid: rt.pid, startedAt: rt.startedAt, lastError: rt.lastError,
      logs: rt.logs.slice(), url: rt.url, entrypoint: rt.entrypoint,
    };
  }

  async function probeVscodeWebHealth() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(VSCODE_WEB_URL, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: resp.status < 500 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function waitForVscodeWebReady(timeoutMs = 20000) {
    const started = Date.now();
    let lastProbe = null;
    while (Date.now() - started < timeoutMs) {
      lastProbe = await probeVscodeWebHealth();
      if (lastProbe.ok) return lastProbe;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const err = new Error("vscode-web-no-responding");
    err.lastProbe = lastProbe;
    throw err;
  }

  async function ensureVscodeWebRunning() {
    const health = await probeVscodeWebHealth();
    if (health.ok) {
      vscodeWebRuntime.status = "running";
      vscodeWebRuntime.lastError = null;
      vscodeWebRuntime.startedAt = vscodeWebRuntime.startedAt || new Date().toISOString();
      return { status: "running", alreadyRunning: true };
    }
    if (vscodeWebRuntime.child && vscodeWebRuntime.status === "starting") {
      await waitForVscodeWebReady();
      vscodeWebRuntime.status = "running";
      return { status: "running", alreadyRunning: true };
    }

    const child = spawn("code", [
      "serve-web",
      "--host", VSCODE_WEB_HOST,
      "--port", String(VSCODE_WEB_PORT),
      "--without-connection-token",
      "--accept-server-license-terms",
    ], { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

    vscodeWebRuntime.child = child;
    vscodeWebRuntime.pid = child.pid;
    vscodeWebRuntime.status = "starting";
    vscodeWebRuntime.startedAt = new Date().toISOString();
    vscodeWebRuntime.lastError = null;

    child.on("error", (err) => {
      vscodeWebRuntime.status = "error";
      vscodeWebRuntime.lastError = err.message;
      vscodeWebRuntime.child = null;
      vscodeWebRuntime.pid = null;
    });
    child.on("exit", (code, signal) => {
      if (vscodeWebRuntime.child === child) {
        vscodeWebRuntime.child = null;
        vscodeWebRuntime.pid = null;
        vscodeWebRuntime.status = code === 0 ? "stopped" : "error";
        vscodeWebRuntime.lastError = code === 0 ? null : `exit ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`;
      }
    });

    try {
      await waitForVscodeWebReady();
      vscodeWebRuntime.status = "running";
      vscodeWebRuntime.lastError = null;
      return { status: "running", alreadyRunning: false };
    } catch (err) {
      vscodeWebRuntime.status = "error";
      vscodeWebRuntime.lastError = err.lastProbe?.error || err.message;
      throw err;
    }
  }

  function stopVscodeWebProcess() {
    const child = vscodeWebRuntime.child;
    const pid = vscodeWebRuntime.pid || child?.pid;
    if (child && !child.killed) {
      try { child.kill(); } catch (_) {}
    } else if (pid) {
      try { process.kill(pid); } catch (_) {}
    }
    vscodeWebRuntime.child = null;
    vscodeWebRuntime.pid = null;
    vscodeWebRuntime.status = "stopped";
    vscodeWebRuntime.lastError = null;
  }

  function runProcess(command, args, { cwd, env, timeoutMs = 20 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...(env || {}) },
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn(value);
      };

      const timer = timeoutMs > 0 ? setTimeout(() => {
        try { child.kill(); } catch (_) {}
        finish(reject, Object.assign(new Error(`Command timed out after ${timeoutMs}ms`), { code: "ETIMEDOUT", stdout, stderr }));
      }, timeoutMs) : null;

      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (err) => finish(reject, err));
      child.on("close", (code) => {
        if (code === 0) {
          finish(resolve, { code, stdout, stderr });
        } else {
          const err = new Error((stderr || stdout || `Command failed with exit code ${code}`).trim());
          err.code = code;
          err.stdout = stdout;
          err.stderr = stderr;
          finish(reject, err);
        }
      });
    });
  }

  // POST /api/connectors/:provider/projects/:id/open-vscode — opens the local clone in VS Code
  // on THIS machine (the HQ server and the user's desktop are the same box in this setup).
  // :provider en vez del literal "gitlab" — igual que su vecina vscode-web abajo,
  // así funciona para cualquier instancia (gitlab2, gitlab3, …) sin código nuevo.
  app.post("/api/connectors/:provider/projects/:id/open-vscode", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    // shell:true so Windows resolves "code.cmd" from PATH (spawn without a shell can't find .cmd files)
    const child = spawn("code", [localClone.path], { shell: true, detached: true, stdio: "ignore" });
    child.on("error", (err) => {
      connectorLog(req.params.provider, "err", `No se pudo abrir VS Code: ${err.message}`, { endpoint: `${req.method} ${req.originalUrl}` });
    });
    child.unref();
    res.json({ ok: true, path: localClone.path });
  });

  // POST /api/connectors/:provider/projects/:id/vscode-web — starts (if needed) the shared
  // `code serve-web` process and returns the URL to embed, pre-opened to this repo's folder.
  app.post("/api/connectors/:provider/projects/:id/vscode-web", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Abrir VS Code Web" }),
    async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      await ensureVscodeWebRunning();
      const folderUri = `file://${localClone.path.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, "/$1:")}`;
      res.json({ ok: true, url: `${VSCODE_WEB_URL}/?folder=${encodeURIComponent(folderUri)}`, path: localClone.path });
    } catch (err) {
      sendAppError(res, AppError.badGateway("Unable to start VS Code Web", { cause: err }), req);
    }
  });

  // GET /api/vscode-web/status
  app.get("/api/vscode-web/status", requireAuth, async (req, res) => {
    const health = await probeVscodeWebHealth();
    res.json({
      status: health.ok ? "running" : (vscodeWebRuntime.status === "starting" ? "starting" : "stopped"),
      pid: vscodeWebRuntime.pid,
      startedAt: vscodeWebRuntime.startedAt,
      lastError: vscodeWebRuntime.lastError,
      url: VSCODE_WEB_URL,
    });
  });

  // POST /api/vscode-web/stop
  app.post("/api/vscode-web/stop", requireAuth,
    auditWrite({ provider: "vscode-web", action: "Detener VS Code Web" }),
    (req, res) => {
    stopVscodeWebProcess();
    res.json({ ok: true });
  });

  // POST /api/connectors/:provider/projects/:id/clone
  app.post("/api/connectors/:provider/projects/:id/clone", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Clonar" }),
    async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;

    try {
      const project = await p.adapter.getProject(p.cfg, req.params.id);
      const cloneUrl = project.cloneUrl;
      if (!cloneUrl) return sendAppError(res, AppError.badGateway("clone-url-not-available"), req);

      const preferredPath = getRepoSetting(project.id).clonePath;
      // GitLab conserva EXACTO su convención histórica ("<id numérico>-<nombre>") para no
      // romper el auto-sanado desde disco de clones ya existentes; los proveedores nuevos
      // (sin nada que preservar) usan un prefijo propio, ya que sus ids ("owner/repo",
      // "workspace/slug") no son numéricos y necesitan distinguirse dentro de la misma
      // carpeta compartida.
      const dirBaseName = p.name === "gitlab"
        ? `${project.id}-${sanitizeRepoCloneName(project.path || project.name || `project-${project.id}`)}`
        : `${p.name}-${sanitizeRepoCloneName(project.id)}`;
      const baseDir = preferredPath
        ? path.resolve(preferredPath)
        : path.join(GITLAB_CLONE_ROOT, dirBaseName);
      if (!fs.existsSync(path.dirname(baseDir))) fs.mkdirSync(path.dirname(baseDir), { recursive: true });
      const existingGitDir = path.join(baseDir, ".git");
      const authHeader = p.adapter.cloneAuthHeader(p.cfg);

      if (fs.existsSync(baseDir) && fs.existsSync(existingGitDir)) {
        await runProcess("git", [
          "-C", baseDir,
          "-c", `http.extraheader=Authorization: ${authHeader}`,
          "fetch", "origin", "--prune",
        ], { env: { GIT_TERMINAL_PROMPT: "0" } });
        const localClone = persistCloneState(p.name, project.id, {
          status: "updated",
          path: path.resolve(baseDir),
          cloneUrl,
          branch: project.defaultBranch,
          at: new Date().toISOString(),
        });
        res.locals.auditMessage = `Clon existente de ${project.path || project.name || req.params.id} actualizado (fetch)`;
        return res.json({
          ok: true,
          status: "updated",
          path: path.resolve(baseDir),
          cloneUrl,
          branch: project.defaultBranch,
          localClone,
        });
      }

      let targetDir = baseDir;
      if (fs.existsSync(baseDir)) {
        let i = 2;
        while (fs.existsSync(`${baseDir}-${i}`)) i++;
        targetDir = `${baseDir}-${i}`;
      }

      const result = await runProcess("git", [
        "-c", `http.extraheader=Authorization: ${authHeader}`,
        "clone", "--recursive", "--progress", cloneUrl, targetDir,
      ], { env: { GIT_TERMINAL_PROMPT: "0" } });
      const localClone = persistCloneState(p.name, project.id, {
        status: "cloned",
        path: path.resolve(targetDir),
        cloneUrl,
        branch: project.defaultBranch,
        at: new Date().toISOString(),
      });

      res.locals.auditMessage = `Clonado ${project.path || project.name || req.params.id} → ${path.resolve(targetDir)}`;
      res.json({
        ok: true,
        status: "cloned",
        path: path.resolve(targetDir),
        cloneUrl,
        branch: project.defaultBranch,
        localClone,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (err) {
      const detail = /Authentication failed|could not read Username|403|401/i.test(err.message || "")
        ? "Unable to clone repository: verify repository access."
        : "Unable to clone repository";
      sendAppError(res, AppError.badGateway(detail, { cause: err }), req);
    }
  });

  // GET /api/system/pick-folder — abre el explorador de carpetas NATIVO de Windows
  // (servidor y navegador corren en la misma máquina — app personal de un solo
  // usuario, por eso esto es seguro aquí; en cualquier app multiusuario sería un
  // hueco de seguridad grave). Bloquea hasta que el usuario elige o cancela.
  app.get("/api/system/pick-folder", requireAuth, async (req, res) => {
    const psScript = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$owner = New-Object System.Windows.Forms.Form",
      "$owner.TopMost = $true",
      "$owner.StartPosition = 'CenterScreen'",
      "$owner.WindowState = 'Minimized'",
      "$owner.ShowInTaskbar = $false",
      "$owner.Show()",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Selecciona la carpeta del repo ya clonado'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
      "$owner.Dispose()",
    ].join("; ");
    try {
      const result = await runProcess("powershell.exe", ["-NoProfile", "-STA", "-Command", psScript], { timeoutMs: 5 * 60 * 1000 });
      res.json({ path: result.stdout.trim() || null });
    } catch (err) {
      sendAppError(res, AppError.internal("Unable to select folder", { cause: err }), req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/link-existing  body:{path, force?}
  // Registra una carpeta que el usuario YA clonó a mano en otra ruta, sin volver a
  // clonar — solo verifica que sea un repo git y (salvo force) que su remote
  // corresponda a este proyecto, y persiste el estado como si se hubiera clonado aquí.
  app.post("/api/connectors/:provider/projects/:id/link-existing", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Vincular clon local" }),
    async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    const { path: rawPath, force } = req.body || {};
    if (typeof rawPath !== "string" || !rawPath) return sendAppError(res, AppError.badRequest("path-requerido"), req);

    const target = path.resolve(rawPath);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      return sendAppError(res, AppError.notFound("Esa ruta no existe o no es una carpeta."), req);
    }
    if (!resolveGitDir(target)) {
      return sendAppError(res, AppError.badRequest("Esa carpeta no es un repositorio git (no tiene .git)."), req);
    }

    try {
      const project = await p.adapter.getProject(p.cfg, req.params.id);
      const expected = (project.path || "").toLowerCase();

      if (!force) {
        const remoteResult = await runProcess("git", ["-C", target, "remote", "get-url", "origin"]).catch(() => null);
        const remoteUrl = (remoteResult?.stdout || "").trim().toLowerCase();
        if (expected && (!remoteUrl || !remoteUrl.includes(expected))) {
          return sendAppError(res, AppError.conflict(
            "Esa carpeta parece ser otro repositorio. Si estás seguro que es el correcto, reintenta con force."
          ), req);
        }
      }

      const localClone = persistCloneState(p.name, project.id, {
        status: "cloned",
        path: target,
        cloneUrl: project.cloneUrl,
        branch: readGitBranch(target) || project.defaultBranch,
        at: new Date().toISOString(),
      });
      res.locals.auditMessage = `Vinculado clon local existente de ${project.path || project.name || req.params.id} (${target})`;
      res.json({ ok: true, path: target, localClone });
    } catch (err) {
      sendAppError(res, AppError.badGateway("Unable to link local repository", { cause: err }), req);
    }
  });

  // GET /api/connectors/:provider/repo-settings — visibilidad + ruta de clonado preferida
  // por repo, de la mini SQLite propia del módulo Repos (repos.db). No está realmente
  // particionada por proveedor (repo_settings guarda TODOS los repos por id) — se expone
  // bajo :provider solo por consistencia con el resto de rutas de Repos.
  app.get("/api/connectors/:provider/repo-settings", requireAuth, (req, res) => {
    res.json(getAllRepoSettings());
  });

  // PUT /api/connectors/:provider/projects/:id/settings  body:{visible?, clonePath?, pinned?}
  app.put("/api/connectors/:provider/projects/:id/settings", requireAuth, (req, res) => {
    const { visible, clonePath, pinned } = req.body || {};
    const patch = {};
    if (visible !== undefined) patch.visible = !!visible;
    if (clonePath !== undefined) patch.clonePath = clonePath ? String(clonePath).trim() : null;
    if (pinned !== undefined) patch.pinned = !!pinned;
    const next = setRepoSetting(req.params.id, patch);
    res.json({ ok: true, settings: next });
  });

  // GET /api/connectors/:provider/pinned-repos — repos marcados "pinned" (acceso directo
  // desde el submenú de Repos en el sidebar). Ligero: solo id/name/path.
  app.get("/api/connectors/:provider/pinned-repos", requireAuth, (req, res) => {
    const all = getAllRepoSettings();
    const pinnedIds = new Set(Object.entries(all).filter(([, s]) => s.pinned).map(([id]) => id));
    if (!pinnedIds.size) return res.json([]);
    const projects = kvGet(`connector-data-${req.params.provider}`)?.value?.projects || [];
    const result = projects
      .filter((p) => pinnedIds.has(String(p.id)))
      .map((p) => ({ id: p.id, name: p.name, path: p.path }));
    res.json(result);
  });

  // POST /api/connectors/:provider/projects/:id/prepare-env
  app.post("/api/connectors/:provider/projects/:id/prepare-env", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Preparar entorno" }),
    async (req, res) => {
    const provider = req.params.provider;
    try {
      const prepared = await prepareRepoEnvironment(provider, req.params.id);
      res.json({ ok: true, ...prepared });
    } catch (err) {
      const projectId = req.params.id;
      if (err.code !== "ENOCLONE") {
        persistCloneState(provider, projectId, {
          envStatus: "error",
          envError: err.message,
          envSupported: err.code !== "ENOPYPROJECT" ? true : false,
        });
      }
      if (err.code === "ENOCLONE") {
        return sendAppError(res, AppError.notFound("No local clone found"), req);
      }
      if (err.code === "ENOPYPROJECT") {
        return sendAppError(res, AppError.badRequest("Este repositorio no parece ser un proyecto Python preparado para venv."), req);
      }
      return sendAppError(res, AppError.badGateway("Unable to prepare repository environment", {
        cause: err,
        code: err.code || "ENVIRONMENT_ERROR",
      }), req);
    }
  });

  // ── Git history / branches (operates on the local clone) ──────────────────────
  // Recibe el adaptador ya resuelto, no el id de la conexión: requireProvider
  // devuelve `name` crudo ("github2") y `adapter` resuelto, y buscar
  // PROVIDERS["github2"] daba undefined — toda operación git desde una
  // conexión extra moría en "cannot read properties of undefined".
  function gitAuthArgs(adapter, cfg) {
    return ["-c", `http.extraheader=Authorization: ${adapter.cloneAuthHeader(cfg)}`];
  }

  function requireLocalClone(req, res) {
    const provider = req.params.provider || "gitlab";
    const localClone = findLocalClone(provider, req.params.id);
    if (!localClone?.path || !fs.existsSync(localClone.path)) {
      sendAppError(res, AppError.notFound("No hay clon local — clónalo primero."), req);
      return null;
    }
    return localClone;
  }

  // Validates a caller-provided path before passing it to Git or the filesystem.
  // This also protects the untracked-file diff path, which reads the file itself.
  function requireCloneFile(req, res, localClone, file) {
    if (typeof file !== "string" || !file) {
      sendAppError(res, AppError.badRequest("file-required"), req);
      return null;
    }
    if (!resolveInsideClone(localClone.path, file)) {
      sendAppError(res, AppError.badRequest("path-outside-repo"), req);
      return null;
    }
    return file;
  }

  // Classified in core/services/git-errors.js: a diverged branch, a rejected
  // push, an expired token and an unreachable remote each get their own code
  // and status instead of one opaque 502. Never forwards git's stderr — git
  // runs with the provider token in `-c http.extraheader`.
  // stderr de git puede arrastrar un token si alguna vez viaja en la URL del
  // remoto, así que se enmascara antes de escribirlo en ningún lado.
  function redactGitText(text) {
    return String(text || "")
      .replace(/(gh[pousr]_|glpat-)[A-Za-z0-9_-]+/g, "$1***")
      .replace(/(Authorization: ?[A-Za-z]+ )[^ ]+/gi, "$1***")
      .replace(/(https?:[/][/])[^@ /]+@/g, "$1***@")
      .trim();
  }

  function sendGitFailure(res, err, req) {
    const failure = gitFailureError(err);
    // La causa nunca viaja al cliente, y hasta ahora tampoco se escribía en
    // ninguna bitácora: un fallo de git salía como un 502 sin detalle y sin
    // una sola línea que dijera qué pasó. Va al log del conector, que es donde
    // el usuario ya mira lo que hace esa conexión.
    const provider = req?.params?.provider;
    if (provider) {
      const detail = redactGitText(err?.stderr || err?.message).split(/\r?\n/).filter(Boolean).slice(-2).join(" · ");
      connectorLog(provider, "err", `git ${req.params.id || ""} · ${failure.code || "GIT_FAILED"}${detail ? ` · ${detail}` : ""}`.slice(0, 400));
    }
    return sendAppError(res, failure, req);
  }

  function sendProviderFailure(res, err, req) {
    return sendAppError(res, AppError.badGateway("Repository provider request failed", { cause: err }), req);
  }

  // Resolves a caller-supplied repo-relative path against a clone root, refusing
  // anything that escapes it (`..`, absolute paths, symlinked parents).
  function resolveInsideClone(root, relativePath) {
    const cloneRoot = fs.realpathSync(root);
    const target = path.resolve(cloneRoot, relativePath || "");
    const withSep = cloneRoot.endsWith(path.sep) ? cloneRoot : cloneRoot + path.sep;
    if (target !== cloneRoot && !target.startsWith(withSep)) return null;
    // Re-check after following symlinks, for a link planted inside the clone.
    try {
      const real = fs.realpathSync(target);
      if (real !== cloneRoot && !real.startsWith(withSep)) return null;
      return real;
    } catch {
      return target; // does not exist yet — containment already verified above
    }
  }

  // Working-copy file list: tracked files plus untracked ones git would not
  // ignore, which is what the user actually sees in an editor.
  async function listLocalCloneTree(clonePath) {
    const result = await runProcess("git", [
      "-C", clonePath, "ls-files", "--cached", "--others", "--exclude-standard",
    ]);
    const files = [...new Set(result.stdout.split(/\r?\n/).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map((file) => ({ path: file }));
    return { files, truncated: false };
  }

  function repoAnalysisKey(provider, projectId) {
    return `repo-analysis-${provider}-${projectId}`;
  }

  // GET devuelve el último informe guardado. El análisis es local y estático:
  // nunca instala dependencias ni ejecuta código del repositorio.
  app.get("/api/connectors/:provider/projects/:id/analysis", requireAuth, (req, res) => {
    const saved = kvGet(repoAnalysisKey(req.params.provider, req.params.id))?.value;
    if (!saved) return sendAppError(res, AppError.notFound("analysis-not-found"), req);
    res.json(saved);
  });

  // POST vuelve a analizar el clon local y persiste el resultado en el KV store.
  app.post("/api/connectors/:provider/projects/:id/analysis", requireAuth, (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const report = analyzeRepository(localClone.path);
      const result = {
        ...report,
        provider: req.params.provider,
        projectId: String(req.params.id),
        branch: readGitBranch(localClone.path),
      };
      kvSet(repoAnalysisKey(req.params.provider, req.params.id), result);
      res.json(result);
    } catch (err) {
      sendAppError(res, AppError.internal("Unable to analyze repository", { cause: err }), req);
    }
  });

  // Resuelve una ruta relativa dentro del clon local, rechazando cualquier intento
  // de salirse del repo (path traversal vía "../").
  function resolveRepoPath(repoRoot, relPath) {
    const root = path.resolve(repoRoot);
    const target = path.resolve(root, relPath || "");
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw AppError.badRequest("path-fuera-del-repo");
    }
    return target;
  }

  // Genera un nombre único tipo "archivo (copy).ext", "archivo (copy 2).ext", … en
  // el mismo directorio que originalPath.
  function uniqueCopyName(originalPath) {
    const dir = path.dirname(originalPath);
    const ext = path.extname(originalPath);
    const base = path.basename(originalPath, ext);
    let candidate = path.join(dir, `${base} (copy)${ext}`);
    let n = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${base} (copy ${n})${ext}`);
      n++;
    }
    return candidate;
  }

  // POST /api/connectors/gitlab/projects/:id/fs/rename  body:{path, newName}
  app.post("/api/connectors/:provider/projects/:id/fs/rename", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Renombrar archivo" }),
    (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { path: relPath, newName } = req.body || {};
    if (!relPath || !newName || /[\\/]/.test(newName)) {
      return sendAppError(res, AppError.badRequest("path y newName (sin / ni \\) son requeridos"), req);
    }
    try {
      const src = resolveRepoPath(localClone.path, relPath);
      if (!fs.existsSync(src)) return sendAppError(res, AppError.notFound("archivo-no-encontrado"), req);
      const dest = path.join(path.dirname(src), newName);
      if (fs.existsSync(dest)) return sendAppError(res, AppError.conflict("ya-existe-un-archivo-con-ese-nombre"), req);
      fs.renameSync(src, dest);
      const destRel = path.relative(localClone.path, dest).replace(/\\/g, "/");
      res.locals.auditMessage = `Renombrado ${relPath} → ${destRel} en ${req.params.id}`;
      res.json({ ok: true, path: destRel });
    } catch (err) {
      const appErr = err instanceof AppError
        ? err
        : AppError.internal("Unable to rename repository file", { cause: err });
      sendAppError(res, appErr, req);
    }
  });

  // POST /api/connectors/gitlab/projects/:id/fs/duplicate  body:{path}
  app.post("/api/connectors/:provider/projects/:id/fs/duplicate", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Duplicar archivo" }),
    (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { path: relPath } = req.body || {};
    if (!relPath) return sendAppError(res, AppError.badRequest("path-requerido"), req);
    try {
      const src = resolveRepoPath(localClone.path, relPath);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return sendAppError(res, AppError.notFound("archivo-no-encontrado"), req);
      const dest = uniqueCopyName(src);
      fs.copyFileSync(src, dest);
      const destRel = path.relative(localClone.path, dest).replace(/\\/g, "/");
      res.locals.auditMessage = `Duplicado ${relPath} → ${destRel} en ${req.params.id}`;
      res.json({ ok: true, path: destRel });
    } catch (err) {
      const appErr = err instanceof AppError
        ? err
        : AppError.internal("Unable to duplicate repository file", { cause: err });
      sendAppError(res, appErr, req);
    }
  });

  // GET /api/connectors/gitlab/projects/:id/git/branches
  app.get("/api/connectors/:provider/projects/:id/git/branches", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const SEP = "\x1f";
      const fmt = ["%(refname:short)", "%(objectname:short)", "%(committerdate:iso-strict)", "%(HEAD)"].join(SEP);
      const result = await runProcess("git", ["-C", localClone.path, "for-each-ref",
        "--sort=-committerdate", `--format=${fmt}`, "refs/heads", "refs/remotes"]);
      const branches = result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
        const [name, sha, date, head] = line.split(SEP);
        return { name, sha, date, current: head === "*", remote: name.startsWith("origin/") && name !== "origin/HEAD" };
      }).filter(b => b.name !== "origin/HEAD");
      res.json({ branches, current: readGitBranch(localClone.path) });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // GET /api/connectors/gitlab/projects/:id/git/log?branch=&limit=
  app.get("/api/connectors/:provider/projects/:id/git/log", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const branch = req.query.branch || "HEAD";
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    try {
      const fmt = ["%H", "%h", "%an", "%ae", "%ad", "%s", "%P", "%D"].join("\x1f");
      const result = await runProcess("git", ["-C", localClone.path, "log", branch,
        `--pretty=format:${fmt}`, "--date=iso-strict", "-n", String(limit)]);
      const commits = result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
        const [sha, shortSha, author, email, date, message, parents, refs] = line.split("\x1f");
        const parentList = (parents || "").split(" ").filter(Boolean);
        return {
          sha, shortSha, author, email, date, message,
          parents: parentList, merge: parentList.length > 1,
          refs: (refs || "").split(",").map(r => r.trim()).filter(Boolean),
        };
      });
      res.json({ commits });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // GET /api/connectors/gitlab/projects/:id/git/commit/:sha — per-file status + diff, split
  // per file (like SourceTree's file list + per-file diff pane) instead of one giant blob.
  app.get("/api/connectors/:provider/projects/:id/git/commit/:sha", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const [nameStatus, numstat, fullDiff] = await Promise.all([
        runProcess("git", ["-C", localClone.path, "show", "--name-status", "--pretty=format:", req.params.sha]),
        runProcess("git", ["-C", localClone.path, "show", "--numstat", "--pretty=format:", req.params.sha]),
        runProcess("git", ["-C", localClone.path, "show", "--pretty=format:", req.params.sha]),
      ]);

      const statusByFile = {};
      nameStatus.stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
        const parts = line.split("\t");
        const status = parts[0];
        const file = parts[parts.length - 1]; // renames: "R100\told\tnew" — keep the new path
        statusByFile[file] = status[0];
      });

      const statsByFile = {};
      numstat.stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
        const [add, del, file] = line.split("\t");
        statsByFile[file] = {
          additions: add === "-" ? 0 : parseInt(add, 10) || 0,
          deletions: del === "-" ? 0 : parseInt(del, 10) || 0,
        };
      });

      // Split the unified diff into per-file segments on "diff --git a/... b/..." boundaries
      const segments = [];
      let current = null;
      for (const line of fullDiff.stdout.split(/\r?\n/)) {
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (m) {
          if (current) segments.push(current);
          current = { file: m[2], lines: [line] };
        } else if (current) {
          current.lines.push(line);
        }
      }
      if (current) segments.push(current);

      const files = segments.map(seg => ({
        file: seg.file,
        status: statusByFile[seg.file] || "M",
        additions: statsByFile[seg.file]?.additions ?? 0,
        deletions: statsByFile[seg.file]?.deletions ?? 0,
        diff: seg.lines.slice(0, 2000),
      }));

      res.json({ files });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // GET /api/connectors/gitlab/projects/:id/git/status — working copy (staged/unstaged/untracked),
  // like SourceTree's "File Status" tab: what's changed locally and not yet committed.
  app.get("/api/connectors/:provider/projects/:id/git/status", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const result = await runProcess("git", ["-C", localClone.path, "status", "--porcelain=v1"]);
      const staged = [], unstaged = [];
      result.stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
        const x = line[0], y = line[1];
        let file = line.slice(3);
        if (file.includes(" -> ")) file = file.split(" -> ")[1];
        if (x === "?" && y === "?") { unstaged.push({ file, status: "?" }); return; }
        if (x !== " ") staged.push({ file, status: x });
        if (y !== " ") unstaged.push({ file, status: y });
      });
      res.json({ staged, unstaged, branch: readGitBranch(localClone.path) });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // GET /api/connectors/gitlab/projects/:id/git/diff?file=&mode=staged|unstaged|untracked — working copy diff for one file
  app.get("/api/connectors/:provider/projects/:id/git/diff", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { file, mode } = req.query;
    const safeFile = requireCloneFile(req, res, localClone, file);
    if (!safeFile) return;
    try {
      if (mode === "untracked") {
        let lines;
        try {
          lines = fs.readFileSync(resolveInsideClone(localClone.path, safeFile), "utf8").split(/\r?\n/);
        } catch (_) {
          return res.json({ diff: ["(binario o no se pudo leer el archivo)"] });
        }
        return res.json({ diff: [
          `diff --git a/${safeFile} b/${safeFile}`, "new file mode 100644",
          "--- /dev/null", `+++ b/${safeFile}`, `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map(l => `+${l}`),
        ].slice(0, 2000) });
      }
      const args = ["-C", localClone.path, "diff"];
      if (mode === "staged") args.push("--cached");
      args.push("--", safeFile);
      const result = await runProcess("git", args);
      res.json({ diff: result.stdout.split(/\r?\n/).slice(0, 2000) });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/git/file-diff-since?path=&sha=&ref=
  // — ONE file's diff between an older commit and `ref` (defaults to HEAD):
  // "what changed in this file since then, up to now" — not the whole
  // commit's file list. Used by CodeViewer's per-file history panel; a plain
  // `git show <sha>` there shows commit-vs-parent across every file it
  // touched, which is the wrong comparison when you already picked one file
  // and want it against the current version.
  app.get("/api/connectors/:provider/projects/:id/git/file-diff-since", requireAuth, async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { path: file, sha, ref } = req.query;
    const safeFile = requireCloneFile(req, res, localClone, file);
    if (!safeFile) return;
    if (typeof sha !== "string" || !sha) return sendAppError(res, AppError.badRequest("sha-required"), req);
    try {
      const result = await runProcess("git", [
        "-C", localClone.path, "diff", `${sha}..${ref || "HEAD"}`, "--", safeFile,
      ]);
      res.json({ diff: result.stdout.split(/\r?\n/).slice(0, 2000) });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // POST /api/connectors/gitlab/projects/:id/git/stage  body:{file}
  app.post("/api/connectors/:provider/projects/:id/git/stage", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "git add" }),
    async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { file } = req.body || {};
    const safeFile = requireCloneFile(req, res, localClone, file);
    if (!safeFile) return;
    try {
      await runProcess("git", ["-C", localClone.path, "add", "--", safeFile]);
      res.locals.auditMessage = `git add ${safeFile} en ${req.params.id}`;
      res.json({ ok: true });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // POST /api/connectors/gitlab/projects/:id/git/unstage  body:{file}
  app.post("/api/connectors/:provider/projects/:id/git/unstage", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "git reset" }),
    async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { file } = req.body || {};
    const safeFile = requireCloneFile(req, res, localClone, file);
    if (!safeFile) return;
    try {
      await runProcess("git", ["-C", localClone.path, "reset", "--", safeFile]);
      res.locals.auditMessage = `git reset ${safeFile} en ${req.params.id}`;
      res.json({ ok: true });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // Commits made through Lintaya can be forced to land as a specific
  // per-connection identity instead of the machine's global git config — e.g. a
  // work account for the provider hosting work repositories, while the machine
  // itself is configured with a personal one. Edited from the connector's detail
  // panel (kv "connector-commit-identity", see server/routes/connectors.js) and
  // applied by the server to every commit, whether the caller is the user or an
  // agent — which is why it is a structured setting and not a line of the
  // connector's free-form AI context. Empty by default, in which case git keeps
  // resolving the identity itself. Passed as -c overrides so it never touches
  // the global or per-clone .git/config.
  // Resolution order, most specific first: the exact connection ("gitlab3"),
  // its base type ("gitlab"), then the same two keys from the environment.
  // The kv entries are what the connector detail panel writes; the env var is
  // the headless/CI fallback for installs with no UI session.
  const ENV_COMMIT_IDENTITY = config.git?.commitIdentity || {};
  function commitIdentityFor(connectionId) {
    const saved = kvGet("connector-commit-identity")?.value || {};
    const baseType = resolveConnectorType(connectionId);
    return saved[connectionId] || saved[baseType]
      || ENV_COMMIT_IDENTITY[connectionId] || ENV_COMMIT_IDENTITY[baseType] || null;
  }
  function commitIdentityArgs(connectionId) {
    const identity = commitIdentityFor(connectionId);
    return identity ? ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`] : [];
  }

  // POST /api/connectors/gitlab/projects/:id/git/commit  body:{message} — commits currently staged changes locally
  app.post("/api/connectors/:provider/projects/:id/git/commit", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Commit" }),
    async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { message } = req.body || {};
    if (!message?.trim()) return sendAppError(res, AppError.badRequest("message-required"), req);
    try {
      const result = await runProcess("git", ["-C", localClone.path, ...commitIdentityArgs(req.params.provider), "commit", "-m", message]);
      res.locals.auditMessage = `Commit "${message.split("\n")[0].slice(0, 80)}" en ${req.params.id}`;
      res.json({ ok: true, output: `${result.stdout}\n${result.stderr}`.trim() });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/git/fetch
  app.post("/api/connectors/:provider/projects/:id/git/fetch", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "git fetch" }),
    async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const result = await runProcess("git", ["-C", localClone.path, ...gitAuthArgs(p.adapter, p.cfg), "fetch", "--prune", "--all"]);
      res.locals.auditMessage = `git fetch en ${req.params.id}`;
      res.json({ ok: true, output: `${result.stdout}\n${result.stderr}`.trim() });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/git/pull
  app.post("/api/connectors/:provider/projects/:id/git/pull", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "git pull" }),
    async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const result = await runProcess("git", ["-C", localClone.path, ...gitAuthArgs(p.adapter, p.cfg), "pull", "--ff-only"]);
      persistCloneState(p.name, req.params.id, { branch: readGitBranch(localClone.path) });
      res.locals.auditMessage = `git pull en ${req.params.id}`;
      res.json({ ok: true, output: `${result.stdout}\n${result.stderr}`.trim() });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/git/push
  app.post("/api/connectors/:provider/projects/:id/git/push", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "git push" }),
    async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    try {
      const result = await runProcess("git", ["-C", localClone.path, ...gitAuthArgs(p.adapter, p.cfg), "push"]);
      res.locals.auditMessage = `git push en ${req.params.id}`;
      res.json({ ok: true, output: `${result.stdout}\n${result.stderr}`.trim() });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/git/checkout  body:{branch}
  app.post("/api/connectors/:provider/projects/:id/git/checkout", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "git checkout" }),
    async (req, res) => {
    const localClone = requireLocalClone(req, res);
    if (!localClone) return;
    const { branch } = req.body || {};
    if (!branch) return sendAppError(res, AppError.badRequest("branch-required"), req);
    const localName = branch.replace(/^origin\//, "");
    try {
      await runProcess("git", ["-C", localClone.path, "checkout", "-B", localName, branch]);
      const current = readGitBranch(localClone.path);
      persistGitlabCloneState(req.params.id, { branch: current });
      res.locals.auditMessage = `git checkout ${current} en ${req.params.id}`;
      res.json({ ok: true, branch: current });
    } catch (err) {
      sendGitFailure(res, err, req);
    }
  });

  // GET /api/repos/network-tools/status
  app.get("/api/repos/network-tools/status", requireAuth, async (req, res) => {
    const runtime = getNetworkToolsRuntimeSnapshot();
    const health = await probeNetworkToolsHealth();
    if (health.ok) runtime.status = "running";
    else if (runtime.status === "running") runtime.status = "stopped";
    res.json({ ok: true, ...runtime, health });
  });

  // POST /api/repos/network-tools/play
  app.post("/api/repos/network-tools/play", requireAuth,
    auditWrite({ provider: "network-tools", action: "Play network-tools" }),
    async (req, res) => {
    try {
      const started = await startNetworkToolsProcess({ parentOrigin: req.body?.parentOrigin });
      const snapshot = getNetworkToolsRuntimeSnapshot();
      res.json({ ok: true, ...snapshot, started });
    } catch (err) {
      if (err.code === "ENOCLONE") {
        return sendAppError(res, AppError.notFound("network-tools-no-local-clone"), req);
      }
      return sendAppError(res, AppError.badGateway("Unable to start network-tools", { cause: err }), req);
    }
  });

  // POST /api/repos/network-tools/stop
  app.post("/api/repos/network-tools/stop", requireAuth,
    auditWrite({ provider: "network-tools", action: "Stop network-tools" }),
    async (req, res) => {
    const stopped = stopNetworkToolsProcess();
    res.json({ ok: true, ...getNetworkToolsRuntimeSnapshot(), stopped });
  });

  // GET /api/connectors/:provider/runtimes — estado del launcher genérico ("Play") de
  // TODOS los repos conocidos en un solo request (evita 1 poll por card en el grid).
  // No está particionado por proveedor (repoRuntimes es un Map global por id) — se
  // expone bajo :provider solo por consistencia con el resto de rutas de Repos.
  app.get("/api/connectors/:provider/runtimes", requireAuth, async (req, res) => {
    const out = {};
    for (const [id, rt] of repoRuntimes.entries()) {
      if (rt.port) {
        const health = await probeRepoHealth(rt.port);
        if (health.ok) rt.status = "running";
        else if (rt.status === "running") rt.status = "stopped";
      }
      out[id] = getRepoRuntimeSnapshot(id);
    }
    res.json(out);
  });

  // POST /api/connectors/:provider/projects/:id/runtime/play
  app.post("/api/connectors/:provider/projects/:id/runtime/play", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Play runtime" }),
    async (req, res) => {
    try {
      const started = await startRepoProcess(req.params.provider, req.params.id);
      res.json({ ok: true, ...getRepoRuntimeSnapshot(req.params.id), started });
    } catch (err) {
      const knownErrors = {
        ENOCLONE: () => AppError.notFound("Este repo no está clonado localmente."),
        ENOENV: () => AppError.conflict("Prepara el entorno (venv) antes de darle Play."),
        ENOENTRYPOINT: () => AppError.unprocessable("No encontré un app.py ni manage.py en este repo — Play no sabe cómo arrancarlo."),
        ENOPYTHON: () => AppError.unprocessable("No encontré el intérprete de Python del venv.", { code: "PYTHON_NOT_FOUND" }),
      };
      const appError = knownErrors[err.code]?.()
        || AppError.badGateway("Unable to start repository runtime", { cause: err });
      return sendAppError(res, appError, req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/runtime/stop
  app.post("/api/connectors/:provider/projects/:id/runtime/stop", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Stop runtime" }),
    (req, res) => {
    const stopped = stopRepoProcess(req.params.id);
    res.json({ ok: true, ...getRepoRuntimeSnapshot(req.params.id), stopped });
  });

  // GitLab config/test/sync routes live in connectors/community/gitlab.
  // Advanced GitLab and shared repository routes below reuse its exported client.

  // GitHub config/test/sync routes live in connectors/community/github.
  // Shared repository operations below reuse its exported HTTP client.

  // Bitbucket Cloud and Server/Data Center transport helpers live in the package.
  // The shared provider adapter below reuses the exported client and path helpers.

  // Extensiones de imagen que el visor de archivos de Repos puede mostrar como
  // <img> en vez de texto. Leer estos bytes como UTF-8 (lo que hacían getFile y
  // el lector de clon local antes de esto) los corrompe — hay que traerlos
  // crudos y mandarlos en base64 para que el frontend arme un data: URI.
  const IMAGE_MIME_BY_EXT = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
    svg: "image/svg+xml",
  };
  function imageMimeForPath(filePath) {
    const ext = String(filePath || "").split(".").pop().toLowerCase();
    return IMAGE_MIME_BY_EXT[ext] || null;
  }

  // GET /repos/:id/actions/jobs/:jobId/logs siempre responde 302 a una URL
  // firmada de blob storage con el log en texto plano — githubRequest (vía
  // requestJson) no sigue redirects, así que esto hace la petición cruda con
  // https/http directamente (mismo patrón que el proxy de avatar de GitLab
  // más abajo) y sigue el Location a mano. La URL firmada no lleva el token
  // de GitHub (rechazaría la request si se lo mandamos junto con su propia
  // firma), por eso el segundo intento va sin Authorization.
  function fetchGithubJobLogText(cfg, id, jobId) {
    return new Promise((resolve) => {
      const attempt = (targetUrl, useAuth, redirectsLeft) => {
        let url;
        try { url = new URL(targetUrl); } catch { resolve(""); return; }
        const isHttps = url.protocol === "https:";
        const lib = isHttps ? https : http;
        const req = lib.request({
          hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search, method: "GET",
          headers: useAuth
            ? { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "User-Agent": "lintaya", "X-GitHub-Api-Version": "2022-11-28" }
            : { "User-Agent": "lintaya" },
          timeout: 15000,
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
            res.resume();
            attempt(res.headers.location, false, redirectsLeft - 1);
            return;
          }
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve(res.statusCode < 400 ? body : ""));
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(""));
        req.end();
      };
      attempt(`${(cfg.baseUrl || "https://api.github.com").replace(/\/$/, "")}/repos/${id}/actions/jobs/${jobId}/logs`, true, 3);
    });
  }

  // ── Provider adapter ─────────────────────────────────────────────────────────
  // Un solo conjunto de rutas de Repos (clone, link-existing, branches remotas,
  // tree, file — las operaciones que SÍ hablan con la API del proveedor) sirve a
  // GitLab, GitHub y Bitbucket llamando a este adaptador en vez de gitlabRequest/
  // githubRequest/bitbucketRequest directamente. Todo lo que es puramente git/
  // filesystem local (git status/diff/commit, fs rename/duplicate, prepare-env,
  // el launcher "Play") NO pasa por aquí — ya es genérico (ver findLocalClone/
  // persistCloneState arriba) porque no le importa de qué proveedor vino el repo,
  // solo dónde está clonado en disco.
  const PROVIDERS = {
    gitlab: {
      async getProject(cfg, id) {
        const p = await gitlabRequest(cfg.baseUrl, cfg.token, `/api/v4/projects/${id}`);
        return { id: String(p.id), name: p.name, path: p.path_with_namespace, cloneUrl: p.http_url_to_repo || p.ssh_url_to_repo, defaultBranch: p.default_branch || "main" };
      },
      cloneAuthHeader(cfg) {
        return "Basic " + Buffer.from(`oauth2:${cfg.token}`, "utf8").toString("base64");
      },
      async listBranches(cfg, id) {
        const data = await gitlabRequest(cfg.baseUrl, cfg.token, `/api/v4/projects/${id}/repository/branches?per_page=100`);
        return (Array.isArray(data) ? data : []).map(b => ({ name: b.name, protected: !!b.protected, default: !!b.default }));
      },
      async listTree(cfg, id, ref) {
        // gitlabRequest fetches a single page — a recursive tree past the first
        // 100 entries needs its own pagination loop, same pattern as syncGitlab.
        const MAX_FILES = 2000, MAX_PAGES = 20; // 20 * 100 = 2000
        const blobs = [];
        let hitPageCap = false;
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const data = await gitlabRequest(cfg.baseUrl, cfg.token,
            `/api/v4/projects/${id}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(ref || "")}`);
          const items = Array.isArray(data) ? data : [];
          blobs.push(...items.filter(f => f.type === "blob"));
          if (items.length < 100) break;
          if (page === MAX_PAGES) hitPageCap = true;
        }
        return {
          files: blobs.map(f => ({ path: f.path })).sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES),
          total: blobs.length,
          truncated: blobs.length > MAX_FILES || hitPageCap,
        };
      },
      async getFile(cfg, id, filePath, ref) {
        const mime = imageMimeForPath(filePath);
        const rawPath = `/api/v4/projects/${id}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref || "")}`;
        if (mime) {
          const buf = await gitlabRequest(cfg.baseUrl, cfg.token, rawPath, "GET", null, null, "buffer");
          return { content: buf.toString("base64"), encoding: "base64", mime };
        }
        const content = await gitlabRequest(cfg.baseUrl, cfg.token, rawPath);
        return typeof content === "string" ? content : JSON.stringify(content, null, 2);
      },
      // Lista solo un nivel de `dirPath` (raíz si es "") — a diferencia de
      // listTree, que trae todo el árbol recursivo de una. Lo usa el árbol de
      // archivos del frontend para cargar carpetas al abrirlas, en vez de traer
      // el repo entero de entrada.
      async listDir(cfg, id, dirPath, ref) {
        const folders = [], files = [];
        for (let page = 1; page <= 5; page += 1) {
          const data = await gitlabRequest(cfg.baseUrl, cfg.token,
            `/api/v4/projects/${id}/repository/tree?path=${encodeURIComponent(dirPath || "")}&per_page=100&page=${page}&ref=${encodeURIComponent(ref || "")}`);
          const items = Array.isArray(data) ? data : [];
          for (const it of items) {
            (it.type === "tree" ? folders : files).push({ name: it.name, path: it.path });
          }
          if (items.length < 100) break;
        }
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        return { folders, files };
      },
      async listPipelines(cfg, id, ref) {
        const data = await gitlabRequest(cfg.baseUrl, cfg.token,
          `/api/v4/projects/${id}/pipelines?ref=${encodeURIComponent(ref || "")}&per_page=10&order_by=id&sort=desc`);
        const list = Array.isArray(data) ? data : [];
        // Fill in sha/duration from the detail endpoint (list endpoint omits them)
        const detailed = await Promise.all(list.map(p =>
          gitlabRequest(cfg.baseUrl, cfg.token, `/api/v4/projects/${id}/pipelines/${p.id}`).catch(() => p)
        ));
        return detailed.map(p => ({
          id: p.id, status: p.status, ref: p.ref,
          sha: (p.sha || "").slice(0, 8),
          duration: p.duration ? `${p.duration}s` : "—",
          when: p.created_at,
          author: p.user?.name || p.user?.username || null,
          authorAvatar: p.user?.avatar_url || null,
        }));
      },
      async listPipelineJobs(cfg, id, pipelineId) {
        const jobs = await gitlabRequest(cfg.baseUrl, cfg.token, `/api/v4/projects/${id}/pipelines/${pipelineId}/jobs?per_page=100`);
        const jobList = Array.isArray(jobs) ? jobs : [];
        // GitLab returns newest-first; reverse to stage/creation order for a left-to-right build waterfall
        return jobList.map(j => ({
          id: j.id, name: j.name, stage: j.stage, status: j.status,
          duration: j.duration || null, startedAt: j.started_at, finishedAt: j.finished_at,
          createdAt: j.created_at, allowFailure: !!j.allow_failure, webUrl: j.web_url,
        })).reverse();
      },
      async getJobTrace(cfg, id, jobId) {
        const t = await gitlabRequest(cfg.baseUrl, cfg.token, `/api/v4/projects/${id}/jobs/${jobId}/trace`, "GET", null, null, "text").catch(() => "");
        return typeof t === "string" ? t : "";
      },
      async triggerPipeline(cfg, id, ref) {
        const p = await gitlabRequest(cfg.baseUrl, cfg.token,
          `/api/v4/projects/${id}/pipeline?ref=${encodeURIComponent(ref)}`, "POST");
        return { id: p.id, status: p.status, webUrl: p.web_url };
      },
      async listFileCommits(cfg, id, filePath, ref, limit) {
        const data = await gitlabRequest(cfg.baseUrl, cfg.token,
          `/api/v4/projects/${id}/repository/commits?path=${encodeURIComponent(filePath)}&ref_name=${encodeURIComponent(ref || "")}&per_page=${limit}`);
        const list = Array.isArray(data) ? data : [];
        return list.map(c => ({
          sha: (c.id || "").slice(0, 8),
          message: (c.title || c.message || "").split("\n")[0],
          author: c.author_name || null, authorAvatar: null,
          when: c.authored_date || c.created_at, webUrl: c.web_url,
        }));
      },
    },
    github: {
      async getProject(cfg, id) {
        const p = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}`);
        return { id: p.full_name, name: p.name, path: p.full_name, cloneUrl: p.clone_url, defaultBranch: p.default_branch || "main" };
      },
      cloneAuthHeader(cfg) {
        // GitHub HTTPS clone con PAT: el token va como "username", password vacío.
        return "Basic " + Buffer.from(`${cfg.token}:x-oauth-basic`, "utf8").toString("base64");
      },
      async listBranches(cfg, id) {
        const data = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/branches?per_page=100`);
        return (Array.isArray(data) ? data : []).map(b => ({ name: b.name, protected: !!b.protected, default: false }));
      },
      async listTree(cfg, id, ref) {
        const data = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/git/trees/${encodeURIComponent(ref || "")}?recursive=1`);
        const blobs = (Array.isArray(data?.tree) ? data.tree : []).filter(f => f.type === "blob");
        const MAX_FILES = 2000;
        return {
          files: blobs.map(f => ({ path: f.path })).sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES),
          total: blobs.length,
          truncated: blobs.length > MAX_FILES || !!data?.truncated,
        };
      },
      async getFile(cfg, id, filePath, ref) {
        const mime = imageMimeForPath(filePath);
        const rawPath = `/repos/${id}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref || "")}`;
        if (mime) {
          const buf = await githubRequest(cfg.baseUrl, cfg.token, rawPath, "GET", null, { Accept: "application/vnd.github.raw+json" }, "buffer");
          return { content: buf.toString("base64"), encoding: "base64", mime };
        }
        return githubRequest(cfg.baseUrl, cfg.token, rawPath, "GET", null, { Accept: "application/vnd.github.raw+json" });
      },
      // Un nivel de `dirPath` (raíz si es "") — ver el comentario en gitlab.listDir.
      async listDir(cfg, id, dirPath, ref) {
        const encPath = String(dirPath || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
        const data = await githubRequest(cfg.baseUrl, cfg.token,
          `/repos/${id}/contents/${encPath}?ref=${encodeURIComponent(ref || "")}`);
        const items = Array.isArray(data) ? data : [data];
        const folders = items.filter(it => it?.type === "dir").map(it => ({ name: it.name, path: it.path })).sort((a, b) => a.name.localeCompare(b.name));
        const files = items.filter(it => it?.type === "file").map(it => ({ name: it.name, path: it.path })).sort((a, b) => a.name.localeCompare(b.name));
        return { folders, files };
      },
      // "Pipeline" de GitLab = "workflow run" de GitHub Actions. Sin
      // triggerPipeline a propósito: GitHub no tiene "un" pipeline por repo —
      // dispararlo requeriría saber a cuál de los workflows del repo apuntar,
      // y no todos aceptan workflow_dispatch. La ruta POST /pipelines responde
      // "trigger-not-supported" cuando el adapter no lo declara.
      async listPipelines(cfg, id, ref) {
        const data = await githubRequest(cfg.baseUrl, cfg.token,
          `/repos/${id}/actions/runs?branch=${encodeURIComponent(ref || "")}&per_page=10`);
        const list = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
        return list.map(r => ({
          id: r.id, status: normalizeGithubRunStatus(r), ref: r.head_branch,
          sha: (r.head_sha || "").slice(0, 8),
          duration: r.run_started_at && r.updated_at
            ? `${Math.max(0, Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000))}s`
            : "—",
          when: r.created_at,
          author: r.actor?.login || null,
          authorAvatar: r.actor?.avatar_url || null,
        }));
      },
      async listPipelineJobs(cfg, id, pipelineId) {
        const data = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/actions/runs/${pipelineId}/jobs?per_page=100`);
        const list = Array.isArray(data?.jobs) ? data.jobs : [];
        // GitHub Actions no agrupa jobs en "stages" — cada job es su propia
        // columna en la waterfall (BuildPanel agrupa por `stage`).
        return list.map(j => ({
          id: j.id, name: j.name, stage: j.name, status: normalizeGithubRunStatus(j),
          duration: j.started_at && j.completed_at
            ? Math.max(0, Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000))
            : null,
          startedAt: j.started_at, finishedAt: j.completed_at, createdAt: j.started_at,
          allowFailure: false, webUrl: j.html_url,
        }));
      },
      async getJobTrace(cfg, id, jobId) {
        return await fetchGithubJobLogText(cfg, id, jobId);
      },
      async listFileCommits(cfg, id, filePath, ref, limit) {
        const data = await githubRequest(cfg.baseUrl, cfg.token,
          `/repos/${id}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(ref || "")}&per_page=${limit}`);
        const list = Array.isArray(data) ? data : [];
        return list.map(c => ({
          sha: (c.sha || "").slice(0, 8),
          message: (c.commit?.message || "").split("\n")[0],
          author: c.commit?.author?.name || c.author?.login || null,
          authorAvatar: c.author?.avatar_url || null,
          when: c.commit?.author?.date, webUrl: c.html_url,
        }));
      },
      // Los tres detalles devuelven una forma comun a proposito: el panel los
      // pinta con un solo componente, y lo que cambia entre fuentes es de donde
      // sale cada campo, no como se lee.
      async getSecurityAdvisory(cfg, id, ghsaId) {
        const advisory = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/security-advisories/${ghsaId}`);
        return {
          kind: "advisory",
          id: advisory.ghsa_id,
          title: advisory.summary || advisory.ghsa_id,
          severity: advisory.severity || null,
          state: advisory.state || null,
          description: advisory.description || "",
          cvssScore: advisory.cvss?.score ?? null,
          cvssVector: advisory.cvss?.vector_string || null,
          cwes: (advisory.cwes || []).map(cwe => cwe.cwe_id).filter(Boolean),
          cve: advisory.cve_id || null,
          // Quien reporto el fallo. Se nombra porque reconocerlo es parte de
          // como funciona el reporte responsable, no un adorno.
          credits: (advisory.credits || []).map(credit => credit.login || credit.user?.login).filter(Boolean),
          affected: (advisory.vulnerabilities || []).map(item => [
            item.package?.name, item.vulnerable_version_range,
          ].filter(Boolean).join(" ")).filter(Boolean),
          publishedAt: advisory.published_at || null,
          updatedAt: advisory.updated_at || null,
          webUrl: advisory.html_url || null,
        };
      },
      async getCodeScanningAlert(cfg, id, number) {
        const alert = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/code-scanning/alerts/${number}`);
        const location = alert.most_recent_instance?.location;
        return {
          kind: "code-scanning",
          id: String(alert.number),
          title: alert.rule?.description || alert.rule?.id || String(alert.number),
          severity: alert.rule?.security_severity_level || alert.rule?.severity || null,
          state: alert.state || null,
          // help trae el "como se arregla"; full_description solo repite el que.
          description: [alert.rule?.full_description, alert.rule?.help].filter(Boolean).join("\n\n"),
          // El mensaje de la instancia es el hallazgo concreto ("score is 0:
          // branch protection not enabled"), no la teoria de la regla.
          finding: alert.most_recent_instance?.message?.text || null,
          rule: alert.rule?.id || null,
          tool: alert.tool?.name || null,
          tags: alert.rule?.tags || [],
          path: location?.path?.startsWith("no file") ? null : (location?.path || null),
          line: location?.start_line || null,
          publishedAt: alert.created_at || null,
          updatedAt: alert.updated_at || null,
          webUrl: alert.html_url || null,
        };
      },
      async getDependabotAlert(cfg, id, number) {
        const alert = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/dependabot/alerts/${number}`);
        const advisory = alert.security_advisory || {};
        return {
          kind: "dependabot",
          id: String(alert.number),
          title: advisory.summary || advisory.ghsa_id || String(alert.number),
          severity: alert.security_vulnerability?.severity || advisory.severity || null,
          state: alert.state || null,
          description: advisory.description || "",
          cvssScore: advisory.cvss?.score ?? null,
          cvssVector: advisory.cvss?.vector_string || null,
          cwes: (advisory.cwes || []).map(cwe => cwe.cwe_id).filter(Boolean),
          cve: advisory.cve_id || null,
          affected: [[
            alert.dependency?.package?.name,
            alert.security_vulnerability?.vulnerable_version_range,
          ].filter(Boolean).join(" ")].filter(Boolean),
          fixedIn: alert.security_vulnerability?.first_patched_version?.identifier || null,
          manifestPath: alert.dependency?.manifest_path || null,
          publishedAt: alert.created_at || null,
          updatedAt: alert.updated_at || null,
          webUrl: alert.html_url || null,
        };
      },

      // Los avisos que el propio repositorio publica sobre si mismo: los
      // redacta un mantenedor, no los deduce un escaner, asi que un "critical"
      // en estado triage aqui pesa mas que cualquier hallazgo automatico.
      async listSecurityAdvisories(cfg, id) {
        const data = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/security-advisories?per_page=100`);
        const list = Array.isArray(data) ? data : [];
        return list.map(advisory => ({
          id: advisory.ghsa_id,
          state: advisory.state,
          severity: advisory.severity || null,
          summary: advisory.summary || null,
          cve: advisory.cve_id || null,
          publishedAt: advisory.published_at || null,
          updatedAt: advisory.updated_at || null,
          webUrl: advisory.html_url || null,
        }));
      },
      // Hallazgos de los escaneres de codigo (CodeQL, Scorecard, lo que el
      // repositorio tenga conectado). GitHub trae dos severidades por alerta:
      // manda la de seguridad, y la generica de la regla es el respaldo cuando
      // la herramienta no clasifica en terminos de seguridad.
      async listCodeScanningAlerts(cfg, id, state) {
        const wanted = state === "closed" || state === "dismissed" || state === "fixed" ? state : "open";
        const data = await githubRequest(cfg.baseUrl, cfg.token,
          `/repos/${id}/code-scanning/alerts?state=${wanted}&per_page=100`);
        const list = Array.isArray(data) ? data : [];
        return list.map(alert => ({
          number: alert.number,
          state: alert.state,
          severity: alert.rule?.security_severity_level || alert.rule?.severity || null,
          rule: alert.rule?.id || null,
          description: alert.rule?.description || null,
          tool: alert.tool?.name || null,
          // GitHub devuelve literalmente "no file associated with this alert"
          // para hallazgos que no viven en una linea (los de Scorecard, por
          // ejemplo); mostrar esa frase como si fuera una ruta seria peor que
          // no mostrar nada.
          path: alert.most_recent_instance?.location?.path?.startsWith("no file") ? null : (alert.most_recent_instance?.location?.path || null),
          line: alert.most_recent_instance?.location?.start_line || null,
          createdAt: alert.created_at || null,
          webUrl: alert.html_url || null,
        }));
      },
      // Dependabot alerts — GitHub-only (GitLab/Bitbucket have their own,
      // differently-shaped dependency-scanning APIs, not covered here).
      // Needs the token to carry `security_events` (classic PAT) or
      // "Dependabot alerts: read" (fine-grained PAT); GitHub 403s otherwise.
      // Pull requests e issues — GitHub-only por ahora, igual que las alertas
      // de Dependabot de abajo: GitLab llama "merge requests" a lo mismo con
      // otra forma de respuesta, y Bitbucket Cloud y Server difieren entre si.
      // Las rutas responden "<recurso>-not-supported" donde no este declarado,
      // asi que agregar un proveedor es agregar su metodo y nada mas.
      async listPullRequests(cfg, id, state) {
        const wanted = state === "closed" || state === "all" ? state : "open";
        const data = await githubRequest(cfg.baseUrl, cfg.token,
          `/repos/${id}/pulls?state=${wanted}&per_page=50&sort=updated&direction=desc`);
        const list = Array.isArray(data) ? data : [];
        return list.map(pr => ({
          number: pr.number,
          title: pr.title,
          // GitHub marca como "closed" tanto el PR fusionado como el
          // descartado, y solo los distingue por merged_at. Sin esto la lista
          // leeria igual un trabajo aceptado y uno tirado a la basura.
          state: pr.merged_at ? "merged" : pr.state,
          draft: !!pr.draft,
          author: pr.user?.login || null,
          authorAvatar: pr.user?.avatar_url || null,
          sourceBranch: pr.head?.ref || null,
          targetBranch: pr.base?.ref || null,
          labels: (pr.labels || []).map(label => label?.name).filter(Boolean),
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          webUrl: pr.html_url,
        }));
      },
      // Detalle de un pull request: lo que la fila de la lista no trae —
      // descripcion, si se puede fusionar, cuanto cambia, revisiones y checks.
      async getPullRequest(cfg, id, number) {
        const pr = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/pulls/${number}`);
        // Las cuatro listas de apoyo son independientes y ninguna es
        // imprescindible: un token sin permiso para leer checks no debe tumbar
        // el detalle entero, asi que cada una cae a vacio por su cuenta.
        const opcional = promesa => promesa.then(data => Array.isArray(data) ? data : data || null).catch(() => null);
        const [files, commits, reviews, checks] = await Promise.all([
          opcional(githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/pulls/${number}/files?per_page=100`)),
          opcional(githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/pulls/${number}/commits?per_page=100`)),
          opcional(githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/pulls/${number}/reviews?per_page=100`)),
          pr.head?.sha
            ? opcional(githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/commits/${pr.head.sha}/check-runs?per_page=100`))
            : Promise.resolve(null),
        ]);
        const runs = Array.isArray(checks?.check_runs) ? checks.check_runs : [];
        const conclusionDe = run => run.status !== "completed" ? "pending" : (run.conclusion || "pending");
        return {
          number: pr.number,
          title: pr.title,
          state: pr.merged_at ? "merged" : pr.state,
          draft: !!pr.draft,
          body: pr.body || "",
          author: pr.user?.login || null,
          authorAvatar: pr.user?.avatar_url || null,
          sourceBranch: pr.head?.ref || null,
          targetBranch: pr.base?.ref || null,
          labels: (pr.labels || []).map(label => label?.name).filter(Boolean),
          assignees: (pr.assignees || []).map(person => person?.login).filter(Boolean),
          // GitHub separa a quien se le pidio revision de quien ya reviso; la
          // primera lista se vacia cuando esa persona responde, asi que sola
          // no dice quien esta involucrado.
          requestedReviewers: (pr.requested_reviewers || []).map(person => person?.login).filter(Boolean),
          // mergeable es "no hay conflicto con la rama destino"; mergeableState
          // ademas incorpora checks y revisiones — "unstable" es fusionable con
          // algun check sin exito, y no es lo mismo que "dirty" (conflicto).
          mergeable: pr.mergeable,
          mergeableState: pr.mergeable_state || null,
          additions: pr.additions ?? null,
          deletions: pr.deletions ?? null,
          changedFiles: pr.changed_files ?? null,
          commitCount: pr.commits ?? null,
          comments: (pr.comments || 0) + (pr.review_comments || 0),
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          mergedAt: pr.merged_at || null,
          webUrl: pr.html_url,
          files: (files || []).map(file => ({
            path: file.filename, status: file.status,
            additions: file.additions, deletions: file.deletions,
          })),
          commits: (commits || []).map(commit => ({
            sha: (commit.sha || "").slice(0, 8),
            message: (commit.commit?.message || "").split("\n")[0],
            author: commit.commit?.author?.name || commit.author?.login || null,
            when: commit.commit?.author?.date || null,
          })),
          reviews: (reviews || [])
            .filter(review => review.state !== "PENDING")
            .map(review => ({
              author: review.user?.login || null,
              state: review.state,
              when: review.submitted_at || null,
            })),
          checks: {
            total: runs.length,
            success: runs.filter(run => conclusionDe(run) === "success").length,
            failed: runs.filter(run => ["failure", "timed_out", "cancelled", "action_required"].includes(conclusionDe(run))).length,
            pending: runs.filter(run => conclusionDe(run) === "pending").length,
            runs: runs.map(run => ({
              name: run.name, status: run.status,
              conclusion: conclusionDe(run), webUrl: run.html_url,
            })),
          },
        };
      },
      async getIssue(cfg, id, number) {
        const issue = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/issues/${number}`);
        // Los comentarios son donde un issue se decide; sin ellos el detalle
        // repite la fila con mas letras. Fallan por su cuenta: un hilo que no
        // se puede leer no debe tumbar el resto del detalle.
        const comentarios = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/issues/${number}/comments?per_page=100`)
          .then(data => Array.isArray(data) ? data : [])
          .catch(() => null);
        return {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          stateReason: issue.state_reason || null,
          body: issue.body || "",
          author: issue.user?.login || null,
          authorAvatar: issue.user?.avatar_url || null,
          assignees: (issue.assignees || []).map(person => person?.login).filter(Boolean),
          labels: (issue.labels || []).map(label => typeof label === "string" ? label : label?.name).filter(Boolean),
          milestone: issue.milestone?.title || null,
          commentCount: issue.comments || 0,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          closedAt: issue.closed_at || null,
          webUrl: issue.html_url,
          comments: (comentarios || []).map(comentario => ({
            id: comentario.id,
            author: comentario.user?.login || null,
            body: comentario.body || "",
            createdAt: comentario.created_at,
          })),
        };
      },
      async listIssues(cfg, id, state) {
        const wanted = state === "closed" || state === "all" ? state : "open";
        const data = await githubRequest(cfg.baseUrl, cfg.token,
          `/repos/${id}/issues?state=${wanted}&per_page=50&sort=updated&direction=desc`);
        const list = Array.isArray(data) ? data : [];
        // GitHub modela sus pull requests como issues con la clave
        // pull_request, asi que /issues los devuelve tambien. Se filtran o la
        // pestana Issues repetiria entera la de Pull Requests.
        return list.filter(issue => !issue.pull_request).map(issue => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author: issue.user?.login || null,
          authorAvatar: issue.user?.avatar_url || null,
          assignees: (issue.assignees || []).map(person => person?.login).filter(Boolean),
          // Una etiqueta llega como objeto, o como string cuando se pidio con
          // un token sin permiso para leer su color.
          labels: (issue.labels || []).map(label => typeof label === "string" ? label : label?.name).filter(Boolean),
          comments: issue.comments || 0,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          webUrl: issue.html_url,
        }));
      },
      async listDependabotAlerts(cfg, id, state) {
        const qs = state ? `?state=${encodeURIComponent(state)}&per_page=100` : "?per_page=100";
        const data = await githubRequest(cfg.baseUrl, cfg.token, `/repos/${id}/dependabot/alerts${qs}`);
        const list = Array.isArray(data) ? data : [];
        return list.map(a => ({
          number: a.number, state: a.state,
          severity: a.security_vulnerability?.severity || a.security_advisory?.severity || null,
          package: a.dependency?.package?.name || null,
          ecosystem: a.dependency?.package?.ecosystem || null,
          summary: a.security_advisory?.summary || null,
          ghsaId: a.security_advisory?.ghsa_id || null,
          manifestPath: a.dependency?.manifest_path || null,
          vulnerableRange: a.security_vulnerability?.vulnerable_version_range || null,
          firstPatchedVersion: a.security_vulnerability?.first_patched_version?.identifier || null,
          createdAt: a.created_at, updatedAt: a.updated_at,
          webUrl: a.html_url,
        }));
      },
    },
    bitbucket: {
      async getProject(cfg, id) {
        const [ns, slug] = splitBitbucketId(id);
        if (cfg.type === "server") {
          const p = await bitbucketRequest(cfg, `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}`);
          let defaultBranch = "master";
          try {
            const db = await bitbucketRequest(cfg, `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}/branches/default`);
            defaultBranch = db?.displayId || defaultBranch;
          } catch (_) {}
          const cloneUrl = p.links?.clone?.find(c => c.name === "http")?.href || p.links?.clone?.[0]?.href;
          return { id: `${p.project?.key || ns}/${p.slug || slug}`, name: p.name, path: `${p.project?.key || ns}/${p.slug || slug}`, cloneUrl, defaultBranch };
        }
        const p = await bitbucketRequest(cfg, `/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(slug)}`);
        const cloneUrl = p.links?.clone?.find(c => c.name === "https")?.href || p.links?.clone?.[0]?.href;
        return { id: p.full_name, name: p.name, path: p.full_name, cloneUrl, defaultBranch: p.mainbranch?.name || "master" };
      },
      cloneAuthHeader(cfg) {
        if (cfg.type === "server") return "Basic " + Buffer.from(`x-token-auth:${cfg.token}`, "utf8").toString("base64");
        return "Basic " + Buffer.from(`${cfg.username}:${cfg.token}`, "utf8").toString("base64");
      },
      async listBranches(cfg, id) {
        const [ns, slug] = splitBitbucketId(id);
        if (cfg.type === "server") {
          const data = await bitbucketRequest(cfg, `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}/branches?limit=100`);
          return (data?.values || []).map(b => ({ name: b.displayId, protected: false, default: !!b.isDefault }));
        }
        const data = await bitbucketRequest(cfg, `/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(slug)}/refs/branches?pagelen=100`);
        return (data?.values || []).map(b => ({ name: b.name, protected: false, default: false }));
      },
      async listTree(cfg, id, ref) {
        const [ns, slug] = splitBitbucketId(id);
        const isServer = cfg.type === "server";
        const files = [];
        const queue = [""];
        let dirCalls = 0;
        let truncated = false;
        const MAX_DIR_CALLS = 200, MAX_FILES = 2000;
        while (queue.length && dirCalls < MAX_DIR_CALLS && files.length < MAX_FILES) {
          const dir = queue.shift();
          dirCalls++;
          let data;
          try {
            data = isServer
              ? await bitbucketRequest(cfg, `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}/browse/${dir}?at=${encodeURIComponent(ref || "")}&limit=200`)
              : await bitbucketRequest(cfg, `/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(slug)}/src/${encodeURIComponent(ref || "")}/${dir}?pagelen=100`);
          } catch (_) { continue; }
          if (isServer) {
            const children = data?.children?.values || [];
            for (const c of children) {
              const name = bitbucketServerPathToString(c.path);
              const full = dir ? `${dir}/${name}` : name;
              if (c.type === "DIRECTORY") queue.push(full); else files.push({ path: full });
            }
            if (data?.children?.isLastPage === false) truncated = true;
          } else {
            const values = data?.values || [];
            for (const c of values) {
              if (c.type === "commit_directory") queue.push(c.path);
              else if (c.type === "commit_file") files.push({ path: c.path });
            }
            if (data?.next) truncated = true;
          }
        }
        if (queue.length || files.length >= MAX_FILES) truncated = true;
        return {
          files: files.map(f => ({ path: f.path })).sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES),
          total: files.length,
          truncated,
        };
      },
      async getFile(cfg, id, filePath, ref) {
        const [ns, slug] = splitBitbucketId(id);
        const encPath = filePath.split("/").map(encodeURIComponent).join("/");
        const mime = imageMimeForPath(filePath);
        const rawOpt = { raw: mime ? "buffer" : true };
        const path = cfg.type === "server"
          ? `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}/raw/${encPath}?at=${encodeURIComponent(ref || "")}`
          : `/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(slug)}/src/${encodeURIComponent(ref || "")}/${encPath}`;
        const result = await bitbucketRequest(cfg, path, "GET", null, rawOpt);
        if (mime) return { content: result.toString("base64"), encoding: "base64", mime };
        return result;
      },
      // Un nivel de `dirPath` (raíz si es "") — ver el comentario en gitlab.listDir.
      // Mismo endpoint por-carpeta que ya usaba listTree en su BFS, solo que acá
      // se hace una sola llamada en vez de encolar las subcarpetas.
      async listDir(cfg, id, dirPath, ref) {
        const [ns, slug] = splitBitbucketId(id);
        const isServer = cfg.type === "server";
        const folders = [], files = [];
        const dir = dirPath || "";
        const data = isServer
          ? await bitbucketRequest(cfg, `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}/browse/${dir}?at=${encodeURIComponent(ref || "")}&limit=200`)
          : await bitbucketRequest(cfg, `/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(slug)}/src/${encodeURIComponent(ref || "")}/${dir}?pagelen=100`);
        if (isServer) {
          const children = data?.children?.values || [];
          for (const c of children) {
            const name = bitbucketServerPathToString(c.path);
            const full = dir ? `${dir}/${name}` : name;
            (c.type === "DIRECTORY" ? folders : files).push({ name, path: full });
          }
        } else {
          const values = data?.values || [];
          for (const c of values) {
            const name = c.path.split("/").pop();
            (c.type === "commit_directory" ? folders : files).push({ name, path: c.path });
          }
        }
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        return { folders, files };
      },
      async listFileCommits(cfg, id, filePath, ref, limit) {
        const [ns, slug] = splitBitbucketId(id);
        const encPath = filePath.split("/").map(encodeURIComponent).join("/");
        if (cfg.type === "server") {
          const data = await bitbucketRequest(cfg,
            `/rest/api/1.0/projects/${encodeURIComponent(ns)}/repos/${encodeURIComponent(slug)}/commits?path=${encPath}&until=${encodeURIComponent(ref || "")}&limit=${limit}`);
          const list = data?.values || [];
          return list.map(c => ({
            sha: (c.displayId || c.id || "").slice(0, 8),
            message: (c.message || "").split("\n")[0],
            author: c.author?.name || null, authorAvatar: null,
            when: c.authorTimestamp ? new Date(c.authorTimestamp).toISOString() : null,
            webUrl: `${cfg.baseUrl.replace(/\/$/, "")}/projects/${ns}/repos/${slug}/commits/${c.id}`,
          }));
        }
        // Cloud: no plain "commits?path=" filter — the file-history endpoint
        // returns each revision of one specific file instead.
        const data = await bitbucketRequest(cfg,
          `/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(slug)}/filehistory/${encodeURIComponent(ref || "master")}/${encPath}?pagelen=${limit}`);
        const list = data?.values || [];
        return list.map(v => ({
          sha: (v.commit?.hash || "").slice(0, 8),
          message: (v.commit?.message || "").split("\n")[0],
          author: v.commit?.author?.user?.display_name || v.commit?.author?.raw || null,
          authorAvatar: v.commit?.author?.user?.links?.avatar?.href || null,
          when: v.commit?.date, webUrl: v.commit?.links?.html?.href || null,
        }));
      },
    },
  };

  // Segunda conexión GitLab: mismo adaptador (ninguno de sus métodos referencia
  // "gitlab" — solo usan cfg.baseUrl/cfg.token), únicamente cambia dónde lee la
  // config. Ver server/connectors/community/gitlab2.
  // Cualquier instancia extra de gitlab/github/bitbucket (ej. "gitlab3") reusa
  // el adaptador de su tipo base — se resuelve por resolveConnectorType, y la
  // config se lee siempre del id real de la instancia, no de un `cfgKey`
  // hardcodeado (por eso ya no hace falta un `PROVIDERS.gitlab2 = {...}` a mano
  // por cada instancia — ver ADR-008/CONN-017).
  function requireProvider(req, res) {
    const provider = PROVIDERS[resolveConnectorType(req.params.provider)];
    if (!provider) { sendAppError(res, AppError.notFound(`proveedor desconocido: ${req.params.provider}`), req); return null; }
    const cfg = getConnectorConfig(req.params.provider, { kvGet, kvSet });
    if (!cfg) { sendAppError(res, AppError.badRequest("connector-not-configured"), req); return null; }
    return { name: req.params.provider, adapter: provider, cfg };
  }

  // GET /api/connectors/:provider/projects/:id/branches
  app.get("/api/connectors/:provider/projects/:id/branches", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    try {
      const branches = await p.adapter.listBranches(p.cfg, req.params.id);
      res.json({ branches: branches.map(b => b.name) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/dependabot-alerts?state=open
  // GitHub only — see PROVIDERS.github.listDependabotAlerts above.
  app.get("/api/connectors/:provider/projects/:id/dependabot-alerts", requireAuth, async (req, res) => {
    if (resolveConnectorType(req.params.provider) !== "github") {
      return sendAppError(res, AppError.badRequest("dependabot-alerts-github-only"), req);
    }
    const p = requireProvider(req, res);
    if (!p) return;
    try {
      const alerts = await p.adapter.listDependabotAlerts(p.cfg, req.params.id, req.query.state);
      res.json({ alerts });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/tree?ref=&source=remote|local
  // Flat list of files (blobs only). `source=local` reads the working copy, which
  // is the only view that shows edits that have not been pushed yet.
  // GET /api/connectors/:provider/projects/:id/security-advisories
  app.get("/api/connectors/:provider/projects/:id/security-advisories", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listSecurityAdvisories) return sendAppError(res, AppError.badRequest("security-advisories-not-supported"), req);
    try {
      res.json({ advisories: await p.adapter.listSecurityAdvisories(p.cfg, req.params.id) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/code-scanning-alerts?state=
  app.get("/api/connectors/:provider/projects/:id/code-scanning-alerts", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listCodeScanningAlerts) return sendAppError(res, AppError.badRequest("code-scanning-not-supported"), req);
    try {
      res.json({ alerts: await p.adapter.listCodeScanningAlerts(p.cfg, req.params.id, req.query.state) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // Detalle de un aviso, por fuente. Cada una responde la misma forma.
  for (const [ruta, metodo, parametro] of [
    ["security-advisories/:advisoryId", "getSecurityAdvisory", "advisoryId"],
    ["code-scanning-alerts/:alertNumber", "getCodeScanningAlert", "alertNumber"],
    ["dependabot-alerts/:alertNumber", "getDependabotAlert", "alertNumber"],
  ]) {
    app.get(`/api/connectors/:provider/projects/:id/${ruta}`, requireAuth, async (req, res) => {
      const p = requireProvider(req, res);
      if (!p) return;
      if (!p.adapter[metodo]) return sendAppError(res, AppError.badRequest("advisory-detail-not-supported"), req);
      try {
        res.json(await p.adapter[metodo](p.cfg, req.params.id, req.params[parametro]));
      } catch (err) {
        sendProviderFailure(res, err, req);
      }
    });
  }

  app.get("/api/connectors/:provider/projects/:id/tree", requireAuth, async (req, res) => {
    if (req.query.source === "local") {
      const localClone = requireLocalClone(req, res);
      if (!localClone) return;
      try {
        const { files, truncated } = await listLocalCloneTree(localClone.path);
        return res.json({ files, truncated, source: "local", branch: readGitBranch(localClone.path) });
      } catch (err) {
        return sendGitFailure(res, err, req);
      }
    }

    const p = requireProvider(req, res);
    if (!p) return;

    // ?dir=<path> (raíz = "") — un solo nivel, para carga perezosa por carpeta
    // desde el árbol del frontend. Distinto de no mandar `dir` en absoluto, que
    // sigue trayendo el árbol recursivo completo (abajo) — se deja porque no
    // molesta a nadie tenerlo disponible, aunque el frontend ya no lo llame.
    if (req.query.dir !== undefined) {
      if (!p.adapter.listDir) return sendAppError(res, AppError.badRequest("listDir-not-supported"), req);
      try {
        const { folders, files } = await p.adapter.listDir(p.cfg, req.params.id, req.query.dir, req.query.ref || "");
        return res.json({ folders, files, source: "remote" });
      } catch (err) {
        return sendProviderFailure(res, err, req);
      }
    }

    try {
      const { files, truncated, total } = await p.adapter.listTree(p.cfg, req.params.id, req.query.ref || "");
      res.json({ files, truncated, total, source: "remote" });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/file?path=&ref=&source=remote|local
  app.get("/api/connectors/:provider/projects/:id/file", requireAuth, async (req, res) => {
    const { path: filePath, ref } = req.query;
    if (typeof filePath !== "string" || !filePath) {
      return sendAppError(res, AppError.badRequest("path-required"), req);
    }

    if (req.query.source === "local") {
      const localClone = requireLocalClone(req, res);
      if (!localClone) return;
      const absolute = resolveInsideClone(localClone.path, filePath);
      if (!absolute) return sendAppError(res, AppError.badRequest("path-outside-repo"), req);
      try {
        const stat = fs.statSync(absolute);
        if (!stat.isFile()) return sendAppError(res, AppError.notFound("not-a-file"), req);
        const mime = imageMimeForPath(filePath);
        if (mime) {
          return res.json({ path: filePath, content: fs.readFileSync(absolute).toString("base64"), encoding: "base64", mime, source: "local" });
        }
        return res.json({ path: filePath, content: fs.readFileSync(absolute, "utf8"), source: "local" });
      } catch (err) {
        const missing = err.code === "ENOENT";
        if (missing) return sendAppError(res, AppError.notFound("file-not-found"), req);
        return sendAppError(res, AppError.internal("Unable to read local repository file", { cause: err }), req);
      }
    }

    const p = requireProvider(req, res);
    if (!p) return;
    try {
      const result = await p.adapter.getFile(p.cfg, req.params.id, filePath, ref || "");
      if (result && typeof result === "object" && result.encoding === "base64") {
        return res.json({ path: filePath, content: result.content, encoding: "base64", mime: result.mime, source: "remote" });
      }
      res.json({ path: filePath, content: typeof result === "string" ? result : JSON.stringify(result, null, 2), source: "remote" });
    } catch (err) {
      if (err.status === 404) return sendAppError(res, AppError.notFound("file-not-found"), req);
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/file-commits?path=&ref=&limit=
  // — last commits that touched one file. Always reads from the provider's
  // remote API (GitLab/GitHub/Bitbucket), regardless of whether the file was
  // opened from the local clone or the remote tree — a local-only "git log
  // -- path" would miss commits nobody has fetched yet, and this button is
  // about who changed the file upstream, not the state of this one checkout.
  app.get("/api/connectors/:provider/projects/:id/file-commits", requireAuth, async (req, res) => {
    const { path: filePath, ref } = req.query;
    if (typeof filePath !== "string" || !filePath) {
      return sendAppError(res, AppError.badRequest("path-required"), req);
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listFileCommits) return sendAppError(res, AppError.badRequest("file-commits-not-supported"), req);
    try {
      res.json({ commits: await p.adapter.listFileCommits(p.cfg, req.params.id, filePath, ref || "", limit) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/pipelines?ref=  — pipeline history.
  // :provider (no literal "gitlab") — funciona para cualquier instancia GitLab
  // sin código nuevo; solo tiene sentido para conectores tipo GitLab (CI propio).
  app.get("/api/connectors/:provider/projects/:id/pipelines", requireAuth, async (req, res) => {
    const ref = req.query.ref || "";
    // ?full=true walks every page instead of just the 10 most recent. The
    // hardcoded per_page=10 below silently reads as "first pipeline ever" for
    // any project with more than 10 — it isn't, it's just the oldest one still
    // inside that window. Found via a months-long gap between a repo's real
    // first commit and its "oldest visible" pipeline. Skips the per-pipeline
    // detail fetch (sha/duration) the default branch below does, since the
    // only known caller of `full` wants status+timestamp across the whole
    // history, not a UI-ready list — that keeps a 100+-pipeline project to a
    // handful of requests instead of one per pipeline. GitLab only for now —
    // the only caller of `full` reads GitLab's own history.
    if (req.query.full === "true") {
      if (resolveConnectorType(req.params.provider) !== "gitlab") {
        return sendAppError(res, AppError.badRequest("full-pipelines-gitlab-only"), req);
      }
      const cfg = getConnectorConfig(req.params.provider, { kvGet, kvSet });
      if (!cfg) return sendAppError(res, AppError.badRequest("connector-not-configured"), req);
      try {
        const all = [];
        for (let page = 1; page <= 50; page += 1) {
          const data = await gitlabRequest(cfg.baseUrl, cfg.token,
            `/api/v4/projects/${req.params.id}/pipelines?ref=${encodeURIComponent(ref)}&per_page=100&order_by=id&sort=asc&page=${page}`);
          const list = Array.isArray(data) ? data : [];
          all.push(...list);
          if (list.length < 100) break;
        }
        return res.json({
          pipelines: all.map(p => ({ id: p.id, status: p.status, ref: p.ref, when: p.created_at })),
          total: all.length,
        });
      } catch (err) {
        return sendProviderFailure(res, err, req);
      }
    }

    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listPipelines) return sendAppError(res, AppError.badRequest("pipelines-not-supported"), req);
    try {
      res.json({ pipelines: await p.adapter.listPipelines(p.cfg, req.params.id, ref) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/pull-requests?state=open|closed|all
  app.get("/api/connectors/:provider/projects/:id/pull-requests", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listPullRequests) return sendAppError(res, AppError.badRequest("pull-requests-not-supported"), req);
    try {
      res.json({ pullRequests: await p.adapter.listPullRequests(p.cfg, req.params.id, req.query.state) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/pull-requests/:number — detalle.
  app.get("/api/connectors/:provider/projects/:id/pull-requests/:number", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.getPullRequest) return sendAppError(res, AppError.badRequest("pull-requests-not-supported"), req);
    try {
      res.json(await p.adapter.getPullRequest(p.cfg, req.params.id, req.params.number));
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/issues/:number — detalle.
  app.get("/api/connectors/:provider/projects/:id/issues/:number", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.getIssue) return sendAppError(res, AppError.badRequest("issues-not-supported"), req);
    try {
      res.json(await p.adapter.getIssue(p.cfg, req.params.id, req.params.number));
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/issues?state=open|closed|all
  app.get("/api/connectors/:provider/projects/:id/issues", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listIssues) return sendAppError(res, AppError.badRequest("issues-not-supported"), req);
    try {
      res.json({ issues: await p.adapter.listIssues(p.cfg, req.params.id, req.query.state) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // PATCH /api/connectors/:provider/projects/:id — edit project metadata (GitLab only:
  // GitLab's own API takes PUT, not PATCH; we keep PATCH on our side since this is a
  // partial update). Deliberately does NOT let `path` through — that's the repo slug
  // baked into the Docker image name/registry path and clone URL everywhere else in the
  // ecosystem (CI variables, docker-compose, other repos' READMEs); renaming the display
  // `name` is cosmetic, renaming `path` would break production without a coordinated
  // redeploy. Callers who genuinely need the slug changed should do it in GitLab directly.
  app.patch("/api/connectors/:provider/projects/:id", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Editar proyecto" }),
    async (req, res) => {
    if (req.params.provider !== "gitlab" && req.params.provider !== "gitlab2") {
      return sendAppError(res, AppError.badRequest("provider-not-supported"), req);
    }
    const cfg = getConnectorConfig(req.params.provider, { kvGet, kvSet });
    if (!cfg) return sendAppError(res, AppError.badRequest("connector-not-configured"), req);
    const { path: _ignoredPath, ...body } = req.body || {};
    if (!Object.keys(body).length) return sendAppError(res, AppError.badRequest("no-fields"), req);
    try {
      const updated = await gitlabRequest(cfg.baseUrl, cfg.token, `/api/v4/projects/${req.params.id}`, "PUT", body);
      res.locals.auditMessage = `Proyecto editado · ${req.params.id} · campos: ${Object.keys(body).join(", ")}`;
      res.json({ ok: true, id: updated?.id, name: updated?.name, path: updated?.path });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/avatar?u=<url> — proxies a GitLab avatar image through
  // our own auth (PRIVATE-TOKEN). A plain <img src="http://gitlab/..."> can't send that
  // header and GitLab's uploads/avatar paths require it, so the browser gets a 404 —
  // this streams the bytes back same-origin instead. `u` must be on the configured
  // GitLab host (no open proxy).
  // GET /api/connectors/:provider/users?search=...  (fuzzy, name/username/email)
  // GET /api/connectors/:provider/users?username=... (exact match)
  // Needed before adding someone as a project member: the members endpoint
  // takes a numeric user_id, not a username.
  app.get("/api/connectors/:provider/users", requireAuth, async (req, res) => {
    const cfg = getConnectorConfig(req.params.provider, { kvGet, kvSet });
    if (!cfg) return sendAppError(res, AppError.badRequest("connector-not-configured"), req);
    const username = String(req.query.username || "").trim();
    const search = String(req.query.search || "").trim();
    if (!username && !search) return sendAppError(res, AppError.badRequest("search or username required"), req);
    try {
      // Confirmed empirically against this connector: an unauthenticated/bad
      // token rejects in ~1s, and an exact ?username= lookup answers fast too
      // — it's specifically the fuzzy ?search= (name/username/email LIKE
      // query) that hangs past 30s with a real token on this self-hosted
      // instance. Prefer ?username= (GitLab's exact-match param) whenever
      // the caller already knows it; ?search= keeps its 30s allowance below
      // for when only a display name is known.
      const qs = username ? `username=${encodeURIComponent(username)}` : `search=${encodeURIComponent(search)}&per_page=20`;
      const data = await gitlabRequest(cfg.baseUrl, cfg.token,
        `/api/v4/users?${qs}`,
        "GET", null, null, "json", 30000);
      const list = Array.isArray(data) ? data : [];
      res.json({ users: list.map(u => ({ id: u.id, username: u.username, name: u.name, state: u.state })) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // POST /api/connectors/:provider/projects/:id/members  body: { userId, accessLevel }
  // — grant a GitLab user a role on a project. GitLab access levels: 10 Guest,
  // 20 Reporter (read-only — can view/clone code, no push), 30 Developer,
  // 40 Maintainer, 50 Owner. Defaults to 20 since "give read access" is the
  // common case; pass a higher accessLevel explicitly when that's not enough.
  app.post("/api/connectors/:provider/projects/:id/members", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Agregar miembro a proyecto" }),
    async (req, res) => {
    const cfg = getConnectorConfig(req.params.provider, { kvGet, kvSet });
    if (!cfg) return sendAppError(res, AppError.badRequest("connector-not-configured"), req);
    const userId = req.body?.userId;
    const accessLevel = req.body?.accessLevel || 20;
    if (!userId) return sendAppError(res, AppError.badRequest("userId required"), req);
    try {
      const member = await gitlabRequest(cfg.baseUrl, cfg.token,
        `/api/v4/projects/${req.params.id}/members`, "POST", { user_id: userId, access_level: accessLevel });
      res.locals.auditMessage = `Miembro agregado · proyecto ${req.params.id} · user_id ${userId} · nivel ${accessLevel}`;
      res.json({ ok: true, id: member?.id, accessLevel: member?.access_level });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  app.get("/api/connectors/:provider/avatar", requireAuth, (req, res) => {
    const cfg = getConnectorConfig(req.params.provider, { kvGet, kvSet });
    if (!cfg) return res.status(400).end();
    const target = req.query.u || "";
    if (!target.startsWith(cfg.baseUrl.replace(/\/$/, ""))) return res.status(400).end();
    let url;
    try { url = new URL(target); } catch { return res.status(400).end(); }
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const proxyReq = lib.request({
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search, method: "GET",
      headers: { "PRIVATE-TOKEN": cfg.token },
      rejectUnauthorized: false, agent: isHttps ? insecureAgent : undefined, timeout: 8000,
    }, (r) => {
      res.status(r.statusCode || 502);
      if (r.headers["content-type"]) res.setHeader("Content-Type", r.headers["content-type"]);
      res.setHeader("Cache-Control", "private, max-age=3600");
      r.pipe(res);
    });
    proxyReq.on("timeout", () => proxyReq.destroy());
    proxyReq.on("error", () => { if (!res.headersSent) res.status(502).end(); });
    proxyReq.end();
  });

  // GET /api/connectors/:provider/projects/:id/pipelines/:pipelineId/jobs — job list w/ timing, for the build-page view
  app.get("/api/connectors/:provider/projects/:id/pipelines/:pipelineId/jobs", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.listPipelineJobs) return sendAppError(res, AppError.badRequest("jobs-not-supported"), req);
    try {
      res.json({ jobs: await p.adapter.listPipelineJobs(p.cfg, req.params.id, req.params.pipelineId) });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // GET /api/connectors/:provider/projects/:id/jobs/:jobId/trace — single job's build log
  app.get("/api/connectors/:provider/projects/:id/jobs/:jobId/trace", requireAuth, async (req, res) => {
    const p = requireProvider(req, res);
    if (!p) return;
    let trace = "";
    try {
      if (p.adapter.getJobTrace) trace = await p.adapter.getJobTrace(p.cfg, req.params.id, req.params.jobId);
    } catch (_) {}
    res.json({
      trace: (trace || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-500),
    });
  });

  // POST /api/connectors/:provider/projects/:id/pipelines  body: { ref }  — trigger a new pipeline run
  // (GitLab only — see the comment on PROVIDERS.github above for why GitHub
  // doesn't declare triggerPipeline)
  app.post("/api/connectors/:provider/projects/:id/pipelines", requireAuth,
    auditWrite({ provider: (req) => req.params.provider, action: "Disparar pipeline" }),
    async (req, res) => {
    const { ref } = req.body || {};
    if (!ref) return sendAppError(res, AppError.badRequest("ref-required"), req);
    const p = requireProvider(req, res);
    if (!p) return;
    if (!p.adapter.triggerPipeline) return sendAppError(res, AppError.badRequest("trigger-not-supported"), req);
    try {
      const result = await p.adapter.triggerPipeline(p.cfg, req.params.id, ref);
      res.locals.auditMessage = `Pipeline #${result.id ?? "?"} disparado en ${ref}`;
      res.json({ ok: true, ...result });
    } catch (err) {
      sendProviderFailure(res, err, req);
    }
  });

  // commitIdentityFor is returned so its resolution order (connection → base
  // type → env, see above) is unit-testable without shelling out to git.
  return { attachRepoSettings, attachCloneState, reposDb, commitIdentityFor };
}

module.exports = { registerReposRoutes };
