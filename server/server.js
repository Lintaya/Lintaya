// server.js - Lintaya server and secure integration APIs

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http  = require("node:http");
const express = require("express");
const { spawn } = require("node:child_process");
const { Client: SSHClient } = require("ssh2");
const { analyzeRepository } = require("./analysis");
const { createApp, requireAuth } = require("./app");
// Connectors register themselves through the loader below. These imports remain
// only for helpers this file still calls outside any connector's own routes —
// repo browsing, container inspection and the fabric correlation engine.
const { githubRequest } = require("./connectors/community/github");
const { gitlabRequest } = require("./connectors/community/gitlab");
const {
  bitbucketRequest,
  bitbucketServerPathToString,
  splitBitbucketId,
} = require("./connectors/community/bitbucket");
const {
  portainerFetch,
  portainerFetchBuffer,
  portainerToken,
} = require("./connectors/community/portainer");
const { connectorManifests, connectorMetadata, getConnectorConfigSchema, getConnectorManifest, isSupportedHere, listAutoSyncTargets, listConnectorBlocks, listConnectorCatalog } = require("./connectors/registry");
const { registerConnectorInstance, registerConnectors } = require("./connectors/loader");
const { loadConfig } = require("./core/config");
const { createWorkloadSources } = require("./core/services/workload-sources");
const {
  MAIN_MIGRATIONS,
  REPOSITORY_MIGRATIONS,
  backfillConnectorTypeIds,
  createKvStore,
  openDatabase,
} = require("./core/database");
const { AppError, errorMiddleware, sendAppError } = require("./core/errors");
const { createLogger } = require("./core/logger");
const { auditConnectorWrite } = require("./core/services/connector-audit");
const { executeSsh, SSH_ALGORITHMS } = require("./core/services/ssh-exec");
const { demuxDockerLog, normalizeInspect, parseDockerPs } = require("./core/services/containers");
const { serviceWorkerVersion, injectServiceWorkerVersion } = require("./core/services/sw-version");
// Fase 1 del roadmap open source: rutas por dominio bajo server/routes/,
// cada una exportando registerXRoutes(context) — mismo molde que ya usan los
// conectores (register(context) llamando app.get/post directo). Este primer
// corte cubre los dominios más chicos y sin acoplamiento a APIs externas;
// Repos, el registro de conectores, Live VM/Host y el transporte SSH ya tienen
// routers propios (ver el roadmap interno, Fase 1).
const { registerHomeRoutes } = require("./routes/home");
const { registerCustomBlocksRoutes } = require("./routes/custom-blocks");
const { registerModulePagesRoutes } = require("./routes/module-pages");
const { registerDashboardsRoutes } = require("./routes/dashboards");
const { registerWorkspacePackageRoutes } = require("./routes/workspace-packages");
const { registerDevicesRoutes } = require("./routes/devices");
const { registerTagsRoutes } = require("./routes/tags");
const { registerVaultMapRoutes } = require("./routes/vault-map");
const { registerVmsRoutes } = require("./routes/vms");
const { registerInventoryRoutes } = require("./routes/inventory");
const {
  readAutoSyncConfig,
  registerSettingsAutoSyncRoutes,
} = require("./routes/settings-auto-sync");
const { registerContainersRoutes } = require("./routes/containers");
const { registerSshRoutes } = require("./routes/ssh");
const { registerDocumentationRoutes } = require("./routes/documentation");
const { registerConnectorsRoutes } = require("./routes/connectors");
const { registerReposRoutes } = require("./routes/repos");
const { registerVaultRoutes } = require("./routes/vault");
const { registerAIContextRoutes } = require("./routes/ai-context");
const { registerOpenAPIRoutes } = require("./routes/openapi");
const { registerAgentSurfaceRoutes } = require("./routes/agent-surfaces");
const { registerAISettingsRoutes } = require("./routes/ai-settings");
const { runWriteTool } = require("./core/assistant-tools");
// AGENT-001 (ADR-011): action registry + REST — see server/core/actions/.
const { registerActionsRoutes } = require("./routes/actions");
const { registerApprovalRoutes } = require("./routes/approvals");
const { createActionRegistry, publicActionShape } = require("./core/actions/registry");
const { createActionExecutor } = require("./core/actions/execute");
const { createApprovalStore } = require("./core/services/approval-store");
const { registerAllActions } = require("./core/actions/bootstrap");
const { createConnectorTypeResolver } = require("./core/connector-types");
const { createConnectorLog } = require("./core/services/connector-log");
const { createVaultService } = require("./core/services/vault");
const { createBackupService } = require("./core/services/backup");
const { createSecretStore, configureDefaultSecretStore } = require("./core/services/secret-store");
const { getConnectorConfig } = require("./core/services/connector-store");
const { registerBackupRoutes } = require("./routes/backups");

const log = createLogger({ component: "server" });
const SSH_ALGS = SSH_ALGORITHMS;

const config = loadConfig(process.env, {
  requireToken: require.main === module,
  serverDir: __dirname,
});

const APP_VERSION = fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim();

const PORT = config.http.port;
const HOST = config.http.host;
const ROOT = config.rootDir;
const TOKEN = config.http.token;
const app = createApp({ token: TOKEN, version: APP_VERSION });

const db = openDatabase({
  filename: config.database.mainPath,
  migrations: MAIN_MIGRATIONS,
});

// kvStore is created here (rather than after seeding, where it used to sit)
// because the vault service needs kvGet/kvSet for Bitwarden sync, and seeding
// (below) needs the vault service to exist first.
const kvStore = createKvStore(db);
const kvGet = (key) => kvStore.get(key);
const kvGetByPrefix = (prefix) => kvStore.getByPrefix(prefix);
const kvSet = (key, value) => kvStore.set(key, value);

const vault = createVaultService({ config, db, kvGet, kvSet, log });

