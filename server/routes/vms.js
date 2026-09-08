// VMs — VLAN map (built from router EVPN data) and vault credential
// association. Scoped to just these two small metadata endpoints; the live
// vCenter inventory belongs to routes/live-vcenter.js.
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPort(value) {
  const port = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function normalizeVlanMap(map, AppError) {
  if (!isPlainObject(map)) throw AppError.badRequest("VLAN map must be a JSON object.");

  const normalized = {};
  for (const [vmId, entry] of Object.entries(map)) {
    if (!vmId.trim()) throw AppError.unprocessable("A VLAN map entry has an empty VM id.");
    const legacyVlanId = typeof entry === "number" ? entry : entry?.vlanId;
    if (!isPlainObject(entry) && typeof entry !== "number") {
      throw AppError.unprocessable(`VLAN map entry "${vmId}" must be an object.`);
    }
    if (!Number.isInteger(legacyVlanId) || legacyVlanId < 1 || legacyVlanId > 4094) {
      throw AppError.unprocessable(`VLAN map entry "${vmId}" must have a vlanId between 1 and 4094.`);
    }
    if (entry?.vlanName !== undefined && (typeof entry.vlanName !== "string" || !entry.vlanName.trim())) {
      throw AppError.unprocessable(`VLAN map entry "${vmId}" has an invalid vlanName.`);
    }
    if (entry?.evi !== undefined && !Number.isInteger(entry.evi)) {
      throw AppError.unprocessable(`VLAN map entry "${vmId}" has an invalid evi.`);
    }
    // Numeric maps were accepted by the previous endpoint. Keep accepting
    // them, but persist the canonical object consumed by /api/vms-live.
    normalized[vmId] = typeof entry === "number" ? { vlanId: entry } : entry;
  }
  return normalized;
}

function parseJump(jump, AppError) {
  if (jump === null) return null;
  if (!isPlainObject(jump) || typeof jump.host !== "string" || !jump.host.trim()) {
    throw AppError.unprocessable("jump must include a non-empty host.");
  }
  let host = jump.host.trim();
  let user = jump.user ?? null;
  let port = jump.port === undefined || jump.port === null || jump.port === "" ? null : validPort(jump.port);
  if (jump.port !== undefined && jump.port !== null && jump.port !== "" && !port) {
    throw AppError.unprocessable("jump.port must be an integer between 1 and 65535.");
  }
  if (user !== null && (typeof user !== "string" || !user.trim())) {
    throw AppError.unprocessable("jump.user must be a non-empty string when provided.");
  }
  const at = host.indexOf("@");
  if (at >= 0) {
    if (!user) user = host.slice(0, at) || null;
    host = host.slice(at + 1);
  }
  const colon = host.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(host.slice(colon + 1))) {
    const pastedPort = validPort(host.slice(colon + 1));
    if (!pastedPort) throw AppError.unprocessable("The jump host port must be between 1 and 65535.");
    if (!port) port = pastedPort;
    host = host.slice(0, colon);
  }
  if (!host.trim()) throw AppError.unprocessable("jump must include a non-empty host.");
  if (jump.vaultItemId !== undefined && jump.vaultItemId !== null && typeof jump.vaultItemId !== "string") {
    throw AppError.unprocessable("jump.vaultItemId must be a string when provided.");
  }
  return { host, port: port || 22, user: user || null, vaultItemId: jump.vaultItemId || null };
}

function registerVmsRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError }) {
  app.get("/api/vms/vlan-map", requireAuth, (req, res) => {
    res.json(kvGet("vm-vlan-map")?.value || {});
  });

  // PUT /api/vms/vlan-map — replace entire map (used by import/update tools)
  app.put("/api/vms/vlan-map", requireAuth, auditActivity({ provider: "vms", action: "Reemplazar VLAN map" }), (req, res) => {
    try {
      const map = normalizeVlanMap(req.body, AppError);
      kvSet("vm-vlan-map", map);
      res.locals.auditMessage = `Reemplazar VLAN map — ${Object.keys(map).length} entradas`;
      return res.json({ ok: true, count: Object.keys(map).length });
    } catch (error) {
      return sendAppError(res, error instanceof AppError ? error : AppError.internal("Unable to save VLAN map", { cause: error }), req);
    }
  });

  app.get("/api/vms/vault-map", requireAuth, (req, res) => {
    const map = kvGet("vm-vault-map")?.value || {};
    res.json(map);
  });

  app.put("/api/vms/:id/vault", requireAuth, auditActivity({ provider: "vms", action: "Vincular VM a vault" }), (req, res) => {
    const { id } = req.params;
    try {
      if (!id?.trim()) return sendAppError(res, AppError.badRequest("VM id is required."), req);
      if (!isPlainObject(req.body)) return sendAppError(res, AppError.badRequest("VM vault link must be a JSON object."), req);
      const { vaultItemId, sshUser, sshPort, jump } = req.body;
      const map = kvGet("vm-vault-map")?.value || {};
      if (!isPlainObject(map)) return sendAppError(res, AppError.internal("VM vault map is invalid"), req);
      const hasVaultItem = typeof vaultItemId === "string" && vaultItemId.trim();
      if (vaultItemId !== undefined && vaultItemId !== null && vaultItemId !== "" && !hasVaultItem) {
        return sendAppError(res, AppError.unprocessable("vaultItemId must be a non-empty string."), req);
      }
      if (hasVaultItem) {
        if (sshUser !== undefined && sshUser !== null && typeof sshUser !== "string") {
          return sendAppError(res, AppError.unprocessable("sshUser must be a string when provided."), req);
        }
        if (sshPort !== undefined && sshPort !== null && sshPort !== "" && !validPort(sshPort)) {
          return sendAppError(res, AppError.unprocessable("sshPort must be an integer between 1 and 65535."), req);
        }
        // Preserve existing sshUser / sshPort / jump if not provided in this request.
        const existing = isPlainObject(map[id]) ? map[id] : {};
        const jumpVal = jump === undefined ? (existing.jump || null) : parseJump(jump, AppError);
        map[id] = {
          vaultItemId: vaultItemId.trim(),
          sshUser: sshUser !== undefined ? (sshUser?.trim() || null) : (existing.sshUser || null),
          sshPort: sshPort !== undefined ? (sshPort === null || sshPort === "" ? null : validPort(sshPort)) : (existing.sshPort || null),
          jump: jumpVal,
        };
      } else {
        delete map[id];
      }
      kvSet("vm-vault-map", map);
      res.locals.auditMessage = hasVaultItem ? `Vincular VM "${id}" a un item del vault` : `Desvincular VM "${id}" del vault`;
      return res.json({ ok: true, map });
    } catch (error) {
      return sendAppError(res, error instanceof AppError ? error : AppError.internal("Unable to update VM vault link", { cause: error }), req);
    }
  });
}

module.exports = { registerVmsRoutes, normalizeVlanMap, parseJump, validPort };
