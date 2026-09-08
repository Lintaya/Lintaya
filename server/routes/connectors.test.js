const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AppError, sendAppError } = require("../core/errors");
const { configureDefaultSecretStore } = require("../core/services/secret-store");
const { registerConnectorsRoutes } = require("./connectors");

// createConnectorStore() (used directly by the DELETE handlers below to clear
// a connection's secrets) reads the process-wide default secret store, not
// anything passed through registerConnectorsRoutes' context — so these tests
// swap it out and always restore the legacy no-op default afterwards, or a
// later test in this file (or run in the same worker) would see a stub.
const LEGACY_SECRET_STORE = { mode: "legacy", get: () => ({}), set() {}, clear() {} };
function withSecretStore(store, fn) {
  configureDefaultSecretStore(store);
  return Promise.resolve().then(fn).finally(() => configureDefaultSecretStore(LEGACY_SECRET_STORE));
}

function setup({ schema, manifest, catalog, rows, configs = {}, kvData, registerConnectorInstance, resolveConnectorType, manifests, schemas, simpleConnectorShape } = {}) {
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers.at(-1)); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers.at(-1)); },
    put(route, ...handlers) { routes.set(`PUT ${route}`, handlers.at(-1)); },
    delete(route, ...handlers) { routes.set(`DELETE ${route}`, handlers.at(-1)); },
  };
  const emptyStatement = { all: () => rows || [], get: () => null, run: () => {} };
  registerConnectorsRoutes({
    app,
    requireAuth(_req, _res, next) { next(); },
    auditActivity() { return (_req, _res, next) => next(); },
    kvGet(key) { return configs[key] === undefined ? null : { value: configs[key] }; }, kvSet(key, value) { configs[key] = value; }, kvGetByPrefix() { return kvData || {}; },
    stmtConnList: emptyStatement, stmtConnGet: emptyStatement,
    stmtConnInsert: emptyStatement, stmtConnUpdate: emptyStatement, stmtConnDelete: emptyStatement,
    parseConn: (value) => value,
    resolveConnectorType: resolveConnectorType || ((id) => id),
    getConnectorConfigSchema: schemas ? ((id) => schemas[id] || null) : (() => schema || null),
    getConnectorManifest: manifests ? ((id) => manifests[id] || null) : (() => manifest || null),
    // Igual que en server.js: el harness entrega lo mismo que producción, o
    // deja de probar lo que corre de verdad.
    isSupportedHere: (candidate) => !Array.isArray(candidate?.os) || candidate.os.includes(process.platform),
    listConnectorCatalog: () => catalog || [],
    getConnectorInstances: () => [], addConnectorInstance() {}, removeConnectorInstance() {},
    registerConnectorInstance: registerConnectorInstance || (() => {}), nextInstanceId: () => "gitlab2",
    SIMPLE_CONNECTOR_SHAPE: simpleConnectorShape || {}, getSyncIntervalOverrides: () => ({}), connectorContext: {},
    AppError, sendAppError,
  });
  const invoke = (method, route, { params = {}, body = {}, query = {}, id = "request-1" } = {}) => new Promise((resolve, reject) => {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler, `Missing ${method} ${route}`);
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    Promise.resolve(handler({ params, body, query, id }, res)).catch(reject);
  });
  return { invoke };
}

test("connector config schemas use RFC 9457 not-found details", async () => {
  const { invoke } = setup();
  const result = await invoke("GET", "/api/connectors/:id/config-schema", { params: { id: "missing" } });
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, {
    type: "urn:lintaya:problem:not-found",
    title: "Not Found",
    status: 404,
    detail: "no-config-schema",
    instance: "urn:lintaya:request:request-1",
    code: "NOT_FOUND",
    details: null,
    requestId: "request-1",
  });
});

test("GET /api/connectors/:id/readme returns the connector package's README.md", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-readme-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# Example connector\n\nHow it works.\n");
  const { invoke } = setup({ manifest: { manifestPath: path.join(dir, "manifest.json") } });
  const result = await invoke("GET", "/api/connectors/:id/readme", { params: { id: "example" } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { content: "# Example connector\n\nHow it works.\n" });
});

test("GET /api/connectors/:id/readme 404s when the package has no README.md", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-readme-"));
  const { invoke } = setup({ manifest: { manifestPath: path.join(dir, "manifest.json") } });
  const result = await invoke("GET", "/api/connectors/:id/readme", { params: { id: "example" } });
  assert.equal(result.status, 404);
  assert.equal(result.body.detail, "no-readme");
});

