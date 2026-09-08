const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const RealDatabase = require("better-sqlite3");

const {
  MAIN_MIGRATIONS,
  REPOSITORY_MIGRATIONS,
  backfillConnectorTypeIds,
  createKvStore,
  openDatabase,
} = require("./database");

class FakeDatabase {
  constructor(filename) {
    this.filename = filename;
    this.open = true;
    this.version = 0;
    this.columns = ["project_id", "visible", "clone_path", "updated_at"];
    this.connectorColumns = ["id", "name", "kind", "created_at"];
    this.statements = [];
  }

  pragma(statement, options = {}) {
    this.statements.push(`PRAGMA ${statement}`);
    if (statement === "user_version" && options.simple) return this.version;
    if (statement.startsWith("user_version = ")) {
      this.version = Number(statement.split("=")[1].trim());
    }
    return undefined;
  }

  exec(sql) {
    this.statements.push(sql);
    if (sql.startsWith("ALTER TABLE repo_settings") && !this.columns.includes("pinned")) {
      this.columns.push("pinned");
    }
    if (sql.startsWith("ALTER TABLE connectors") && !this.connectorColumns.includes("connector_type_id")) {
      this.connectorColumns.push("connector_type_id");
    }
  }

  prepare(sql) {
    if (sql === "PRAGMA table_info(repo_settings)") {
      return { all: () => this.columns.map((name) => ({ name })) };
    }
    if (sql === "PRAGMA table_info(connectors)") {
      return { all: () => this.connectorColumns.map((name) => ({ name })) };
    }
    throw new Error(`Unexpected SQL in migration fake: ${sql}`);
  }

  transaction(callback) {
    return () => callback();
  }
}

class FakeKvDatabase {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    if (sql.startsWith("SELECT value")) {
      return { get: (key) => this.rows.get(key) || null };
    }
    if (sql.startsWith("INSERT OR REPLACE")) {
      return {
        run: (key, value, updatedAt) => {
          this.rows.set(key, { value, updated_at: updatedAt });
        },
      };
    }
    if (sql.startsWith("SELECT key, value")) {
      return {
        all: (pattern) => {
          const prefix = pattern.replace(/%$/, "");
          const rows = [];
          for (const [key, row] of this.rows) {
            if (key.startsWith(prefix)) rows.push({ key, value: row.value });
          }
          return rows;
        },
      };
    }
    throw new Error(`Unexpected SQL in KV fake: ${sql}`);
  }
}

