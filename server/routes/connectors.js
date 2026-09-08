// Generic connector management — CRUD for connector cards, extra instances of
// the 8 "simple" (instantiable) connector types, aggregated live status, the
// per-connector sync-interval override, the per-connection enabled/disabled
// flag, the per-connector AI context, and the per-connection git committer
// identity (server.js "connector-sync-intervals"
// note applies here too). This is
// deliberately separate from each connector's own business-logic routes
// (server/connectors/<tier>/<id>/routes.js) — those are already modularized;
// this file only covers the connector-agnostic management surface that used
// to live directly in server.js.
//
// Registered later than the other server/routes/*.js modules (see server.js)
// because it needs CONNECTOR_CONTEXT, which is only built once every
// connector package has been loaded.
const fs = require("node:fs");
const path = require("node:path");
const { createConnectorStore } = require("../core/services/connector-store");
// Same require pattern server/core/assistant-tools.js already uses to reach
// this repo's one shared tree-layout module from server-side code.
const ZoneTree = require("../../app/zone-tree.js");

function registerConnectorsRoutes({
  app, requireAuth, kvGet, kvSet, kvGetByPrefix, auditActivity,
  stmtConnList, stmtConnGet, stmtConnInsert, stmtConnUpdate, stmtConnDelete, parseConn,
  resolveConnectorType, getConnectorConfigSchema, getConnectorManifest, isSupportedHere, listConnectorCatalog,
  getConnectorInstances, addConnectorInstance, removeConnectorInstance,
  registerConnectorInstance, nextInstanceId,
  SIMPLE_CONNECTOR_SHAPE, getSyncIntervalOverrides, connectorContext,
  AppError, sendAppError,
}) {
  // ── Connectors CRUD (SQLite-backed registry) ─────────────────────────────
  function listEnrichedConnectors() {
    const catalog = listConnectorCatalog();
    const rows = stmtConnList.all().map(parseConn);
    const existingIds = new Set(rows.map((row) => row.id));
    // A package should be visible and configurable as soon as its manifest is
    // registered, even on installations whose SQLite seed predates it. The
    // synthetic card is intentionally not persisted: user-created cards still
    // use the CRUD API, while package identity stays owned by the manifest.
    const manifestCards = catalog
      .filter((connector) => !existingIds.has(connector.id))
      .map((connector) => ({
        id: connector.id,
        name: connector.displayName,
        kind: connector.displayName,
        icon: connector.displayName.slice(0, 2).toUpperCase(),
        color: "#2563eb",
        endpoint: "",
        auth: "",
        interval: "manual / on-demand",
        feeds: connector.capabilities,
        docs: "",
        sampleEndpoints: [],
        connectorTypeId: connector.id,
        manifestManaged: true,
        ...connector,
      }));
    // Merge live status + endpoint config so UI knows if configured
    const enabledMap = kvGet("connector-enabled")?.value || {};
    // Nombre puesto por el usuario, por conexión. Vive en kv y no en la fila
    // de connectors porque la mayoría de los tipos no tiene fila: se sintetiza
    // del manifiesto en cada listado (ver manifestCards arriba). Un override
    // aquí deja que la identidad del paquete siga siendo del manifiesto y que
    // la etiqueta siga siendo del usuario — mismo patrón que connector-enabled.
    const nameMap = kvGet("connector-names")?.value || {};
    const enriched = [...rows, ...manifestCards].map(c => {
      const cfg    = kvGet(`connector-config-${c.id}`)?.value || null;
      const status = kvGet(`connector-status-${c.id}`)?.value || null;
      const configured = c.id === "vcenter"  ? !!cfg?.host
                       : c.id === "bw"      ? !!cfg?.serverUrl
                       : c.id === "plane"   ? !!cfg?.apiKey
                       // No credentials to store — it drives whichever account
                       // is already signed into the local Outlook desktop app.
                       : c.id === "outlook-local" ? true
                       : !!cfg;
      // Use live endpoint if configured
      const liveEndpoint = c.id === "vcenter" ? (cfg?.host || c.endpoint)
                         : c.id === "bw"     ? (cfg?.serverUrl || c.endpoint)
                         : c.id === "plane"  ? (cfg?.baseUrl || c.endpoint)
                         : c.endpoint;
      // El tipo base (ej. "gitlab") de esta card — igual al propio id salvo que
      // sea una instancia extra ("gitlab3"). El frontend lo usa para saber qué
      // ícono/ConfigPanel/dispatcher de Test-Sync reutilizar sin adivinar por
      // el string del id (ver ADR-008/CONN-017).
      const type = resolveConnectorType(c.id);
      const manifest = getConnectorManifest(type);
      return {
        ...c,
        type,
        // Derived from the manifest, not stored per-row — every instance of a
        // type shares the same transport, so this can't drift out of sync the
        // way a copied-at-creation-time field (icon/feeds) could. Absent for
        // the 8 "simple" HTTP connectors, so "http" is the correct default.
        transport: manifest?.transport || "http",
        os: manifest?.os || null,
        requires: manifest?.requires || null,
        // Whether this machine can run it at all. A connector that names its
        // platforms and not this one is never mounted (connectors/loader.js),
        // so the card has to say that rather than let someone configure a
        // connection whose every call would 404.
        supportedHere: isSupportedHere(manifest || {}),
        // `c.config` only ever exists on the synthetic base card (manifestCards
        // spreads it in from listConnectorCatalog()'s schema-derived shape) —
        // the `connectors` SQL table has no config column at all (config lives
        // in its own connector-config-${id} KV entry), so every *extra*
        // instance of any instantiable type (a second GitLab connection, a
        // second Outlook-local account, …) always had `c.config` undefined
        // and silently lost its "Configure" button. Falling back to whether
        // the type has a schema at all fixes every instance, not just the
        // first one.
        configurable: Boolean(c.config) || Boolean(getConnectorConfigSchema(type)),
        configured,
        endpoint: liveEndpoint,
        liveStatus: status || null,
        modules: (manifest?.modules || []).map((module) => ({ ...module })),
        // Per-connection, defaults to true so existing installations (no KV
        // entry yet) don't need a backfill. Disabling only pulls a connection
        // out of the auto-sync scheduler (see runAutoSyncTarget in server.js)
        // — it stays visible here and Test/Sync still work manually.
        enabled: enabledMap[c.id] !== false,
        name: nameMap[c.id] || c.name,
      };
    });
    return enriched;
  }

  // Misma regla de estado efectivo que la UI de Connectors: un conector sin
  // registro de estado vivo cuenta como "offline" (Disconnected en la card).
  function effectiveConnectorStatus(connector) {
    return connector.liveStatus?.status || "offline";
  }

  // La instancia base de un conector no aporta su propia entrada al nav: se ve
  // a traves de la ruta core equivalente (Correo, Llamadas, Passwords, Repos
  // <proveedor>). Se declara aqui para que el shell pueda ocultar tambien esa
  // ruta core cuando el conector queda Disconnected, sin duplicar el mapeo en
  // el frontend. Las instancias extra ("gitlab3") si navegan por su `route`.
  function coreRouteForModule(connector, module) {
    if (connector.id !== connector.type) return null;
    return module.component === "ReposView" ? `repos-${connector.type}` : module.id;
  }

  function listConnectorModules() {
    return listEnrichedConnectors()
      .filter((connector) => connector.modules.length > 0)
      .flatMap((connector) => {
        const status = effectiveConnectorStatus(connector);
        // Un modulo solo es navegable si su conector esta configurado,
        // conectado y activo: un conector Disconnected no puede servir la
        // vista, y uno Deshabilitado se trata igual — el usuario lo apagó a
        // propósito (ej. "Llamadas" cuando Outlook está Inactivo) — asi que
        // el shell esconde el módulo del menu en vez de ofrecer uno muerto.
        const available = Boolean(connector.configured) && status !== "offline" && connector.enabled !== false;
        // The name on its own, not just folded into label: a view that wants
        // to title itself after the connection should not have to unpick the
        // module wording around it.
        const connectorName = connector.name || connector.displayName || connector.type;
        return connector.modules.map((module) => ({
          route: `module:${encodeURIComponent(connector.id)}:${module.id}`,
          connectorId: connector.id,
          connectorType: connector.type,
          connectorName,
          moduleId: module.id,
          label: module.label.replaceAll("{connectorName}", connectorName),
          icon: module.icon,
          component: module.component,
          navOrder: module.navOrder ?? 100,
          coreRoute: coreRouteForModule(connector, module),
          configured: Boolean(connector.configured),
          status,
          available,
        }));
      })
      .sort((left, right) => left.navOrder - right.navOrder || left.label.localeCompare(right.label));
  }

  // GET  /api/connectors  — list all with live status merged in
  app.get("/api/connectors", requireAuth, (req, res) => {
    const enriched = listEnrichedConnectors();
    res.json(enriched);
  });

  // GET /api/connectors/catalog — manifests plus safe config-field summaries
  // for the New connection picker.  It deliberately returns no stored config,
  // secret, implementation path, or filesystem location.
  app.get("/api/connectors/catalog", requireAuth, (req, res) => {
    res.json(listConnectorCatalog());
  });

  // GET /api/connectors/modules — connector-owned full views. A route is
  // instance-aware, so a second Git provider or Outlook account never collides
  // with the base connector's navigation entry. Devuelve tambien los modulos
  // no disponibles (`available: false`) con su `status`: el shell necesita
  // saber que existen para poder ocultar su ruta core, y la pagina de Modulos
  // los muestra deshabilitados en vez de hacerlos desaparecer sin explicacion.
  app.get("/api/connectors/modules", requireAuth, (req, res) => {
    res.json(listConnectorModules());
  });

  // GET /api/connectors/:id/config-schema — JSON Schema for the connector's own
  // config form (see connectors/sdk's config.schema.json convention). No secrets
  // live in the schema itself (fields are marked `x-lintaya-secret`, not filled
  // in), so this is safe to expose to any authenticated caller.
  app.get("/api/connectors/:id/config-schema", requireAuth, (req, res) => {
    const schema = getConnectorConfigSchema(resolveConnectorType(req.params.id));
    if (!schema) return sendAppError(res, AppError.notFound("no-config-schema"), req);
    res.json(schema);
  });

  // GET /api/connectors/:id/readme — raw markdown for the connector's own
  // README.md, read straight from its package folder (same directory as
  // manifest.json — see readConnectorConfigSchema's identical lookup for
  // config.schema.json). Lets "View README" in the detail panel show the
  // real developer docs instead of just the single external `docs` link.
  app.get("/api/connectors/:id/readme", requireAuth, (req, res) => {
    const manifest = getConnectorManifest(resolveConnectorType(req.params.id));
    if (!manifest) return sendAppError(res, AppError.notFound("unknown-connector-type"), req);
    const readmePath = path.join(path.dirname(manifest.manifestPath), "README.md");
    if (!fs.existsSync(readmePath)) return sendAppError(res, AppError.notFound("no-readme"), req);
    res.json({ content: fs.readFileSync(readmePath, "utf8") });
  });

  // POST /api/connectors — create
  app.post("/api/connectors", requireAuth, auditActivity({ provider: "connectors", action: "Crear conector" }), (req, res) => {
    const d = req.body || {};
    if (!d.name || !d.kind) return sendAppError(res, AppError.badRequest("name and kind are required"), req);
    const id = d.id || `conn-${Date.now()}`;
    stmtConnInsert.run(
      id, d.name, d.kind, d.icon || "", d.color || "#2563eb",
      d.endpoint || "", d.auth || "", d.interval || "manual",
      JSON.stringify(d.feeds || []), d.docs || "",
      JSON.stringify(d.sample_endpoints || []), Date.now(), resolveConnectorType(id)
    );
    res.locals.auditMessage = `Crear conector "${d.name}"`;
    res.json(parseConn(stmtConnGet.get(id)));
  });

  // PUT /api/connectors/:id — update
  app.put("/api/connectors/:id", requireAuth, auditActivity({ provider: "connectors", action: "Editar conector" }), (req, res) => {
    const { id } = req.params;
    const existing = stmtConnGet.get(id);
    if (!existing) return sendAppError(res, AppError.notFound("not found"), req);
    const d = req.body || {};
    stmtConnUpdate.run(
      d.name     ?? existing.name,
      d.kind     ?? existing.kind,
      d.icon     ?? existing.icon,
      d.color    ?? existing.color,
      d.endpoint ?? existing.endpoint,
      d.auth     ?? existing.auth,
      d.interval ?? existing.interval,
      d.feeds        ? JSON.stringify(d.feeds)            : existing.feeds,
      d.docs     ?? existing.docs,
      d.sample_endpoints ? JSON.stringify(d.sample_endpoints) : existing.sample_endpoints,
      id
    );
    res.json(parseConn(stmtConnGet.get(id)));
  });

  // A block id (in a Board tree or home-layout) belongs to `connectorId` if
  // it's the fixed/manifest shape "<connectorInstanceId>.<blockId>" (see
  // server/routes/home.js for how that's built), or a custom-block record
  // whose own `connectorId` field says so.
  function blockBelongsToConnector(blockId, connectorId, customBlocksById) {
    if (blockId === connectorId || blockId.startsWith(`${connectorId}.`)) return true;
    const custom = customBlocksById.get(blockId);
    return Boolean(custom && custom.connectorId === connectorId);
  }

  // Read-only: what would deleting `connectorId` affect? Shared by the
  // impact-preview route below and the real DELETE, so the warning shown to
  // the user is computed exactly the same way as what actually happens.
  function computeConnectorImpact(connectorId, { kvGet }) {
    const customBlocks = kvGet("custom-blocks")?.value || [];
    const customBlocksById = new Map(customBlocks.map(b => [b.id, b]));
    const belongsHere = (blockId) => blockBelongsToConnector(blockId, connectorId, customBlocksById);

    const blockRecordsToDelete = customBlocks.filter(b => b.connectorId === connectorId).length;

    const boards = kvGet("module-pages")?.value || [];
    const deletedBoardIds = new Set();
    const boardImpacts = [];
    for (const board of boards) {
      const allIds = ZoneTree.blockIds(board.tree);
      const matching = allIds.filter(belongsHere);
      if (!matching.length) continue;
      const willBeDeleted = matching.length === allIds.length;
      if (willBeDeleted) deletedBoardIds.add(board.id);
      boardImpacts.push({ id: board.id, title: board.title, blocksRemoved: matching.length, totalBlocks: allIds.length, willBeDeleted });
    }

    const dashboards = kvGet("dashboards")?.value || [];
    const dashboardImpacts = [];
    for (const dash of dashboards) {
      const boardIds = dash.boardIds || [];
      const boardsRemoved = boardIds.filter(bid => deletedBoardIds.has(bid)).length;
      if (!boardsRemoved) continue;
      dashboardImpacts.push({ id: dash.id, title: dash.title, boardsRemoved, totalBoards: boardIds.length, willBeDeleted: boardsRemoved === boardIds.length });
    }

    return { blockRecordsToDelete, boards: boardImpacts, dashboards: dashboardImpacts };
  }

  // Filters block ids off every leaf of a zone-tree. Mirrors zone-tree.js's
  // own compactNode() walk shape — that module only exposes exact
  // zone-key+index removal (pullBlock), not id-based filtering, so this
  // stays local to where it's actually needed instead of growing the shared
  // tree module's surface for one caller.
  function stripBlockIds(node, idsToRemove) {
    if (!node || typeof node !== "object") return node;
    if (node.t === "z") return { ...node, blocks: (node.blocks || []).filter(bid => !idsToRemove.has(bid)) };
    return { ...node, a: stripBlockIds(node.a, idsToRemove), b: stripBlockIds(node.b, idsToRemove) };
  }

  // GET /api/connectors/:id/impact — what would deleting this connector
  // affect? Powers the warning the "Delete connection" button shows before
  // the DELETE below actually runs.
  app.get("/api/connectors/:id/impact", requireAuth, (req, res) => {
    res.json(computeConnectorImpact(req.params.id, { kvGet }));
  });

  // DELETE /api/connectors/:id — remove, cascading to every Block/Board/
  // Dashboard that depended on it. The passive "unavailable" degradation
  // (custom-page-view.jsx, dashboard.jsx) is for a connector that silently
  // disappears; this route is the deliberate, active "remove it from
  // Lintaya for good" action, so it cleans up after itself instead of
  // leaving dangling references for that fallback to catch forever.
  app.delete("/api/connectors/:id", requireAuth, auditActivity({ provider: "connectors", action: "Borrar conector" }), (req, res) => {
    const { id } = req.params;
    const existing = stmtConnGet.get(id);
    const impact = computeConnectorImpact(id, { kvGet });

    const customBlocks = kvGet("custom-blocks")?.value || [];
    const customBlocksById = new Map(customBlocks.map(b => [b.id, b]));
    const belongsHere = (blockId) => blockBelongsToConnector(blockId, id, customBlocksById);

    if (impact.blockRecordsToDelete) {
      kvSet("custom-blocks", customBlocks.filter(b => b.connectorId !== id));
    }

    // Home's own block picker (left/right arrays) can hold either kind of
    // block id too — same cleanup custom-blocks.js's own DELETE route does
    // for a single block, just matched against every id this connector owns.
    const homeLayout = kvGet("home-layout")?.value || { left: [], right: [] };
    kvSet("home-layout", {
      left: (homeLayout.left || []).filter(bid => !belongsHere(bid)),
      right: (homeLayout.right || []).filter(bid => !belongsHere(bid)),
    });

    // Boards: strip this connector's blocks from every affected tree; a
    // board left with zero blocks is deleted outright instead of saved empty.
    if (impact.boards.length) {
      const boards = kvGet("module-pages")?.value || [];
      const deletedBoardIds = new Set(impact.boards.filter(b => b.willBeDeleted).map(b => b.id));
      const nextBoards = [];
      for (const board of boards) {
        if (deletedBoardIds.has(board.id)) continue;
        const affected = impact.boards.find(b => b.id === board.id);
        if (!affected) { nextBoards.push(board); continue; }
        const idsToRemove = new Set(ZoneTree.blockIds(board.tree).filter(belongsHere));
        nextBoards.push({ ...board, tree: ZoneTree.compactTree(stripBlockIds(board.tree, idsToRemove)) });
      }
      kvSet("module-pages", nextBoards);

      // Dashboards: drop deleted board ids from boardIds; an emptied
      // dashboard is deleted outright, same rule as an emptied board above.
      const dashboards = kvGet("dashboards")?.value || [];
      const nextDashboards = [];
      for (const dash of dashboards) {
        const originalIds = dash.boardIds || [];
        if (!originalIds.some(bid => deletedBoardIds.has(bid))) { nextDashboards.push(dash); continue; }
        const boardIds = originalIds.filter(bid => !deletedBoardIds.has(bid));
        if (!boardIds.length) continue; // fully emptied -> delete this dashboard
        nextDashboards.push({
          ...dash, boardIds,
          selectedBoardId: boardIds.includes(dash.selectedBoardId) ? dash.selectedBoardId : boardIds[0],
        });
      }
      kvSet("dashboards", nextDashboards);
    }

    // Resolve the connector's type — and clear its secret-store entry — before
    // the SQL row disappears: resolveConnectorType()/getSecretFields() need
    // that row (or the connector-instances KV map) to find the right
    // config.schema.json, so this must run first or a local/bitwarden secret
    // store entry would be silently orphaned (see ADR-010's cleanup-gap note).
    createConnectorStore({ id, kvGet, kvSet }).setConfig(null);
    stmtConnDelete.run(id);
    for (const prefix of ["connector-data-", "connector-status-", "connector-log-"]) {
      kvSet(`${prefix}${id}`, null);
    }
    res.locals.auditMessage = `Borrar conector "${existing?.name || id}"`;
    res.json({ ok: true, removed: impact });
  });

  // POST /api/connectors/:typeId/instances body:{label?} — crea una N-ésima
  // conexión del mismo tipo ("+ Add another connection" en Connectors). Solo
  // para conectores "instantiable" (los 8 tipos simples: gitlab, github,
  // bitbucket, outline, portainer, qportal, outlook, plane) — ver "Módulos —
  // concepto propuesto", ADR-008 y CONN-017 en el roadmap interno.
  app.post("/api/connectors/:typeId/instances", requireAuth, auditActivity({ provider: "connectors", action: "Agregar otra conexión" }), (req, res) => {
    const { typeId } = req.params;
    const manifest = getConnectorManifest(typeId);
    if (!manifest) return sendAppError(res, AppError.notFound("unknown-connector-type"), req);
    if (!manifest.instantiable) return sendAppError(res, AppError.badRequest("not-instantiable"), req);

    const label = String(req.body?.label || "").trim();
    const instanceId = nextInstanceId(typeId);
    const base = stmtConnGet.get(typeId);

    // `base` is only a real DB row for connector types that were persisted
    // before the manifest system existed — most types (including
    // outlook-local) are synthesized fresh from the manifest on every list
    // (see listEnrichedConnectors's manifestCards) and never get an actual
    // row, so `base` is undefined here and every `base?.x` falls through.
    // icon/feeds need their own manifest-derived fallback (matching that
    // same synthesis) instead of silently going blank/empty for the new
    // instance — that's what previously left an extra instance's card with
    // no icon initials and no capability tags.
    stmtConnInsert.run(
      instanceId,
      label || base?.name || manifest.displayName || typeId,
      base?.kind || manifest.displayName || typeId,
      base?.icon || manifest.displayName.slice(0, 2).toUpperCase(),
      base?.color || "#2563eb",
      "",
      base?.auth || "",
      base?.interval || "manual",
      base?.feeds || JSON.stringify(manifest.capabilities || []),
      base?.docs || "",
      JSON.stringify([]),
      Date.now(),
      typeId,
    );
    addConnectorInstance(typeId, instanceId);

    try {
      registerConnectorInstance({ typeId, instanceId, context: connectorContext });
    } catch (err) {
      // No dejar una card sin backend detrás si el montaje en caliente falla.
      removeConnectorInstance(typeId, instanceId);
      stmtConnDelete.run(instanceId);
      return sendAppError(res, AppError.internal("Unable to register connector instance", { cause: err }), req);
    }

    res.locals.auditMessage = `Agregar otra conexión de ${typeId}${label ? ` ("${label}")` : ""}`;
    res.json(parseConn(stmtConnGet.get(instanceId)));
  });

  // DELETE /api/connectors/:typeId/instances/:instanceId — quita una conexión
  // extra (no la base). No desmonta sus rutas de Express (no hay API para
  // eso) — deja de aparecer en Connectors/sidebar y de auto-sincronizarse, y su
  // config se limpia para que, si algo le pega directo, responda
  // connector-not-configured en vez de servir datos de una conexión borrada.
  app.delete("/api/connectors/:typeId/instances/:instanceId", requireAuth, auditActivity({ provider: "connectors", action: "Quitar conexión extra" }), (req, res) => {
    const { typeId, instanceId } = req.params;
    if (instanceId === typeId) return sendAppError(res, AppError.badRequest("cannot-remove-base-instance"), req);
    // Same ordering reason as the DELETE /api/connectors/:id handler above:
    // resolve type + clear secrets before the instance mapping disappears.
    createConnectorStore({ id: instanceId, kvGet, kvSet }).setConfig(null);
    removeConnectorInstance(typeId, instanceId);
    stmtConnDelete.run(instanceId);
    for (const prefix of ["connector-data-", "connector-status-", "connector-log-"]) {
      kvSet(`${prefix}${instanceId}`, null);
    }
    res.locals.auditMessage = `Quitar conexión extra "${instanceId}" (${typeId})`;
    res.json({ ok: true });
  });

  app.get("/api/connectors/status", requireAuth, (req, res) => {
    // Batch-fetch all connector KV data in a single SQL query
    const allConnectorData = kvGetByPrefix("connector-");
    const allVcenterData   = kvGetByPrefix("vcenter-data-");

    const result = {};

    // vCenter connectors
    const vcIds = ["vcenter"];
    for (const id of vcIds) {
      const cfg    = allConnectorData[`connector-config-${id}`] || null;
      const status = allConnectorData[`connector-status-${id}`] || null;
      const data   = allVcenterData[`vcenter-data-${id}`] || null;
      result[id] = {
        configured: !!cfg,
        host: cfg?.host || null,
        ...(status || {}),
        // Persistent activity log
        log: allConnectorData[`connector-log-${id}`] || [],
        // Real feed counts from latest sync
        feeds: data ? {
          vms:            data.vms?.length        ?? 0,
          hosts:          data.hosts?.length      ?? 0,
          clusters:       data.clusters?.length   ?? 0,
          datastores:     data.datastores?.length ?? 0,
          syncedAt:       data.syncedAt           || null,
          clusterDetails: (data.clusters || []).map(cl => ({
            id:          cl.cluster,
            name:        cl.name,
            drs_enabled: cl.drs_enabled ?? false,
            ha_enabled:  cl.ha_enabled  ?? false,
          })),
        } : null,
      };
    }

    // Bitwarden CLI connector
    const bwCfg    = allConnectorData["connector-config-bw"] || null;
    const bwStatus = allConnectorData["connector-status-bw"] || null;
    result["bw"] = { configured: !!bwCfg, ...(bwStatus || {}) };

    // Simple connectors (config/status/data/log pattern)
    for (const [typeId, shape] of Object.entries(SIMPLE_CONNECTOR_SHAPE)) {
      for (const id of [typeId, ...getConnectorInstances(typeId)]) {
        const cfg    = allConnectorData[`connector-config-${id}`] || null;
        const status = allConnectorData[`connector-status-${id}`] || null;
        const data   = allConnectorData[`connector-data-${id}`] || null;
        result[id] = {
          configured: shape.configured ? shape.configured(cfg) : !!cfg,
          ...shape.configFields(cfg),
          ...(status || {}),
          ...shape.dataFields(data, id),
          log: allConnectorData[`connector-log-${id}`] || [],
        };
      }
    }

    // UCS Manager connector
    const ucsmCfg    = allConnectorData["connector-config-ucsm"] || null;
    const ucsmStatus = allConnectorData["connector-status-ucsm"] || null;
    const ucsmData   = allConnectorData["connector-data-ucsm"] || null;
    result["ucsm"] = {
      configured: !!ucsmCfg,
      hosts:      ucsmCfg?.hosts || null,
      ...(ucsmStatus || {}),
      sites:      ucsmData?.sites || {},
      syncedAt:   ucsmData?.syncedAt || null,
      log:        allConnectorData["connector-log-ucsm"] || [],
    };

    // Anthropic connector
    const anCfg    = allConnectorData["connector-config-anthropic"] || null;
    const anStatus = allConnectorData["connector-status-anthropic"] || null;
    const anData   = allConnectorData["connector-data-anthropic"] || null;
    result["anthropic"] = {
      configured:    !!anCfg,
      metric:        anCfg?.metric || "cost",
      limits:        anCfg?.limits || {},
      ...(anStatus || {}),
      fiveHour:      anData?.fiveHour || null,
      weekly:        anData?.weekly || null,
      contextWindow: anData?.contextWindow || null,
      byModel:       anData?.byModel || [],
      byDay:         anData?.byDay || [],
      blocks:        anData?.blocks?.slice(0, 12) || [],
      source:        anData?.source || null,
      syncedAt:      anData?.syncedAt || null,
      log:           allConnectorData["connector-log-anthropic"] || [],
    };

    res.json(result);
  });

  // Cada conector puede fijar su propio intervalo (kv "connector-sync-intervals" =
  // { [id]: minutos }) en vez de heredar el del grupo fast/slow — se edita desde el
  // panel de detalle del conector (botón "⏱ Sync interval"), no solo desde vCenter.
  app.post("/api/connectors/:id/sync-interval", requireAuth, auditActivity({ provider: "connectors", action: "Cambiar intervalo de sync" }), (req, res) => {
    const { minutes } = req.body || {};
    const overrides = getSyncIntervalOverrides();
    if (minutes == null) {
      delete overrides[req.params.id];
    } else {
      const n = Math.min(1440, Math.max(1, Number(minutes) || 0));
      if (!n) return sendAppError(res, AppError.badRequest("invalid minutes"), req);
      overrides[req.params.id] = n;
    }
    kvSet("connector-sync-intervals", overrides);
    res.locals.auditMessage = minutes == null
      ? `Restaurar intervalo default de sync para "${req.params.id}"`
      : `Sync de "${req.params.id}" cada ${overrides[req.params.id]} min`;
    res.json({ ok: true, overrides });
  });

  // Enable/disable a single connection independently of every other instance
  // of the same type (kv "connector-enabled" = { [id]: false }, absent = the
  // default, enabled) — edited from the connector's detail panel. Disabling
  // only pulls it out of the auto-sync scheduler (server.js's
  // runAutoSyncTarget); the card, manual Test/Sync, and every other route
  // keep working exactly as before.
  app.post("/api/connectors/:id/enabled", requireAuth, auditActivity({ provider: "connectors", action: "Activar/desactivar conector" }), (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") return sendAppError(res, AppError.badRequest("enabled must be a boolean"), req);
    const map = kvGet("connector-enabled")?.value || {};
    if (enabled) delete map[req.params.id];
    else map[req.params.id] = false;
    kvSet("connector-enabled", map);
    res.locals.auditMessage = `Conector "${req.params.id}" ${enabled ? "activado" : "desactivado"}`;
    res.json({ ok: true, enabled });
  });

  // Etiqueta de la conexión. El nombre por defecto es el displayName del
  // manifiesto; esto guarda el que el usuario prefiera, para la conexión base
  // igual que para una extra — antes solo se podía nombrar una instancia
  // extra, y solo en el momento de crearla. Vaciarlo devuelve el default.
  app.post("/api/connectors/:id/name", requireAuth, auditActivity({ provider: "connectors", action: "Renombrar conexión" }), (req, res) => {
    const raw = req.body?.name;
    if (raw !== undefined && typeof raw !== "string") {
      return sendAppError(res, AppError.badRequest("name must be a string"), req);
    }
    const name = String(raw || "").trim().slice(0, 60);
    const map = kvGet("connector-names")?.value || {};
    if (name) map[req.params.id] = name;
    else delete map[req.params.id];
    kvSet("connector-names", map);
    res.locals.auditMessage = name
      ? `Renombrar "${req.params.id}" a "${name}"`
      : `Restaurar el nombre por defecto de "${req.params.id}"`;
    res.json({ ok: true, name });
  });

  // Contexto en Markdown por conector, para que un agente de IA (Claude Code u
  // otro) sepa cómo usar ese conector — reglas de negocio propias del usuario,
  // formato esperado al crear/editar datos, etc. Vive en kv "connector-ai-context"
  // = { [id]: markdown }, editable desde el panel de detalle del conector
  // (botón "🤖 AI context") — mismo patrón que "connector-sync-intervals" arriba.
  app.get("/api/connectors/:id/ai-context", requireAuth, (req, res) => {
    const all = kvGet("connector-ai-context")?.value || {};
    res.json({ content: all[req.params.id] || "" });
  });

  app.post("/api/connectors/:id/ai-context", requireAuth, auditActivity({ provider: "connectors", action: "Editar AI context" }), (req, res) => {
    const { content } = req.body || {};
    const all = kvGet("connector-ai-context")?.value || {};
    if (!content) {
      delete all[req.params.id];
    } else {
      all[req.params.id] = String(content);
    }
    kvSet("connector-ai-context", all);
    res.locals.auditMessage = `AI context de "${req.params.id}" actualizado`;
    res.json({ ok: true });
  });

  // Identidad de committer por conexión para los commits que Lintaya hace sobre
  // clones locales (Repos → stage/commit), en vez de la del git global de la
  // máquina — p. ej. la cuenta de trabajo para el GitLab de la empresa mientras
  // la máquina está configurada con la personal. Vive en kv
  // "connector-commit-identity" = { [id]: { name, email } }, mismo patrón que
  // "connector-ai-context" arriba, y se edita desde el panel de detalle.
  //
  // Deliberadamente NO vive dentro del AI context: ese es markdown libre y
  // advisory para agentes, mientras que la identidad la impone el servidor con
  // `-c user.name`/`-c user.email` para *cualquier* commit — hecho por el
  // usuario desde la UI o por un agente — y por eso necesita un campo
  // estructurado que un agente no pueda reescribir a conveniencia. La resuelve
  // server/routes/repos.js (commitIdentityArgs), que además acepta la env
  // GIT_COMMIT_IDENTITY como fallback para arranques headless/CI.
  function identityField(value) {
    const text = typeof value === "string" ? value.trim() : "";
    // Control characters would end up inside a `git -c user.x=…` argument.
    return text && !/\p{Cc}/u.test(text) ? text : "";
  }

  app.get("/api/connectors/:id/commit-identity", requireAuth, (req, res) => {
    const all = kvGet("connector-commit-identity")?.value || {};
    res.json({ identity: all[req.params.id] || null });
  });

  app.post("/api/connectors/:id/commit-identity", requireAuth, auditActivity({ provider: "connectors", action: "Editar identidad de commit" }), (req, res) => {
    const { name, email } = req.body || {};
    const all = kvGet("connector-commit-identity")?.value || {};
    const cleanName = identityField(name);
    const cleanEmail = identityField(email);
    if (!cleanName && !cleanEmail) {
      // Both blank = "use whatever git already resolves", stored as absence.
      delete all[req.params.id];
      kvSet("connector-commit-identity", all);
      res.locals.auditMessage = `Identidad de commit de "${req.params.id}" restaurada a la de git`;
      return res.json({ ok: true, identity: null });
    }
    if (!cleanName || !cleanEmail) {
      return sendAppError(res, AppError.badRequest("name and email are both required"), req);
    }
    all[req.params.id] = { name: cleanName, email: cleanEmail };
    kvSet("connector-commit-identity", all);
    res.locals.auditMessage = `Commits de "${req.params.id}" como ${cleanName} <${cleanEmail}>`;
    res.json({ ok: true, identity: all[req.params.id] });
  });

  // ── Export/import connection config — never secrets ─────────────────────
  // A connection's *public* config only (hosts, urls, usernames, flags — every
  // field the schema doesn't mark x-lintaya-secret/writeOnly). The UI scopes
  // this to Development/Enterprise connections (the ones with the most fiddly
  // config to retype — per-site VIPs, base URLs), but nothing here is
  // type-specific, so it works for any connectionId.
  function secretFieldsOf(connectorTypeId) {
    const schema = getConnectorConfigSchema(connectorTypeId);
    return new Set(
      Object.entries(schema?.properties || {})
        .filter(([, def]) => def["x-lintaya-secret"] || def.writeOnly)
        .map(([key]) => key),
    );
  }

  // A connection "exists" once it's either a type's own base id (always
  // valid once its manifest is registered, even with no SQLite row — see
  // listEnrichedConnectors's manifestCards above) or a registered extra
  // instance. Import only ever writes to a connection that already exists —
  // creating a brand-new instance also means a SQLite row and a live route
  // mount (see POST .../instances above), which import deliberately doesn't
  // attempt to replicate; the message below tells the user the one extra
  // step that does.
  function connectionExists(id) {
    if (getConnectorManifest(id)) return true;
    const all = kvGet("connector-instances")?.value || {};
    return Object.values(all).some((ids) => ids.includes(id));
  }

  function buildConnectionExport(id) {
    const connectorTypeId = resolveConnectorType(id);
    const manifest = getConnectorManifest(connectorTypeId);
    if (!manifest) return null;
    const secretFields = secretFieldsOf(connectorTypeId);
    const store = createConnectorStore({ id, kvGet, kvSet });
    const fullConfig = store.getConfig() || {};
    const config = Object.fromEntries(
      Object.entries(fullConfig).filter(([key]) => !secretFields.has(key)),
    );
    return { connectorTypeId, connectionId: id, displayName: manifest.displayName, config };
  }

  // GET /api/connectors/export?ids=vcenter,ucsm — downloadable JSON, public
  // config only, for the given connection ids.
  app.get("/api/connectors/export", requireAuth, (req, res) => {
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return sendAppError(res, AppError.badRequest("ids-required"), req);
    const connections = ids.map(buildConnectionExport).filter(Boolean);
    if (!connections.length) return sendAppError(res, AppError.badRequest("no-valid-connections"), req);
    res.json({ format: "lintaya-connections-export", version: 1, exportedAt: new Date().toISOString(), connections });
  });

  // POST /api/connectors/import  body:{connections:[{connectorTypeId,connectionId,config}]}
  // Per-entry result, not all-or-nothing — one bad entry (unknown type,
  // connection that doesn't exist yet) shouldn't block the rest of the file.
  app.post("/api/connectors/import", requireAuth, auditActivity({ provider: "connectors", action: "Importar conexiones" }), (req, res) => {
    const { connections } = req.body || {};
    if (!Array.isArray(connections) || !connections.length) {
      return sendAppError(res, AppError.badRequest("connections-required"), req);
    }
    const results = connections.map((entry) => {
      const connectionId = entry?.connectionId;
      if (!connectionId || !entry?.connectorTypeId || typeof entry.config !== "object" || !entry.config) {
        return { connectionId: connectionId || null, ok: false, error: "invalid-entry" };
      }
      if (!getConnectorManifest(entry.connectorTypeId)) {
        return { connectionId, ok: false, error: "unknown-connector-type" };
      }
      if (!connectionExists(connectionId)) {
        return { connectionId, ok: false, error: "connection-not-found — create it first (New connection, or Add another connection), then re-import" };
      }
      const actualType = resolveConnectorType(connectionId);
      if (actualType !== entry.connectorTypeId) {
        return { connectionId, ok: false, error: "connector-type-mismatch" };
      }
      // Merge onto the existing full config (never a blind replace): in
      // legacy secret-store mode, secrets live inline in this same config
      // blob, and setConfig() writes the object it's given wholesale — a
      // bare `setConfig(importedFields)` would silently wipe them, since
      // import never includes secret fields to begin with.
      const secretFields = secretFieldsOf(entry.connectorTypeId);
      const importedFields = Object.fromEntries(
        Object.entries(entry.config).filter(([key]) => !secretFields.has(key)),
      );
      const store = createConnectorStore({ id: connectionId, kvGet, kvSet });
      const existing = store.getConfig() || {};
      store.setConfig({ ...existing, ...importedFields });
      return { connectionId, ok: true };
    });
    const okCount = results.filter((r) => r.ok).length;
    res.locals.auditMessage = `Importar conexiones (${okCount}/${results.length} ok)`;
    res.json({ results });
  });
}

module.exports = { registerConnectorsRoutes };
