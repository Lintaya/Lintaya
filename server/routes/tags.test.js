const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerTagsRoutes, DEFAULT_TAGS } = require("./tags");
const { request } = require("./test-http-harness");

function setup(seed) {
  const store = new Map();
  if (seed) store.set("tags", seed);
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
  registerTagsRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError });
  return { app, store, auditLog, headers: { authorization: "Bearer test-token" } };
}

test("an instance with nothing stored answers with the seeded catalog", async () => {
  const { app, headers, store } = setup();
  const response = await request(app, "GET", "/api/tags", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().map(tag => tag.id), DEFAULT_TAGS.map(tag => tag.id));
  // Leer no escribe: el catálogo sembrado no se materializa hasta que alguien
  // lo edita, para que /api/tags/adopt siga viendo una instancia sin catálogo.
  assert.equal(store.has("tags"), false);
});

test("creating a tag derives its id from the label and records the action", async () => {
  const { app, headers, auditLog } = setup([]);
  const response = await request(app, "POST", "/api/tags", {
    headers,
    body: { label: "Data Center", color: "#ff0000", description: "Where it lives" },
  });
  assert.equal(response.status, 200);
  const tag = response.json();
  assert.equal(tag.id, "data-center");
  assert.equal(tag.schemaVersion, 1);
  assert.equal(tag.label, "Data Center");
  assert.equal(auditLog.at(-1).message, 'Crear etiqueta "Data Center"');
});

test("two tags with the same label get distinct ids", async () => {
  const { app, headers } = setup([]);
  await request(app, "POST", "/api/tags", { headers, body: { label: "Zona" } });
  const second = await request(app, "POST", "/api/tags", { headers, body: { label: "Zona" } });
  assert.equal(second.json().id, "zona-2");
});

test("a label with no usable characters is refused rather than stored under an empty id", async () => {
  const { app, headers } = setup([]);
  const response = await request(app, "POST", "/api/tags", { headers, body: { label: "%%%" } });
  assert.equal(response.status, 400);
});

test("renaming a tag keeps its id, because assignments already reference it", async () => {
  const { app, headers, store } = setup([{ id: "environment", label: "Environment", color: "#10b981" }]);
  const response = await request(app, "PUT", "/api/tags/environment", { headers, body: { label: "Entorno" } });
  assert.equal(response.status, 200);
  assert.equal(response.json().id, "environment");
  assert.equal(response.json().label, "Entorno");
  assert.equal(store.get("tags")[0].id, "environment");
});

test("a category value keeps its id when the list is reordered or relabelled around it", async () => {
  const seed = [{
    id: "environment", label: "Environment", color: "#10b981",
    values: [{ id: "env-prod", label: "Prod" }, { id: "env-dev", label: "Dev" }],
  }];
  const { app, headers } = setup(seed);
  const response = await request(app, "PUT", "/api/tags/environment", {
    headers,
    body: { values: [{ label: "Dev" }, { label: "Prod" }, { label: "Lab" }] },
  });
  assert.equal(response.status, 200);
  const values = response.json().values;
  assert.deepEqual(values.map(value => value.id), ["env-dev", "env-prod", "lab"]);
});

test("an unnamed value is refused instead of being stored without a label", async () => {
  const { app, headers } = setup([{ id: "environment", label: "Environment" }]);
  const response = await request(app, "PUT", "/api/tags/environment", {
    headers,
    body: { values: [{ label: "Prod" }, { label: "  " }] },
  });
  assert.equal(response.status, 400);
});

test("deleting a tag leaves assignments elsewhere alone", async () => {
  const { app, headers, store, auditLog } = setup([
    { id: "environment", label: "Environment" }, { id: "ownership", label: "Ownership" },
  ]);
  const response = await request(app, "DELETE", "/api/tags/environment", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(store.get("tags").map(tag => tag.id), ["ownership"]);
  assert.equal(auditLog.at(-1).message, 'Borrar etiqueta "Environment"');
});

test("editing or deleting a tag that does not exist is a 404", async () => {
  const { app, headers } = setup([]);
  assert.equal((await request(app, "PUT", "/api/tags/nope", { headers, body: { label: "x" } })).status, 404);
  assert.equal((await request(app, "DELETE", "/api/tags/nope", { headers })).status, 404);
});

test("a browser catalog is adopted once, and refused after one is stored", async () => {
  const { app, headers, store } = setup();
  const body = { tags: [{ id: "zona", label: "Zona", color: "#123456", values: [{ id: "z-a", label: "A" }] }] };
  const first = await request(app, "POST", "/api/tags/adopt", { headers, body });
  assert.equal(first.status, 200);
  assert.deepEqual(store.get("tags").map(tag => tag.id), ["zona"]);
  assert.deepEqual(store.get("tags")[0].values, [{ id: "z-a", label: "A" }]);

  const second = await request(app, "POST", "/api/tags/adopt", { headers, body });
  assert.equal(second.status, 409);
  assert.deepEqual(store.get("tags").map(tag => tag.id), ["zona"]);
});

test("adopting refuses an empty payload rather than wiping the catalog to nothing", async () => {
  const { app, headers, store } = setup();
  assert.equal((await request(app, "POST", "/api/tags/adopt", { headers, body: { tags: [] } })).status, 400);
  assert.equal(store.has("tags"), false);
});

test("reordering rewrites the catalog order", async () => {
  const { app, headers, store, auditLog } = setup([
    { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" },
  ]);
  const response = await request(app, "PUT", "/api/tags/order", { headers, body: { ids: ["c", "a", "b"] } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().map(tag => tag.id), ["c", "a", "b"]);
  assert.deepEqual(store.get("tags").map(tag => tag.id), ["c", "a", "b"]);
  assert.equal(auditLog.at(-1).message, "Reordenar 3 etiquetas");
});

test("reordering refuses anything that is not an exact permutation", async () => {
  const seed = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  for (const ids of [["a"], ["a", "b", "c"], ["a", "a"], ["a", "zzz"], "a"]) {
    const { app, headers, store } = setup(seed);
    const response = await request(app, "PUT", "/api/tags/order", { headers, body: { ids } });
    assert.equal(response.status, 400, `should refuse ${JSON.stringify(ids)}`);
    assert.deepEqual(store.get("tags").map(tag => tag.id), ["a", "b"]);
  }
});

// /api/tags/order tiene que declararse antes que /api/tags/:id o el parámetro
// se come la palabra "order" y reordenar se convierte en editar una etiqueta
// llamada así.
test("the order route is not swallowed by the :id route", async () => {
  const { app, headers } = setup([{ id: "a", label: "A" }]);
  const response = await request(app, "PUT", "/api/tags/order", { headers, body: { ids: ["a"] } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().map(tag => tag.id), ["a"]);
});

test("every route needs the bearer token", async () => {
  const { app } = setup([]);
  assert.equal((await request(app, "GET", "/api/tags")).status, 401);
  assert.equal((await request(app, "POST", "/api/tags", { body: { label: "x" } })).status, 401);
});