test("GET /api/connectors/:id/readme 404s for an unknown connector type", async () => {
  const { invoke } = setup(); // no manifest configured
  const result = await invoke("GET", "/api/connectors/:id/readme", { params: { id: "missing" } });
  assert.equal(result.status, 404);
  assert.equal(result.body.detail, "unknown-connector-type");
});

test("connector catalog is served through the authenticated connector surface", async () => {
  const catalog = [{ id: "example", displayName: "Example", config: { fields: [] } }];
  const { invoke } = setup({ catalog });
  const result = await invoke("GET", "/api/connectors/catalog");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, catalog);
});

const REPOS_MODULE_MANIFEST = {
  modules: [{ id: "repositories", label: "Repos {connectorName}", icon: "repos", component: "ReposView", navOrder: 90 }],
};
const PORTAINER_MODULE_MANIFEST = require("../connectors/community/portainer/manifest.json");

test("connector modules carry safe navigation metadata and never leak stored config", async () => {
  const { invoke } = setup({
    rows: [{ id: "gitlab2", name: "GitLab CI", endpoint: "", config: null }],
    manifest: REPOS_MODULE_MANIFEST,
    configs: {
      "connector-config-gitlab2": { token: "never-returned" },
      "connector-status-gitlab2": { status: "ok" },
    },
  });
  const result = await invoke("GET", "/api/connectors/modules");
  assert.deepEqual(result.body, [{
    route: "module:gitlab2:repositories",
    connectorId: "gitlab2",
    connectorType: "gitlab2",
    connectorName: "GitLab CI",
    moduleId: "repositories",
    label: "Repos GitLab CI",
    icon: "repos",
    component: "ReposView",
    navOrder: 90,
    coreRoute: "repos-gitlab2",
    configured: true,
    status: "ok",
    available: true,
  }]);
  assert.equal(JSON.stringify(result.body).includes("never-returned"), false);
});

test("a Disconnected connector's module is listed as unavailable so the shell drops it from the menu", async () => {
  const { invoke } = setup({
    rows: [{ id: "gitlab2", name: "GitLab CI", endpoint: "", config: null }],
    manifest: REPOS_MODULE_MANIFEST,
    // Configurado pero sin registro de estado vivo — la card lo pinta como
    // Disconnected, asi que su modulo no puede servir nada.
    configs: { "connector-config-gitlab2": { token: "t" } },
  });
  const result = await invoke("GET", "/api/connectors/modules");
  assert.equal(result.body.length, 1);
  assert.equal(result.body[0].status, "offline");
  assert.equal(result.body[0].available, false);
  assert.equal(result.body[0].coreRoute, "repos-gitlab2");
});

test("an unconfigured connector's module is unavailable even though the manifest declares it", async () => {
  const { invoke } = setup({
    rows: [{ id: "gitlab2", name: "GitLab CI", endpoint: "", config: null }],
    manifest: REPOS_MODULE_MANIFEST,
  });
  const result = await invoke("GET", "/api/connectors/modules");
  assert.equal(result.body[0].configured, false);
  assert.equal(result.body[0].available, false);
});

test("a disabled connector's module is unavailable even though it's configured and connected — e.g. Llamadas when Outlook is Inactivo", async () => {
  const { invoke } = setup({
    rows: [{ id: "gitlab2", name: "GitLab CI", endpoint: "", config: null }],
    manifest: REPOS_MODULE_MANIFEST,
    configs: {
      "connector-config-gitlab2": { token: "t" },
      "connector-status-gitlab2": { status: "ok" },
      "connector-enabled": { gitlab2: false },
    },
  });
  const result = await invoke("GET", "/api/connectors/modules");
  assert.equal(result.body[0].status, "ok");
  assert.equal(result.body[0].available, false, "disabled must hide the module even though it's connected");
  assert.equal(result.body[0].coreRoute, "repos-gitlab2", "the shell hides this core route when available is false");
});