test("openDatabase applies and versions the main schema", () => {
  const db = openDatabase({
    filename: "main-test.db",
    migrations: MAIN_MIGRATIONS,
    DatabaseClass: FakeDatabase,
  });

  assert.equal(db.filename, "main-test.db");
  assert.equal(db.version, 3);
  assert.ok(db.statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS kv")));
  assert.ok(db.connectorColumns.includes("connector_type_id"));
});

test("repository migrations add pinned idempotently", () => {
  const db = openDatabase({
    filename: "repos-test.db",
    migrations: REPOSITORY_MIGRATIONS,
    DatabaseClass: FakeDatabase,
  });

  assert.equal(db.version, 2);
  assert.ok(db.columns.includes("pinned"));
});

// CORE-003 / ADR-010 — realistic migration + backfill against a real SQLite
// file (not the FakeDatabase above), reproducing an installation that
// predates `connector_type_id`: a base "gitlab" row and a "gitlab2" extra
// instance created back when the only record of that relationship was the
// `connector-instances` KV map. Opening it must add the column via version 2
// without touching existing data, and the backfill (the same function
// server.js's bootstrapConnectorInstances() calls on every boot) must land
// both rows on `connector_type_id = "gitlab"` using nothing but the id and
// the injected resolver — no server.js, no Express, no manifest registry.
test("connector_type_id migration + backfill resolves a legacy instance like gitlab2 on a pre-existing database", () => {
  const file = path.join(os.tmpdir(), `lintaya-core-003-${process.pid}-${Date.now()}.db`);
  const cleanup = () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
  cleanup();

  try {
    // 1. Build the database exactly as an installation from before this ADR
    //    would have it: only the version-1 schema applied, no
    //    connector_type_id column at all, a base connection and a legacy
    //    extra instance seeded the way seedConnectors()/the old "+ Add
    //    another connection" flow did (id only — no type-id column existed
    //    to fill in).
    const legacy = new RealDatabase(file);
    legacy.pragma("journal_mode = WAL");
    MAIN_MIGRATIONS[0].apply(legacy);
    legacy.pragma("user_version = 1");
    const insertLegacyRow = legacy.prepare(`
      INSERT INTO connectors
        (id, name, kind, icon, color, endpoint, auth, interval, feeds, docs, sample_endpoints, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertLegacyRow.run("gitlab", "GitLab", "GitLab REST API v4", "GL", "#380D75", "", "", "manual", "[]", "", "[]", Date.now());
    insertLegacyRow.run("gitlab2", "GitLab CICD", "GitLab REST API v4", "GL", "#380D75", "", "", "manual", "[]", "", "[]", Date.now());
    assert.equal(
      legacy.prepare("PRAGMA table_info(connectors)").all().some((c) => c.name === "connector_type_id"),
      false,
      "precondition: this simulated installation must not have the column yet",
    );
    legacy.close();

    // 2. Reopen through the real migration runner, the same entry point
    //    server.js uses (openDatabase + MAIN_MIGRATIONS) — this is what adds
    //    the column, purely additively, on an installation that already has
    //    rows.
    const migrated = openDatabase({ filename: file, migrations: MAIN_MIGRATIONS, DatabaseClass: RealDatabase });
    assert.equal(migrated.pragma("user_version", { simple: true }), 3);
    const beforeBackfill = migrated.prepare("SELECT id, connector_type_id FROM connectors ORDER BY id").all();
    assert.deepEqual(beforeBackfill, [
      { id: "gitlab", connector_type_id: null },
      { id: "gitlab2", connector_type_id: null },
    ]);

    // 3. Backfill, with a resolver standing in for the real
    //    resolveConnectorType()'s KV-scan fallback (gitlab2 isn't a manifest
    //    id, so it resolves via the connector-instances map to "gitlab") and
    //    a hasType predicate standing in for getConnectorManifest() (only
    //    "gitlab" is an installed type in this scenario).
    const resolveType = (id) => (id === "gitlab2" ? "gitlab" : id);
    const hasType = (typeId) => typeId === "gitlab";
    const updated = backfillConnectorTypeIds(migrated, { resolveType, hasType });
    assert.equal(updated, 2);

    const afterBackfill = migrated.prepare("SELECT id, connector_type_id FROM connectors ORDER BY id").all();
    assert.deepEqual(afterBackfill, [
      { id: "gitlab", connector_type_id: "gitlab" },
      { id: "gitlab2", connector_type_id: "gitlab" },
    ]);

    // 4. Idempotent on the next boot: already-populated rows are left alone,
    //    even if the resolver would now answer differently — matching
    //    resolveConnectorType() treating the column as the source of truth
    //    once set, not something to keep recomputing.
    const secondPass = backfillConnectorTypeIds(migrated, {
      resolveType: () => "some-other-type",
      hasType: () => true,
    });
    assert.equal(secondPass, 0);
    assert.deepEqual(
      migrated.prepare("SELECT id, connector_type_id FROM connectors ORDER BY id").all(),
      afterBackfill,
    );

    migrated.close();
  } finally {
    cleanup();
    // better-sqlite3's WAL mode leaves -wal/-shm sidecar files next to the
    // main one; harmless if npm test's tmp dir outlives this run, but no
    // reason to leak them.
    try { fs.unlinkSync(`${file}-wal`); } catch { /* not created */ }
    try { fs.unlinkSync(`${file}-shm`); } catch { /* not created */ }
  }
});

test("createKvStore serializes values and exposes timestamps", () => {
  const db = new FakeKvDatabase();
  const store = createKvStore(db, { now: () => 123456 });

  assert.equal(store.get("missing"), null);
  assert.deepEqual(store.set("settings", { enabled: true }), {
    value: { enabled: true },
    updatedAt: 123456,
  });
  assert.deepEqual(store.get("settings"), {
    value: { enabled: true },
    updatedAt: 123456,
  });
});

test("createKvStore.getByPrefix batches all keys under a prefix, deserialized", () => {
  const db = new FakeKvDatabase();
  const store = createKvStore(db, { now: () => 123456 });

  store.set("connector-config-plane", { apiKey: "x" });
  store.set("connector-status-plane", { status: "ok" });
  store.set("vcenter-data-vcenter", { vms: [] });

  assert.deepEqual(store.getByPrefix("connector-"), {
    "connector-config-plane": { apiKey: "x" },
    "connector-status-plane": { status: "ok" },
  });
});
