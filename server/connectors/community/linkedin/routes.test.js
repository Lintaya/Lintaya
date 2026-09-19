const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../../../app");
const { sendAppError } = require("../../../core/errors");
const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { request } = require("../../../routes/test-http-harness");
const { registerLinkedinActions } = require("./actions");
const { registerLinkedinRoutes } = require("./routes");

const NOW = Date.parse("2026-09-17T12:00:00Z");
const AUTH = { authorization: "Bearer test-token", host: "localhost:3000" };

function fakeResponse({ status = 200, json = null, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => (json == null ? "" : JSON.stringify(json)),
  };
}

// LinkedIn falso: token, identidad y creación de posts.
function fakeLinkedIn() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/oauth/v2/accessToken")) return fakeResponse({ json: { access_token: "fresh-token", expires_in: 5184000, scope: "openid,profile,w_member_social" } });
    if (String(url).endsWith("/v2/userinfo")) return fakeResponse({ json: { sub: "abc123", name: "Ada Lovelace", picture: "https://media.example.test/ada.jpg" } });
    if (String(url).endsWith("/rest/posts")) return fakeResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:42" } });
    return fakeResponse({ status: 404 });
  };
  return { calls, fetchImpl };
}

function setup({ seed = {} } = {}) {
  const rows = new Map(Object.entries(seed));
  const kvGet = (key) => (rows.has(key) ? { value: rows.get(key) } : null);
  const kvSet = (key, value) => rows.set(key, value);
  const linkedin = fakeLinkedIn();
  const registry = createActionRegistry();
  registerLinkedinActions({ registry, fetchImpl: linkedin.fetchImpl, now: () => NOW });
  const executeAction = createActionExecutor({
    registry, kvGet, kvSet, connectorLog: () => {}, resolveConnectorType: () => "linkedin",
  });
  const app = createApp({ token: "test-token" });
  registerLinkedinRoutes({
    app, requireAuth, kvGet, kvSet, connectorLog: () => {}, executeAction, sendAppError,
    fetchImpl: linkedin.fetchImpl, now: () => NOW,
  });
  return { app, rows, linkedin };
}

const APP_ONLY = { clientId: "cid", clientSecret: "app-secret-value" };
const CONNECTED = {
  ...APP_ONLY, accessToken: "access-token-value", authorUrn: "urn:li:person:abc123",
  name: "Ada Lovelace", expiresAt: new Date(NOW + 20 * 86400000).toISOString(),
};

test("GET /config and /profile never return the client secret or the access token", async () => {
  const { app } = setup({ seed: { "connector-config-linkedin": CONNECTED } });
  const config = await request(app, "GET", "/api/connectors/linkedin/config", { headers: AUTH });
  assert.equal(config.status, 200);
  assert.equal(config.json().configured, true);
  assert.equal(config.json().hasSecret, true);
  const profile = await request(app, "GET", "/api/connectors/linkedin/profile", { headers: AUTH });
  assert.equal(profile.json().connected, true);
  assert.equal(profile.json().expiresInDays, 20);
  for (const text of [config.text, profile.text]) {
    assert.equal(text.includes("app-secret-value"), false);
    assert.equal(text.includes("access-token-value"), false);
  }
});

test("saving without a secret keeps the stored one; switching app drops the old session", async () => {
  const { app, rows } = setup({ seed: { "connector-config-linkedin": CONNECTED } });
  await request(app, "POST", "/api/connectors/linkedin/config", { headers: AUTH, body: { clientId: "cid", headline: "Ingeniera" } });
  let cfg = rows.get("connector-config-linkedin");
  assert.equal(cfg.clientSecret, "app-secret-value");
  assert.equal(cfg.accessToken, "access-token-value", "same app keeps the session");
  assert.equal(cfg.headline, "Ingeniera");

  await request(app, "POST", "/api/connectors/linkedin/config", { headers: AUTH, body: { clientId: "other-app", clientSecret: "s2" } });
  cfg = rows.get("connector-config-linkedin");
  assert.equal(cfg.accessToken, undefined, "a token belongs to the app that issued it");

  const missing = await request(app, "POST", "/api/connectors/linkedin/config", { headers: AUTH, body: {} });
  assert.equal(missing.status, 400);
});

