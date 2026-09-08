const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerCustomBlocksRoutes } = require("./custom-blocks");
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
  registerCustomBlocksRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, ...overrides });
  const headers = { authorization: "Bearer test-token" };
  return { app, store, auditLog, headers };
}

test("GET /api/home/custom-blocks is empty when nothing was created", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/home/custom-blocks", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), []);
});

test("POST /api/home/custom-blocks requires connectorId, blockId and title", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { connectorId: "gitlab" } });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});

test("POST creates a custom block, defaults limit to 10, and GET reflects it back", async () => {
  const { app, headers, auditLog } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers,
    body: { connectorId: "gitlab", blockId: "recent-commits", title: "Commits · noc/vm-health-api", scope: "1" },
  });
  assert.equal(created.status, 200);
  const block = created.json();
  assert.equal(block.connectorId, "gitlab");
  assert.equal(block.blockId, "recent-commits");
  assert.equal(block.scope, "1");
  assert.equal(block.limit, 10, "limit defaults to 10 when not given");
  assert.ok(block.id.startsWith("custom-"));

  const list = await request(app, "GET", "/api/home/custom-blocks", { headers });
  assert.deepEqual(list.json(), [block]);
  assert.equal(auditLog[0].message, 'Crear block "Commits · noc/vm-health-api" (gitlab.recent-commits)');
});

test("POST honors an explicit limit", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers,
    body: { connectorId: "plane", blockId: "my-issues", title: "My tasks", limit: 20 },
  });
  assert.equal(created.json().limit, 20);
});

test("POST defaults description/icon to null and active to true when omitted", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers,
    body: { connectorId: "plane", blockId: "my-issues", title: "My tasks" },
  });
  const block = created.json();
  assert.equal(block.description, null);
  assert.equal(block.icon, null);
  assert.equal(block.active, true);
});

test("POST honors an explicit description, icon and active:false", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers,
    body: { connectorId: "gitlab", blockId: "recent-commits", title: "Commits", description: "Últimos commits del repo core", icon: "🔧", active: false },
  });
  const block = created.json();
  assert.equal(block.description, "Últimos commits del repo core");
  assert.equal(block.icon, "🔧");
  assert.equal(block.active, false);
});

test("POST defaults kind to \"connector\" when omitted (backward compat)", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { connectorId: "gitlab", blockId: "recent-commits", title: "Commits" },
  });
  assert.equal(created.json().kind, "connector");
});

test("POST kind:\"content\" requires content instead of connectorId/blockId", async () => {
  const { app, headers } = setup();
  const missing = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Arquitectura" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.json().code, "BAD_REQUEST");

  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Arquitectura", format: "md", content: "# Arquitectura\n\nTodo bien." },
  });
  assert.equal(created.status, 200);
  const block = created.json();
  assert.equal(block.kind, "content");
  assert.equal(block.format, "md");
  assert.equal(block.content, "# Arquitectura\n\nTodo bien.");
  assert.equal(block.connectorId, undefined, "content blocks carry no connectorId");
  assert.equal(block.blockId, undefined, "content blocks carry no blockId");
});

test("POST kind:\"content\" defaults format to \"md\" and rejects blank content", async () => {
  const { app, headers } = setup();
  const blank = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Vacío", content: "   " },
  });
  assert.equal(blank.status, 400);

  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Notas", content: "hola" },
  });
  assert.equal(created.json().format, "md");
});

test("POST kind:\"content\" stores an optional prompt and defaults it to null", async () => {
  const { app, headers } = setup();
  const withPrompt = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Arquitectura", content: "# Arquitectura", prompt: "la arquitectura de los conectores" },
  });
  assert.equal(withPrompt.json().prompt, "la arquitectura de los conectores");

  const withoutPrompt = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Notas", content: "hola" },
  });
  assert.equal(withoutPrompt.json().prompt, null);
});

