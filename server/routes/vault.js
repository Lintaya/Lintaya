// /api/vault/* — session unlock/lock, item CRUD (Bitwarden mode) and demo
// SQLite read (demo mode). Session state, the bw CLI runner and the
// Bitwarden↔app item mapping live in core/services/vault.js; this router only
// wires HTTP verbs, auth and RFC 9457 error shaping onto that service.
const { classifyVaultUnlockFailure } = require("../core/services/vault-errors");

const VAULT_LOCKED_MESSAGE = "Vault is locked — unlock it in the Passwords tab first, then retry.";

// Turn whatever the CLI failed with into the answer that names the actual
// cause, instead of blaming the password for every one of them.
function unlockFailure(error, AppError) {
  const { message, code, status } = classifyVaultUnlockFailure(error);
  return new AppError(message, { code, status });
}

function registerVaultRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, vault, AppError, sendAppError, log }) {
  function requireUnlockedVault(req, res, next) {
    if (!vault.vaultSession.unlocked) {
      return sendAppError(res, new AppError(VAULT_LOCKED_MESSAGE, { code: "VAULT_LOCKED", status: 401 }), req);
    }
    next();
  }

  app.get("/api/vault/status", requireAuth, (req, res) => {
    res.json({
      unlocked: vault.vaultSession.unlocked,
      mode: vault.VAULT_MODE,
    });
  });

  // Debug: show raw KV content for folders (no secrets exposed)
  app.get("/api/vault/debug/folders", requireAuth, (req, res) => {
    res.json({
      stored: kvGet("vault-folders")?.value || [],
      updatedAt: kvGet("vault-folders")?.updatedAt || null,
    });
  });

  app.get("/api/vault/items", requireAuth, (req, res) => {
    res.json(vault.getVaultMetadata());
  });

  app.post("/api/vault/unlock", requireAuth, auditActivity({ provider: "vault", action: "Desbloquear vault" }), async (req, res) => {
    const masterPassword = req.body && req.body.masterPassword;

    try {
      if (vault.VAULT_MODE === "bitwarden") {
        let session;
        try {
          session = await vault.bw(["unlock", masterPassword, "--raw"]);
        } catch (bwErr) {
          return sendAppError(res, unlockFailure(bwErr, AppError), req);
        }

        vault.markVaultUnlocked("bitwarden", session);

        // Await sync so items are ready the moment the client calls /api/vault/items
        try {
          await vault.syncBitwardenItems(session);
        } catch (syncErr) {
          log.warn("[vault] sync after unlock failed", { message: syncErr.message });
          // Don't fail the unlock itself — items may still load on next manual sync
        }

        return res.json({ ok: true, unlocked: true, mode: vault.VAULT_MODE });
      }

      if (!vault.VAULT_MASTER_PASSWORD) {
        return sendAppError(res, AppError.unavailable(
          "The server does not have a vault master password configured yet.",
          { code: "VAULT_MASTER_PASSWORD_NOT_CONFIGURED" }
        ), req);
      }

      if (masterPassword !== vault.VAULT_MASTER_PASSWORD) {
        return sendAppError(res, new AppError("The master password was rejected.", { code: "WRONG_MASTER_PASSWORD", status: 401 }), req);
      }

      vault.markVaultUnlocked("demo");
      return res.json({ ok: true, unlocked: true, mode: vault.VAULT_MODE });
    } catch (error) {
      return sendAppError(res, unlockFailure(error, AppError), req);
    }
  });

  app.get("/api/vault/folders", requireAuth, (req, res) => {
    res.json(kvGet("vault-folders")?.value || []);
  });

  app.post("/api/vault/create", requireAuth, auditActivity({ provider: "vault", action: "Crear item en vault" }), requireUnlockedVault, async (req, res) => {
    if (vault.VAULT_MODE !== "bitwarden") {
      return sendAppError(res, AppError.badRequest("Creating items is only available in Bitwarden mode."), req);
    }
    const { service, username, password, url, notes, folderId, tags } = req.body || {};
    if (!service) return sendAppError(res, AppError.badRequest("A service name is required."), req);

    try {
      const fields = [];
      if (Array.isArray(tags) && tags.length > 0) {
        fields.push({ name: "hq_tags", value: tags.join(","), type: 0 });
      }

      const item = {
        object: "item",
        type: 1,
        name: service,
        login: {
          username: username || "",
          password: password || "",
          uris: url ? [{ match: null, uri: url }] : [],
        },
        folderId: folderId || null,
        notes: notes || "",
        favorite: false,
        reprompt: 0,
        fields,
      };

      const encoded = Buffer.from(JSON.stringify(item)).toString("base64");
      const result = await vault.bw(["create", "item", encoded], vault.vaultSession.bwSession);
      const created = JSON.parse(result);

      // Re-sync so the new item appears in the list immediately
      await vault.syncBitwardenItems(vault.vaultSession.bwSession);
      vault.armVaultTimer();
      res.locals.auditMessage = `Crear item en vault: "${service}"`; // nunca el password
      res.json({ ok: true, id: created.id });
    } catch (err) {
      sendAppError(res, AppError.badGateway(err.message), req);
    }
  });

  app.put("/api/vault/edit/:id", requireAuth, auditActivity({ provider: "vault", action: "Editar item de vault" }), requireUnlockedVault, async (req, res) => {
    if (vault.VAULT_MODE !== "bitwarden") {
      return sendAppError(res, AppError.badRequest("Editing items is only available in Bitwarden mode."), req);
    }
    const { id } = req.params;
    const { service, username, password, url, notes, folderId, tags } = req.body || {};
    if (!service) return sendAppError(res, AppError.badRequest("A service name is required."), req);

    try {
      // Fetch existing item to preserve fields we don't touch
      const raw = await vault.bw(["get", "item", id], vault.vaultSession.bwSession);
      const existing = JSON.parse(raw);

      // Rebuild fields: keep non-hq fields, replace hq_tags
      const otherFields = (existing.fields || []).filter(f => f.name !== "hq_tags");
      const fields = [...otherFields];
      if (Array.isArray(tags) && tags.length > 0) {
        fields.push({ name: "hq_tags", value: tags.join(","), type: 0 });
      }

      const updated = {
        ...existing,
        name: service,
        login: {
          ...existing.login,
          username: username || "",
          password: password || existing.login?.password || "",
          uris: url ? [{ match: null, uri: url }] : (existing.login?.uris || []),
        },
        folderId: folderId || null,
        notes: notes || "",
        fields,
      };

      const encoded = Buffer.from(JSON.stringify(updated)).toString("base64");
      await vault.bw(["edit", "item", id, encoded], vault.vaultSession.bwSession);
      await vault.syncBitwardenItems(vault.vaultSession.bwSession);
      vault.armVaultTimer();
      res.locals.auditMessage = `Editar item de vault: "${service}"`; // nunca el password
      res.json({ ok: true });
    } catch (err) {
      sendAppError(res, AppError.badGateway(err.message), req);
    }
  });

  app.post("/api/vault/sync", requireAuth, auditActivity({ provider: "vault", action: "Sync vault" }), requireUnlockedVault, async (req, res) => {
    if (vault.VAULT_MODE !== "bitwarden") {
      return sendAppError(res, AppError.badRequest("Sync is only available in Bitwarden mode."), req);
    }
    try {
      const count = await vault.syncBitwardenItems(vault.vaultSession.bwSession);
      vault.armVaultTimer();
      res.locals.auditMessage = `Sync vault — ${count} items`;
      res.json({ ok: true, count });
    } catch (err) {
      sendAppError(res, AppError.badGateway(err.message), req);
    }
  });

  app.post("/api/vault/get", requireAuth, auditActivity({ provider: "vault", action: "Obtener password del vault" }), requireUnlockedVault, async (req, res) => {
    const itemId = req.body && req.body.itemId;
    if (!itemId) return sendAppError(res, AppError.badRequest("An item id is required."), req);

    try {
      let password;
      if (vault.VAULT_MODE === "bitwarden") {
        password = await vault.bw(["get", "password", itemId], vault.vaultSession.bwSession);
      } else {
        const row = vault.selectVaultSecret.get(String(itemId));
        if (!row) return sendAppError(res, AppError.notFound("That vault item was not found."), req);
        password = row.secret;
      }

      // Record access timestamp for "last used" tracking
      const localUsed = kvGet("vault-last-used")?.value || {};
      localUsed[itemId] = new Date().toISOString();
      kvSet("vault-last-used", localUsed);

      vault.armVaultTimer();
      res.locals.auditMessage = `Obtener password del vault (item ${itemId})`; // nunca el password en sí
      return res.json({ password });
    } catch (error) {
      return sendAppError(res, AppError.badGateway(error.message), req);
    }
  });

  app.post("/api/vault/lock", requireAuth, auditActivity({ provider: "vault", action: "Bloquear vault" }), async (req, res) => {
    await vault.lockVaultSession();
    res.json({ ok: true });
  });
}

module.exports = { registerVaultRoutes };