test("OAuth: start issues a single-use state and the callback needs no Lintaya token", async () => {
  const { app, rows, linkedin } = setup({ seed: { "connector-config-linkedin": APP_ONLY } });
  const start = await request(app, "GET", "/api/connectors/linkedin/oauth/start", { headers: AUTH });
  const url = new URL(start.json().url);
  const state = url.searchParams.get("state");
  assert.equal(state.length, 64);
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/connectors/linkedin/oauth/callback");

  // Sin cabecera Authorization: así llega la ventana que abre LinkedIn.
  const callback = await request(app, "GET", `/api/connectors/linkedin/oauth/callback?code=the-code&state=${state}`, { headers: { host: "localhost:3000" } });
  assert.equal(callback.status, 200);
  assert.match(callback.text, /LinkedIn conectado/);

  const exchange = linkedin.calls.find((c) => c.url.endsWith("/oauth/v2/accessToken"));
  assert.match(exchange.init.body, /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fconnectors%2Flinkedin%2Foauth%2Fcallback/);
  const cfg = rows.get("connector-config-linkedin");
  assert.equal(cfg.authorUrn, "urn:li:person:abc123");
  assert.equal(cfg.accessToken, "fresh-token");
  assert.equal(cfg.refreshToken, null);

  // El mismo state no sirve dos veces.
  const replay = await request(app, "GET", `/api/connectors/linkedin/oauth/callback?code=again&state=${state}`, { headers: { host: "localhost:3000" } });
  assert.equal(replay.status, 400);
});

test("OAuth callback with an unknown state is rejected without calling LinkedIn", async () => {
  const { app, linkedin } = setup({ seed: { "connector-config-linkedin": APP_ONLY } });
  const res = await request(app, "GET", "/api/connectors/linkedin/oauth/callback?code=x&state=forged", { headers: { host: "localhost:3000" } });
  assert.equal(res.status, 400);
  assert.equal(linkedin.calls.length, 0);
});

test("an expired LinkedIn session is reported as 400, never 401 — a 401 would log the user out of Lintaya", async () => {
  const { app } = setup({ seed: { "connector-config-linkedin": APP_ONLY } });
  const res = await request(app, "POST", "/api/connectors/linkedin/test", { headers: AUTH });
  assert.equal(res.status, 400);
  assert.equal(res.json().error, "linkedin-not-connected");
});

test("publishing goes through the action, and the block's status and the published list reflect it", async () => {
  const block = { id: "custom-1", kind: "linkedin-post", connectorId: "linkedin", title: "Anuncio", payload: { body: "Nueva versión de Lintaya", link: null, linkAsFirstComment: false } };
  const { app, linkedin } = setup({ seed: { "connector-config-linkedin": CONNECTED, "custom-blocks": [block] } });

  const before = await request(app, "GET", "/api/connectors/linkedin/posts/custom-1", { headers: AUTH });
  assert.equal(before.json().status, "unpublished");

  const published = await request(app, "POST", "/api/connectors/linkedin/posts/custom-1/publish", { headers: AUTH });
  assert.equal(published.status, 200);
  assert.equal(published.json().status, "published");
  assert.equal(published.json().postUrl, "https://www.linkedin.com/feed/update/urn:li:share:42");
  assert.equal(linkedin.calls.filter((c) => c.url.endsWith("/rest/posts")).length, 1);

  const list = await request(app, "GET", "/api/connectors/linkedin/blocks/published", { headers: AUTH });
  assert.equal(list.json().items.length, 1);
  assert.equal(list.json().items[0].url, "https://www.linkedin.com/feed/update/urn:li:share:42");
});

test("an unconfirmed attempt can only be released by the user, and only then publishes again", async () => {
  const block = { id: "custom-1", kind: "linkedin-post", connectorId: "linkedin", title: "Anuncio", payload: { body: "Hola", link: null, linkAsFirstComment: false } };
  const { app } = setup({ seed: {
    "connector-config-linkedin": CONNECTED,
    "custom-blocks": [block],
    "connector-data-linkedin": { posts: { "custom-1": { phase: "publishing", contentHash: "h", startedAt: new Date(0).toISOString() } } },
  } });
  const status = await request(app, "GET", "/api/connectors/linkedin/posts/custom-1", { headers: AUTH });
  assert.equal(status.json().status, "unconfirmed");

  const blocked = await request(app, "POST", "/api/connectors/linkedin/posts/custom-1/publish", { headers: AUTH });
  assert.equal(blocked.status, 409);

  const released = await request(app, "POST", "/api/connectors/linkedin/posts/custom-1/dismiss-unconfirmed", { headers: AUTH });
  assert.equal(released.json().status, "unpublished");
});

