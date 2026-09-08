const {
  buildOutlineUrl,
  normalizeDocumentDetail,
  outlineRequest,
  syncOutline,
} = require("./client");
const {
  connectorKeys,
  createConnectorLogger,
  createConnectorStore,
  guardAsyncRoute,
  redactText,
  registerBlockRoute,
} = require("../../sdk");

const {
  config: CONFIG_KEY,
  data: DATA_KEY,
  status: STATUS_KEY,
} = connectorKeys("outline");

function registerOutlineRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    request = outlineRequest,
    sync = syncOutline,
    now = Date.now,
    isoNow = () => new Date().toISOString(),
    executeAction,
    sendAppError,
    // Segunda+ conexión Outline reutilizando este módulo bajo otro id — ver
    // server/connectors/loader.js (manifest "instantiable") y ADR-008/CONN-017.
    id = "outline",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerOutlineRoutes requires ${name}`);
  }

  const store = createConnectorStore({ id, kvGet, kvSet });
  const log = createConnectorLogger({
    id,
    write: connectorLog,
    getSecrets: () => [store.getConfig()?.apiKey],
  });
  const safeError = (error, cfg) => redactText(error?.message || String(error), [cfg?.apiKey]);

  app.get(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.json({ configured: false });
    return res.json({ configured: true, baseUrl: cfg.baseUrl, hasKey: Boolean(cfg.apiKey) });
  });

  app.post(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const { baseUrl, apiKey } = req.body || {};
    if (!baseUrl || !String(baseUrl).trim() || !apiKey || !String(apiKey).trim()) {
      log("err", "Config save failed: baseUrl and apiKey are required");
      return res.status(400).json({ error: "baseUrl and apiKey are required" });
    }
    const normalizedBaseUrl = String(baseUrl).trim().replace(/\/+$/, "");
    try {
      buildOutlineUrl(normalizedBaseUrl, "/api/auth.info");
    } catch {
      log("err", "Config save failed: baseUrl must be a valid HTTP(S) URL");
      return res.status(400).json({ error: "baseUrl must be a valid HTTP(S) URL" });
    }
    store.setConfig({
      baseUrl: normalizedBaseUrl,
      apiKey: String(apiKey).trim(),
    });
    log("ok", "Config saved");
    return res.json({ ok: true });
  });

  app.get(`/api/connectors/${id}/documents/:id`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    try {
      const response = await request(
        cfg.baseUrl,
        cfg.apiKey,
        "/api/documents.info",
        { id: req.params.id },
      );
      if (!response?.data) return res.status(404).json({ error: "document-not-found" });
      return res.json(normalizeDocumentDetail(response.data));
    } catch (error) {
      return res.status(502).json({ error: safeError(error, cfg) });
    }
  }));

  app.post(`/api/connectors/${id}/documents`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const { collectionId, title, text, parentDocumentId } = req.body || {};
    if (!collectionId || !title) {
      return res.status(400).json({ error: "collectionId-and-title-required" });
    }
    try {
      const body = { collectionId, title, text: text || "", publish: true };
      if (parentDocumentId) body.parentDocumentId = parentDocumentId;
      const response = await request(cfg.baseUrl, cfg.apiKey, "/api/documents.create", body);
      const document = response?.data;
      log("ok", `Documento creado · ${document?.title || title}`);
      return res.json({
        ok: true,
        id: document?.id,
        title: document?.title,
        url: document?.url,
      });
    } catch (error) {
      const message = safeError(error, cfg);
      log("err", `Create FAIL · ${message}`);
      return res.status(502).json({ error: message });
    }
  }));

  app.patch(`/api/connectors/${id}/documents/:id`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const { text, title } = req.body || {};
    if (text === undefined && title === undefined) {
      return res.status(400).json({ error: "no-fields" });
    }
    try {
      const body = { id: req.params.id };
      if (text !== undefined) body.text = text;
      if (title !== undefined) body.title = title;
      const response = await request(cfg.baseUrl, cfg.apiKey, "/api/documents.update", body);
      const document = response?.data;
      log("ok", `Documento actualizado · ${document?.title || req.params.id}`);
      return res.json({
        ok: true,
        id: document?.id,
        title: document?.title,
        updatedAt: document?.updatedAt,
      });
    } catch (error) {
      const message = safeError(error, cfg);
      log("err", `Update FAIL · ${message}`);
      return res.status(502).json({ error: message });
    }
  }));

  app.post(`/api/connectors/${id}/test`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ ok: false, error: "connector-not-configured" });
    const startedAt = now();
    try {
      const response = await request(cfg.baseUrl, cfg.apiKey, "/api/auth.info");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const user = response?.data?.user?.name || null;
      const team = response?.data?.team?.name || null;
      store.setStatus({
        status: "ok",
        latency,
        lastTest: isoNow(),
        lastError: null,
        user,
        team,
      });
      log("ok", `Test OK · usuario "${user}" · equipo "${team}" · ${latency}`);
      return res.json({ ok: true, latency, user, team });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = [401, 403].includes(error.status)
        ? "API key inválida — revisa el token en Outline → Settings → API"
        : safeError(error, cfg);
      store.setStatus({ status: "error", latency, lastTest: isoNow(), lastError: message });
      log("err", `Test FAIL · ${message}`);
      return res.status(502).json({ ok: false, error: message, latency });
    }
  }));

  app.post(`/api/connectors/${id}/documents/:id/delete`, requireAuth, guardAsyncRoute(async (req, res) => {
    // Compatibility route for existing UI/API clients. Never call Outline
    // directly here: the canonical Action Registry owns validation, audit and
    // SEC-003's approval gate, so this route cannot become a bypass.
    if (!store.getConfig()) return res.status(400).json({ error: "connector-not-configured" });
    if (typeof executeAction !== "function") {
      return res.status(503).json({ error: "approval-center-unavailable" });
    }
    try {
      const result = await executeAction({
        connectionId: id,
        actionId: "delete-document",
        input: { id: req.params.id },
        actor: typeof req.get === "function" ? req.get("X-Actor") || undefined : undefined,
        requestId: req.id,
      });
      return res.status(result.pending ? 202 : 200).json(result);
    } catch (error) {
      if (typeof sendAppError === "function") return sendAppError(res, error, req);
      throw error;
    }
  }));

  app.post(`/api/connectors/${id}/sync`, requireAuth, guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg) return res.status(400).json({ error: "connector-not-configured" });
    const startedAt = now();
    try {
      const { collections, documents } = await sync(cfg, { request });
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();
      const total = collections.length + documents.length;
      store.setData({ collections, documents, syncedAt });
      store.setStatus({
        status: "ok",
        latency,
        lastSync: syncedAt,
        lastError: null,
        itemsSynced: total,
      });
      log(
        "ok",
        `Sync OK · ${collections.length} colecciones, ${documents.length} documentos · ${latency}`,
      );
      return res.json({
        ok: true,
        latency,
        syncedAt,
        collectionCount: collections.length,
        documentCount: documents.length,
        total,
        collections,
        documents: documents.slice(0, 30),
      });
    } catch (error) {
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const message = safeError(error, cfg);
      store.setStatus({ status: "error", latency, lastSync: isoNow(), lastError: message });
      log("err", `Sync FAIL · ${message}`);
      return res.status(502).json({ error: message });
    }
  }));

  // Home block "recent-docs" (declared in manifest.json): the synced documents
  // newest-first, with absolute URLs so the dashboard needs no baseUrl of its own.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "recent-docs",
    getBlock: (req) => {
      const cfg = store.getConfig();
      if (!cfg) return null;
      const data = store.getData();
      const { scope, limit } = req?.query || {};
      let documents = [...(data?.documents || [])]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      if (scope) documents = documents.filter(d => d.collectionId === scope);
      documents = documents.slice(0, Number(limit) || 30);
      return {
        items: documents.map(doc => ({
          id: doc.id,
          title: doc.title || "Sin título",
          subtitle: doc.updatedBy || null,
          timestamp: doc.updatedAt,
          url: doc.url ? `${cfg.baseUrl}${doc.url}` : null,
        })),
        updatedAt: data?.syncedAt || null,
      };
    },
  });
}

module.exports = {
  CONFIG_KEY,
  DATA_KEY,
  STATUS_KEY,
  registerOutlineRoutes,
};
