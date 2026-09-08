// Generic "entity id → vault item id" association, used identically by
// connectors and (for the top-level GET + the non-device parts) by devices.
// devices.js registers its own GET/PUT under /api/devices/... because DELETE
// /api/devices/:id also needs to clean device-vault-map directly — this file
// covers the other consumer with the exact same shape (a plain { id: vaultItemId }
// map), so that logic isn't duplicated a second time.
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function registerVaultMapRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, entity, kvKey, label }) {
  // GET /api/<entity>/vault-map → { "<id>": "vault-item-id", ... }
  app.get(`/api/${entity}/vault-map`, requireAuth, (req, res) => {
    try {
      const map = kvGet(kvKey)?.value || {};
      if (!isPlainObject(map)) return sendAppError(res, AppError.internal(`${label} vault map is invalid`), req);
      return res.json(map);
    } catch (error) {
      return sendAppError(res, error instanceof AppError ? error : AppError.internal(`Unable to read ${label} vault map`, { cause: error }), req);
    }
  });

  // PUT /api/<entity>/:id/vault body: { vaultItemId }
  app.put(`/api/${entity}/:id/vault`, requireAuth, auditActivity({ provider: entity, action: `Vincular ${label} a vault` }), (req, res) => {
    const { id } = req.params;
    try {
      if (!id?.trim()) return sendAppError(res, AppError.badRequest(`${label} id is required.`), req);
      if (!isPlainObject(req.body)) return sendAppError(res, AppError.badRequest(`${label} vault link must be a JSON object.`), req);
      const { vaultItemId } = req.body;
      if (vaultItemId !== undefined && vaultItemId !== null && vaultItemId !== "" && (typeof vaultItemId !== "string" || !vaultItemId.trim())) {
        return sendAppError(res, AppError.unprocessable("vaultItemId must be a non-empty string."), req);
      }
      const map = kvGet(kvKey)?.value || {};
      if (!isPlainObject(map)) return sendAppError(res, AppError.internal(`${label} vault map is invalid`), req);
      const normalizedVaultItemId = typeof vaultItemId === "string" ? vaultItemId.trim() : "";
      if (normalizedVaultItemId) {
        map[id] = normalizedVaultItemId;
      } else {
        delete map[id];
      }
      kvSet(kvKey, map);
      res.locals.auditMessage = normalizedVaultItemId ? `Vincular ${label} "${id}" a un item del vault` : `Desvincular ${label} "${id}" del vault`;
      return res.json({ ok: true });
    } catch (error) {
      return sendAppError(res, error instanceof AppError ? error : AppError.internal(`Unable to update ${label} vault link`, { cause: error }), req);
    }
  });
}

module.exports = { isPlainObject, registerVaultMapRoutes };