test("saving the app leaves a visible 'warn' status until the account is authorized, then 'ok'", async () => {
  const { app, rows } = setup();
  await request(app, "POST", "/api/connectors/linkedin/config", { headers: AUTH, body: { clientId: "cid", clientSecret: "sec" } });
  // Sin `status` la lista de conectores trata la conexión como offline y la oculta.
  assert.equal(rows.get("connector-status-linkedin").status, "warn");

  const start = await request(app, "GET", "/api/connectors/linkedin/oauth/start", { headers: AUTH });
  const state = new URL(start.json().url).searchParams.get("state");
  await request(app, "GET", `/api/connectors/linkedin/oauth/callback?code=c&state=${state}`, { headers: { host: "localhost:3000" } });
  const status = rows.get("connector-status-linkedin");
  assert.equal(status.status, "ok");
  assert.equal(status.user, "Ada Lovelace");
  // Lo que pinta la tarjeta: sin esto salia "Last sync —" e "Items —".
  assert.equal(status.lastSync, new Date(NOW).toISOString());
  assert.equal(status.itemsSynced, 0);
  assert.match(status.latency, /^\d+ms$/);
  assert.equal(JSON.stringify(status).includes("fresh-token"), false);
});

const DAY = 86400000;
function post(id, body, createdAt) {
  return { id, kind: "linkedin-post", connectorId: "linkedin", title: `Post ${id}`, createdAt, payload: { body, link: null, linkAsFirstComment: false } };
}

test("account block: who is connected, days left on the authorization, and what was published", async () => {
  const { app } = setup({ seed: {
    "connector-config-linkedin": { ...CONNECTED, expiresAt: new Date(NOW + 8 * DAY).toISOString() },
    "connector-data-linkedin": { posts: { a: { phase: "published", publishedAt: new Date(NOW - DAY).toISOString(), postUrl: "u" } } },
  } });
  const res = await request(app, "GET", "/api/connectors/linkedin/blocks/account", { headers: AUTH });
  const [account, expiry, count] = res.json().items;
  assert.equal(account.title, "Ada Lovelace");
  assert.equal(account.badge.text, "Conectado");
  assert.equal(expiry.badge.text, "8 d");
  assert.equal(expiry.badge.color, "#d97706", "10 days or fewer is a warning");
  assert.match(count.title, /^1 publicación/);
  assert.equal(res.text.includes("access-token-value"), false);
});

test("account block says plainly when no account is connected yet", async () => {
  const { app } = setup({ seed: { "connector-config-linkedin": APP_ONLY } });
  const res = await request(app, "GET", "/api/connectors/linkedin/blocks/account", { headers: AUTH });
  assert.equal(res.json().items[0].badge.text, "Desconectado");
});

test("pending block: unpublished posts, with the ones that need attention first", async () => {
  const { app } = setup({ seed: {
    "connector-config-linkedin": CONNECTED,
    "custom-blocks": [
      post("draft-old", "Borrador viejo", "2026-09-01T00:00:00Z"),
      post("draft-new", "Primera línea\nsegunda", "2026-09-10T00:00:00Z"),
      post("stuck", "Se cortó", "2026-08-01T00:00:00Z"),
      post("done", "Ya salió", "2026-09-05T00:00:00Z"),
    ],
    "connector-data-linkedin": { posts: {
      stuck: { phase: "publishing", startedAt: new Date(0).toISOString() },
      done: { phase: "published", contentHash: "x", publishedAt: "2026-09-06T00:00:00Z" },
    } },
  } });
  const items = (await request(app, "GET", "/api/connectors/linkedin/blocks/pending", { headers: AUTH })).json().items;
  assert.deepEqual(items.map(i => i.id), ["stuck", "draft-new", "draft-old"]);
  assert.equal(items[0].badge.text, "Sin confirmar");
  assert.equal(items[1].title, "Primera línea");
  assert.equal(items[1].subtitle, "Post draft-new · 21/3000");
});

test("activity block: counts only what went out from Lintaya, and flags a long silence", async () => {
  const { app } = setup({ seed: {
    "connector-config-linkedin": CONNECTED,
    "custom-blocks": [post("draft", "pendiente", "2026-09-10T00:00:00Z")],
    "connector-data-linkedin": { posts: {
      a: { phase: "published", publishedAt: new Date(NOW - 20 * DAY).toISOString(), postUrl: "https://www.linkedin.com/feed/update/urn:li:share:1" },
      b: { phase: "published", publishedAt: new Date(NOW - 40 * DAY).toISOString(), postUrl: "https://www.linkedin.com/feed/update/urn:li:share:2" },
    } },
  } });
  const items = (await request(app, "GET", "/api/connectors/linkedin/blocks/activity", { headers: AUTH })).json().items;
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  assert.equal(byId.last.title, "Última publicación hace 20 días");
  assert.equal(byId.last.badge.text, "20 d sin publicar");
  assert.equal(byId.last.url, "https://www.linkedin.com/feed/update/urn:li:share:1");
  assert.match(byId.week.title, /^0 publicaciones/);
  assert.match(byId.total.title, /^2 publicaciones/);
  assert.equal(byId.pending.title, "1 borrador pendiente");
});

