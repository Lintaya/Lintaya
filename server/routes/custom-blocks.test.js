const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerCustomBlocksRoutes } = require("./custom-blocks");
const { request } = require("./test-http-harness");

function setup(overrides = {}) {
  const store = new Map();
  store.set("builder-settings", { qr: { dynamicEnabled: true } });
  const db = new Database(":memory:");
  db.exec("CREATE TABLE qr_links (code TEXT PRIMARY KEY)");
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditLog = [];
  const auditActivity = (options) => (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => { auditLog.push({ ...options, message: res.locals.auditMessage }); return originalJson(body); };
    next();
  };

  const app = createApp({ token: "test-token" });
  registerCustomBlocksRoutes({ app, db, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, ...overrides });
  const headers = { authorization: "Bearer test-token" };
  return { app, store, auditLog, headers, db };
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
  assert.equal(body.connectorId, undefined, "switching kind strips stale connector fields");
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

test("DELETE removes the qr_links row owned by a dynamic QR block", async () => {
  const { app, db, store, headers } = setup();
  db.prepare("INSERT INTO qr_links (code) VALUES (?)").run("owned-code");
  store.set("custom-blocks", [{ id: "qr-1", kind: "qr", title: "Dynamic", payload: { mode: "dynamic", linkId: "owned-code" } }]);
  const deleted = await request(app, "DELETE", "/api/home/custom-blocks/qr-1", { headers });
  assert.equal(deleted.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM qr_links WHERE code = ?").get("owned-code").count, 0);
});

test("dynamic QR creation is rejected when the builder setting is missing", async () => {
  const { app, store, headers } = setup();
  store.delete("builder-settings");
  const response = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { kind: "qr", title: "Dynamic", payload: { mode: "dynamic", linkId: "code" }, logo: { source: "none" }, style: { ecLevel: "M", pattern: "square", corners: "square", fgColor: "#000000", bgColor: "#ffffff" } } });
  assert.equal(response.status, 400);
  assert.equal(response.json().errorCode, "builder.dynamicQrDisabled");
});

test("dynamic QR creation is accepted when enabled and editing remains allowed when disabled", async () => {
  const { app, store, headers } = setup();
  const body = { kind: "qr", title: "Dynamic", payload: { mode: "dynamic", linkId: "code" }, logo: { source: "none" }, style: { ecLevel: "M", pattern: "square", corners: "square", fgColor: "#000000", bgColor: "#ffffff" } };
  const created = await request(app, "POST", "/api/home/custom-blocks", { headers, body });
  assert.equal(created.status, 200);
  store.set("builder-settings", { qr: { dynamicEnabled: false } });
  const edited = await request(app, "PUT", `/api/home/custom-blocks/${created.json().id}`, { headers, body: { title: "Still dynamic" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.json().payload.mode, "dynamic");
});

test("static QR cannot be converted to dynamic while disabled", async () => {
  const { app, store, headers } = setup();
  const body = { kind: "qr", title: "Static", payload: { mode: "manual", value: "https://example.com" }, logo: { source: "none" }, style: { ecLevel: "M", pattern: "square", corners: "square", fgColor: "#000000", bgColor: "#ffffff" } };
  const created = await request(app, "POST", "/api/home/custom-blocks", { headers, body });
  store.set("builder-settings", { qr: { dynamicEnabled: false } });
  const response = await request(app, "PUT", `/api/home/custom-blocks/${created.json().id}`, { headers, body: { payload: { mode: "dynamic", linkId: "code" } } });
  assert.equal(response.status, 400);
  assert.equal(response.json().errorCode, "builder.dynamicQrDisabled");
});

test("QR blocks round-trip, reject unknown kinds, and reject incomplete QR PUTs", async () => {
  const { app, headers } = setup();
  const body = { kind: "qr", title: "Docs QR", payload: { mode: "manual", value: "https://例子.test/é" }, logo: { source: "brand", variant: "light" }, style: { ecLevel: "Q", pattern: "square", corners: "square", fgColor: "#000000", bgColor: "#ffffff" } };
  const created = await request(app, "POST", "/api/home/custom-blocks", { headers, body });
  assert.equal(created.status, 200); assert.deepEqual(created.json().payload, body.payload);
  const listed = await request(app, "GET", "/api/home/custom-blocks", { headers }); assert.deepEqual(listed.json()[0].style, body.style);
  const unknown = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { kind: "wat", title: "x" } }); assert.equal(unknown.status, 400);
  const connector = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { connectorId: "gitlab", blockId: "recent-commits", title: "connector" } });
  const incomplete = await request(app, "PUT", `/api/home/custom-blocks/${connector.json().id}`, { headers, body: { kind: "qr" } }); assert.equal(incomplete.status, 400);
});