test("disabling Portainer marks the core Containers route unavailable", async () => {
  const { invoke } = setup({
    rows: [{ id: "portainer", name: "Portainer", endpoint: "", config: null }],
    manifest: PORTAINER_MODULE_MANIFEST,
    configs: {
      "connector-config-portainer": { baseUrl: "https://portainer.test", apiKey: "secret" },
      "connector-status-portainer": { status: "ok" },
      "connector-enabled": { portainer: false },
    },
  });
  const result = await invoke("GET", "/api/connectors/modules");
  assert.deepEqual(result.body.map(module => ({
    moduleId: module.moduleId,
    coreRoute: module.coreRoute,
    available: module.available,
  })), [{ moduleId: "containers", coreRoute: "containers", available: false }]);
});

test("warn and error still count as connected — only offline hides the module", async () => {
  for (const status of ["warn", "error"]) {
    const { invoke } = setup({
      rows: [{ id: "gitlab2", name: "GitLab CI", endpoint: "", config: null }],
      manifest: REPOS_MODULE_MANIFEST,
      configs: {
        "connector-config-gitlab2": { token: "t" },
        "connector-status-gitlab2": { status },
      },
    });
    const result = await invoke("GET", "/api/connectors/modules");
    assert.equal(result.body[0].available, true, `${status} should stay navigable`);
  }
});

test("outlook-local reports configured with no stored config — it has no credentials to save", async () => {
  const catalog = [{ id: "outlook-local", displayName: "Outlook Local (COM)", capabilities: ["mail.read"], config: { fields: [] } }];
  const { invoke } = setup({ catalog }); // no configs entry for connector-config-outlook-local
  const result = await invoke("GET", "/api/connectors");
  assert.equal(result.body[0].configured, true);
});

test("registered manifests appear as non-persisted cards when an older database has no seed row", async () => {
  const catalog = [{ id: "example", displayName: "Example", capabilities: ["items.read"], config: { fields: [] } }];
  const { invoke } = setup({ catalog });
  const result = await invoke("GET", "/api/connectors");
  assert.deepEqual(result.body, [{
    id: "example",
    name: "Example",
    kind: "Example",
    icon: "EX",
    color: "#2563eb",
    endpoint: "",
    auth: "",
    interval: "manual / on-demand",
    feeds: ["items.read"],
    docs: "",
    sampleEndpoints: [],
    connectorTypeId: "example",
    manifestManaged: true,
    displayName: "Example",
    capabilities: ["items.read"],
    config: { fields: [] },
    type: "example",
    transport: "http",
    os: null,
    requires: null,
    supportedHere: true,
    configurable: true,
    configured: false,
    liveStatus: null,
    modules: [],
    enabled: true,
  }]);
});

