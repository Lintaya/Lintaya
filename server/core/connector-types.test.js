const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { createConnectorTypeResolver } = require("./connector-types");

function makeDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE connectors (id TEXT PRIMARY KEY, connector_type_id TEXT)");
  return db;
}

function setup({ rows = [], instances = {}, manifests = new Set() } = {}) {
  const db = makeDb();
  const insert = db.prepare("INSERT INTO connectors (id, connector_type_id) VALUES (?, ?)");
  for (const row of rows) insert.run(row.id, row.connector_type_id ?? null);
  const kv = new Map(Object.entries({ "connector-instances": instances }));
  const kvGet = (key) => (kv.has(key) ? { value: kv.get(key) } : null);
  const getConnectorManifest = (id) => (manifests.has(id) ? { id } : null);
  return createConnectorTypeResolver({ db, kvGet, getConnectorManifest });
}

test("returns the backfilled connector_type_id column when present", () => {
  const resolve = setup({ rows: [{ id: "gitlab2", connector_type_id: "gitlab" }] });
  assert.equal(resolve("gitlab2"), "gitlab");
});

test("falls back to the manifest when the column is empty (a base type's own id)", () => {
  const resolve = setup({ rows: [{ id: "gitlab", connector_type_id: null }], manifests: new Set(["gitlab"]) });
  assert.equal(resolve("gitlab"), "gitlab");
});

test("falls back to a connector-instances KV scan when neither the column nor the manifest match", () => {
  const resolve = setup({
    rows: [{ id: "gitlab2", connector_type_id: null }],
    instances: { gitlab: ["gitlab2", "gitlab3"] },
  });
  assert.equal(resolve("gitlab2"), "gitlab");
});

test("returns the id itself when nothing resolves it (unknown connection)", () => {
  const resolve = setup({});
  assert.equal(resolve("mystery"), "mystery");
});

test("column wins even when a KV instance mapping would say otherwise", () => {
  const resolve = setup({
    rows: [{ id: "gitlab2", connector_type_id: "gitlab" }],
    instances: { "some-other-type": ["gitlab2"] },
  });
  assert.equal(resolve("gitlab2"), "gitlab");
});