test("PUT switching between kinds strips stale fields", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { connectorId: "gitlab", blockId: "recent-commits", title: "x" } });
  const switched = await request(app, "PUT", `/api/home/custom-blocks/${created.json().id}`, { headers, body: { kind: "qr", payload: { mode: "manual", value: "https://example.com" }, logo: { source: "none" }, style: { ecLevel: "M", pattern: "square", corners: "square", fgColor: "#000000", bgColor: "#ffffff" } } });
  assert.equal(switched.status, 200); assert.equal(switched.json().connectorId, undefined); assert.equal(switched.json().blockId, undefined);
});

test("QR blocks accept an icon logo and reject a malformed icon key", async () => {
  const { app, headers } = setup();
  const base = { kind: "qr", title: "Menu", payload: { mode: "manual", value: "https://example.com/menu" }, style: { ecLevel: "H", pattern: "square", corners: "square", fgColor: "#000000", bgColor: "#ffffff" } };
  const created = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { ...base, logo: { source: "icon", icon: "restaurant" } } });
  assert.equal(created.status, 200);
  assert.deepEqual(created.json().logo, { source: "icon", icon: "restaurant" });
  for (const icon of [undefined, "", "Heart", "<svg>", 5]) {
    const bad = await request(app, "POST", "/api/home/custom-blocks", { headers, body: { ...base, logo: { source: "icon", icon } } });
    assert.equal(bad.status, 400, `icon ${JSON.stringify(icon)} should be rejected`);
  }
});

test("POST /api/home/custom-blocks stores a linkedin-post block with its text and link", async () => {
  const { app, headers, store } = setup();
  const res = await request(app, "POST", "/api/home/custom-blocks", { headers, body: {
    kind: "linkedin-post", connectorId: "linkedin", title: "Lanzamiento",
    payload: { body: "Hoy lanzamos 🚀", link: " https://example.test/post ", linkAsFirstComment: false },
  } });
  assert.equal(res.status, 200);
  const saved = store.get("custom-blocks")[0];
  assert.equal(saved.kind, "linkedin-post");
  assert.equal(saved.connectorId, "linkedin");
  assert.deepEqual(saved.payload, { body: "Hoy lanzamos 🚀", link: "https://example.test/post", linkAsFirstComment: false });
  assert.equal(saved.blockId, undefined);
});

test("a linkedin-post block is validated like the connector will publish it", async () => {
  const { app, headers } = setup();
  const post = (payload, extra = {}) => request(app, "POST", "/api/home/custom-blocks", { headers, body: { kind: "linkedin-post", connectorId: "linkedin", title: "P", payload, ...extra } });

  assert.equal((await post({ body: "   " })).status, 400);
  assert.equal((await post({ body: "ok", link: "javascript:alert(1)" })).status, 400);
  assert.equal((await post({ body: "ok" }, { connectorId: "" })).status, 400);
  // Puntos de código: 3000 emojis caben, uno más no.
  assert.equal((await post({ body: "🚀".repeat(3000) })).status, 200);
  assert.equal((await post({ body: "🚀".repeat(3001) })).status, 400);
  // El enlace se publica al final del texto y cuenta para el límite.
  assert.equal((await post({ body: "x".repeat(2990), link: "https://example.test/long" })).status, 400);
});
