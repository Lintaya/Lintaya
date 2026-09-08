const { randomUUID } = require("node:crypto");
const { applyWorkspaceImport, buildWorkspacePackage, previewWorkspaceImport } = require("../core/workspace-package");

function registerWorkspacePackageRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, resolveConnectorType, connectionAlias, connectionCandidates = () => [], AppError, sendAppError }) {
  app.post("/api/workspace-packages/export", requireAuth, (req, res) => {
    const dashboardIds = Array.isArray(req.body?.dashboardIds) ? req.body.dashboardIds : [];
    const boardIds = Array.isArray(req.body?.boardIds) ? req.body.boardIds : [];
    if (!dashboardIds.length && !boardIds.length) {
      return sendAppError(res, AppError.badRequest("dashboardIds-or-boardIds-required"), req);
    }
    if ([...dashboardIds, ...boardIds].some(id => typeof id !== "string" || !id.trim())) {
      return sendAppError(res, AppError.badRequest("resource-ids-must-be-non-empty-strings"), req);
    }
    try {
      const packageValue = buildWorkspacePackage({
        dashboardIds, boardIds,
        dashboards: kvGet("dashboards")?.value || [],
        boards: kvGet("module-pages")?.value || [],
        customBlocks: kvGet("custom-blocks")?.value || [],
        resolveConnectorType,
        connectionAlias,
      });
      const { blocks, requirements, boards, dashboards } = packageValue.resources;
      res.json({
        summary: {
          dashboards: dashboards.length, boards: boards.length,
          customBlocks: blocks.length, connectorRequirements: requirements.length,
          containsAuthoredContent: blocks.length > 0,
          authoredBlockTitles: blocks.map(block => block.title),
          excluded: ["secrets", "provider caches", "synced records", "local ids"],
        },
        package: packageValue,
      });
    } catch (error) {
      const message = String(error?.message || "export-failed");
      const notFound = message === "dashboard-not-found" || message === "board-not-found";
      return sendAppError(res, notFound ? AppError.notFound(message) : AppError.badRequest(message), req);
    }
  });

  app.post("/api/workspace-packages/import/preview", requireAuth, (req, res) => {
    const packageValue = req.body?.package;
    if (!packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) {
      return sendAppError(res, AppError.badRequest("package-required"), req);
    }
    const preview = previewWorkspaceImport(packageValue, {
      existingBlocks: kvGet("custom-blocks")?.value || [],
      existingBoards: kvGet("module-pages")?.value || [],
      existingDashboards: kvGet("dashboards")?.value || [],
      connectionCandidates,
    });
    if (!preview.valid) return sendAppError(res, AppError.badRequest("invalid-workspace-package", { errors: preview.errors }), req);
    res.json(preview);
  });

  app.post("/api/workspace-packages/import", requireAuth, auditActivity({ provider: "dashboards", action: "Importar workspace" }), (req, res) => {
    const packageValue = req.body?.package;
    if (!packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) {
      return sendAppError(res, AppError.badRequest("package-required"), req);
    }
    const existingBlocks = kvGet("custom-blocks")?.value || [];
    const existingBoards = kvGet("module-pages")?.value || [];
    const existingDashboards = kvGet("dashboards")?.value || [];
    try {
      const imported = applyWorkspaceImport(packageValue, {
        names: req.body?.names || {}, resourceActions: req.body?.resourceActions || {}, connectionMappings: req.body?.connectionMappings || {},
        existingBlocks, existingBoards, existingDashboards, connectionCandidates,
        newId: randomUUID,
      });
      kvSet("custom-blocks", imported.next.blocks);
      kvSet("module-pages", imported.next.boards);
      kvSet("dashboards", imported.next.dashboards);
      const total = imported.results.blocks.length + imported.results.boards.length + imported.results.dashboards.length;
      const sourceFile = String(req.body?.sourceFile || "").trim().slice(0, 200) || null;
      res.locals.auditMessage = `Importar workspace: ${imported.results.dashboards.map(item => item.title).join(", ") || "sin Dashboard"} (${total} recursos)`;
      res.locals.auditMeta = {
        ...(sourceFile ? { sourceFile } : {}),
        imported: imported.results,
        counts: {
          blocks: imported.results.blocks.length,
          boards: imported.results.boards.length,
          dashboards: imported.results.dashboards.length,
        },
      };
      res.json({ ok: true, results: imported.results });
    } catch (error) {
      return sendAppError(res, AppError.badRequest(String(error?.message || "import-failed")), req);
    }
  });
}

module.exports = { registerWorkspacePackageRoutes };
