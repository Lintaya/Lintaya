// Devices — CRUD for custom/user-created network devices, plus their vault
// credential association (device id → vault item id).
function registerDevicesRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError }) {
  // GET /api/devices/vault-map → { "dev-0": "vault-item-id", ... }
  app.get("/api/devices/vault-map", requireAuth, (req, res) => {
    res.json(kvGet("device-vault-map")?.value || {});
  });

  // PUT /api/devices/:id/vault body: { vaultItemId } → saves association
  app.put("/api/devices/:id/vault", requireAuth, auditActivity({ provider: "devices", action: "Vincular device a vault" }), (req, res) => {
    const { id } = req.params;
    const { vaultItemId } = req.body || {};
    const map = kvGet("device-vault-map")?.value || {};
    if (vaultItemId) {
      map[id] = vaultItemId;
    } else {
      delete map[id];
    }
    kvSet("device-vault-map", map);
    res.locals.auditMessage = vaultItemId ? `Vincular device "${id}" a un item del vault` : `Desvincular device "${id}" del vault`;
    res.json({ ok: true, map });
  });

  // GET /api/devices → array of saved devices
  app.get("/api/devices", requireAuth, (req, res) => {
    res.json(kvGet("custom-devices")?.value || []);
  });

  // POST /api/devices body: device object → creates and returns with id
  app.post("/api/devices", requireAuth, auditActivity({ provider: "devices", action: "Crear device" }), (req, res) => {
    const d = req.body || {};
    if (!d.name || !d.kind || !d.mgmtIp) {
      return sendAppError(res, AppError.badRequest("name, kind and mgmtIp are required"), req);
    }
    const devices = kvGet("custom-devices")?.value || [];
    const id = `dev-${Date.now()}`;
    const newDev = {
      id,
      name:     d.name,
      kind:     d.kind,
      vendor:   d.vendor   || "",
      model:    d.model    || "",
      os:       d.os       || "",
      site:     d.site     || "MEX",
      mgmtIp:   d.mgmtIp,
      sshUser:  d.sshUser  || "admin",
      sshPort:  Number(d.sshPort) || 22,
      enableMode: d.enableMode ?? (d.kind.startsWith("switch") || d.kind === "router"),
      location: d.location || "",
      serial:   d.serial   || "",
      firmware: d.os       || "",
      status:   d.status   || "online",
      favorite: false,
      tags:     Array.isArray(d.tags) ? d.tags : (d.tags ? String(d.tags).split(",").map(t=>t.trim()).filter(Boolean) : []),
      notes:    d.notes    || "",
      portsTotal: d.portsTotal || null,
      portsUsed:  d.portsUsed  || null,
      lastConfigBackup: null,
      createdAt: new Date().toISOString(),
    };
    devices.push(newDev);
    kvSet("custom-devices", devices);
    res.locals.auditMessage = `Crear device "${newDev.name}"`;
    res.json(newDev);
  });

  // PUT /api/devices/:id body: partial device → update existing
  app.put("/api/devices/:id", requireAuth, auditActivity({ provider: "devices", action: "Editar device" }), (req, res) => {
    const { id } = req.params;
    const devices = kvGet("custom-devices")?.value || [];
    const idx = devices.findIndex(d => d.id === id);
    if (idx === -1) return sendAppError(res, AppError.notFound("not found"), req);
    const updated = { ...devices[idx], ...req.body, id }; // id is immutable
    if (req.body.tags && !Array.isArray(req.body.tags)) {
      updated.tags = String(req.body.tags).split(",").map(t=>t.trim()).filter(Boolean);
    }
    devices[idx] = updated;
    kvSet("custom-devices", devices);
    res.locals.auditMessage = `Editar device "${updated.name}"`;
    res.json(updated);
  });

  // DELETE /api/devices/:id → removes device and its vault association
  app.delete("/api/devices/:id", requireAuth, auditActivity({ provider: "devices", action: "Borrar device" }), (req, res) => {
    const { id } = req.params;
    const devices = kvGet("custom-devices")?.value || [];
    const removed = devices.find(d => d.id === id);
    const next = devices.filter(d => d.id !== id);
    kvSet("custom-devices", next);
    res.locals.auditMessage = `Borrar device "${removed?.name || id}"`;
    // also clean vault map
    const map = kvGet("device-vault-map")?.value || {};
    delete map[id];
    kvSet("device-vault-map", map);
    res.json({ ok: true });
  });
}

module.exports = { registerDevicesRoutes };
