const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerBackupRoutes } = require("./backups");
const { request } = require("./test-http-harness");

function setup(service = {}) {
  const calls = [];
  const app = createApp({ token: "test-token" });
  registerBackupRoutes({
    app, requireAuth, AppError, sendAppError,
    auditActivity: () => (req, res, next) => next(),
    vault: { async lockVaultSession() { calls.push("lock"); } },
    backupService: {
      async exportArchive(password) { calls.push(["export", password]); return Buffer.from('{"encrypted":true}'); },
      async restoreArchive(archive, password) { calls.push(["restore", archive.toString(), password]); return { createdAt: "2026-08-21T00:00:00.000Z", recoveryPoint: "recovery.lhq" }; },
      ...service,
    },
  });
  return { app, calls, headers: { authorization: "Bearer test-token" } };
}

test("export returns an encrypted attachment and never places its password in the response", async () => {
  const { app, calls, headers } = setup();
  const res = await request(app, "POST", "/api/backups/export", { headers, body: { password: "a strong password" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/vnd.lintaya.backup+json");
  assert.match(res.headers["content-disposition"], /attachment/);
  assert.equal(res.text, '{"encrypted":true}');
  assert.deepEqual(calls, [["export", "a strong password"]]);
});

test("import requires explicit confirmation", async () => {
  const { app, calls, headers } = setup();
  const res = await request(app, "POST", "/api/backups/import", { headers, body: Buffer.from("archive") });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
  assert.deepEqual(calls, []);
});

test("import restores archive, locks Vault, and declares restart required", async () => {
  const { app, calls, headers } = setup();
  const res = await request(app, "POST", "/api/backups/import", {
    headers: { ...headers, "x-lintaya-backup-confirm": "RESTORE", "x-lintaya-backup-password": "a strong password" },
    body: Buffer.from("archive"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { ok: true, createdAt: "2026-08-21T00:00:00.000Z", recoveryPoint: "recovery.lhq", vaultLocked: true, restartRequired: true });
  assert.deepEqual(calls, [["restore", "archive", "a strong password"], "lock"]);
});
