const Database = require("better-sqlite3");

const MAIN_MIGRATIONS = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS connectors (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          kind         TEXT NOT NULL DEFAULT '',
          icon         TEXT NOT NULL DEFAULT '',
          color        TEXT NOT NULL DEFAULT '#2563eb',
          endpoint     TEXT DEFAULT '',
          auth         TEXT DEFAULT '',
          interval     TEXT DEFAULT 'manual',
          feeds        TEXT NOT NULL DEFAULT '[]',
          docs         TEXT DEFAULT '',
          sample_endpoints TEXT NOT NULL DEFAULT '[]',
          created_at   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vault_items (
          id TEXT PRIMARY KEY,
          service TEXT NOT NULL,
          username TEXT NOT NULL,
          secret TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          url TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          strength TEXT DEFAULT 'medium',
          last_used TEXT DEFAULT '',
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    apply(db) {
      const columns = db.prepare("PRAGMA table_info(connectors)").all();
      if (!columns.some((column) => column.name === "connector_type_id")) {
        db.exec("ALTER TABLE connectors ADD COLUMN connector_type_id TEXT");
      }
    },
  },
  {
    // SEC-003 — an approval is an append-only, locally persisted decision
    // bound to a single destructive connector action.  Inputs are kept only
    // so the approved action can resume; public/API shapes use the redacted
    // input maintained by approval-store.js.
    version: 3,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS approvals (
          id                TEXT PRIMARY KEY,
          connection_id     TEXT NOT NULL,
          connector_type_id TEXT NOT NULL,
          action_id         TEXT NOT NULL,
          action_title      TEXT NOT NULL,
          input_json        TEXT NOT NULL,
          input_hash        TEXT NOT NULL,
          requester         TEXT NOT NULL,
          request_id        TEXT,
          status            TEXT NOT NULL,
          requested_at      INTEGER NOT NULL,
          expires_at        INTEGER NOT NULL,
          resolved_at       INTEGER,
          resolved_by       TEXT,
          completed_at      INTEGER,
          failure_reason    TEXT
        );
        CREATE INDEX IF NOT EXISTS approvals_status_requested_at
          ON approvals(status, requested_at DESC);
        CREATE TABLE IF NOT EXISTS approval_events (
          id          TEXT PRIMARY KEY,
          approval_id TEXT NOT NULL,
          type        TEXT NOT NULL,
          actor       TEXT,
          created_at  INTEGER NOT NULL,
          meta_json   TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (approval_id) REFERENCES approvals(id)
        );
        CREATE INDEX IF NOT EXISTS approval_events_approval_created_at
          ON approval_events(approval_id, created_at ASC);
      `);
    },
  },
];

const REPOSITORY_MIGRATIONS = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repo_settings (
          project_id TEXT PRIMARY KEY,
          visible    INTEGER NOT NULL DEFAULT 1,
          clone_path TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    apply(db) {
      const columns = db.prepare("PRAGMA table_info(repo_settings)").all();
      if (!columns.some((column) => column.name === "pinned")) {
        db.exec("ALTER TABLE repo_settings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
];

// Backfills `connectors.connector_type_id` for rows that predate the column
// (CORE-003 / ADR-010) — e.g. a "gitlab2" instance created before this
// migration existed. `resolveType(id)`/`hasType(typeId)` are injected rather
// than imported, so this stays a plain SQL operation independent from the
// manifest registry and the `connector-instances` KV map that server.js's
// `resolveConnectorType()` depends on — that separation is what makes this
// testable against a real SQLite file without booting the whole app.
// Idempotent: a row with a value already set is left untouched, so this can
// run on every boot (same call site as before, `bootstrapConnectorInstances()`
// in server.js) without redoing work post-backfill.
function backfillConnectorTypeIds(db, { resolveType, hasType }) {
  const rows = db.prepare("SELECT id, connector_type_id FROM connectors").all();
  const update = db.prepare("UPDATE connectors SET connector_type_id = ? WHERE id = ?");
  let updated = 0;
  for (const row of rows) {
    if (row.connector_type_id) continue;
    const typeId = resolveType(row.id);
    if (typeId && hasType(typeId)) {
      update.run(typeId, row.id);
      updated++;
    }
  }
  return updated;
}

function migrate(db, migrations) {
  const currentVersion = Number(db.pragma("user_version", { simple: true })) || 0;
  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (!pending.length) return currentVersion;

  const apply = db.transaction(() => {
    let version = currentVersion;
    for (const migration of pending) {
      migration.apply(db);
      db.pragma(`user_version = ${migration.version}`);
      version = migration.version;
    }
    return version;
  });
  return apply();
}

function openDatabase({ filename, migrations = [], DatabaseClass = Database }) {
  if (!filename) throw new TypeError("A database filename is required");
  const db = new DatabaseClass(filename);
  db.pragma("journal_mode = WAL");
  migrate(db, migrations);
  return db;
}

function createKvStore(db, options = {}) {
  const now = options.now || Date.now;
  const select = db.prepare("SELECT value, updated_at FROM kv WHERE key = ?");
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)",
  );
  const selectByPrefix = db.prepare("SELECT key, value FROM kv WHERE key LIKE ?");

  return {
    get(key) {
      const row = select.get(key);
      return row ? { value: JSON.parse(row.value), updatedAt: row.updated_at } : null;
    },
    getByPrefix(prefix) {
      const rows = selectByPrefix.all(`${prefix}%`);
      const result = {};
      for (const row of rows) {
        result[row.key] = JSON.parse(row.value);
      }
      return result;
    },
    set(key, value) {
      const updatedAt = now();
      upsert.run(key, JSON.stringify(value), updatedAt);
      return { value, updatedAt };
    },
  };
}

module.exports = {
  MAIN_MIGRATIONS,
  REPOSITORY_MIGRATIONS,
  backfillConnectorTypeIds,
  createKvStore,
  migrate,
  openDatabase,
};