test("connector creation validates required fields with RFC 9457 details", async () => {
  const { invoke } = setup();
  const result = await invoke("POST", "/api/connectors", { body: { name: "GitLab" } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "BAD_REQUEST");
  assert.equal(result.body.detail, "name and kind are required");
});

test("a connector with no connector-enabled entry defaults to enabled", async () => {
  const { invoke } = setup({ rows: [{ id: "gitlab", name: "GitLab", config: null }] });
  const result = await invoke("GET", "/api/connectors");
  assert.equal(result.body.find(c => c.id === "gitlab").enabled, true);
});

test("an extra instance of an instantiable type is configurable even though the connectors table has no config column", async () => {
  // Real DB rows never carry a `config` field (the `connectors` table has no
  // such column — see core/database.js). Only the synthetic base card
  // (manifestCards, spread in from listConnectorCatalog()) used to get
  // `configurable: true`; a second instance like this fell back to false and
  // silently lost its "Configure" button.
  const { invoke } = setup({
    rows: [{ id: "outlook-local2", name: "Correo 2" }],
    schema: { title: "Outlook Local", properties: {} },
    manifest: { id: "outlook-local", displayName: "Correo", modules: [] },
  });
  const result = await invoke("GET", "/api/connectors");
  assert.equal(result.body.find(c => c.id === "outlook-local2").configurable, true);
});

test("POST /api/connectors/:id/enabled disables a single connection without touching others", async () => {
  const configs = {};
  const { invoke } = setup({ rows: [{ id: "gitlab", name: "GitLab", config: null }, { id: "gitlab2", name: "GitLab 2", config: null }], configs });
  const result = await invoke("POST", "/api/connectors/:id/enabled", { params: { id: "gitlab2" }, body: { enabled: false } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, enabled: false });
  assert.deepEqual(configs["connector-enabled"], { gitlab2: false });

  const list = await invoke("GET", "/api/connectors");
  assert.equal(list.body.find(c => c.id === "gitlab").enabled, true);
  assert.equal(list.body.find(c => c.id === "gitlab2").enabled, false);
});

test("POST /api/connectors/:id/name labels a connection and the listing uses it", async () => {
  const configs = {};
  const { invoke } = setup({ rows: [{ id: "github", name: "GitHub", config: null }], configs });
  const result = await invoke("POST", "/api/connectors/:id/name", { params: { id: "github" }, body: { name: "GitHub Lintaya" } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, name: "GitHub Lintaya" });
  assert.deepEqual(configs["connector-names"], { github: "GitHub Lintaya" });

  const list = await invoke("GET", "/api/connectors");
  assert.equal(list.body.find(c => c.id === "github").name, "GitHub Lintaya");
});

test("clearing the name drops the override instead of storing an empty one", async () => {
  // Otherwise the connector would render with a blank label rather than
  // falling back to the name the manifest gives it.
  const configs = { "connector-names": { github: "GitHub Lintaya" } };
  const { invoke } = setup({ rows: [{ id: "github", name: "GitHub", config: null }], configs });
  const result = await invoke("POST", "/api/connectors/:id/name", { params: { id: "github" }, body: { name: "   " } });
  assert.deepEqual(result.body, { ok: true, name: "" });
  assert.deepEqual(configs["connector-names"], {});

  const list = await invoke("GET", "/api/connectors");
  assert.equal(list.body.find(c => c.id === "github").name, "GitHub");
});

test("a name that is not a string is rejected, and an over-long one is trimmed", async () => {
  const configs = {};
  const { invoke } = setup({ rows: [{ id: "github", name: "GitHub", config: null }], configs });
  const bad = await invoke("POST", "/api/connectors/:id/name", { params: { id: "github" }, body: { name: { evil: true } } });
  assert.equal(bad.status, 400);
  assert.equal(configs["connector-names"], undefined);

  await invoke("POST", "/api/connectors/:id/name", { params: { id: "github" }, body: { name: "x".repeat(200) } });
  assert.equal(configs["connector-names"].github.length, 60);
});

test("re-enabling a connection removes its entry instead of storing enabled: true", async () => {
  const configs = { "connector-enabled": { gitlab2: false } };
  const { invoke } = setup({ configs });
  const result = await invoke("POST", "/api/connectors/:id/enabled", { params: { id: "gitlab2" }, body: { enabled: true } });
  assert.equal(result.status, 200);
  assert.deepEqual(configs["connector-enabled"], {});
});

test("simple connectors expose status and persistent logs through the status endpoint", async () => {
  const { invoke } = setup({
    simpleConnectorShape: {
      "lintaya-remote": {
        configFields: cfg => ({ baseUrl: cfg?.baseUrl || null }),
        dataFields: data => ({
          connectors: data?.connectors || [],
          blocks: data?.blocks || [],
          boards: data?.boards || [],
          syncedAt: data?.syncedAt || null,
        }),
      },
    },
    kvData: {
      "connector-config-lintaya-remote": { baseUrl: "http://10.0.0.1:3000", token: "secret" },
      "connector-status-lintaya-remote": { status: "ok", remoteVersion: "0.1.0-beta.1" },
      "connector-log-lintaya-remote": [{ level: "ok", msg: "Test OK" }],
    },
  });
  const result = await invoke("GET", "/api/connectors/status");
  assert.deepEqual(result.body["lintaya-remote"], {
    configured: true,
    baseUrl: "http://10.0.0.1:3000",
    status: "ok",
    remoteVersion: "0.1.0-beta.1",
    connectors: [],
    blocks: [],
    boards: [],
    syncedAt: null,
    log: [{ level: "ok", msg: "Test OK" }],
  });
  assert.equal(JSON.stringify(result.body).includes("secret"), false);
});

test("POST /api/connectors/:id/enabled rejects a non-boolean body", async () => {
  const { invoke } = setup();
  const result = await invoke("POST", "/api/connectors/:id/enabled", { params: { id: "gitlab" }, body: { enabled: "yes" } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "BAD_REQUEST");
});

test("removing a connector instance clears all connection-scoped state", async () => {
  const configs = {
    "connector-config-gitlab2": { token: "secret" },
    "connector-data-gitlab2": { projects: [{ id: "p1" }] },
    "connector-status-gitlab2": { status: "ok" },
    "connector-log-gitlab2": [{ action: "sync" }],
  };
  const { invoke } = setup({ configs });
  const result = await invoke("DELETE", "/api/connectors/:typeId/instances/:instanceId", {
    params: { typeId: "gitlab", instanceId: "gitlab2" },
  });
  assert.equal(result.status, 200);
  for (const prefix of ["connector-config-", "connector-data-", "connector-status-", "connector-log-"]) {
    assert.equal(configs[`${prefix}gitlab2`], null);
  }
});

test("removing a connector instance also clears its secret-store entry", async () => {
  const configs = {
    "connector-config-gitlab2": { baseUrl: "https://gitlab.example" },
    "connector-data-gitlab2": { projects: [{ id: "p1" }] },
    "connector-status-gitlab2": { status: "ok" },
    "connector-log-gitlab2": [{ action: "sync" }],
  };
  const cleared = [];
  await withSecretStore(
    { mode: "local", get: () => ({}), set() {}, clear: (id) => cleared.push(id), getSecretFields: () => ["token"] },
    async () => {
      const { invoke } = setup({ configs });
      const result = await invoke("DELETE", "/api/connectors/:typeId/instances/:instanceId", {
        params: { typeId: "gitlab", instanceId: "gitlab2" },
      });
      assert.equal(result.status, 200);
      for (const prefix of ["connector-config-", "connector-data-", "connector-status-", "connector-log-"]) {
        assert.equal(configs[`${prefix}gitlab2`], null);
      }
      assert.deepEqual(cleared, ["gitlab2"]);
    },
  );
});

test("deleting a connector also clears its secret-store entry", async () => {
  const configs = { "connector-config-gitlab": { baseUrl: "https://gitlab.example" } };
  const cleared = [];
  await withSecretStore(
    { mode: "local", get: () => ({}), set() {}, clear: (id) => cleared.push(id), getSecretFields: () => ["token"] },
    async () => {
      const { invoke } = setup({ configs, rows: [{ id: "gitlab", name: "GitLab" }] });
      const result = await invoke("DELETE", "/api/connectors/:id", { params: { id: "gitlab" } });
      assert.equal(result.status, 200);
      assert.equal(configs["connector-config-gitlab"], null);
      assert.deepEqual(cleared, ["gitlab"]);
    },
  );
});

// Shared fixture for the impact/cascade tests below: three Boards, one
// Dashboard fully dependent on a Board that will be deleted, one partially
// dependent, one untouched, plus a mix of fixed (manifest) and custom
// connector blocks alongside genuinely unrelated content blocks, so the
// cascade's "which ids belong to this connector" matching gets exercised
// for both shapes at once, not just the trivial single-block case.
function cascadeFixtureConfigs() {
  return {
    "custom-blocks": [
      { id: "custom-1", kind: "content", title: "Notes" },
      { id: "custom-2", kind: "content", title: "Other notes" },
      { id: "custom-3", kind: "connector", connectorId: "github", blockId: "repos-overview", title: "My GH block" },
    ],
    "module-pages": [
      { id: "board-a", title: "Mixed Board", tree: { t: "z", k: "z1", blocks: ["github.repos-overview", "custom-1", "custom-3"] } },
      { id: "board-b", title: "GitHub Only Board", tree: { t: "z", k: "z2", blocks: ["github.recent-commits"] } },
      { id: "board-c", title: "Unrelated Board", tree: { t: "z", k: "z3", blocks: ["custom-2"] } },
    ],
    "dashboards": [
      { id: "dash-partial", title: "Ops", boardIds: ["board-b", "board-c"], selectedBoardId: "board-b" },
      { id: "dash-emptied", title: "GitHub Only", boardIds: ["board-b"], selectedBoardId: "board-b" },
      { id: "dash-untouched", title: "Notes", boardIds: ["board-a", "board-c"], selectedBoardId: "board-a" },
    ],
    "home-layout": { left: ["github.recent-commits", "custom-1"], right: ["custom-3"] },
  };
}

test("GET /api/connectors/:id/impact reports affected Boards/Dashboards without changing anything", async () => {
  const configs = cascadeFixtureConfigs();
  const before = JSON.parse(JSON.stringify(configs));
  const { invoke } = setup({ configs });
  const result = await invoke("GET", "/api/connectors/:id/impact", { params: { id: "github" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.blockRecordsToDelete, 1);
  assert.deepEqual(
    result.body.boards.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "board-a", title: "Mixed Board", blocksRemoved: 2, totalBlocks: 3, willBeDeleted: false },
      { id: "board-b", title: "GitHub Only Board", blocksRemoved: 1, totalBlocks: 1, willBeDeleted: true },
    ],
  );
  assert.deepEqual(
    result.body.dashboards.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "dash-emptied", title: "GitHub Only", boardsRemoved: 1, totalBoards: 1, willBeDeleted: true },
      { id: "dash-partial", title: "Ops", boardsRemoved: 1, totalBoards: 2, willBeDeleted: false },
    ],
  );
  // dash-untouched never appears — board-a survives (only loses blocks, isn't deleted).
  assert.ok(!result.body.dashboards.some(d => d.id === "dash-untouched"));
  assert.deepEqual(configs, before);
});

