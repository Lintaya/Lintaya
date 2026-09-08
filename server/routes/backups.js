const express = require("express");
const { BackupError, MIN_PASSWORD_LENGTH } = require("../core/services/backup");

function exportFilename() {
  return `lintaya-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.lhq`;
}

// Logical encrypted backup/restore.  The passphrase is received only for the
// duration of the request and is never saved in SQLite, a log, or an audit
// entry.  The import body uses a dedicated media type so Express's JSON parser
// never attempts to interpret the encrypted payload.
function registerBackupRoutes({ app, requireAuth, auditActivity, backupService, vault, AppError, sendAppError }) {
  app.post("/api/backups/export", requireAuth, auditActivity({ provider: "backups", action: "Exportar backup cifrado" }), async (req, res) => {
    try {
      const archive = await backupService.exportArchive(req.body?.password);
      res.locals.auditMessage = "Exportó un backup cifrado";
      res.setHeader("Content-Type", "application/vnd.lintaya.backup+json");
      res.setHeader("Content-Disposition", `attachment; filename=\"${exportFilename()}\"`);
      res.send(archive);
    } catch (error) {
      const appError = error instanceof BackupError
        ? AppError.unprocessable(error.message, { code: error.code, details: { minPasswordLength: MIN_PASSWORD_LENGTH } })
        : AppError.internal("Unable to export backup.", { cause: error });
      sendAppError(res, appError, req);
    }
  });

  app.post(
    "/api/backups/import",
    requireAuth,
    express.raw({ type: ["application/vnd.lintaya.backup+json", "application/octet-stream"], limit: "50mb" }),
    auditActivity({ provider: "backups", action: "Restaurar backup cifrado" }),
    async (req, res) => {
      if (req.get("X-Lintaya-Backup-Confirm") !== "RESTORE") {
        return sendAppError(res, AppError.badRequest("Explicit restore confirmation is required.", { requiredHeader: "X-Lintaya-Backup-Confirm: RESTORE" }), req);
      }
      if (!Buffer.isBuffer(req.body)) {
        return sendAppError(res, AppError.badRequest("An encrypted backup file is required."), req);
      }
      try {
        const restored = await backupService.restoreArchive(req.body, req.get("X-Lintaya-Backup-Password"));
        // A restored DB must never inherit a live Bitwarden session from the
        // pre-restore process. The master password/session is not backed up.
        if (vault?.lockVaultSession) await vault.lockVaultSession();
        res.locals.auditMessage = "Restauró un backup cifrado";
        res.locals.auditMeta = { recoveryPoint: restored.recoveryPoint };
        res.json({ ok: true, ...restored, vaultLocked: true, restartRequired: true });
      } catch (error) {
        const appError = error instanceof BackupError
          ? AppError.unprocessable(error.message, { code: error.code })
          : AppError.internal("Unable to restore backup.", { cause: error });
        sendAppError(res, appError, req);
      }
    },
  );
}

module.exports = { registerBackupRoutes };
