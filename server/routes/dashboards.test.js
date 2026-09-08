const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerDashboardsRoutes } = require("./dashboards");
const { request } = require("./test-http-harness");

function setup() {
  const store = new Map();
  const kvGet = key => store.has(key) ? { value: store.get(key) } : null;
  const kvSet = (key, value) => store.set(key, value);
  const auditLog = [];
  const auditActivity = options => (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = body => {
      auditLog.push({ ...options, message: res.locals.auditMessage });
      return originalJson(body);
    };
    next();
  };
  const app = createApp({ token: "test-token" });
  registerDashboardsRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError });
  return { app, store, auditLog, headers: { authorization: "Bearer test-token" } };
}

test("GET /api/dashboards starts empty", async () => {
  const { app, headers } = setup();
  const response = await request(app, "GET", "/api/dashboards", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), []);
});

test("POST creates a versioned Dashboard with ordered Board references", async () => {
  const { app, headers, auditLog } = setup();
  const response = await request(app, "POST", "/api/dashboards", {
    headers,
    body: { title: "Operación", boardIds: ["page-b", "page-a"] },
  });
  assert.equal(response.status, 200);
  const dashboard = response.json();
  assert.equal(dashboard.schemaVersion, 1);
  assert.ok(dashboard.id.startsWith("dashboard-"));
  assert.deepEqual(dashboard.boardIds, ["page-b", "page-a"]);
  assert.equal(dashboard.selectedBoardId, "page-b");
  assert.equal(dashboard.active, true);
  assert.equal(dashboard.showInSidebar, true);
  assert.equal(auditLog[0].message, 'Crear Dashboard "Operación"');
});

test("Dashboard may be empty and keeps unresolved Board references", async () => {
  const { app, headers, store } = setup();
  store.set("module-pages", [{ id: "page-existing", tree: { t: "z", blocks: [] } }]);
  const empty = await request(app, "POST", "/api/dashboards", {
    headers, body: { title: "Vacío", boardIds: [] },
  });
  assert.equal(empty.json().selectedBoardId, null);

  const unresolved = await request(app, "POST", "/api/dashboards", {
    headers,
    body: { title: "Importable", boardIds: ["page-missing"], selectedBoardId: "page-missing" },
  });
  assert.deepEqual(unresolved.json().boardIds, ["page-missing"]);
  assert.deepEqual(store.get("module-pages"), [{ id: "page-existing", tree: { t: "z", blocks: [] } }]);
});

test("POST rejects duplicate/invalid references and a selection outside the Dashboard", async () => {
  const { app, headers } = setup();
  const duplicate = await request(app, "POST", "/api/dashboards", {
    headers, body: { title: "Duplicado", boardIds: ["page-a", "page-a"] },
  });
  assert.equal(duplicate.status, 400);
  const invalidSelection = await request(app, "POST", "/api/dashboards", {
    headers, body: { title: "Selección", boardIds: ["page-a"], selectedBoardId: "page-b" },
  });
  assert.equal(invalidSelection.status, 400);
});

test("PUT preserves order, updates selection, and falls back when the selected Board is removed", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/dashboards", {
    headers, body: { title: "Ops", boardIds: ["page-a", "page-b"], selectedBoardId: "page-b" },
  });
  const id = created.json().id;
  const reordered = await request(app, "PUT", `/api/dashboards/${id}`, {
    headers, body: { boardIds: ["page-b", "page-a"], selectedBoardId: "page-a" },
  });
  assert.deepEqual(reordered.json().boardIds, ["page-b", "page-a"]);
  assert.equal(reordered.json().selectedBoardId, "page-a");

  const removedSelection = await request(app, "PUT", `/api/dashboards/${id}`, {
    headers, body: { boardIds: ["page-b"] },
  });
  assert.equal(removedSelection.json().selectedBoardId, "page-b");
});

test("DELETE removes only the Dashboard and never its Boards or Blocks", async () => {
  const { app, headers, store } = setup();
  const pages = [{ id: "page-a", tree: { t: "z", blocks: ["custom-a"] } }];
  const blocks = [{ id: "custom-a", title: "Reusable" }];
  store.set("module-pages", pages);
  store.set("custom-blocks", blocks);
  const created = await request(app, "POST", "/api/dashboards", {
    headers, body: { title: "Temporal", boardIds: ["page-a"] },
  });
  const response = await request(app, "DELETE", `/api/dashboards/${created.json().id}`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(store.get("dashboards"), []);
  assert.deepEqual(store.get("module-pages"), pages);
  assert.deepEqual(store.get("custom-blocks"), blocks);
});
