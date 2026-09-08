const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerAIContextRoutes } = require("./ai-context");
const { request } = require("./test-http-harness");

function setup() {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditLog = [];
  const auditActivity = (options) => (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      auditLog.push({ ...options, message: res.locals.auditMessage });
      return originalJson(body);
    };
    next();
  };
  const app = createApp({ token: "test-token" });
  registerAIContextRoutes({
    app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError,
    connectors: [{ id: "github", name: "GitHub", capabilities: ["read"] }],
  });
  return { app, store, auditLog, headers: { authorization: "Bearer test-token" } };
}

test("GET /api/ai-context remains public but exposes only safe ConnectorType discovery metadata", async () => {
  const { app, store } = setup();
  store.set("ai-context", { privateHost: "internal.example", secret: "must-not-leak" });
  const res = await request(app, "GET", "/api/ai-context");
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.connectors[0].id, "github");
  assert.equal(body.visibility, "public-discovery");
  assert.ok(!JSON.stringify(body).includes("internal.example"));
  assert.ok(!JSON.stringify(body).includes("must-not-leak"));
  assert.deepEqual(Object.keys(body.connectors[0]).sort(), ["capabilities", "id", "name"]);
  assert.ok(body.endpoints.health.some(item => item.includes("/llms.txt") && item.includes("no auth")));
  assert.ok(body.endpoints.health.some(item => item.includes("/llms.es.txt") && item.includes("no auth")));
  assert.ok(body.endpoints.connectors.every(item => item.includes("(auth)")));
});

test("stored AI context requires authentication and uses RFC 9457", async () => {
  const { app } = setup();
  const res = await request(app, "GET", "/api/ai-context/stored");
  assert.equal(res.status, 401);
  assert.match(res.headers["content-type"], /^application\/problem\+json/);
  assert.equal(res.json().code, "UNAUTHORIZED");
});

test("PUT /api/ai-context rejects a non-object body as Problem Details", async () => {
  const { app, headers } = setup();
  const res = await request(app, "PUT", "/api/ai-context", { headers, body: ["not", "an", "object"] });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
  assert.equal(res.json().type, "urn:lintaya:problem:bad-request");
});

test("stored AI context can be merged through the authenticated endpoint and is audited", async () => {
  const { app, store, auditLog, headers } = setup();
  store.set("ai-context", { description: "Existing" });
  const put = await request(app, "PUT", "/api/ai-context", { headers, body: { version: "2.0" } });
  assert.deepEqual(put.json(), { ok: true, context: { description: "Existing", version: "2.0" } });

  const get = await request(app, "GET", "/api/ai-context/stored", { headers });
  assert.deepEqual(get.json(), { description: "Existing", version: "2.0" });
  assert.deepEqual(auditLog, [{ provider: "settings", action: "Actualizar AI context", message: "Actualizar AI context — 1 campos" }]);
});
