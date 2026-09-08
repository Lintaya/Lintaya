const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerHomeRoutes, HOME_LAYOUT_DEFAULT } = require("./home");
const { request } = require("./test-http-harness");

function setup(overrides = {}) {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditLog = [];
  const auditActivity = (options) => (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => { auditLog.push({ ...options, message: res.locals.auditMessage }); return originalJson(body); };
    next();
  };

  const app = createApp({ token: "test-token" });
  registerHomeRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, ...overrides });
  const headers = { authorization: "Bearer test-token" };
  return { app, store, auditLog, headers };
}

test("GET /api/home/layout falls back to the default layout when nothing is saved", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/home/layout", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), HOME_LAYOUT_DEFAULT);
});

test("POST /api/home/layout rejects a non-array left/right", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/home/layout", { headers, body: { left: "nope", right: [] } });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});

test("POST /api/home/layout saves and GET reflects it back", async () => {
  const { app, headers } = setup();
  const layout = { left: ["a"], right: ["b"] };
  const post = await request(app, "POST", "/api/home/layout", { headers, body: layout });
  assert.equal(post.status, 200);
  const get = await request(app, "GET", "/api/home/layout", { headers });
  assert.deepEqual(get.json(), layout);
});

test("notes: create, edit, delete round-trip and audit each write", async () => {
  const { app, headers, auditLog } = setup();

  const created = await request(app, "POST", "/api/home/notes", { headers, body: { title: "Test", body: "x" } });
  assert.equal(created.status, 200);
  const note = created.json();
  assert.equal(note.title, "Test");

  const edited = await request(app, "PUT", `/api/home/notes/${note.id}`, { headers, body: { title: "Renamed" } });
  assert.equal(edited.json().title, "Renamed");

  const deleted = await request(app, "DELETE", `/api/home/notes/${note.id}`, { headers });
  assert.deepEqual(deleted.json(), { ok: true });

  const list = await request(app, "GET", "/api/home/notes", { headers });
  assert.deepEqual(list.json(), []);

  assert.deepEqual(auditLog.map(e => e.action), ["Crear nota", "Editar nota", "Borrar nota"]);
  assert.equal(auditLog[2].message, 'Borrar nota "Renamed"');
});

test("PUT /api/home/notes/:id 404s for an unknown id", async () => {
  const { app, headers } = setup();
  const res = await request(app, "PUT", "/api/home/notes/nope", { headers, body: { title: "x" } });
  assert.equal(res.status, 404);
  assert.equal(res.json().code, "NOT_FOUND");
});

test("DELETE /api/home/notes/:id also drops the note's id from the layout", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/notes", { headers, body: { title: "x" } });
  const note = created.json();
  await request(app, "POST", "/api/home/layout", { headers, body: { left: [note.id], right: ["plane"] } });

  await request(app, "DELETE", `/api/home/notes/${note.id}`, { headers });

  const layout = await request(app, "GET", "/api/home/layout", { headers });
  assert.deepEqual(layout.json(), { left: [], right: ["plane"] });
});

test("GET /api/home/blocks returns only blocks whose connector has config saved", async () => {
  // No connector configured at all → every declared block's connectorId
  // fails the `kvGet(connector-config-<id>)` check, so none should appear.
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/home/blocks", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), []);
});

test("GET /api/home/blocks excludes a configured connector's blocks once it's disabled", async () => {
  // gitlab declares "recent-commits" in its manifest — configure it (so it
  // would normally appear) and disable it via the same kv "connector-enabled"
  // POST /api/connectors/:id/enabled writes to.
  const { app, store, headers } = setup();
  store.set("connector-config-gitlab", { baseUrl: "https://gitlab.example", token: "t" });
  const before = await request(app, "GET", "/api/home/blocks", { headers });
  assert.ok(before.json().some(b => b.connectorId === "gitlab"), "sanity: configured+enabled shows up");

  store.set("connector-enabled", { gitlab: false });
  const after = await request(app, "GET", "/api/home/blocks", { headers });
  assert.equal(after.json().some(b => b.connectorId === "gitlab"), false);
});

test("GET /api/home/blocks lists a block for every configured instance of an instantiable type, not just the base one", async () => {
  // gitlab declares "recent-commits" — configure the base plus one extra
  // instance ("gitlab2") and confirm both surface as distinct blocks, since
  // each has its own live data at /api/connectors/<instanceId>/blocks/<id>.
  const { app, store, headers } = setup({
    getConnectorInstances: (typeId) => (typeId === "gitlab" ? ["gitlab2"] : []),
    stmtConnGet: { get: (id) => (id === "gitlab2" ? { id, name: "GitLab (work)" } : null) },
  });
  store.set("connector-config-gitlab", { baseUrl: "https://gitlab.example", token: "t" });
  store.set("connector-config-gitlab2", { baseUrl: "https://gitlab2.example", token: "t2" });

  const res = await request(app, "GET", "/api/home/blocks", { headers });
  const gitlabBlocks = res.json().filter(b => b.blockId === "recent-commits");
  assert.equal(gitlabBlocks.length, 2);

  const base = gitlabBlocks.find(b => b.connectorId === "gitlab");
  assert.equal(base.id, "gitlab.recent-commits");
  assert.equal(base.connectorType, "gitlab");
  assert.equal(base.title, "GitLab — últimos commits");

  const extra = gitlabBlocks.find(b => b.connectorId === "gitlab2");
  assert.equal(extra.id, "gitlab2.recent-commits");
  assert.equal(extra.connectorType, "gitlab");
  assert.equal(extra.title, "GitLab — últimos commits · GitLab (work)");
});

test("GET /api/home/blocks omits an extra instance that isn't configured, even if the base is", async () => {
  const { app, store, headers } = setup({
    getConnectorInstances: (typeId) => (typeId === "gitlab" ? ["gitlab2"] : []),
    stmtConnGet: { get: () => null },
  });
  store.set("connector-config-gitlab", { baseUrl: "https://gitlab.example", token: "t" });
  // gitlab2 never configured — no connector-config-gitlab2 entry.

  const res = await request(app, "GET", "/api/home/blocks", { headers });
  const gitlabBlocks = res.json().filter(b => b.blockId === "recent-commits");
  assert.equal(gitlabBlocks.length, 1);
  assert.equal(gitlabBlocks[0].connectorId, "gitlab");
});
