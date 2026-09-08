const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { request } = require("./test-http-harness");
const { registerWorkspacePackageRoutes } = require("./workspace-packages");

function setup() {
  const store = new Map();
  const kvGet = key => store.has(key) ? { value: store.get(key) } : null;
  const app = createApp({ token: "test-token" });
  const auditLog = [];
  const auditActivity = options => (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = body => { auditLog.push({ ...options, message: res.locals.auditMessage, meta: res.locals.auditMeta }); return originalJson(body); };
    next();
  };
  registerWorkspacePackageRoutes({
    app, requireAuth, kvGet, kvSet: (key, value) => store.set(key, value), auditActivity, AppError, sendAppError,
    resolveConnectorType: id => id === "gitlab2" ? "gitlab" : id,
    connectionAlias: id => id === "gitlab2" ? "Production" : id,
    connectionCandidates: type => type === "gitlab" ? [{ id: "gitlab2", name: "Production" }] : [],
  });
  return { app, store, auditLog, headers: { authorization: "Bearer test-token" } };
}

test("exports a Dashboard, its Boards, authored Blocks, and connector requirements", async () => {
  const { app, store, headers } = setup();
  store.set("custom-blocks", [{ id: "custom-a", kind: "content", title: "Runbook", format: "md", content: "Private operational notes" }]);
  store.set("module-pages", [{ id: "page-a", title: "Ops", icon: "grid", tree: { t: "z", k: "z1", blocks: ["custom-a", "gitlab2.recent-commits"] } }]);
  store.set("dashboards", [{ id: "dashboard-a", title: "Daily", boardIds: ["page-a"], selectedBoardId: "page-a" }]);
  const response = await request(app, "POST", "/api/workspace-packages/export", { headers, body: { dashboardIds: ["dashboard-a"] } });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.deepEqual(body.summary, {
    dashboards: 1, boards: 1, customBlocks: 1, connectorRequirements: 1,
    containsAuthoredContent: true, authoredBlockTitles: ["Runbook"],
    excluded: ["secrets", "provider caches", "synced records", "local ids"],
  });
  assert.equal(body.package.format, "lintaya-workspace-package");
  assert.equal(body.package.resources.requirements[0].connectionAlias, "Production");
  assert.equal(JSON.stringify(body.package).includes("dashboard-a"), false);
});

test("previews an import without changing any stored resource", async () => {
  const { app, store, headers } = setup();
  const packageValue = {
    format: "lintaya-workspace-package", version: 1, exportedAt: "2026-08-27T12:00:00.000Z",
    resources: {
      blocks: [{ key: "block:notes", kind: "content", title: "Notes", format: "md", content: "hello" }],
      requirements: [{ key: "requirement:commits", connectorTypeId: "gitlab", blockId: "recent-commits", connectionAlias: "Production" }],
      boards: [{ key: "board:ops", title: "Ops", icon: "grid", tree: { t: "z", key: "zone:1", blocks: ["block:notes", "requirement:commits"] } }],
      dashboards: [{ key: "dashboard:daily", title: "Daily", icon: "grid", boards: ["board:ops"], selectedBoard: "board:ops" }],
    },
  };
  store.set("module-pages", [{ id: "page-existing", title: "Ops" }]);
  const before = JSON.stringify([...store.entries()]);
  const response = await request(app, "POST", "/api/workspace-packages/import/preview", { headers, body: { package: packageValue } });
  assert.equal(response.status, 200);
  assert.equal(response.json().writesPerformed, false);
  assert.equal(response.json().requirements[0].connectionId, "gitlab2");
  assert.equal(response.json().conflicts[0].resourceType, "board");
  assert.equal(response.json().resources.find(item => item.key === "board:ops").suggestedTitle, "Ops (importado)");
  assert.equal(JSON.stringify([...store.entries()]), before);
});

test("preview rejects malformed, unsafe, and unsupported packages", async () => {
  const { app, headers } = setup();
  const missing = await request(app, "POST", "/api/workspace-packages/import/preview", { headers, body: {} });
  assert.equal(missing.status, 400);
  const unsafe = await request(app, "POST", "/api/workspace-packages/import/preview", {
    headers, body: { package: { format: "foreign", version: 99, apiToken: "secret", resources: {} } },
  });
  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.json().detail, "invalid-workspace-package");
});

test("imports with new local ids, preserves existing resources, and audits the write", async () => {
  const { app, store, auditLog, headers } = setup();
  const packageValue = {
    format: "lintaya-workspace-package", version: 1, exportedAt: "2026-08-27T12:00:00.000Z",
    resources: {
      blocks: [{ key: "block:notes", kind: "content", title: "Notes", format: "md", content: "hello" }],
      requirements: [{ key: "requirement:commits", connectorTypeId: "gitlab", blockId: "recent-commits", connectionAlias: "Production" }],
      boards: [{ key: "board:ops", title: "Ops", icon: "grid", tree: { t: "z", key: "zone:1", blocks: ["block:notes", "requirement:commits"] } }],
      dashboards: [{ key: "dashboard:daily", title: "Daily", icon: "grid", boards: ["board:ops"], selectedBoard: "board:ops" }],
    },
  };
  store.set("custom-blocks", [{ id: "custom-existing", title: "Existing" }]);
  const response = await request(app, "POST", "/api/workspace-packages/import", {
    headers, body: { package: packageValue, names: { "block:notes": "Notes copy", "board:ops": "Ops copy", "dashboard:daily": "Daily copy" }, connectionMappings: { "requirement:commits": "gitlab2" }, sourceFile: "daily-export.json" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().ok, true);
  assert.equal(store.get("custom-blocks")[0].id, "custom-existing");
  assert.equal(store.get("custom-blocks").length, 3);
  assert.equal(store.get("module-pages")[0].title, "Ops copy");
  assert.equal(store.get("dashboards")[0].title, "Daily copy");
  assert.equal(auditLog.at(-1).message, "Importar workspace: Daily copy (4 recursos)");
  assert.equal(auditLog.at(-1).meta.sourceFile, "daily-export.json");
  assert.deepEqual(auditLog.at(-1).meta.counts, { blocks: 2, boards: 1, dashboards: 1 });
  assert.equal(auditLog.at(-1).meta.imported.boards[0].title, "Ops copy");
  assert.equal(Object.hasOwn(auditLog.at(-1).meta.imported.blocks[0], "content"), false);
});

test("requires a selection and fails closed for missing or unresolved resources", async () => {
  const { app, store, headers } = setup();
  assert.equal((await request(app, "POST", "/api/workspace-packages/export", { headers, body: {} })).status, 400);
  assert.equal((await request(app, "POST", "/api/workspace-packages/export", { headers, body: { boardIds: ["missing"] } })).status, 404);
  store.set("module-pages", [{ id: "page-a", title: "Broken", tree: { t: "z", blocks: ["unknown"] } }]);
  assert.equal((await request(app, "POST", "/api/workspace-packages/export", { headers, body: { boardIds: ["page-a"] } })).status, 400);
});
