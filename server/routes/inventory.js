// Cached base inventory used by the legacy Home/VM views. Live vCenter
// projections remain in live-vcenter.js; these endpoints only expose the
// already persisted snapshot, VM list, and host list without side effects.
function registerInventoryRoutes({ app, requireAuth, kvGet }) {
  app.get("/api/snapshot", requireAuth, (req, res) => {
    const cached = kvGet("snapshot");
    if (cached) return res.json(cached.value);
    return res.json({ message: "Sin datos todavia. Corre los workers para poblar." });
  });

  app.get("/api/vms", requireAuth, (req, res) => {
    return res.json(kvGet("vms")?.value || []);
  });

  app.get("/api/hosts", requireAuth, (req, res) => {
    return res.json(kvGet("hosts")?.value || []);
  });
}

module.exports = { registerInventoryRoutes };