// ── Connectors registry helpers ───────────────────────────────────────────────
const stmtConnInsert = db.prepare(`
  INSERT OR IGNORE INTO connectors
    (id, name, kind, icon, color, endpoint, auth, interval, feeds, docs, sample_endpoints, created_at, connector_type_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtConnUpdate = db.prepare(`
  UPDATE connectors SET name=?, kind=?, icon=?, color=?, endpoint=?, auth=?, interval=?, feeds=?, docs=?, sample_endpoints=?
  WHERE id=?
`);
const stmtConnDelete = db.prepare(`DELETE FROM connectors WHERE id=?`);
const stmtConnList   = db.prepare(`SELECT * FROM connectors ORDER BY created_at ASC`);
const stmtConnGet    = db.prepare(`SELECT * FROM connectors WHERE id=?`);
const VCENTER_ID = "vcenter";
const LEGACY_VCENTER_ID = "vc-mex";

function migrateLegacyVcenterRow() {
  const legacy = stmtConnGet.get(LEGACY_VCENTER_ID);
  if (!legacy) return;

  const canonical = stmtConnGet.get(VCENTER_ID);
  if (canonical) {
    stmtConnDelete.run(LEGACY_VCENTER_ID);
    return;
  }

  db.prepare(`
    UPDATE connectors
    SET id = ?, name = ?, sample_endpoints = REPLACE(sample_endpoints, ?, ?)
    WHERE id = ?
  `).run(VCENTER_ID, "VMware vCenter", LEGACY_VCENTER_ID, VCENTER_ID, LEGACY_VCENTER_ID);
}

function parseConn(row) {
  if (!row) return null;
  const { sample_endpoints, created_at, connector_type_id, ...rest } = row;
  return {
    ...rest,
    connectorTypeId: connector_type_id || null,
    feeds:           JSON.parse(row.feeds          || "[]"),
    sampleEndpoints: JSON.parse(sample_endpoints   || "[]"),
    createdAt:       created_at,
    ...connectorMetadata(row.id),
  };
}

function seedConnectors() {
  const now = Date.now();
  const defaults = [
    {
      id: "vcenter", name: "VMware vCenter", kind: "VMware vSphere REST",
      icon: "VC", color: "#ffffff",
      endpoint: "",
      auth: "Session token (POST /api/session)",
      interval: "every 5 min",
      feeds: JSON.stringify(["VMs", "ESXi Hosts", "Clusters", "Datastores"]),
      docs: "https://developer.broadcom.com/xapis/vsphere-automation-api/latest/",
      sample_endpoints: JSON.stringify(["POST /api/connectors/vcenter/vcenter/sync", "GET /api/vms-live", "GET /api/hosts-live"]),
    },
    {
      id: "plane", name: "Plane.so", kind: "Plane REST API",
      icon: "PL", color: "#f97316",
      endpoint: "https://10.0.0.1/api/v1/",
      auth: "API key (X-Api-Key header)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Projects", "Issues", "States", "Members"]),
      docs: "https://developers.plane.so/api-reference",
      sample_endpoints: JSON.stringify(["POST /api/connectors/plane/test", "POST /api/connectors/plane/sync"]),
    },
    {
      id: "bw", name: "Bitwarden CLI", kind: "CLI local (bw)",
      icon: "BW", color: "#175ddc",
      endpoint: "bw status / bw get password <id>",
      auth: "Session key (export BW_SESSION)",
      interval: "manual / on credential request",
      feeds: JSON.stringify(["Passwords", "Secure notes"]),
      docs: "https://bitwarden.com/help/cli/",
      sample_endpoints: JSON.stringify(["bw status", "bw list items", "bw get password <id>"]),
    },
    {
      id: "outlook", name: "Outlook Calendar", kind: "Microsoft Graph",
      icon: "OL", color: "#0078d4",
      endpoint: "https://graph.microsoft.com/v1.0/me/calendarView",
      auth: "OAuth device code (delegated)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Calendar events"]),
      docs: "https://learn.microsoft.com/graph/api/user-list-calendarview",
      sample_endpoints: JSON.stringify(["POST /api/connectors/outlook/sync", "GET /api/connectors/outlook/events"]),
    },
    {
      id: "portainer", name: "Portainer", kind: "Portainer API",
      icon: "PT", color: "#C080FF",
      endpoint: "https://portainer/api",
      auth: "API key (X-API-Key header)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Endpoints", "Containers"]),
      docs: "https://docs.portainer.io/api/access",
      sample_endpoints: JSON.stringify(["POST /api/connectors/portainer/sync", "GET /api/containers"]),
    },
    {
      id: "gitlab", name: "GitLab", kind: "GitLab REST API v4",
      icon: "GL", color: "#380D75",
      endpoint: "http://10.0.0.1/api/v4",
      auth: "Personal Access Token (PRIVATE-TOKEN header)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Projects", "Deployments"]),
      docs: "https://docs.gitlab.com/ee/api/deployments.html",
      sample_endpoints: JSON.stringify(["POST /api/connectors/gitlab/test", "POST /api/connectors/gitlab/sync"]),
    },
    {
      id: "github", name: "GitHub", kind: "GitHub REST API v3",
      icon: "GH", color: "#24292f",
      endpoint: "https://api.github.com",
      auth: "Personal Access Token (Authorization: Bearer header)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Repos", "Workflow runs", "Commits"]),
      docs: "https://docs.github.com/en/rest",
      sample_endpoints: JSON.stringify(["POST /api/connectors/github/test", "POST /api/connectors/github/sync"]),
    },
    {
      id: "bitbucket", name: "Bitbucket", kind: "Bitbucket Cloud v2.0 / Server REST 1.0",
      icon: "BB", color: "#0052CC",
      endpoint: "https://api.bitbucket.org/2.0 (Cloud) o instancia self-hosted",
      auth: "API token / App password (Cloud) o Personal Access Token (Server)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Repos", "Pull requests", "Commits"]),
      docs: "https://developer.atlassian.com/cloud/bitbucket/rest/",
      sample_endpoints: JSON.stringify(["POST /api/connectors/bitbucket/test", "POST /api/connectors/bitbucket/sync"]),
    },
    {
      id: "anthropic", name: "Anthropic", kind: "Claude Code transcripts + Admin API",
      icon: "AN", color: "#D97757",
      endpoint: "~/.claude/projects (local) · https://api.anthropic.com (Admin API opcional)",
      auth: "ninguna para el uso local · Admin API key opcional",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Plan usage (5h / semanal)", "Context window", "Tokens y costo por modelo"]),
      docs: "https://platform.claude.com/docs/en/api/administration-api",
      sample_endpoints: JSON.stringify(["POST /api/connectors/anthropic/sync", "POST /api/connectors/anthropic/calibrate"]),
    },
    {
      id: "ucsm", name: "UCS Manager", kind: "Cisco UCS Manager XML API",
      icon: "UC", color: "#049fd9",
      endpoint: "https://10.0.0.1/nuova",
      auth: "aaaLogin (username/password → cookie)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Chassis", "Blades"]),
      docs: "https://developer.cisco.com/docs/ucs-manager-xml-api/",
      sample_endpoints: JSON.stringify(["POST /api/connectors/ucsm/test", "POST /api/connectors/ucsm/sync"]),
    },
    {
      id: "outline", name: "Outline", kind: "Outline REST API",
      icon: "OT", color: "#27272a",
      endpoint: "https://10.0.0.1/api",
      auth: "API key (Authorization: Bearer)",
      interval: "manual / on-demand",
      feeds: JSON.stringify(["Collections", "Documents"]),
      docs: "https://www.getoutline.com/developers",
      sample_endpoints: JSON.stringify(["POST /api/connectors/outline/test", "POST /api/connectors/outline/sync"]),
    },
  ];
  for (const c of defaults) {
    stmtConnInsert.run(c.id, c.name, c.kind, c.icon, c.color, c.endpoint, c.auth, c.interval, c.feeds, c.docs, c.sample_endpoints, now, c.id);
  }
}

migrateLegacyVcenterRow();

if (!config.database.disableSeeds) {
  vault.seedDemoVault();
  seedConnectors();
  // INSERT OR IGNORE en seedConnectors() no toca filas ya sembradas — GitLab pasó de
  // naranja a morado (marca real) después de sembrarse la primera vez en muchas
  // instalaciones, así que se corrige aquí una sola vez (no-op si ya está en morado).
  db.prepare("UPDATE connectors SET color = ? WHERE id = ? AND color = ?").run("#380D75", "gitlab", "#fc6d26");
  db.prepare("UPDATE connectors SET color = ? WHERE id = ? AND color = ?").run("#C080FF", "portainer", "#13bef9");
  db.prepare("UPDATE connectors SET color = ? WHERE id = ? AND color = ?").run("#27272a", "outline", "#000000");
  db.prepare("UPDATE connectors SET color = ? WHERE id = ? AND color = ?").run("#ffffff", "vcenter", "#2563eb");
}

// ── Instancias de conectores (varias conexiones de un mismo tipo) ───────────
// KV "connector-instances" = { [typeId]: ["gitlab2", "gitlab3", …] } — la
// instancia base (el id del tipo, ej. "gitlab") es implícita y nunca se
// lista, así que los datos ya guardados bajo ese id no necesitan migración.
function getConnectorInstances(typeId) {
  return (kvGet("connector-instances")?.value || {})[typeId] || [];
}

// Cualquier id (base o instancia) → el id del tipo/manifest que lo implementa.
// Sin esto una instancia extra no tiene de dónde sacar su config schema ni su
// adaptador de repos — solo el id del tipo tiene manifest propio.
//
// CORE-003 (ADR-010): la columna `connectors.connector_type_id` es ahora la
// fuente de verdad y se consulta primero — `bootstrapConnectorInstances()`
// la deja poblada para toda fila conocida en cada arranque. El check de
// manifest y el escaneo de la KV `connector-instances` quedan como respaldo
// defensivo (fila nueva todavía sin backfill, o un tipo base cuyo id nunca
// tuvo fila propia en `connectors`) — no deberían disparar en una
// instalación ya migrada, pero abaratan no tener que garantizar orden de
// arranque perfecto. Factored into core/connector-types.js (AGENT-002) so
// mcp-server.js resolves connections through this exact same order.
const resolveConnectorType = createConnectorTypeResolver({ db, kvGet, getConnectorManifest });

function addConnectorInstance(typeId, instanceId) {
  const all = kvGet("connector-instances")?.value || {};
  const list = all[typeId] || [];
  if (!list.includes(instanceId)) kvSet("connector-instances", { ...all, [typeId]: [...list, instanceId] });
}

function removeConnectorInstance(typeId, instanceId) {
  const all = kvGet("connector-instances")?.value || {};
  kvSet("connector-instances", { ...all, [typeId]: (all[typeId] || []).filter(x => x !== instanceId) });
}

function nextInstanceId(typeId) {
  const taken = new Set([typeId, ...getConnectorInstances(typeId)]);
  let n = 2;
  while (taken.has(`${typeId}${n}`)) n++;
  return `${typeId}${n}`;
}

// Reconoce instancias creadas antes de que este registro existiera (hoy:
// "gitlab2", sembrado a mano en una sesión anterior). Corre en cada arranque
// — barato (una vuelta sobre `connectors` × manifests) e idempotente, así que
// si una instancia queda sin reclamar (ej. porque todavía tenía su propio
// manifest.json) se resuelve sola en el siguiente restart sin intervención.
function bootstrapConnectorInstances() {
  const all = kvGet("connector-instances")?.value || {};
  const claimed = new Set(Object.values(all).flat());
  let changed = false;
  for (const row of stmtConnList.all()) {
    if (claimed.has(row.id) || getConnectorManifest(row.id)) continue;
    for (const manifest of connectorManifests.values()) {
      if (row.id !== manifest.id && row.id.startsWith(manifest.id) && /^\d+$/.test(row.id.slice(manifest.id.length))) {
        (all[manifest.id] ||= []).push(row.id);
        changed = true;
        break;
      }
    }
  }
  if (changed) kvSet("connector-instances", all);

  // CORE-003: persist the relationship while retaining the KV registry for
  // one compatibility release. This backfills older instances such as
  // gitlab2 without changing their public IDs or routes. Must run after the
  // KV reconciliation above — an unclaimed legacy instance needs to land in
  // `connector-instances` first, or resolveConnectorType()'s KV-scan fallback
  // (used here since the column is still empty for these rows) won't find it.
  backfillConnectorTypeIds(db, {
    resolveType: resolveConnectorType,
    hasType: (typeId) => !!getConnectorManifest(typeId),
  });
}
bootstrapConnectorInstances();

// Bitwarden secret-store mode reuses the same vault session the Passwords
// module unlocks (vault.vaultSession) — one unlock, two purposes — instead of
// asking for a second master password. Building the store here never touches
// the CLI (see secret-store.js); only an actual get/set/clear does, and each
// throws `vault-locked` if the session isn't there yet, same error code the
// rest of the app already uses for a locked Bitwarden vault.
function requireBitwardenSecretSession() {
  const session = vault.vaultSession;
  if (!session.unlocked || session.mode !== "bitwarden" || !session.bwSession) {
    const error = new Error("bitwarden vault is locked");
    error.code = "vault-locked";
    throw error;
  }
  return session.bwSession;
}

const connectorSecretStore = createSecretStore({
  mode: config.secretStore.mode,
  key: config.secretStore.key,
  kvGet,
  kvSet,
  getSession: config.secretStore.mode === "bitwarden" ? requireBitwardenSecretSession : undefined,
});
function connectorSecretFields(id) {
  const schema = getConnectorConfigSchema(resolveConnectorType(id));
  return Object.entries(schema?.properties || {})
    .filter(([, property]) => property?.["x-lintaya-secret"] || property?.writeOnly)
    .map(([field]) => field);
}
configureDefaultSecretStore({
  ...connectorSecretStore,
  getSecretFields: connectorSecretFields,
});

function migrateLegacyVcenterData() {
  for (const prefix of ["connector-config-", "connector-status-", "connector-log-", "vcenter-data-"]) {
    const oldKey = `${prefix}${LEGACY_VCENTER_ID}`;
    const newKey = `${prefix}${VCENTER_ID}`;
    const legacy = kvGet(oldKey);
    if (legacy && !kvGet(newKey)) kvSet(newKey, legacy.value);
  }

  const vaultMap = kvGet("connector-vault-map")?.value;
  if (vaultMap?.[LEGACY_VCENTER_ID] && !vaultMap[VCENTER_ID]) {
    kvSet("connector-vault-map", {
      ...vaultMap,
      [VCENTER_ID]: vaultMap[LEGACY_VCENTER_ID],
    });
  }
}

migrateLegacyVcenterData();


// Hosts the user has disabled for monitoring — their VMs are excluded from the dashboard
const getDisabledHostSet = () => new Set(kvGet("host-monitoring-disabled")?.value || []);

// Append a timestamped entry to a connector's persistent activity log (max 30
// entries). `meta` is optional structured detail (e.g. which endpoint(s) the
// call hit) — the UI shows it behind an expand toggle so the log stays
// scannable. Factored into core/services/connector-log.js (AGENT-002) so
// mcp-server.js writes to this exact same trail instead of a second copy.
const connectorLog = createConnectorLog({ kvGet, kvSet });

// Standard way to make a write route show up in Logs → Conectores — see
// server/core/services/connector-audit.js. Any route that changes state
// should use this instead of calling connectorLog() by hand, so a new route
// doesn't silently go unlogged the way /prepare-env originally did.
const auditWrite = (options) => auditConnectorWrite(connectorLog, options);

// Same idea as connectorLog/auditWrite, but for write routes that don't
// belong to any single connector (Home, Blocks, Devices, Docs, Vault,
// Settings...). A separate `activity-log-<domain>` KV key (not
// `connector-log-<id>`) keeps this from ever colliding with a real connector
// or instance id. High-frequency, low-signal writes (layout/reorder saves on
// every drag, /api/chat) are deliberately left unwrapped — same "reads and
// noise stay out" principle already applied to connector routes.
const ACTIVITY_DOMAIN_LABELS = {
  home: "Home",
  blocks: "Home 2 / Blocks",
  "module-pages": "Boards",
  dashboards: "Dashboards",
  connectors: "Conectores (alta/baja)",
  devices: "Devices",
  vms: "VMs",
  hosts: "Hosts",
  vault: "Vault",
  settings: "Settings",
  containers: "Contenedores",
  fabric: "Fabric",
  backups: "Respaldos",
};
const activityLog = (domain, level, msg, meta) => {
  const key = `activity-log-${domain}`;
  const existing = kvGet(key)?.value || [];
  const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const entry = { t, ts: Date.now(), level, msg };
  if (meta && Object.keys(meta).length) entry.meta = meta;
  kvSet(key, [entry, ...existing].slice(0, 30));
};
const auditActivity = (options) => auditConnectorWrite(activityLog, options);

// Fase 1 del roadmap open source — routers por dominio (ver require()s arriba).
const ROUTE_CONTEXT = { app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, rootDir: ROOT };
registerHomeRoutes({ ...ROUTE_CONTEXT, getConnectorInstances, stmtConnGet });
registerCustomBlocksRoutes(ROUTE_CONTEXT);
registerModulePagesRoutes(ROUTE_CONTEXT);
registerDashboardsRoutes(ROUTE_CONTEXT);
registerWorkspacePackageRoutes({
  ...ROUTE_CONTEXT,
  resolveConnectorType,
  connectionAlias: id => stmtConnGet.get(id)?.name || id,
  connectionCandidates: connectorTypeId => [connectorTypeId, ...getConnectorInstances(connectorTypeId)]
    .filter(id => !!kvGet(`connector-config-${id}`)?.value)
    .map(id => ({ id, name: stmtConnGet.get(id)?.name || id })),
});
registerDevicesRoutes(ROUTE_CONTEXT);
registerTagsRoutes(ROUTE_CONTEXT);
registerVaultMapRoutes({ ...ROUTE_CONTEXT, entity: "connectors", kvKey: "connector-vault-map", label: "conector" });
registerVmsRoutes(ROUTE_CONTEXT);
registerInventoryRoutes(ROUTE_CONTEXT);
registerDocumentationRoutes(ROUTE_CONTEXT);

// AI Context - public endpoint for agents (before connectors, uses connectorManifests)
const connectorList = [...connectorManifests.values()].map(m => ({
  id: m.id,
  name: m.name,
  capabilities: m.capabilities || ["read"],
}));
registerAIContextRoutes({ ...ROUTE_CONTEXT, connectors: connectorList });

// OpenAPI/Swagger docs (public, no auth)
registerOpenAPIRoutes({ app, connectors: connectorList });
registerAgentSurfaceRoutes({ app, rootDir: ROOT });

function setStaticHeaders(res, filePath) {
  if (filePath.endsWith(".webmanifest")) {
    res.setHeader("Content-Type", "application/manifest+json");
  }
  // Never cache these — changes must be picked up immediately
  if (filePath.endsWith("sw.js") || filePath.endsWith("data.js") || filePath.endsWith(".jsx")) {
    res.setHeader("Cache-Control", "no-store");
  }
}

let _publicDataCache = null;
function buildPublicDataScript() {
  if (_publicDataCache) return _publicDataCache;
  // public-data.js is the only dataset that reaches a browser. The raw dev
  // mock it replaced carried this organisation's cluster names and internal
  // domains, so it was deleted rather than left in a repository that is going
  // to be published.
  _publicDataCache = fs.readFileSync(path.join(ROOT, "app", "public-data.js"), "utf8");
  return _publicDataCache;
}

// Conectores: CRUD, instancias extra, status agregado, sync-interval y AI
// context — ver server/routes/connectors.js (extraído del monolito, se
// registra más abajo una vez que CONNECTOR_CONTEXT existe).

registerVaultRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, vault, AppError, sendAppError, log });

// ─── xterm.js static assets (served locally so no CDN needed) ────────────────
const xtermDir    = path.join(__dirname, "node_modules", "@xterm", "xterm");
const xtermFitDir = path.join(__dirname, "node_modules", "@xterm", "addon-fit");
app.get("/lib/xterm.js",     (req, res) => res.sendFile(path.join(xtermDir,    "lib", "xterm.js")));
app.get("/lib/xterm.css",    (req, res) => res.sendFile(path.join(xtermDir,    "css", "xterm.css")));
app.get("/lib/addon-fit.js", (req, res) => res.sendFile(path.join(xtermFitDir, "lib", "addon-fit.js")));

// ─── vCenter connector ────────────────────────────────────────────────────────
// Lives in server/connectors/enterprise/vcenter (registered below).

// HTTPS agent that accepts self-signed certs. Still declared here because other
// self-hosted connectors in this file reuse it.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// ── Bitwarden CLI connector endpoints ────────────────────────────────────────
// Lives in server/connectors/community/bitwarden (registered below). The bw()
// CLI runner and BW_BIN live in core/services/vault.js — the connector
// consumes them via CONNECTOR_CONTEXT instead of owning them.

// ── Plane.so connector ────────────────────────────────────────────────────────
// Lives in server/connectors/community/plane (registered below).

// Descriptor por tipo para los 8 conectores "simples" e instantiable (gitlab,
// github, bitbucket, outline, portainer, qportal, outlook, plane) — usado por
// el loop genérico de /api/connectors/status más abajo. `configFields` son
// estáticos de la config (van antes del spread de `status`, que puede
// pisarlos); `dataFields` se derivan del último sync (van después de
// `status`, para que nunca los pise). `configured` es opcional — solo
// Outlook necesita un criterio distinto al genérico `!!cfg`.
const SIMPLE_CONNECTOR_SHAPE = {
  gitlab: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null }),
    dataFields: (data, id) => ({
      projects: attachRepoSettings(attachCloneState(id, data?.projects || [])),
      deployments: data?.deployments?.slice(0, 30) || [],
      commits: data?.commits?.slice(0, 30) || [],
      syncedAt: data?.syncedAt || null,
    }),
  },
  github: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null }),
    dataFields: (data, id) => ({
      projects: attachRepoSettings(attachCloneState(id, data?.projects || [])),
      deployments: data?.deployments?.slice(0, 30) || [],
      commits: data?.commits?.slice(0, 30) || [],
      syncedAt: data?.syncedAt || null,
    }),
  },
  bitbucket: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null, bbType: cfg?.type || null }),
    dataFields: (data, id) => ({
      projects: attachRepoSettings(attachCloneState(id, data?.projects || [])),
      deployments: data?.deployments?.slice(0, 30) || [],
      commits: data?.commits?.slice(0, 30) || [],
      syncedAt: data?.syncedAt || null,
    }),
  },
  outline: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null }),
    dataFields: data => ({
      collections: data?.collections || [],
      documents: data?.documents?.slice(0, 30) || [],
      syncedAt: data?.syncedAt || null,
    }),
  },
  portainer: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null }),
    dataFields: data => ({
      endpointCount: data?.endpoints?.length ?? null,
      syncedAt: data?.syncedAt || null,
    }),
  },
  qportal: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null, email: cfg?.email || null }),
    dataFields: data => ({
      vrfCount: data?.vrfCatalog?.length ?? null,
      reqCount: data?.requestVrf?.length ?? null,
      assignedCount: data?.assignedResources?.length ?? null,
      syncedAt: data?.syncedAt || null,
    }),
  },
  outlook: {
    configured: cfg => !!cfg?.clientId,
    configFields: cfg => ({ connected: !!cfg?.refreshToken, user: cfg?.user || null }),
    dataFields: data => ({
      eventCount: data?.events?.length ?? null,
      syncedAt: data?.syncedAt || null,
    }),
  },
  plane: {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null, workspace: cfg?.workspace || null }),
    dataFields: data => ({ projects: data?.projects || [] }),
  },
  "lintaya-remote": {
    configFields: cfg => ({ baseUrl: cfg?.baseUrl || null }),
    dataFields: data => ({
      connectors: data?.connectors || [],
      blocks: data?.blocks || [],
      boards: data?.boards || [],
      syncedAt: data?.syncedAt || null,
    }),
  },
};

// GET /api/connectors/status  — live status for all connectors
// /api/connectors/status — ver server/routes/connectors.js.

// GET /api/activity/status — same idea as /api/connectors/status but for the
// generic activity log (see ACTIVITY_DOMAIN_LABELS/activityLog above):
// write routes that don't belong to any one connector.
app.get("/api/activity/status", requireAuth, (req, res) => {
  const result = {};
  for (const [domain, label] of Object.entries(ACTIVITY_DOMAIN_LABELS)) {
    result[domain] = { label, log: kvGet(`activity-log-${domain}`)?.value || [] };
  }
  res.json(result);
});

app.get(["/app/data.js", "/app/public-data.js"], (req, res) => {
  res.type("application/javascript");
  res.send(buildPublicDataScript());
});

app.use(
  "/app",
  express.static(path.join(ROOT, "app"), {
    setHeaders: setStaticHeaders,
  })
);
app.use(
  "/icons",
  express.static(path.join(ROOT, "icons"), {
    setHeaders: setStaticHeaders,
  })
);
app.use(
  "/assets",
  express.static(path.join(ROOT, "assets"), {
    setHeaders: setStaticHeaders,
  })
);
// Third-party libraries vendored locally instead of loaded from a CDN
// (DOMPurify today) — Lintaya has to keep working with no internet access,
// so anything the shell needs on every load can't depend on a live fetch to
// an external host.
app.use(
  "/vendor",
  express.static(path.join(ROOT, "vendor"), {
    setHeaders: setStaticHeaders,
  })
);

app.get("/manifest.webmanifest", (req, res) => {
  res.type("application/manifest+json");
  res.sendFile(path.join(ROOT, "manifest.webmanifest"));
});

// The worker's cache key is injected here rather than kept in the tracked file,
// so developing against a clean clone leaves it clean. See
// core/services/sw-version.js for how the key is derived.
app.get("/sw.js", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("application/javascript");
  const version = serviceWorkerVersion({
    appVersion: APP_VERSION,
    nodeEnv: config.nodeEnv,
    rootDir: ROOT,
  });
  res.send(injectServiceWorkerVersion(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), version));
});

function sendShell(res) {
  res.sendFile(path.join(ROOT, "Lintaya.html"));
}

// ── Auto-sync scheduler ──────────────────────────────────────────────────────
// Periodically hits each connector's own /sync route over loopback HTTP (reuses
// the exact same code path as clicking "Sync" in the UI — no logic duplicated).
// The targets are derived from the manifests rather than listed here: a list in
// this file has to be edited for every connector, had already drifted (neither
// lintaya-remote nor outlook-local was ever scheduled), and named connectors
// that a given build may not ship. A connector that is not on the fast cadence,
// or whose sync route is shaped differently, declares it in its own manifest —
// see `autoSync` on vCenter.
const AUTO_SYNC_TARGETS = listAutoSyncTargets();
// Instancias extra de los 8 conectores simples/instantiable heredan el mismo
// group "fast" que su tipo base (ninguno de esos 8 usa "slow") — así una
// instancia nueva entra al auto-sync sin tocar este archivo.
function getAllAutoSyncTargets() {
  const extra = [];
  for (const typeId of Object.keys(SIMPLE_CONNECTOR_SHAPE)) {
    for (const instanceId of getConnectorInstances(typeId)) {
      extra.push({ id: instanceId, path: `/api/connectors/${instanceId}/sync`, group: "fast" });
    }
  }
  return [...AUTO_SYNC_TARGETS, ...extra];
}

// Cada conector puede fijar su propio intervalo (kv "connector-sync-intervals" =
// { [id]: minutos }) en vez de heredar el del grupo fast/slow — se edita desde el
// panel de detalle del conector (botón "⏱ Sync interval"), no solo desde vCenter.
function getSyncIntervalOverrides() {
  return kvGet("connector-sync-intervals")?.value || {};
}

function effectiveSyncInterval(target, cfg) {
  const overrides = getSyncIntervalOverrides();
  const override = overrides[target.id];
  if (override && override > 0) return override;
  return target.group === "slow" ? cfg.slowMinutes : cfg.fastMinutes;
}

// /api/connectors/:id/sync-interval y /api/connectors/:id/ai-context — ver
// server/routes/connectors.js.

async function runAutoSyncTarget(t) {
  if (!kvGet(`connector-config-${t.id}`)?.value) return; // skip unconfigured
  // kv "connector-enabled" = { [id]: false } — set via POST
  // /api/connectors/:id/enabled (routes/connectors.js). Absent = enabled, the
  // default, so existing installations need no backfill.
  if (kvGet("connector-enabled")?.value?.[t.id] === false) return; // skip disabled
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${t.path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    log.info("[auto-sync] tick", { id: t.id, result: r.ok ? "ok" : `HTTP ${r.status}` });
  } catch (e) {
    log.warn("[auto-sync] failed", { id: t.id, message: e.message });
  }
}

registerSettingsAutoSyncRoutes({
  ...ROUTE_CONTEXT,
  getTargets: getAllAutoSyncTargets,
  getOverrides: getSyncIntervalOverrides,
  effectiveSyncInterval,
});

const autoSyncTimer = setInterval(async () => {
  const cfg = readAutoSyncConfig(kvGet);
  if (!cfg.enabled) return;

  const state = kvGet("auto-sync-state")?.value || {};
  const now = Date.now();

  const due = getAllAutoSyncTargets().filter(t => {
    const minutes = effectiveSyncInterval(t, cfg);
    const last = state[t.id];
    return !last || now - new Date(last).getTime() >= minutes * 60_000;
  });

  if (due.length === 0) return;

  await Promise.allSettled(due.map(async (t) => {
    await runAutoSyncTarget(t);
    state[t.id] = new Date().toISOString();
  }));
  kvSet("auto-sync-state", state);
}, 60_000);
autoSyncTimer.unref?.();

// ── Qportal connector ────────────────────────────────────────────────────────
// Lives in server/connectors/enterprise/qportal (registered below).

// ── Outlook (Microsoft Graph) connector ──────────────────────────────────────
// Lives in server/connectors/development/outlook (registered below).

// ── AI assistant (chat) ──────────────────────────────────────────────────────
// Provider settings (/api/settings/ai), /api/chat streaming and the legacy
// claude-key shim live in server/routes/ai-settings.js (registered above).

const application = app;
const httpServer = http.createServer(application);

registerSshRoutes({
  app,
  httpServer,
  requireAuth,
  kvGet,
  log,
  token: TOKEN,
  serverDir: __dirname,
  SSHClient,
  lookupVaultPassword: vault.lookupVaultPassword,
  AppError,
  sendAppError,
});

// Container monitoring — unified layer (SSH collector + Portainer connector)
// ════════════════════════════════════════════════════════════════════════════

// Resolve SSH credentials for a VM from the vault map (mirrors /api/ssh/session).
// Returns { username, password } on success, or { error } with a specific reason.
async function resolveVmSshCreds(vmId) {
  const map   = kvGet("vm-vault-map")?.value || {};
  const entry = map[vmId];
  const vaultItemId = typeof entry === "object" ? entry?.vaultItemId : entry;
  let   sshUser     = (typeof entry === "object" ? entry?.sshUser : null) || null;
  if (!vaultItemId) return { error: "no-cred-linked" };
  // Username priority: explicit sshUser → the vault item's own username → root
  if (!sshUser) {
    const it = (kvGet("vault-items")?.value || []).find(i => i.id === vaultItemId);
    if (it?.user) sshUser = it.user;
  }
  let password = null;
  if (vault.VAULT_MODE === "bitwarden") {
    if (!vault.vaultSession.unlocked || !vault.vaultSession.bwSession) return { error: "vault-locked" };
    try { password = await vault.bw(["get", "password", String(vaultItemId)], vault.vaultSession.bwSession); vault.armVaultTimer(); }
    catch { return { error: "cred-fetch-failed" }; }
  } else {
    const row = vault.selectVaultSecret.get(String(vaultItemId));
    if (row) password = row.secret;
  }
  if (!password) return { error: "cred-empty" };
  // Per-VM SSH port + optional jump host (ProxyJump), mirroring /api/ssh/session.
  const port = (typeof entry === "object" && entry.sshPort) ? entry.sshPort : 22;
  let jump = null;
  if (typeof entry === "object" && entry.jump && entry.jump.host) {
    let jpass = null;
    if (entry.jump.vaultItemId) {
      try { jpass = await vault.lookupVaultPassword(entry.jump.vaultItemId); }
      catch (e) { return { error: e.code === "vault-locked" ? "vault-locked" : "cred-fetch-failed" }; }
    }
    jump = {
      host: entry.jump.host,
      port: entry.jump.port || 22,
      user: entry.jump.user || sshUser || "root",
      password: jpass,
    };
  }
  return { username: sshUser || "root", password, port, jump };
}

// Non-interactive SSH exec: connect, run one command, return { out, err }.
// Single auth attempt (account-lockout safe). Linux Docker hosts → default algorithms.
// The shared service owns all non-interactive execution used by containers and
// fabric; interactive terminal behavior remains in this module.
function sshExec(ip, port, username, password, command, timeoutMs = 12000, jump = null) {
  return executeSsh({ SSHClient, ip, port, username, password, command, timeoutMs, jump });
}


// SSH into a VM and collect its containers (docker, podman fallback) + stats
async function collectContainersSSH(vmId, vmName, ip) {
  if (!ip || ip === "—") return { error: "no-ip" };
  const creds = await resolveVmSshCreds(vmId);
  if (creds.error) return { error: creds.error };
  try {
    // Detect runtime presence so "no Docker installed" is distinguishable from "0 containers"
    const cmd = "if command -v docker >/dev/null 2>&1; then docker ps --all --format '{{json .}}'; " +
                "elif command -v podman >/dev/null 2>&1; then podman ps --all --format '{{json .}}'; " +
                "else echo __NO_RUNTIME__; fi";
    const ps = await sshExec(ip, creds.port || 22, creds.username, creds.password, cmd, 12000, creds.jump);
    if (/__NO_RUNTIME__/.test(ps.out)) return { error: "no-docker-runtime" };
    if (!ps.out.trim() && /permission denied|cannot connect to the docker daemon/i.test(ps.err || ""))
      return { error: "docker-permission" };
    const containers = parseDockerPs(ps.out);
    // Resource stats only when there are containers (skips a slow extra SSH on empty hosts)
    if (containers.length) {
      try {
        const st = await sshExec(ip, creds.port || 22, creds.username, creds.password,
          "docker stats --no-stream --format '{{json .}}' 2>/dev/null", 12000, creds.jump);
        const statMap = {};
        st.out.split("\n").filter(Boolean).forEach(l => { try { const s = JSON.parse(l); statMap[(s.ID || s.Container || "").slice(0, 12)] = s; } catch {} });
        for (const c of containers) { const s = statMap[c.id]; if (s) { c.cpuPct = s.CPUPerc || null; c.memUsage = s.MemUsage || null; } }
      } catch {}
    }
    return { containers };
  } catch (e) { return { error: e.message }; }
}

// Run the SSH collector for every VM marked as a Docker host
// Collect one VM's containers via SSH; persists result (incl. error) and returns a summary
async function collectOneVm(vmId) {
  const data   = kvGet("vcenter-data-vcenter")?.value;
  const vm     = (data?.vms || []).find(v => v.vm === vmId);
  const vmName = vm?.name || vmId;
  const ip     = data?.clusterVmMap?.[vmId]?.ipAddress || (kvGet("vm-ip-overrides")?.value || {})[vmName] || null;
  const result = await collectContainersSSH(vmId, vmName, ip);
  kvSet(`vm-containers-${vmId}`, { ...result, ts: Date.now(), source: "ssh", vmName, ip });
  return { vmId, vmName, ip, count: result.containers?.length ?? 0, error: result.error || null };
}

async function runContainerCollection() {
  const hosts = kvGet("vm-container-hosts")?.value || [];
  for (const vmId of hosts) await collectOneVm(vmId);
  return { polled: hosts.length };
}

registerContainersRoutes({
  ...ROUTE_CONTEXT,
  collectOneVm,
  runContainerCollection,
  resolveVmSshCreds,
  sshExec,
  portainer: { fetch: portainerFetch, fetchBuffer: portainerFetchBuffer, token: portainerToken },
  demuxDockerLog,
  normalizeInspect,
});

// POST /api/apps/topology  body { vmIds:[...] } → container graph for an app.
// Reads `docker inspect` on each linked VM (env + networks), infers edges from
// env values that reference another container's name/alias. Env is used only
// server-side for inference and never returned.
app.post("/api/apps/topology", requireAuth, async (req, res) => {
  const vmIds = Array.isArray(req.body?.vmIds) ? req.body.vmIds : [];
  if (!vmIds.length) return res.json({ nodes: [], edges: [], vms: [] });
  const data  = kvGet("vcenter-data-vcenter")?.value;
  const overrides = kvGet("vm-ip-overrides")?.value || {};
  const nodes = [], vmsOut = [], vmCtx = {};
  for (const vmId of vmIds) {
    const vm = (data?.vms || []).find(v => v.vm === vmId);
    const vmName = vm?.name || vmId;
    const ip = data?.clusterVmMap?.[vmId]?.ipAddress || overrides[vmName] || null;
    if (!ip) { vmsOut.push({ vmId, vmName, error: "no-ip" }); continue; }
    const creds = await resolveVmSshCreds(vmId);
    if (creds.error) { vmsOut.push({ vmId, vmName, error: creds.error }); continue; }
    vmCtx[vmId] = { ip, creds };
    try {
      const cmd = 'ids=$(docker ps -aq 2>/dev/null); if [ -n "$ids" ]; then docker inspect $ids 2>/dev/null; else echo "[]"; fi';
      const r = await sshExec(ip, creds.port || 22, creds.username, creds.password, cmd, 25000, creds.jump);
      let arr = []; try { arr = JSON.parse(r.out); } catch {}
      if (!Array.isArray(arr)) arr = [];
      // Live CPU/mem stats (best-effort)
      const statsMap = {};
      try {
        const sr = await sshExec(ip, creds.port || 22, creds.username, creds.password, "docker stats --no-stream --format '{{json .}}' 2>/dev/null", 20000, creds.jump);
        (sr.out || "").split("\n").filter(Boolean).forEach(l => { try { const s = JSON.parse(l); statsMap[(s.Name || "").replace(/^\//, "")] = { cpu: s.CPUPerc || null, mem: s.MemUsage || null }; } catch {} });
      } catch {}
      vmsOut.push({ vmId, vmName, count: arr.length });
      for (const c of arr) {
        const name = (c.Name || "").replace(/^\//, "");
        const nets = c.NetworkSettings?.Networks || {};
        const netNames = Object.keys(nets);
        const aliases = [name];
        for (const nd of Object.values(nets)) (nd.Aliases || []).forEach(a => aliases.push(a));
        const ports = [], hostPorts = [];
        for (const [k, v] of Object.entries(c.NetworkSettings?.Ports || {})) if (Array.isArray(v)) v.forEach(b => { ports.push((b.HostPort ? b.HostPort + "→" : "") + k); if (b.HostPort) hostPorts.push(String(b.HostPort)); });
        const image = c.Config?.Image || "";
        const isProxy = /nginx|apache|httpd|traefik|proxy-manager/i.test(image + " " + name);
        const st = statsMap[name] || {};
        nodes.push({ id: vmId + "/" + name, name, vm: vmName, vmId, vmIp: ip, image, running: !!(c.State?.Running), state: (c.State?.Status || "").toLowerCase(), env: c.Config?.Env || [], aliases, networks: netNames, ports, hostPorts, isProxy, cpuPct: st.cpu || null, memUsage: st.mem || null });
      }
    } catch (e) { vmsOut.push({ vmId, vmName, error: e.message }); }
  }
  // Alias index (skip overly generic tokens to avoid false edges like "app").
  const STOP = new Set(["app", "db", "web", "api", "backend", "frontend", "default", "data", "redis", "cache", "server", "host", "local", "prod", "dev", "test", "main", "www", "net", "svc", "service", "node", "proxy"]);
  // Indexes scoped PER VM (avoids cross-VM port/alias collisions), plus a global
  // ip:port index so a proxy can reference a container on another VM by its IP.
  const perVm = {};   // vmId -> { alias:{}, port:{} }
  const ipPort = {};  // "vmIp:hostPort" -> node id
  nodes.forEach(n => {
    const pv = perVm[n.vmId] || (perVm[n.vmId] = { alias: {}, port: {} });
    n.aliases.forEach(a => { const k = (a || "").toLowerCase(); if (k.length >= 3 && !STOP.has(k) && !pv.alias[k]) pv.alias[k] = n.id; });
    (n.hostPorts || []).forEach(p => { if (!pv.port[p]) pv.port[p] = n.id; if (n.vmIp && !ipPort[n.vmIp + ":" + p]) ipPort[n.vmIp + ":" + p] = n.id; });
  });
  const seen = new Set(), edges = [];
  const addEdge = (from, to, via, type, extra) => { if (!from || !to || from === to) return; const key = from + "->" + to + ":" + type; if (seen.has(key)) return; seen.add(key); edges.push(Object.assign({ from, to, via, type }, extra || {})); };
  // Edges from env references (within the same VM)
  nodes.forEach(n => {
    const pv = perVm[n.vmId]; if (!pv) return;
    const toks = new Set();
    (n.env || []).forEach(kv => { const v = kv.slice(kv.indexOf("=") + 1).toLowerCase(); v.split(/[^a-z0-9_.-]+/).forEach(t => { if (t && !STOP.has(t)) toks.add(t); }); });
    toks.forEach(t => { const to = pv.alias[t]; if (to) addEdge(n.id, to, t, "env"); });
  });
  // Edges from reverse-proxy config (nginx / apache) inside proxy containers
  for (const n of nodes.filter(x => x.isProxy && x.running)) {
    const ctx = vmCtx[n.vmId]; if (!ctx) continue;
    try {
      const cmd = `docker exec ${n.name} sh -c 'cat /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* /data/nginx/proxy_host/*.conf /etc/apache2/sites-enabled/*.conf /usr/local/apache2/conf/httpd.conf 2>/dev/null' 2>/dev/null`;
      const r = await sshExec(ctx.ip, ctx.creds.port || 22, ctx.creds.username, ctx.creds.password, cmd, 15000, ctx.creds.jump);
      const conf = r.out || "";
      // Local refs resolve by published host-port on THIS vm; other-VM IPs via
      // the global ip:port index; named hosts by this VM's alias.
      const pv = perVm[n.vmId] || { alias: {}, port: {} };
      const localHost = new Set(["127.0.0.1", "localhost", "0.0.0.0", "172.17.0.1", ctx.ip]);
      const isIp = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
      const up = {}; let m;
      const upRe = /upstream\s+([a-zA-Z0-9_.-]+)\s*\{([^}]*)\}/g;
      while ((m = upRe.exec(conf))) { const sm = m[2].match(/server\s+([a-zA-Z0-9_.-]+)(?::(\d+))?/); if (sm) up[m[1].toLowerCase()] = sm[1].toLowerCase() + (sm[2] ? ":" + sm[2] : ""); }
      const resolve = (host, port, domain, path) => {
        host = host.toLowerCase();
        if (up[host]) { const parts = up[host].split(":"); host = parts[0]; port = port || parts[1]; }
        let to = null;
        if (localHost.has(host) && port) to = pv.port[port];
        else if (isIp(host) && port) to = ipPort[host + ":" + port] || pv.port[port];
        else to = pv.alias[host];
        if (to) addEdge(n.id, to, host + (port ? ":" + port : ""), "proxy", (domain || (path && path !== "/")) ? { domain: domain || null, path: path || null } : null);
      };
      // Per server { server_name … location … proxy_pass } → capture domain + path.
      for (const blk of conf.split(/\bserver\s*\{/).slice(1)) {
        const sn = blk.match(/server_name\s+([^;]+);/);
        const domain = sn ? (sn[1].trim().split(/\s+/).find(d => d && d !== "_") || null) : null;
        let anyLoc = false;
        // Brace-aware location extraction (handles nested if/set blocks inside).
        const lre = /location\s+([^\s{]+)\s*\{/g; let lm;
        while ((lm = lre.exec(blk))) {
          let depth = 1, i = lre.lastIndex;
          while (i < blk.length && depth > 0) { const ch = blk[i++]; if (ch === "{") depth++; else if (ch === "}") depth--; }
          const body = blk.slice(lre.lastIndex, i - 1);
          lre.lastIndex = i;
          const pp = body.match(/proxy_pass\s+https?:\/\/([a-zA-Z0-9_.-]+)(?::(\d+))?/i);
          if (pp) { anyLoc = true; resolve(pp[1], pp[2], domain, lm[1]); }
        }
        if (!anyLoc) { const pp = blk.match(/proxy_pass\s+https?:\/\/([a-zA-Z0-9_.-]+)(?::(\d+))?/i); if (pp) resolve(pp[1], pp[2], domain, "/"); }
      }
      // Fallback global scan (no domain/path) — dedup keeps the richer edge above.
      const ppRe = /proxy_pass\s+https?:\/\/([a-zA-Z0-9_.-]+)(?::(\d+))?/gi;
      while ((m = ppRe.exec(conf))) resolve(m[1], m[2]);
      const apRe = /ProxyPass\s+\S+\s+https?:\/\/([a-zA-Z0-9_.-]+)(?::(\d+))?/gi;
      while ((m = apRe.exec(conf))) resolve(m[1], m[2]);
    } catch (e) { /* proxy may have no docker exec / no config */ }
  }
  const outNodes = nodes.map(n => ({ id: n.id, name: n.name, vm: n.vm, vmId: n.vmId, vmIp: n.vmIp, image: n.image, running: n.running, state: n.state, networks: n.networks, ports: n.ports, isProxy: n.isProxy, cpuPct: n.cpuPct, memUsage: n.memUsage }));
  res.json({ nodes: outNodes, edges, vms: vmsOut, collectedAt: Date.now() });
});

// ── Portainer connector ───────────────────────────────────────────────────────
// Portainer lives in server/connectors/community/portainer (registered below).

// Periodic SSH container collection (every 3 min; no-op if no hosts marked)
const containerCollectionTimer = setInterval(() => {
  runContainerCollection().catch(() => {});
}, 3 * 60 * 1000);
containerCollectionTimer.unref?.();

// Workload sources register themselves when their connector loads (see
// CONNECTOR_CONTEXT below). Core keeps the join and knows no provider by name,
// so a build without the enterprise tier correlates fabric with every MAC
// unnamed instead of failing.
const workloadSources = createWorkloadSources();

// ════════════════════════════════════════════════════════════════════════════
// Fabric correlation — provider-agnostic. Only devices flagged with a
// `fabricProvider` expose this. A plane *adapter* (e.g. ucs-nxos) yields the
// MAC table + per-port traffic; a *workload source* (e.g. vcenter) yields
// mac → workload. correlate() joins them. New providers (cloud, etc.) plug in
// via FABRIC_ADAPTERS / workloadSources without touching the engine or UI.
// ════════════════════════════════════════════════════════════════════════════
function normMac(m) { return (m || "").toLowerCase().replace(/[^0-9a-f]/g, ""); }
function fmtMac(n) { return n.length === 12 ? n.replace(/(..)(..)(..)(..)(..)(..)/, "$1:$2:$3:$4:$5:$6") : n; }

// Resolve SSH creds for a custom device (mirrors resolveVmSshCreds, device map).
async function resolveDeviceSshCreds(deviceId) {
  const dev = (kvGet("custom-devices")?.value || []).find(d => d.id === deviceId);
  if (!dev) return { error: "device-not-found" };
  const vaultItemId = (kvGet("device-vault-map")?.value || {})[deviceId];
  if (!vaultItemId) return { error: "no-cred-linked" };
  let password;
  try { password = await vault.lookupVaultPassword(vaultItemId); }
  catch (e) { return { error: e.code === "vault-locked" ? "vault-locked" : "cred-fetch-failed" }; }
  if (!password) return { error: "cred-empty" };
  let user = dev.sshUser;
  if (!user) { const it = (kvGet("vault-items")?.value || []).find(i => i.id === vaultItemId); user = it?.user; }
  return { dev, username: user || "admin", password, port: dev.sshPort || 22 };
}

// Generic interactive-shell runner: opens a shell, sends a command sequence
// (each with a settle delay), returns combined output. Needed for gear like UCS
// where `connect nxos` spawns a subshell that exec channels can't drive.
function sshShellCollect(ip, port, username, password, steps, opts = {}) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let out = "", done = false, authDone = false;
    const finish = (fn, a) => { if (done) return; done = true; try { conn.end(); } catch {} fn(a); };
    const hard = setTimeout(() => finish(reject, new Error("ssh-shell-timeout")), opts.hardTimeout || 50000);
    conn.on("ready", () => {
      conn.shell({ term: "xterm", cols: 220, rows: 80 }, async (err, stream) => {
        if (err) { clearTimeout(hard); return finish(reject, err); }
        stream.on("data", d => out += d.toString("utf8"));
        stream.stderr.on("data", d => out += d.toString("utf8"));
        for (const s of steps) { stream.write((s.cmd || "") + "\n"); await new Promise(r => setTimeout(r, s.wait || 1500)); }
        clearTimeout(hard);
        finish(resolve, out.replace(/\x1b\[[0-9;]*[mGKHFJ]/g, ""));
      });
    });
    conn.on("error", e => { clearTimeout(hard); finish(reject, e); });
    conn.connect({ host: ip, port: parseInt(port, 10) || 22, username, readyTimeout: 12000, hostVerifier: () => true, algorithms: SSH_ALGS,
      authHandler(ml, _p, next) {
        if (ml === null) { next("none"); return; }
        if (authDone) { next(false); return; }
        authDone = true;
        if (ml.includes("password")) next({ type: "password", username, password });
        else if (ml.includes("keyboard-interactive")) next({ type: "keyboard-interactive", username, prompt(_n, _i, _l, pr, fin) { fin(pr.map(p => (p.prompt || "").toLowerCase().includes("pass") ? password : "")); } });
        else next(false);
      } });
  });
}

function parseNxosMacTable(text) {
  const idx = text.lastIndexOf("show mac address-table");
  const seg = idx >= 0 ? text.slice(idx) : text;
  const rows = [];
  for (const line of seg.split("\n")) {
    const m = line.match(/^[*+ ]*\s*(\d+)\s+([0-9a-fA-F.]{14})\s+\w+\s+\S+\s+\S+\s+\S+\s+(\S+)/);
    if (m) rows.push({ vlan: m[1], mac: normMac(m[2]), port: m[3] });
  }
  return rows;
}
function parseNxosCounters(text) {
  const idx = text.lastIndexOf("show interface counters");
  const seg = idx >= 0 ? text.slice(idx) : text;
  const inO = {}, outO = {}; let mode = null;
  for (const line of seg.split("\n")) {
    if (/InOctets/.test(line)) { mode = "in"; continue; }
    if (/OutOctets/.test(line)) { mode = "out"; continue; }
    if (/(InMcastPkts|InBcastPkts|OutMcastPkts|OutBcastPkts)/.test(line)) { mode = null; continue; }
    const m = line.match(/^(\S+)\s+(\d+)\s+(\d+)/);
    if (m && mode === "in") inO[m[1]] = +m[2];
    if (m && mode === "out") outO[m[1]] = +m[2];
  }
  return { inO, outO };
}

// Plane adapter: Cisco UCS Fabric Interconnect over NX-OS.
async function fabricAdapterUcsNxos(creds, dev) {
  const fab = /[-_]?b$/i.test(dev.name || "") ? "b" : "a";
  const text = await sshShellCollect(dev.mgmtIp, creds.port, creds.username, creds.password, [
    { cmd: "", wait: 1200 },
    { cmd: `connect nxos ${fab}`, wait: 2800 },
    { cmd: "terminal length 0", wait: 1000 },
    { cmd: "show mac address-table", wait: 4000 },
    { cmd: "show interface counters", wait: 6000 },
  ]);
  const macs = parseNxosMacTable(text);
  const { inO, outO } = parseNxosCounters(text);
  return macs.map(e => ({ mac: e.mac, port: e.port, segment: e.vlan, trafficIn: inO[e.port] ?? null, trafficOut: outO[e.port] ?? null }));
}

const FABRIC_ADAPTERS = { "ucs-nxos": fabricAdapterUcsNxos };

// POST /api/fabric/:deviceId/collect — run the device's plane adapter
app.post("/api/fabric/:deviceId/collect", requireAuth, auditActivity({ provider: "fabric", action: "Colectar fabric" }), async (req, res) => {
  const { deviceId } = req.params;
  const dev = (kvGet("custom-devices")?.value || []).find(d => d.id === deviceId);
  if (!dev) return sendAppError(res, AppError.notFound("device-not-found"), req);
  const provider = dev.fabricProvider;
  if (!provider || !FABRIC_ADAPTERS[provider]) return sendAppError(res, AppError.badRequest("not-a-fabric-device"), req);
  const creds = await resolveDeviceSshCreds(deviceId);
  if (creds.error) {
    const error = creds.error === "vault-locked"
      ? AppError.unauthorized("vault-locked")
      : AppError.badRequest(creds.error);
    return sendAppError(res, error, req);
  }
  try {
    const endpoints = await FABRIC_ADAPTERS[provider](creds, dev);
    const data = { provider, endpoints, ts: Date.now() };
    kvSet(`fabric-data-${deviceId}`, data);
    res.locals.auditMessage = `Colectar fabric de "${dev.name || deviceId}" — ${endpoints.length} endpoints`;
    res.json({ ok: true, count: endpoints.length, ts: data.ts });
  } catch (error) {
    log.warn("[fabric] collection failed", { deviceId, provider, message: error.message });
    return sendAppError(res, AppError.badGateway("fabric-collection-failed", { cause: error }), req);
  }
});

// GET /api/fabric/:deviceId/correlation — join plane data with workloads
app.get("/api/fabric/:deviceId/correlation", requireAuth, async (req, res) => {
  const { deviceId } = req.params;
  const dev = (kvGet("custom-devices")?.value || []).find(d => d.id === deviceId);
  if (!dev) return sendAppError(res, AppError.notFound("device-not-found"), req);
  if (!dev.fabricProvider) return sendAppError(res, AppError.badRequest("not-a-fabric-device"), req);
  const fab = kvGet(`fabric-data-${deviceId}`)?.value;
  if (!fab) return res.json({ collected: false, rows: [], missing: [], summary: null });
  let widx;
  try { widx = await workloadSources.vmIndex(dev.site); }
  catch (error) {
    log.warn("[fabric] workload index failed", { deviceId, message: error.message });
    return sendAppError(res, AppError.badGateway("workload-index-failed", { cause: error }), req);
  }
  const idx = widx.index;
  const hidx = workloadSources.hostIndex(dev.site);
  const rows = fab.endpoints.map(e => {
    const w = idx[e.mac];
    const h = !w ? hidx[e.mac] : null;
    return { mac: fmtMac(e.mac), port: e.port, segment: e.segment, trafficIn: e.trafficIn, trafficOut: e.trafficOut,
      workload: w ? w.vm : (h ? h.host : null),
      kind:     w ? "vm"  : (h ? "host" : null),
      net:      w ? w.net : (h ? h.device : null),
      connected: w ? w.connected : (h ? true : null) };
  }).sort((a, b) => (a.segment - b.segment) || (b.trafficOut || 0) - (a.trafficOut || 0));
  const fabMacs = new Set(fab.endpoints.map(e => e.mac));
  const missing = Object.entries(idx).filter(([m, w]) => w.connected && !fabMacs.has(m)).map(([m, w]) => ({ mac: fmtMac(m), workload: w.vm, net: w.net }));
  const summary = { total: rows.length, matched: rows.filter(r => r.workload).length,
    matchedVm: rows.filter(r => r.kind === "vm").length, matchedHost: rows.filter(r => r.kind === "host").length,
    orphan: rows.filter(r => !r.workload).length,
    missing: missing.length, collectedAt: fab.ts, indexedAt: widx.ts, workloads: widx.vmCount };
  res.json({ collected: true, provider: fab.provider, rows, missing, summary });
});

// Repos state/helpers/routes moved to server/routes/repos.js (registered below,
// right after CONNECTOR_CONTEXT — same spot the git/repos routes used to start).

// Connector routes go on their own router, mounted once here (well before the
// GET "*" catch-all below). A hot-mounted extra instance (POST
// /api/connectors/:typeId/instances, e.g. a second Outlook Local or GitLab
// connection, added without restarting the server) registers its routes at
// request time — long after the catch-all already sits at the end of `app`'s
// own middleware stack, so a plain `app.get(...)` call from that instance
// would be silently shadowed for every GET (POST/PUT/DELETE were unaffected,
// since the catch-all only handles GET, which is what made this so easy to
// miss until a route that's GET-only, like Outlook Local's, went looking).
// Routing through this router instead works because Express reads a mounted
// router's stack fresh on every request rather than snapshotting it at mount
// time, so routes added to it after boot are still found.
const connectorRouter = express.Router();
app.use(connectorRouter);

const CONNECTOR_CONTEXT = {
  app: connectorRouter, requireAuth, kvGet, kvSet, connectorLog,
  // Outlook drops its pending device code, which kvSet cannot express.
  kvDelete: (key) => db.prepare("DELETE FROM kv WHERE key = ?").run(key),
  // The bw() runner and BW_BIN belong to the vault service, so the Bitwarden
  // connector receives them rather than importing core/services/vault directly.
  runBw: vault.bw,
  binary: vault.BW_BIN,
  readVaultItems: () => kvGet("vault-items")?.value,
  // vCenter's live/diagnostics routers came from core in ADR-014 Phase 1 and
  // need more than a connector usually does. Handed to every connector the same
  // way runBw is: each destructures what it uses.
  auditActivity, AppError, sendAppError, log, workloadSources,
  // A connector installed under LINTAYA_CONNECTORS_DIR (ADR-014) resolves its
  // own require() against that directory, never against server/node_modules,
  // so it cannot reach express on its own. Handing over the instance the app
  // already uses also keeps middleware from a second, version-skewed copy.
  express,
  // Same reason as express: a connector installed outside the repository
  // cannot resolve connectors/sdk by relative path, and a copy of it would
  // build a second connector store over a second secret store.
  sdk: require("./connectors/sdk"),
};

// AGENT-001 (ADR-011): one registry instance for the whole process, built
// the same way every other service here is (a factory called once, threaded
// through as a dependency) — not a bare module singleton, so
// core/actions/registry.test.js and execute.test.js can each build their own
// isolated instance instead of sharing this one. All 13 connector types are
// registered via registerAllActions() (core/actions/bootstrap.js), shared
// with mcp-server.js (AGENT-002) so the two callers can't drift on which
// types/actions exist.
const actionRegistry = createActionRegistry();
// runBw/readVaultItems/binary: same vault-service handles CONNECTOR_CONTEXT
// already injects into registerBitwardenRoutes() above — see that context
// object's own comment for why the CLI runner and unlock session live in
// the vault service rather than this connector package.
registerAllActions(actionRegistry, {
  bitwarden: {
    runBw: CONNECTOR_CONTEXT.runBw,
    readVaultItems: CONNECTOR_CONTEXT.readVaultItems,
    binary: CONNECTOR_CONTEXT.binary,
  },
});
const approvalStore = createApprovalStore({ db });
const executeAction = createActionExecutor({
  registry: actionRegistry, kvGet, kvSet, connectorLog, resolveConnectorType, approvalStore,
});
// Connector packages are registered after this composition step so legacy
// provider routes can delegate destructive operations to the one executor.
// The same mutable context is also passed to hot-mounted connection instances.
CONNECTOR_CONTEXT.executeAction = executeAction;
CONNECTOR_CONTEXT.sendAppError = sendAppError;
registerConnectors({ context: CONNECTOR_CONTEXT });

registerConnectorsRoutes({
  app, requireAuth, kvGet, kvSet, kvGetByPrefix, auditActivity,
  stmtConnList, stmtConnGet, stmtConnInsert, stmtConnUpdate, stmtConnDelete, parseConn,
  resolveConnectorType, getConnectorConfigSchema, getConnectorManifest, isSupportedHere, listConnectorCatalog,
  getConnectorInstances, addConnectorInstance, removeConnectorInstance,
  registerConnectorInstance, nextInstanceId,
  SIMPLE_CONNECTOR_SHAPE, getSyncIntervalOverrides, connectorContext: CONNECTOR_CONTEXT,
  AppError, sendAppError,
});
registerActionsRoutes({
  app, requireAuth, registry: actionRegistry, publicActionShape, executeAction, resolveConnectorType, sendAppError,
});
registerApprovalRoutes({ app, requireAuth, approvalStore, executeAction, runWriteTool, kvGet, kvSet, sendAppError });

// ── AI assistant (multi-provider) ────────────────────────────────────────────
// Provider settings (/api/settings/ai), /api/chat streaming and the legacy
// claude-key shim live in server/routes/ai-settings.js (extracted here).
// Registered here (not earlier) because the write-tool proposal flow needs
// approvalStore, which is only constructed once the action registry exists.
registerAISettingsRoutes({ ...ROUTE_CONTEXT, db, log, config, kvGetByPrefix, approvalStore });

const { attachRepoSettings, attachCloneState, reposDb } = registerReposRoutes({
  app, requireAuth, kvGet, kvSet, auditWrite, connectorLog,
  resolveConnectorType, config, insecureAgent, AppError, sendAppError,
});

const backupService = createBackupService({
  mainDb: db,
  reposDb,
  backupDir: path.join(config.serverDir, "backups"),
});
registerBackupRoutes({
  app, requireAuth, auditActivity, backupService, vault, AppError, sendAppError,
});

// ── Outline connector ──────────────────────────────────────────────────────────

// Outline routes and REST client live in connectors/community/outline.
// ── UCS Manager connector ──────────────────────────────────────────────────────
// Lives in server/connectors/enterprise/ucsm (registered below).

// ── Shell + catch-all (MUST be last — shadows any GET route registered after) ──
app.get("/", (req, res) => sendShell(res));
app.get("/Lintaya.html", (req, res) => sendShell(res));
// Compat redirects — old PWA installs / bookmarks still have "Personal HQ.html"
// baked into their start_url (see docs/adr/001-public-name-lintaya.md). A 301
// updates the address bar to the new name on next load instead of 404ing them.
app.get("/Personal HQ.html", (req, res) => res.redirect(301, "/Lintaya.html"));
app.get("/Personal%20HQ.html", (req, res) => res.redirect(301, "/Lintaya.html"));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return sendAppError(res, AppError.notFound("not-found"), req);
  }
  if (path.extname(req.path)) {
    return res.status(404).end();
  }
  return sendShell(res);
});

// Safety net for anything that reaches next(err) instead of formatting its
// own response — registered last so it sits after every route above.
app.use(errorMiddleware(log));

function startServer() {
  if (!TOKEN) {
    throw new Error("HQ_TOKEN env var not set. Set it before starting the server.");
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Local: http://localhost:${PORT}`);
    log.info("Lintaya running", {
      url: `http://${HOST}:${PORT}`,
      tokenChars: TOKEN.length,
      vaultMode: vault.VAULT_MODE,
      sshTerminal: `ws://${HOST}:${PORT}/api/ssh/terminal`,
      lanHint: `http://<this-machine-ip>:${PORT}`,
    });

    // Auto-login to Bitwarden on startup if API key is configured and not yet logged in
    if (vault.VAULT_MODE === "bitwarden" && config.vault.clientId && config.vault.clientSecret) {
      vault.bw(["status"])
        .then((out) => {
          const status = JSON.parse(out).status;
          if (status === "unauthenticated") {
            log.info("[vault] bw unauthenticated — logging in with API key...");
            return vault.bw(["login", "--apikey", "--nointeraction"]);
          }
          log.info("[vault] bw status", { status });
        })
        .then(() => log.info("[vault] Ready — waiting for user to unlock via app"))
        .catch((err) => log.warn("[vault] Auto-login failed", { message: err.message }));
    }
  });

  return httpServer;
}

function closeResources() {
  clearInterval(autoSyncTimer);
  clearInterval(containerCollectionTimer);
  vault.clearVaultTimer();
  if (reposDb.open) reposDb.close();
  if (db.open) db.close();
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app: application,
  createApp,
  startServer,
  closeResources,
  kvSet,
  kvGet,
};
