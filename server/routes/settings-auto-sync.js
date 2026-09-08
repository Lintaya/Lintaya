const DEFAULT_AUTO_SYNC_CONFIG = Object.freeze({ enabled: false, fastMinutes: 5, slowMinutes: 20 });

function normalizeAutoSyncConfig(value = {}) {
  return {
    enabled: !!value.enabled,
    fastMinutes: Math.min(180, Math.max(1, Number(value.fastMinutes) || DEFAULT_AUTO_SYNC_CONFIG.fastMinutes)),
    slowMinutes: Math.min(360, Math.max(1, Number(value.slowMinutes) || DEFAULT_AUTO_SYNC_CONFIG.slowMinutes)),
  };
}

function readAutoSyncConfig(kvGet) {
  return { ...DEFAULT_AUTO_SYNC_CONFIG, ...(kvGet("auto-sync-config")?.value || {}) };
}

function registerSettingsAutoSyncRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, getTargets, getOverrides, effectiveSyncInterval }) {
  app.get("/api/settings/auto-sync", requireAuth, (req, res) => {
    const config = readAutoSyncConfig(kvGet);
    const state = kvGet("auto-sync-state")?.value || {};
    const overrides = getOverrides();
    return res.json({
      ...config,
      lastRun: state,
      overrides,
      targets: getTargets().map(target => ({
        ...target,
        effectiveMinutes: effectiveSyncInterval(target, config),
      })),
    });
  });

  app.post("/api/settings/auto-sync", requireAuth, auditActivity({ provider: "settings", action: "Cambiar config de auto-sync" }), (req, res) => {
    const config = normalizeAutoSyncConfig(req.body || {});
    kvSet("auto-sync-config", config);
    res.locals.auditMessage = `Auto-sync ${config.enabled ? "activado" : "desactivado"} (fast=${config.fastMinutes}min, slow=${config.slowMinutes}min)`;
    return res.json({ ok: true, ...config });
  });
}

module.exports = {
  DEFAULT_AUTO_SYNC_CONFIG,
  normalizeAutoSyncConfig,
  readAutoSyncConfig,
  registerSettingsAutoSyncRoutes,
};