test("DELETE /api/connectors/:id cascades to Blocks/Boards/Dashboards exactly as the impact preview described", async () => {
  const configs = cascadeFixtureConfigs();
  const { invoke } = setup({ configs, rows: [{ id: "github", name: "GitHub" }] });
  const result = await invoke("DELETE", "/api/connectors/:id", { params: { id: "github" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.removed.blockRecordsToDelete, 1);

  // custom-3 (github-owned) gone; unrelated content blocks untouched.
  assert.deepEqual(configs["custom-blocks"].map(b => b.id).sort(), ["custom-1", "custom-2"]);

  const boards = configs["module-pages"];
  assert.equal(boards.length, 2, "board-b (fully github) should be deleted");
  const boardA = boards.find(b => b.id === "board-a");
  assert.deepEqual(boardA.tree.blocks, ["custom-1"], "board-a keeps its unrelated content block, loses the two github ones");
  assert.ok(boards.some(b => b.id === "board-c"), "board-c (unrelated) survives untouched");
  const boardC = boards.find(b => b.id === "board-c");
  assert.deepEqual(boardC.tree.blocks, ["custom-2"]);

  const dashboards = configs["dashboards"];
  assert.equal(dashboards.length, 2, "dash-emptied (only had board-b) should be deleted");
  assert.ok(!dashboards.some(d => d.id === "dash-emptied"));
  const partial = dashboards.find(d => d.id === "dash-partial");
  assert.deepEqual(partial.boardIds, ["board-c"]);
  assert.equal(partial.selectedBoardId, "board-c", "selection resets off the deleted board");
  const untouched = dashboards.find(d => d.id === "dash-untouched");
  assert.deepEqual(untouched.boardIds, ["board-a", "board-c"], "board-a survived, so this dashboard is unchanged");

  assert.deepEqual(configs["home-layout"], { left: ["custom-1"], right: [] });

  // Existing connector-level cleanup still happens alongside the cascade.
  assert.equal(configs["connector-data-github"], null);
});

test("DELETE /api/connectors/:id is a no-op on Blocks/Boards/Dashboards when nothing references that connector", async () => {
  const configs = {
    "custom-blocks": [{ id: "custom-1", kind: "content", title: "Notes" }],
    "module-pages": [{ id: "board-c", title: "Unrelated Board", tree: { t: "z", k: "z3", blocks: ["custom-2"] } }],
    "dashboards": [{ id: "dash-untouched", title: "Notes", boardIds: ["board-c"], selectedBoardId: "board-c" }],
  };
  const before = JSON.parse(JSON.stringify(configs));
  const { invoke } = setup({ configs, rows: [{ id: "gitlab", name: "GitLab" }] });
  const result = await invoke("DELETE", "/api/connectors/:id", { params: { id: "gitlab" } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.removed, { blockRecordsToDelete: 0, boards: [], dashboards: [] });
  for (const key of ["custom-blocks", "module-pages", "dashboards"]) {
    assert.deepEqual(configs[key], before[key]);
  }
});

test("connector instance mounting hides internal registration failures", async () => {
  const { invoke } = setup({
    manifest: { instantiable: true, displayName: "GitLab" },
    registerConnectorInstance() { throw new Error("token=should-not-leak"); },
  });
  const result = await invoke("POST", "/api/connectors/:typeId/instances", { params: { typeId: "gitlab" } });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    type: "urn:lintaya:problem:internal-error",
    title: "Internal Server Error",
    status: 500,
    detail: "Internal server error",
    instance: "urn:lintaya:request:request-1",
    code: "INTERNAL_ERROR",
    details: null,
    requestId: "request-1",
  });
});

// ── GET /api/connectors/export, POST /api/connectors/import ────────────────
const VCENTER_SCHEMA = {
  type: "object",
  properties: {
    host: { type: "string" },
    username: { type: "string" },
    password: { type: "string", "x-lintaya-secret": true },
  },
};
const UCSM_SCHEMA = {
  type: "object",
  properties: {
    username: { type: "string" },
    password: { type: "string", writeOnly: true },
  },
};
const TIER_MANIFESTS = {
  vcenter: { id: "vcenter", displayName: "VMware vCenter" },
  ucsm: { id: "ucsm", displayName: "UCS Manager" },
};
const TIER_SCHEMAS = { vcenter: VCENTER_SCHEMA, ucsm: UCSM_SCHEMA };

test("GET /api/connectors/export requires ids", async () => {
  const { invoke } = setup({});
  const result = await invoke("GET", "/api/connectors/export", { query: {} });
  assert.equal(result.status, 400);
  assert.equal(result.body.detail, "ids-required");
});

test("GET /api/connectors/export strips secret fields (x-lintaya-secret and writeOnly) but keeps public ones", async () => {
  const { invoke } = setup({
    manifests: TIER_MANIFESTS,
    schemas: TIER_SCHEMAS,
    configs: {
      "connector-config-vcenter": { host: "https://vcenter.example.com", username: "svc", password: "super-secret" },
    },
  });
  const result = await invoke("GET", "/api/connectors/export", { query: { ids: "vcenter" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.format, "lintaya-connections-export");
  assert.deepEqual(result.body.connections, [{
    connectorTypeId: "vcenter",
    connectionId: "vcenter",
    displayName: "VMware vCenter",
    config: { host: "https://vcenter.example.com", username: "svc" },
  }]);
  assert.ok(!("password" in result.body.connections[0].config), "the secret field never leaves the server");
});

test("GET /api/connectors/export skips an id with no registered manifest, and 400s if none resolve", async () => {
  const { invoke } = setup({ manifests: TIER_MANIFESTS, schemas: TIER_SCHEMAS, configs: {} });
  const result = await invoke("GET", "/api/connectors/export", { query: { ids: "not-a-real-type" } });
  assert.equal(result.status, 400);
  assert.equal(result.body.detail, "no-valid-connections");
});

test("POST /api/connectors/import merges public fields onto the existing config without touching secrets", async () => {
  const { invoke } = setup({
    manifests: TIER_MANIFESTS,
    schemas: TIER_SCHEMAS,
    configs: {
      "connector-config-vcenter": { host: "https://old.example.com", username: "svc", password: "still-here" },
    },
  });
  const result = await invoke("POST", "/api/connectors/import", {
    body: { connections: [{ connectorTypeId: "vcenter", connectionId: "vcenter", config: { host: "https://new.example.com", username: "svc2" } }] },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.results, [{ connectionId: "vcenter", ok: true }]);
});

test("POST /api/connectors/import never lets an imported value overwrite a secret field, even if the file hand-includes one", async () => {
  const { invoke } = setup({
    manifests: TIER_MANIFESTS,
    schemas: TIER_SCHEMAS,
    configs: { "connector-config-vcenter": { host: "https://old.example.com", password: "real-secret" } },
  });
  await invoke("POST", "/api/connectors/import", {
    body: { connections: [{ connectorTypeId: "vcenter", connectionId: "vcenter", config: { host: "https://new.example.com", password: "attacker-supplied" } }] },
  });
  // Re-export to prove the secret field wasn't touched (not merely absent from the response).
  const after = await invoke("GET", "/api/connectors/export", { query: { ids: "vcenter" } });
  assert.equal(after.body.connections[0].config.host, "https://new.example.com");
  assert.ok(!("password" in after.body.connections[0].config));
});

test("POST /api/connectors/import rejects an unknown connector type", async () => {
  const { invoke } = setup({ manifests: TIER_MANIFESTS, schemas: TIER_SCHEMAS });
  const result = await invoke("POST", "/api/connectors/import", {
    body: { connections: [{ connectorTypeId: "not-real", connectionId: "not-real", config: {} }] },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.results, [{ connectionId: "not-real", ok: false, error: "unknown-connector-type" }]);
});

test("POST /api/connectors/import rejects a connection that doesn't exist yet, with a message pointing at how to create it", async () => {
  // connectorTypeId "vcenter" is a real, registered type — so this reaches
  // the connectionExists() check rather than failing earlier on
  // unknown-connector-type. "vcenter2" is neither a manifest's own id nor a
  // registered extra instance, so it doesn't exist as a connection yet.
  const { invoke } = setup({ manifests: TIER_MANIFESTS, schemas: TIER_SCHEMAS });
  const result = await invoke("POST", "/api/connectors/import", {
    body: { connections: [{ connectorTypeId: "vcenter", connectionId: "vcenter2", config: {} }] },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].ok, false);
  assert.match(result.body.results[0].error, /connection-not-found/);
});

test("POST /api/connectors/import rejects a connectorTypeId that doesn't match what the connectionId actually resolves to", async () => {
  const { invoke } = setup({
    manifests: TIER_MANIFESTS,
    schemas: TIER_SCHEMAS,
    resolveConnectorType: () => "vcenter", // every id resolves to vcenter, regardless of what's asked
    configs: { "connector-config-vcenter": {} },
  });
  const result = await invoke("POST", "/api/connectors/import", {
    body: { connections: [{ connectorTypeId: "ucsm", connectionId: "vcenter", config: {} }] },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.results, [{ connectionId: "vcenter", ok: false, error: "connector-type-mismatch" }]);
});

test("POST /api/connectors/import rejects malformed entries without crashing the rest of the batch", async () => {
  const { invoke } = setup({
    manifests: TIER_MANIFESTS,
    schemas: TIER_SCHEMAS,
    configs: { "connector-config-vcenter": { host: "https://old.example.com" } },
  });
  const result = await invoke("POST", "/api/connectors/import", {
    body: { connections: [
      { connectorTypeId: "vcenter" }, // missing connectionId/config
      { connectorTypeId: "vcenter", connectionId: "vcenter", config: { host: "https://new.example.com" } },
    ] },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.results, [
    { connectionId: null, ok: false, error: "invalid-entry" },
    { connectionId: "vcenter", ok: true },
  ]);
});

test("GET /api/connectors/:id/commit-identity returns null when none is stored", async () => {
  const { invoke } = setup();

  const res = await invoke("GET", "/api/connectors/:id/commit-identity", { params: { id: "gitlab" } });

  assert.equal(res.status, 200);
  assert.equal(res.body.identity, null);
});

test("POST /api/connectors/:id/commit-identity stores a trimmed name and email per connection", async () => {
  const configs = {};
  const { invoke } = setup({ configs });

  const res = await invoke("POST", "/api/connectors/:id/commit-identity", {
    params: { id: "gitlab3" },
    body: { name: "  Ada Lovelace  ", email: " ada@example.com " },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.identity, { name: "Ada Lovelace", email: "ada@example.com" });
  assert.deepEqual(configs["connector-commit-identity"], {
    gitlab3: { name: "Ada Lovelace", email: "ada@example.com" },
  });
});

test("clearing both fields removes the entry so git resolves the identity again", async () => {
  const configs = { "connector-commit-identity": { gitlab: { name: "Ada", email: "ada@example.com" } } };
  const { invoke } = setup({ configs });

  const res = await invoke("POST", "/api/connectors/:id/commit-identity", {
    params: { id: "gitlab" },
    body: { name: "  ", email: "" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.identity, null);
  assert.deepEqual(configs["connector-commit-identity"], {});
});

test("a commit identity with only one of the two fields is rejected", async () => {
  const configs = {};
  const { invoke } = setup({ configs });

  const res = await invoke("POST", "/api/connectors/:id/commit-identity", {
    params: { id: "gitlab" },
    body: { name: "Ada Lovelace" },
  });

  assert.equal(res.status, 400);
  assert.equal(configs["connector-commit-identity"], undefined);
});

test("control characters never reach a git -c override", async () => {
  const configs = {};
  const { invoke } = setup({ configs });

  const res = await invoke("POST", "/api/connectors/:id/commit-identity", {
    params: { id: "gitlab" },
    body: { name: "Ada\nLovelace", email: "ada@example.com" },
  });

  assert.equal(res.status, 400);
  assert.equal(configs["connector-commit-identity"], undefined);
});