test("POST kind:\"content\" stores an optional custom rules override and defaults it to null", async () => {
  const { app, headers } = setup();
  const withRules = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Arquitectura", content: "# Arquitectura", rules: "Agregá un campo `author` al frontmatter." },
  });
  assert.equal(withRules.json().rules, "Agregá un campo `author` al frontmatter.");

  const withoutRules = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Notas", content: "hola" },
  });
  assert.equal(withoutRules.json().rules, null, "null means: use block-builder.jsx's default template for the format");
});

test("PUT can switch a block's kind and content/format fields", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { connectorId: "gitlab", blockId: "recent-commits", title: "Commits" },
  });
  const block = created.json();

  const updated = await request(app, "PUT", `/api/home/custom-blocks/${block.id}`, {
    headers, body: { kind: "content", format: "html", content: "<p>Hola</p>" },
  });
  assert.equal(updated.status, 200);
  const body = updated.json();
  assert.equal(body.kind, "content");
  assert.equal(body.format, "html");
  assert.equal(body.content, "<p>Hola</p>");
  // Campos del kind anterior no se limpian solos, pero ya no se usan — el
  // renderer decide qué mirar según `kind`, no según qué campos existen.
  assert.equal(body.connectorId, "gitlab");
});

test("PUT can update a content block's prompt independently of its content", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { kind: "content", title: "Arquitectura", content: "# v1" },
  });
  const block = created.json();
  assert.equal(block.prompt, null);

  const updated = await request(app, "PUT", `/api/home/custom-blocks/${block.id}`, {
    headers, body: { prompt: "la arquitectura de los conectores" },
  });
  const body = updated.json();
  assert.equal(body.prompt, "la arquitectura de los conectores");
  assert.equal(body.content, "# v1", "updating the prompt alone leaves content untouched");
});

test("PUT updates only the given fields and 404s on an unknown id", async () => {
  const { app, headers, auditLog } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers,
    body: { connectorId: "gitlab", blockId: "recent-commits", title: "Commits", scope: "1", limit: 5 },
  });
  const block = created.json();

  const updated = await request(app, "PUT", `/api/home/custom-blocks/${block.id}`, {
    headers, body: { title: "Commits — renamed", description: "ahora con descripción", icon: "🔧", active: false },
  });
  assert.equal(updated.status, 200);
  const body = updated.json();
  assert.equal(body.title, "Commits — renamed");
  assert.equal(body.description, "ahora con descripción");
  assert.equal(body.icon, "🔧");
  assert.equal(body.active, false);
  // Untouched fields survive the partial update.
  assert.equal(body.connectorId, "gitlab");
  assert.equal(body.scope, "1");
  assert.equal(body.limit, 5);
  assert.equal(auditLog.at(-1).message, 'Editar block "Commits — renamed"');

  const list = await request(app, "GET", "/api/home/custom-blocks", { headers });
  assert.deepEqual(list.json(), [body]);

  const notFound = await request(app, "PUT", "/api/home/custom-blocks/does-not-exist", { headers, body: { title: "x" } });
  assert.equal(notFound.status, 404);
});

test("DELETE removes the block and 404s on an unknown id", async () => {
  const { app, headers, auditLog } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { connectorId: "outline", blockId: "recent-docs", title: "Docs" },
  });
  const block = created.json();

  const deleted = await request(app, "DELETE", `/api/home/custom-blocks/${block.id}`, { headers });
  assert.deepEqual(deleted.json(), { ok: true });
  assert.equal(auditLog.at(-1).message, 'Borrar block "Docs"');

  const list = await request(app, "GET", "/api/home/custom-blocks", { headers });
  assert.deepEqual(list.json(), []);

  const notFound = await request(app, "DELETE", `/api/home/custom-blocks/${block.id}`, { headers });
  assert.equal(notFound.status, 404);
});

test("DELETE also drops the block's id from home-layout if it was added there", async () => {
  const { app, store, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", {
    headers, body: { connectorId: "vcenter", blockId: "alerts", title: "Alerts" },
  });
  const block = created.json();
  store.set("home-layout", { left: [block.id], right: ["plane"] });

  await request(app, "DELETE", `/api/home/custom-blocks/${block.id}`, { headers });

  assert.deepEqual(store.get("home-layout"), { left: [], right: ["plane"] });
});
