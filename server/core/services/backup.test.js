const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { MAIN_MIGRATIONS, REPOSITORY_MIGRATIONS, migrate } = require("../database");
const { createBackupService, decryptArchive, MIN_PASSWORD_LENGTH } = require("./backup");

function database(migrations) {
  const db = new Database(":memory:");
  migrate(db, migrations);
  return db;
}

function seed(main, repos, suffix) {
  main.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)").run(`key-${suffix}`, JSON.stringify({ token: `secret-${suffix}` }), 1);
  main.prepare("INSERT INTO connectors (id, name, created_at) VALUES (?, ?, ?)").run(`connector-${suffix}`, `Connector ${suffix}`, 2);
  main.prepare("INSERT INTO vault_items (id, service, username, secret, updated_at) VALUES (?, ?, ?, ?, ?)").run(`vault-${suffix}`, "Service", "user", `vault-secret-${suffix}`, 3);
  repos.prepare("INSERT INTO repo_settings (project_id, visible, clone_path, pinned, updated_at) VALUES (?, ?, ?, ?, ?)").run(`repo-${suffix}`, 1, `C:/repo-${suffix}`, 1, 4);
}

test("encrypted backup round-trip restores both logical databases and writes a recovery point", async (t) => {
  const main = database(MAIN_MIGRATIONS);
  const repos = database(REPOSITORY_MIGRATIONS);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-backup-"));
  t.after(() => { main.close(); repos.close(); fs.rmSync(backupDir, { recursive: true, force: true }); });
  seed(main, repos, "source");
  const service = createBackupService({ mainDb: main, reposDb: repos, backupDir, now: () => Date.parse("2026-08-21T12:00:00.000Z") });
  const password = "a strong backup password";
  const archive = await service.exportArchive(password);

  const snapshot = await decryptArchive(archive, password);
  assert.equal(snapshot.databases.main.kv[0].key, "key-source");
  assert.equal(snapshot.databases.repos.repo_settings[0].pinned, 1);

  seed(main, repos, "current");
  const restored = await service.restoreArchive(archive, password);
  assert.match(restored.recoveryPoint, /^lintaya-before-import-.*\.lhq$/);
  assert.ok(fs.existsSync(path.join(backupDir, restored.recoveryPoint)));
  assert.deepEqual(main.prepare("SELECT key FROM kv ORDER BY key").all(), [{ key: "key-source" }]);
  assert.deepEqual(repos.prepare("SELECT project_id FROM repo_settings").all(), [{ project_id: "repo-source" }]);
});

test("backup refuses a wrong password without mutating data", async (t) => {
  const main = database(MAIN_MIGRATIONS);
  const repos = database(REPOSITORY_MIGRATIONS);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-backup-"));
  t.after(() => { main.close(); repos.close(); fs.rmSync(backupDir, { recursive: true, force: true }); });
  seed(main, repos, "current");
  const service = createBackupService({ mainDb: main, reposDb: repos, backupDir });
  const archive = await service.exportArchive("a strong backup password");
  await assert.rejects(() => service.restoreArchive(archive, "another valid password"), { code: "BACKUP_DECRYPT_FAILED" });
  assert.deepEqual(main.prepare("SELECT key FROM kv").all(), [{ key: "key-current" }]);
});

test("backup requires a sufficiently long passphrase", async () => {
  const main = database(MAIN_MIGRATIONS);
  const repos = database(REPOSITORY_MIGRATIONS);
  const service = createBackupService({ mainDb: main, reposDb: repos, backupDir: os.tmpdir() });
  await assert.rejects(() => service.exportArchive("short"), { code: "BACKUP_PASSWORD_TOO_SHORT" });
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  main.close(); repos.close();
});
