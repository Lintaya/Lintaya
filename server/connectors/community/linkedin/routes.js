// Rutas del conector de LinkedIn.
//
// La configuración tiene dos tiempos, a diferencia de los conectores de token:
//   1. POST /config guarda la APLICACIÓN (Client ID, Client Secret) y el
//      titular que LinkedIn no devuelve.
//   2. /oauth/start + /oauth/callback autorizan la CUENTA. La contraseña se
//      escribe en la página de LinkedIn; aquí solo llega un código de un uso.
//
// Las publicaciones son custom blocks de kind "linkedin-post" (ver
// server/routes/custom-blocks.js); estas rutas solo exponen su estado y la
// acción de publicar, que pasa por el Action Registry.
const crypto = require("node:crypto");

const {
  createConnectorLogger,
  guardAsyncRoute,
  redactText,
  registerBlockRoute,
} = require("../../sdk");
const { buildAuthorizeUrl, exchangeCode, getUserInfo, SCOPES } = require("./client");
const { clearPost, findPostBlock, linkedinStore, postStatus, readPosts } = require("./publisher");

const STATE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function registerLinkedinRoutes(options) {
  const {
    app,
    requireAuth,
    kvGet,
    kvSet,
    connectorLog,
    executeAction,
    sendAppError,
    fetchImpl = fetch,
    now = Date.now,
    id = "linkedin",
  } = options || {};

  for (const [name, dependency] of Object.entries({ app, requireAuth, kvGet, kvSet, connectorLog })) {
    if (!dependency) throw new TypeError(`registerLinkedinRoutes requires ${name}`);
  }

  const store = linkedinStore({ id, kvGet, kvSet });
  const secrets = () => {
    const cfg = store.getConfig() || {};
    return [cfg.clientSecret, cfg.accessToken, cfg.refreshToken];
  };
  const log = createConnectorLogger({ id, write: connectorLog, getSecrets: secrets });
  const safe = (error) => redactText(error?.message || String(error), secrets());
  const STATE_KEY = `linkedin-oauth-states-${id}`;

  const fail = (res, req, status, code) => res.status(status).json({ error: code });

  // La lista de conectores solo muestra la tarjeta si el estado trae `status`
  // ("ok" | "warn" | "error"), igual que el resto de conectores. Sin él, la
  // conexión se leía como "offline" y la tarjeta quedaba oculta, sin ningún
  // sitio desde el que pulsar Conectar.
  const NOT_CONNECTED = "Falta autorizar la cuenta: pulsa «Conectar con LinkedIn».";
  const setLiveStatus = (status, fields = {}) => store.setStatus({
    status,
    lastTest: new Date(now()).toISOString(),
    lastError: null,
    ...fields,
  });

  // Lo único que se devuelve de la sesión es lo que la interfaz dibuja. Ni el
  // token ni el secreto salen nunca por aquí.
  const profileOf = (cfg) => {
    if (!cfg?.accessToken || !cfg?.authorUrn) {
      return { connected: false, authorUrn: null, name: null, picture: null, headline: cfg?.headline || null,
        expiresAt: null, expiresInDays: null, hasRefreshToken: false };
    }
    const expiresAt = cfg.expiresAt || null;
    const expiresInDays = expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now()) / DAY_MS)) : null;
    return {
      connected: !expiresAt || Date.parse(expiresAt) > now(),
      authorUrn: cfg.authorUrn,
      name: cfg.name || null,
      picture: cfg.picture || null,
      headline: cfg.headline || null,
      expiresAt,
      expiresInDays,
      hasRefreshToken: Boolean(cfg.refreshToken),
    };
  };

  app.get(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const cfg = store.getConfig();
    if (!cfg?.clientId) return res.json({ configured: false });
    return res.json({
      configured: true,
      clientId: cfg.clientId,
      headline: cfg.headline || "",
      hasSecret: Boolean(cfg.clientSecret),
      connected: profileOf(cfg).connected,
    });
  });

  app.post(`/api/connectors/${id}/config`, requireAuth, (req, res) => {
    const { clientId, clientSecret, headline } = req.body || {};
    const existing = store.getConfig() || {};
    const nextId = String(clientId || "").trim();
    // El secreto nunca vuelve al formulario, así que un guardado sin él
    // conserva el anterior en vez de borrarlo.
    const nextSecret = clientSecret ? String(clientSecret).trim() : existing.clientSecret;
    if (!nextId || !nextSecret) {
      log("err", "Config save failed: clientId and clientSecret are required");
      return fail(res, req, 400, "linkedin-credentials-required");
    }
    // Otra aplicación invalida la sesión: el token pertenece a la app anterior.
    const sameApp = existing.clientId === nextId;
    store.setConfig({
      ...(sameApp ? existing : {}),
      clientId: nextId,
      clientSecret: nextSecret,
      headline: headline ? String(headline).trim().slice(0, 220) : null,
    });
    if (!sameApp || !existing.authorUrn) setLiveStatus("warn", { lastError: NOT_CONNECTED });
    log("ok", "Config saved");
    return res.json({ ok: true });
  });

  // El test comprueba la SESIÓN, que es lo que puede fallar: la app guardada
  // no se puede validar contra LinkedIn sin pasar por el navegador.
  // Test y sync hacen lo mismo en este conector: no hay datos que traer de
  // LinkedIn (no existe API de lectura para un perfil personal), así que
  // "sincronizar" es volver a leer nombre y foto y contar lo publicado desde
  // Lintaya. Existe porque la tarjeta del conector muestra "Sync now" siempre.
  const refreshProfile = (label) => guardAsyncRoute(async (req, res) => {
    const cfg = store.getConfig();
    if (!cfg?.clientId) return fail(res, req, 400, "connector-not-configured");
    if (!cfg.accessToken) {
      setLiveStatus("warn", { lastError: NOT_CONNECTED });
      return fail(res, req, 400, "linkedin-not-connected");
    }
    const startedAt = now();
    try {
      const info = await getUserInfo(cfg.accessToken, fetchImpl);
      store.setConfig({ ...cfg, name: info.name, picture: info.picture });
      const published = Object.values(readPosts(store)).filter((r) => r?.phase === "published").length;
      setLiveStatus("ok", {
        user: info.name || null,
        itemsSynced: published,
        latency: `${Math.max(0, now() - startedAt)}ms`,
        // Leer el perfil ES la sincronizacion de este conector, asi que el
        // Test tambien la cuenta: no hay otros datos que traer.
        lastSync: new Date(now()).toISOString(),
      });
      log("ok", `${label} ok · ${info.name || info.sub}`);
      return res.json({ ok: true, name: info.name, published });
    } catch (error) {
      const code = error?.code || "linkedin-request-failed";
      setLiveStatus("error", {
        lastError: code === "linkedin-token-expired"
          ? "La autorización de LinkedIn caducó: pulsa «Volver a conectar»."
          : `LinkedIn no respondió como se esperaba (${code}).`,
      });
      log("err", `${label} failed: ${safe(error)}`);
      // Nunca 401: la interfaz trata cualquier 401 como sesión de Lintaya
      // caducada y cerraría la app.
      return fail(res, req, 400, code);
    }
  });

  app.post(`/api/connectors/${id}/test`, requireAuth, refreshProfile("Test"));
  app.post(`/api/connectors/${id}/sync`, requireAuth, refreshProfile("Sync"));

  app.get(`/api/connectors/${id}/profile`, requireAuth, (req, res) => {
    res.json(profileOf(store.getConfig()));
  });

  // ── OAuth ────────────────────────────────────────────────────────────────
  // La URL de retorno se arma con el mismo origen desde el que se abrió
  // Lintaya (localhost:3000 o :3001), y se guarda con el `state` para que el
  // intercambio use exactamente la misma: LinkedIn exige que coincidan.
  const redirectUriFor = (req) => `${req.protocol}://${req.get("host")}/api/connectors/${id}/oauth/callback`;

  const readStates = () => {
    const all = kvGet(STATE_KEY)?.value || {};
    const fresh = {};
    for (const [key, entry] of Object.entries(all)) {
      if (entry && Date.parse(entry.expiresAt) > now()) fresh[key] = entry;
    }
    return fresh;
  };

  app.get(`/api/connectors/${id}/oauth/start`, requireAuth, (req, res) => {
    const cfg = store.getConfig();
    if (!cfg?.clientId || !cfg?.clientSecret) return fail(res, req, 400, "linkedin-credentials-required");
    const state = crypto.randomBytes(32).toString("hex");
    const redirectUri = redirectUriFor(req);
    kvSet(STATE_KEY, { ...readStates(), [state]: { redirectUri, expiresAt: new Date(now() + STATE_TTL_MS).toISOString() } });
    log("ok", "OAuth started");
    res.json({ url: buildAuthorizeUrl({ clientId: cfg.clientId, redirectUri, state }) });
  });

  const closingPage = (ok, message) => `<!doctype html><meta charset="utf-8"><title>LinkedIn</title>
<body style="font-family:system-ui,sans-serif;padding:32px;color:#1f2937">
<h2 style="margin:0 0 8px">${ok ? "LinkedIn conectado" : "No se pudo conectar LinkedIn"}</h2>
<p style="margin:0;color:#6b7280">${message}</p>
<script>setTimeout(function(){ window.close(); }, ${ok ? 1500 : 6000});</script></body>`;

  // Sin requireAuth a propósito: esta URL la abre LinkedIn en una ventana que
  // no lleva el token de Lintaya. Lo que la protege es el `state`: aleatorio,
  // de un solo uso y con caducidad, guardado en el servidor al iniciar.
  app.get(`/api/connectors/${id}/oauth/callback`, guardAsyncRoute(async (req, res) => {
    const { code, state, error } = req.query || {};
    const states = readStates();
    const entry = state ? states[state] : null;
    if (state && states[state]) {
      delete states[state];
      kvSet(STATE_KEY, states);
    }
    res.type("html");
    if (!entry) {
      log("err", "OAuth callback rejected: unknown or expired state");
      return res.status(400).send(closingPage(false, "El enlace caducó o ya se usó. Vuelve a pulsar Conectar en Lintaya."));
    }
    if (error || !code) {
      log("warn", `OAuth cancelled: ${String(error || "no-code")}`);
      return res.status(400).send(closingPage(false, "La autorización se canceló en LinkedIn."));
    }
    const cfg = store.getConfig();
    const startedAt = now();
    try {
      const token = await exchangeCode({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, code: String(code), redirectUri: entry.redirectUri }, fetchImpl);
      const info = await getUserInfo(token.accessToken, fetchImpl);
      store.setConfig({
        ...cfg,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresIn ? new Date(now() + token.expiresIn * 1000).toISOString() : null,
        scopes: token.scopes.length ? token.scopes : SCOPES,
        sub: info.sub,
        authorUrn: `urn:li:person:${info.sub}`,
        name: info.name,
        picture: info.picture,
      });
      // Conectar ya leyo el perfil: cuenta como la primera sincronizacion, y
      // asi la tarjeta no queda con "Last sync —" recien conectada.
      setLiveStatus("ok", {
        user: info.name || null,
        itemsSynced: Object.values(readPosts(store)).filter((r) => r?.phase === "published").length,
        latency: `${Math.max(0, now() - startedAt)}ms`,
        lastSync: new Date(now()).toISOString(),
      });
      log("ok", `Connected as ${info.name || info.sub}`);
      return res.send(closingPage(true, "Ya puedes cerrar esta ventana y volver a Lintaya."));
    } catch (caught) {
      log("err", `OAuth exchange failed: ${safe(caught)}`);
      return res.status(400).send(closingPage(false, "LinkedIn rechazó la autorización. Revisa el Client ID, el Client Secret y la URL de retorno registrada."));
    }
  }));

  // ── Publicaciones ────────────────────────────────────────────────────────
  app.get(`/api/connectors/${id}/posts/:blockId`, requireAuth, (req, res) => {
    const block = findPostBlock(kvGet, req.params.blockId, id);
    if (!block) return fail(res, req, 404, "linkedin-block-not-found");
    res.json(postStatus(store, block, now));
  });

  // Delegar en la acción, nunca llamar al cliente desde aquí: así la
  // publicación queda auditada igual venga de la interfaz, del CLI o de un
  // agente (con su X-Actor).
  app.post(`/api/connectors/${id}/posts/:blockId/publish`, requireAuth, guardAsyncRoute(async (req, res) => {
    if (typeof executeAction !== "function") return fail(res, req, 503, "action-registry-unavailable");
    try {
      const result = await executeAction({
        connectionId: id,
        actionId: "publish-post",
        input: { blockId: req.params.blockId },
        actor: typeof req.get === "function" ? req.get("X-Actor") || undefined : undefined,
        requestId: req.id,
      });
      const block = findPostBlock(kvGet, req.params.blockId, id);
      return res.json(block ? postStatus(store, block, now) : result.result || result);
    } catch (error) {
      if (typeof sendAppError === "function") return sendAppError(res, error, req);
      throw error;
    }
  }));

  // Para un intento que quedó sin confirmar: solo el usuario puede comprobar en
  // su perfil si el post salió. Si dice que no, se libera el block para
  // volver a publicarlo; si salió, lo correcto es no tocar nada.
  app.post(`/api/connectors/${id}/posts/:blockId/dismiss-unconfirmed`, requireAuth, (req, res) => {
    const block = findPostBlock(kvGet, req.params.blockId, id);
    if (!block) return fail(res, req, 404, "linkedin-block-not-found");
    const status = postStatus(store, block, now);
    if (status.status !== "unconfirmed" && status.status !== "failed") return fail(res, req, 409, "linkedin-nothing-to-dismiss");
    clearPost(store, block.id);
    log("warn", `Unconfirmed attempt dismissed for block ${block.id}`);
    res.json(postStatus(store, block, now));
  });

  // El usuario borró el post directamente en LinkedIn. Lintaya no tiene forma
  // de comprobarlo (leer posts de un miembro exige r_member_social, un permiso
  // que LinkedIn tiene cerrado), así que solo él puede decirlo. Se olvida el
  // registro local y el block vuelve a borrador; no se llama a LinkedIn, porque
  // allí ya no hay nada que borrar. Borrar DESDE Lintaya es otra cosa: la acción
  // destructiva delete-post, que pasa por el Approval Center.
  app.post(`/api/connectors/${id}/posts/:blockId/forget-published`, requireAuth, (req, res) => {
    const block = findPostBlock(kvGet, req.params.blockId, id);
    if (!block) return fail(res, req, 404, "linkedin-block-not-found");
    const status = postStatus(store, block, now);
    if (status.status !== "published") return fail(res, req, 409, "linkedin-post-not-published");
    clearPost(store, block.id);
    log("warn", `Post ${status.postUrn} marked as deleted on LinkedIn; block ${block.id} is a draft again`);
    res.json(postStatus(store, block, now));
  });

  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "published",
    getBlock: (req) => {
      const posts = readPosts(store);
      const blocks = (kvGet("custom-blocks")?.value || []).filter((b) => b.kind === "linkedin-post" && b.connectorId === id);
      const items = blocks
        .map((block) => ({ block, record: posts[block.id] }))
        .filter(({ record }) => record?.phase === "published")
        .sort((a, b) => Date.parse(b.record.publishedAt) - Date.parse(a.record.publishedAt))
        .slice(0, Number(req?.query?.limit) || 30)
        .map(({ block, record }) => ({
          id: block.id,
          title: String(block.payload?.body || block.title || "").split(/\s+/).slice(0, 12).join(" "),
          subtitle: block.title || null,
          timestamp: record.publishedAt,
          url: record.postUrl,
        }));
      return {
        items,
        updatedAt: new Date(now()).toISOString(),
        emptyMessage: "Todavía no has publicado desde Lintaya. Aquí saldrá cada publicación, con su enlace a LinkedIn.",
      };
    },
  });

  // ── Blocks que salen de lo que Lintaya sabe ──────────────────────────────
  // LinkedIn no deja leer nada de un perfil personal (ni feed, ni posts, ni
  // métricas), así que estos tres blocks se arman con la sesión guardada, los
  // blocks "linkedin-post" y el registro de lo publicado. Son listas normales a
  // propósito: así sirven igual en Home, boards, el CLI y el MCP.
  const postBlocks = () => (kvGet("custom-blocks")?.value || [])
    .filter((b) => b.kind === "linkedin-post" && b.connectorId === id);
  const publishedRecords = () => Object.values(readPosts(store))
    .filter((r) => r?.phase === "published" && r.publishedAt);
  const daysSince = (iso) => Math.floor((now() - Date.parse(iso)) / DAY_MS);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const firstLine = (text) => {
    const line = String(text || "").split("\n").find((l) => l.trim()) || "";
    return line.length > 90 ? `${line.slice(0, 89)}…` : line;
  };

  // La cuenta conectada y, sobre todo, cuánto le queda a la autorización: sin
  // refresh token (lo normal) caduca a los 60 días y hay que reconectar a mano.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "account",
    getBlock: () => {
      const cfg = store.getConfig();
      if (!cfg?.clientId) return null;
      const profile = profileOf(cfg);
      if (!profile.authorUrn) {
        return {
          items: [{ id: "account", title: "Sin cuenta conectada", subtitle: NOT_CONNECTED, badge: { text: "Desconectado", color: "#dc2626" } }],
          updatedAt: new Date(now()).toISOString(),
        };
      }
      const days = profile.expiresInDays;
      const expiryColor = !profile.connected ? "#dc2626" : days != null && days <= 10 ? "#d97706" : "#16a34a";
      const items = [
        {
          id: "account",
          title: profile.name || "Cuenta de LinkedIn",
          subtitle: profile.headline || "Sin titular: añádelo en la configuración del conector para que la vista previa lo muestre",
          badge: profile.connected ? { text: "Conectado", color: "#16a34a" } : { text: "Caducado", color: "#dc2626" },
        },
        {
          id: "expiry",
          title: !profile.connected
            ? "La autorización caducó: vuelve a conectar"
            : days == null ? "Autorización sin fecha de caducidad" : `La autorización caduca en ${plural(days, "día", "días")}`,
          subtitle: profile.hasRefreshToken
            ? "Se renueva sola (la app tiene refresh token)"
            : "Sin renovación automática: reconecta desde el conector antes de que caduque",
          ...(profile.expiresAt ? { timestamp: profile.expiresAt } : {}),
          badge: { text: days == null ? "—" : `${days} d`, color: expiryColor },
        },
        {
          id: "published",
          title: `${plural(publishedRecords().length, "publicación", "publicaciones")} desde Lintaya`,
          subtitle: "Solo cuenta lo publicado desde aquí: LinkedIn no deja leer el resto",
        },
      ];
      return { items, updatedAt: new Date(now()).toISOString() };
    },
  });

  // Lo que queda por hacer: publicaciones sin publicar y, primero, las que
  // necesitan atención (un intento sin confirmar o un rechazo de LinkedIn).
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "pending",
    getBlock: (req) => {
      if (!store.getConfig()?.clientId) return null;
      const STATE = {
        unconfirmed: { order: 0, badge: { text: "Sin confirmar", color: "#dc2626" } },
        failed: { order: 1, badge: { text: "Falló", color: "#dc2626" } },
        publishing: { order: 2, badge: { text: "Publicando", color: "#d97706" } },
        unpublished: { order: 3, badge: { text: "Borrador", color: "#64748b" } },
      };
      const items = postBlocks()
        .map((block) => ({ block, state: postStatus(store, block, now).status }))
        .filter(({ state }) => state !== "published")
        .sort((a, b) => (STATE[a.state].order - STATE[b.state].order)
          || Date.parse(b.block.createdAt || 0) - Date.parse(a.block.createdAt || 0))
        .slice(0, Number(req?.query?.limit) || 30)
        .map(({ block, state }) => {
          const chars = [...String(block.payload?.body || "")].length;
          return {
            id: block.id,
            title: firstLine(block.payload?.body) || block.title,
            subtitle: `${block.title} · ${chars}/3000`,
            ...(block.createdAt ? { timestamp: block.createdAt } : {}),
            badge: STATE[state].badge,
          };
        });
      return {
        items,
        updatedAt: new Date(now()).toISOString(),
        emptyMessage: "Nada pendiente. Crea una publicación en Nuevo bloque → LinkedIn.",
      };
    },
  });

  // Ritmo de publicación. Solo cuenta lo publicado desde Lintaya, y lo dice:
  // un "0 esta semana" no significa que no hayas publicado desde la web.
  registerBlockRoute({
    app,
    requireAuth,
    id,
    blockId: "activity",
    getBlock: () => {
      if (!store.getConfig()?.clientId) return null;
      const published = publishedRecords()
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      const current = new Date(now());
      const monthStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1);
      const inLast = (days) => published.filter((r) => now() - Date.parse(r.publishedAt) <= days * DAY_MS).length;
      const thisMonth = published.filter((r) => Date.parse(r.publishedAt) >= monthStart).length;
      const pending = postBlocks().filter((block) => postStatus(store, block, now).status !== "published").length;
      const last = published[0];
      const idle = last ? daysSince(last.publishedAt) : null;

      const items = [
        {
          id: "last",
          title: last ? `Última publicación hace ${plural(idle, "día", "días")}` : "Todavía no has publicado desde Lintaya",
          subtitle: last ? "Ábrela en LinkedIn" : "Crea un bloque en Nuevo bloque → LinkedIn y publícalo desde su tarjeta",
          ...(last ? { timestamp: last.publishedAt, url: last.postUrl } : {}),
          ...(idle != null && idle > 14 ? { badge: { text: `${idle} d sin publicar`, color: "#d97706" } } : {}),
        },
        { id: "week", title: `${plural(inLast(7), "publicación", "publicaciones")} en los últimos 7 días` },
        { id: "month", title: `${plural(thisMonth, "publicación", "publicaciones")} este mes` },
        { id: "total", title: `${plural(published.length, "publicación", "publicaciones")} en total desde Lintaya` },
        {
          id: "pending",
          title: `${plural(pending, "borrador pendiente", "borradores pendientes")}`,
          ...(pending ? { badge: { text: String(pending), color: "#64748b" } } : {}),
        },
      ];
      return { items, updatedAt: new Date(now()).toISOString() };
    },
  });
}

module.exports = { registerLinkedinRoutes };