test("activity block with nothing published explains how to start", async () => {
  const { app } = setup({ seed: { "connector-config-linkedin": CONNECTED } });
  const items = (await request(app, "GET", "/api/connectors/linkedin/blocks/activity", { headers: AUTH })).json().items;
  assert.equal(items[0].title, "Todavía no has publicado desde Lintaya");
});

test("a second LinkedIn connection has its own routes, callback URL, OAuth state and posts", async () => {
  const rows = new Map(Object.entries({
    "connector-config-linkedin": CONNECTED,
    "connector-config-linkedin2": { clientId: "page-app", clientSecret: "page-secret" },
    "custom-blocks": [
      { id: "mine", kind: "linkedin-post", connectorId: "linkedin", title: "Perfil", payload: { body: "Desde mi perfil", link: null, linkAsFirstComment: false } },
      { id: "page", kind: "linkedin-post", connectorId: "linkedin2", title: "Página", payload: { body: "Desde la página", link: null, linkAsFirstComment: false } },
    ],
  }));
  const kvGet = (key) => (rows.has(key) ? { value: rows.get(key) } : null);
  const kvSet = (key, value) => rows.set(key, value);
  const linkedin = fakeLinkedIn();
  const registry = createActionRegistry();
  registerLinkedinActions({ registry, fetchImpl: linkedin.fetchImpl, now: () => NOW });
  const executeAction = createActionExecutor({ registry, kvGet, kvSet, connectorLog: () => {}, resolveConnectorType: (id) => (id.startsWith("linkedin") ? "linkedin" : id) });
  const app = createApp({ token: "test-token" });
  const common = { app, requireAuth, kvGet, kvSet, connectorLog: () => {}, executeAction, sendAppError, fetchImpl: linkedin.fetchImpl, now: () => NOW };
  // Igual que el loader: la base sin id y la instancia extra con el suyo.
  const { register } = require("./index");
  register(common);
  register(common, "linkedin2");

  const start = await request(app, "GET", "/api/connectors/linkedin2/oauth/start", { headers: AUTH });
  const url = new URL(start.json().url);
  assert.equal(url.searchParams.get("client_id"), "page-app");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/connectors/linkedin2/oauth/callback");
  assert.ok(rows.get("linkedin-oauth-states-linkedin2"));
  assert.equal(rows.get("linkedin-oauth-states-linkedin"), undefined, "each connection keeps its own pending states");

  // La segunda conexión todavía no está autorizada, así que no publica; la
  // primera no puede publicar un block que pertenece a la segunda.
  const notYet = await request(app, "POST", "/api/connectors/linkedin2/posts/page/publish", { headers: AUTH });
  assert.equal(notYet.status, 400);
  const crossed = await request(app, "POST", "/api/connectors/linkedin/posts/page/publish", { headers: AUTH });
  assert.equal(crossed.status, 404);
  assert.equal(linkedin.calls.filter((c) => c.url.endsWith("/rest/posts")).length, 0);
});

test("a post deleted by hand on LinkedIn can be forgotten: the block is a draft again and nothing is sent to LinkedIn", async () => {
  const block = { id: "custom-1", kind: "linkedin-post", connectorId: "linkedin", title: "Anuncio", payload: { body: "Hola", link: null, linkAsFirstComment: false } };
  const { app, linkedin, rows } = setup({ seed: {
    "connector-config-linkedin": CONNECTED,
    "custom-blocks": [block],
    "connector-data-linkedin": { posts: { "custom-1": { phase: "published", contentHash: "h", postUrn: "urn:li:share:9", postUrl: "u", publishedAt: "2026-09-18T00:00:00Z" } } },
  } });
  const res = await request(app, "POST", "/api/connectors/linkedin/posts/custom-1/forget-published", { headers: AUTH });
  assert.equal(res.status, 200);
  assert.equal(res.json().status, "unpublished");
  assert.equal(rows.get("connector-data-linkedin").posts["custom-1"], undefined);
  assert.equal(linkedin.calls.length, 0);

  // Solo se puede olvidar lo que figura como publicado.
  const again = await request(app, "POST", "/api/connectors/linkedin/posts/custom-1/forget-published", { headers: AUTH });
  assert.equal(again.status, 409);
});
