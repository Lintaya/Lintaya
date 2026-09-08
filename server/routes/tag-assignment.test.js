// Etiquetar un Board, un Dashboard o un Block es opcional (ADR-015). Las tres
// rutas comparten normalizeAssignedTags/applyAssignedTags, así que se prueban
// juntas: lo que importa es que las tres se comporten igual.
const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerModulePagesRoutes } = require("./module-pages");
const { registerDashboardsRoutes } = require("./dashboards");
const { registerCustomBlocksRoutes } = require("./custom-blocks");
const { normalizeAssignedTags } = require("./tags");
const { request } = require("./test-http-harness");

function setup(register) {
  const store = new Map();
  const kvGet = key => store.has(key) ? { value: store.get(key) } : null;
  const kvSet = (key, value) => store.set(key, value);
  const auditActivity = () => (req, res, next) => next();
  const app = createApp({ token: "test-token" });
  register({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError });
  return { app, store, headers: { authorization: "Bearer test-token" } };
}

// Cada entrada: cómo se llama la ruta y el cuerpo mínimo para crear uno.
const ENTITIES = [
  { name: "Board", register: registerModulePagesRoutes, path: "/api/module-pages", body: { title: "B", tree: { type: "zone" } } },
  { name: "Dashboard", register: registerDashboardsRoutes, path: "/api/dashboards", body: { title: "D", boardIds: [] } },
  { name: "Block", register: registerCustomBlocksRoutes, path: "/api/home/custom-blocks", body: { kind: "content", title: "K", content: "hola" } },
];

for (const entity of ENTITIES) {
  test(`a ${entity.name} saves with no tags at all, and carries no tags key`, async () => {
    const { app, headers } = setup(entity.register);
    const response = await request(app, "POST", entity.path, { headers, body: entity.body });
    assert.equal(response.status, 200);
    assert.equal("tags" in response.json(), false);
  });

  test(`a ${entity.name} keeps the tags it was created with`, async () => {
    const { app, headers } = setup(entity.register);
    const response = await request(app, "POST", entity.path, {
      headers, body: { ...entity.body, tags: ["env-prod", "owner-infra"] },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json().tags, ["env-prod", "owner-infra"]);
  });

  test(`editing a ${entity.name} without mentioning tags leaves them alone`, async () => {
    const { app, headers } = setup(entity.register);
    const created = (await request(app, "POST", entity.path, {
      headers, body: { ...entity.body, tags: ["env-prod"] },
    })).json();
    const updated = await request(app, "PUT", `${entity.path}/${created.id}`, { headers, body: { title: "Otro" } });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.json().tags, ["env-prod"]);
  });

  test(`an empty list clears a ${entity.name}'s tags rather than storing an empty one`, async () => {
    const { app, headers } = setup(entity.register);
    const created = (await request(app, "POST", entity.path, {
      headers, body: { ...entity.body, tags: ["env-prod"] },
    })).json();
    const updated = await request(app, "PUT", `${entity.path}/${created.id}`, { headers, body: { tags: [] } });
    assert.equal(updated.status, 200);
    assert.equal("tags" in updated.json(), false);
  });

  test(`a ${entity.name} refuses tags that are not a list of ids`, async () => {
    const { app, headers } = setup(entity.register);
    const response = await request(app, "POST", entity.path, {
      headers, body: { ...entity.body, tags: "env-prod" },
    });
    assert.equal(response.status, 400);
  });

  // Borrar una etiqueta del catálogo no limpia las asignaciones, así que un id
  // que ya no existe tiene que poder guardarse: si no, un registro intacto
  // dejaría de poder editarse por una etiqueta que alguien borró.
  test(`a ${entity.name} still saves a tag id the catalog no longer has`, async () => {
    const { app, headers } = setup(entity.register);
    const response = await request(app, "POST", entity.path, {
      headers, body: { ...entity.body, tags: ["borrada-hace-meses"] },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json().tags, ["borrada-hace-meses"]);
  });
}

test("normalizing trims, drops blanks and de-duplicates, and tells apart absent from empty", () => {
  assert.equal(normalizeAssignedTags(undefined), undefined);
  assert.deepEqual(normalizeAssignedTags(null), []);
  assert.deepEqual(normalizeAssignedTags([]), []);
  assert.deepEqual(normalizeAssignedTags([" env-prod ", "", "env-prod", "owner-infra"]), ["env-prod", "owner-infra"]);
  assert.equal(normalizeAssignedTags("env-prod"), null);
  assert.equal(normalizeAssignedTags([1]), null);
});
