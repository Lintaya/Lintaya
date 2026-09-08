// Encrypted, portable logical backups for the two SQLite databases used by
// Lintaya.  This deliberately exports rows rather than copying a live WAL
// file: an export is consistent while the server is running, and an import can
// replace data transactionally without closing prepared statements in routes.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const FORMAT = "lintaya-backup";
const VERSION = 1;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 12;

const TABLES = {
  main: {
    kv: ["key", "value", "updated_at"],
    connectors: ["id", "name", "kind", "icon", "color", "endpoint", "auth", "interval", "feeds", "docs", "sample_endpoints", "created_at"],
    vault_items: ["id", "service", "username", "secret", "tags", "url", "notes", "strength", "last_used", "updated_at"],
  },
  repos: {
    repo_settings: ["project_id", "visible", "clone_path", "pinned", "updated_at"],
  },
};

class BackupError extends Error {
  constructor(message, code = "INVALID_BACKUP") {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new BackupError(`Use a backup password of at least ${MIN_PASSWORD_LENGTH} characters.`, "BACKUP_PASSWORD_TOO_SHORT");
  }
}

function isSafeValue(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function validateRows(rows, columns, tableName) {
  if (!Array.isArray(rows)) throw new BackupError(`Backup table ${tableName} is missing or invalid.`);
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new BackupError(`Backup table ${tableName} contains an invalid row.`);
    }
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column) || !isSafeValue(row[column])) {
        throw new BackupError(`Backup table ${tableName} has an invalid ${column} value.`);
      }
    }
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new BackupError("The backup contents are invalid.");
  }
  if (snapshot.format !== FORMAT || snapshot.version !== VERSION) {
    throw new BackupError("This file is not a compatible Lintaya backup.", "UNSUPPORTED_BACKUP");
  }
  if (typeof snapshot.createdAt !== "string" || !Number.isFinite(Date.parse(snapshot.createdAt))) {
    throw new BackupError("The backup creation date is invalid.");
  }
  for (const [database, tables] of Object.entries(TABLES)) {
    if (!snapshot.databases || !snapshot.databases[database] || typeof snapshot.databases[database] !== "object") {
      throw new BackupError(`The ${database} database is missing from this backup.`);
    }
    for (const [table, columns] of Object.entries(tables)) {
      validateRows(snapshot.databases[database][table], columns, `${database}.${table}`);
    }
  }
  return snapshot;
}

function readSnapshot(mainDb, reposDb, now = Date.now) {
  const databases = {};
  for (const [database, tables] of Object.entries(TABLES)) {
    const db = database === "main" ? mainDb : reposDb;
    databases[database] = {};
    for (const [table, columns] of Object.entries(tables)) {
      databases[database][table] = db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all();
    }
  }
  return { format: FORMAT, version: VERSION, createdAt: new Date(now()).toISOString(), databases };
}

async function encryptSnapshot(snapshot, password, randomBytes = crypto.randomBytes) {
  assertPassword(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]);
  return Buffer.from(JSON.stringify({
    format: FORMAT,
    version: VERSION,
    encrypted: true,
    kdf: { name: "scrypt", salt: salt.toString("base64") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
    ciphertext: ciphertext.toString("base64"),
  }), "utf8");
}

async function decryptArchive(archive, password) {
  assertPassword(password);
  const source = Buffer.isBuffer(archive) ? archive : Buffer.from(archive || "");
  if (!source.length || source.length > MAX_ARCHIVE_BYTES) {
    throw new BackupError("The backup file is empty or too large.");
  }
  let envelope;
  try { envelope = JSON.parse(source.toString("utf8")); } catch { throw new BackupError("The backup file is not valid JSON."); }
  if (!envelope || envelope.format !== FORMAT || envelope.version !== VERSION || envelope.encrypted !== true
    || envelope.kdf?.name !== "scrypt" || envelope.cipher?.name !== "aes-256-gcm") {
    throw new BackupError("This file is not a compatible encrypted Lintaya backup.", "UNSUPPORTED_BACKUP");
  }
  try {
    const key = await scrypt(password, Buffer.from(envelope.kdf.salt, "base64"), 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.cipher.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, "base64"));
    const cleartext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    return validateSnapshot(JSON.parse(cleartext.toString("utf8")));
  } catch (error) {
    if (error instanceof BackupError) throw error;
    // Wrong password and tampering must be indistinguishable to callers.
    throw new BackupError("The backup password is incorrect or the file was modified.", "BACKUP_DECRYPT_FAILED");
  }
}

function replaceDatabase(db, schema, source) {
  const restore = db.transaction((rowsByTable) => {
    for (const [table, columns] of Object.entries(schema)) {
      db.prepare(`DELETE FROM ${table}`).run();
      const placeholders = columns.map(() => "?").join(", ");
      const insert = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
      for (const row of rowsByTable[table]) insert.run(...columns.map(column => row[column]));
    }
  });
  restore(source);
}

function backupFilename(now = Date.now) {
  return `lintaya-before-import-${new Date(now()).toISOString().replace(/[:.]/g, "-")}.lhq`;
}

function createBackupService({ mainDb, reposDb, backupDir, now = Date.now, randomBytes = crypto.randomBytes, fsModule = fs }) {
  if (!mainDb || !reposDb) throw new TypeError("mainDb and reposDb are required");
  if (!backupDir) throw new TypeError("backupDir is required");

  return {
    async exportArchive(password) {
      return encryptSnapshot(readSnapshot(mainDb, reposDb, now), password, randomBytes);
    },
    async restoreArchive(archive, password) {
      const snapshot = await decryptArchive(archive, password);
      // A durable, encrypted recovery point is written only after the upload
      // validates and before either database changes.
      const recovery = await this.exportArchive(password);
      fsModule.mkdirSync(backupDir, { recursive: true });
      const filename = backupFilename(now);
      fsModule.writeFileSync(path.join(backupDir, filename), recovery, { flag: "wx" });

      replaceDatabase(reposDb, TABLES.repos, snapshot.databases.repos);
      replaceDatabase(mainDb, TABLES.main, snapshot.databases.main);
      return { createdAt: snapshot.createdAt, recoveryPoint: filename };
    },
    readSnapshot: () => readSnapshot(mainDb, reposDb, now),
  };
}

module.exports = {
  FORMAT,
  VERSION,
  MIN_PASSWORD_LENGTH,
  BackupError,
  createBackupService,
  decryptArchive,
  encryptSnapshot,
  validateSnapshot,
};
