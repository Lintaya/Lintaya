const assert = require("node:assert/strict");
const test = require("node:test");

const { createActionRegistry } = require("../../../core/actions/registry");
const { createActionExecutor } = require("../../../core/actions/execute");
const { registerLinkedinActions } = require("./actions");
const { IN_FLIGHT_MS } = require("./publisher");

const NOW = Date.parse("2026-09-17T12:00:00Z");

function fakeResponse({ status = 201, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => "",
  };
}

function postBlock(overrides = {}) {
  return {
    id: "custom-post-1", kind: "linkedin-post", connectorId: "linkedin", title: "Lanzamiento",
    payload: { body: "Hoy lanzamos #Lintaya", link: null, linkAsFirstComment: false },
    ...overrides,
  };
}

function setup({ fetchImpl, blocks = [postBlock()], config, data, approvalStore } = {}) {
  const rows = new Map(Object.entries({
    "custom-blocks": blocks,
    "connector-config-linkedin": config === undefined ? {
      clientId: "cid", clientSecret: "sec", accessToken: "tok",
      authorUrn: "urn:li:person:abc", expiresAt: new Date(NOW + 30 * 86400000).toISOString(),
    } : config,
    ...(data ? { "connector-data-linkedin": data } : {}),
  }));
  const kvGet = (key) => (rows.has(key) ? { value: rows.get(key) } : null);
  const kvSet = (key, value) => rows.set(key, value);
  const calls = [];
  const wrappedFetch = async (url, init) => {
    // En el momento de la llamada la intención ya tiene que estar escrita.
    calls.push({ url, init, recordAtCall: rows.get("connector-data-linkedin")?.posts?.["custom-post-1"] || null });
    return fetchImpl(url, init);
  };
  const registry = createActionRegistry();
  registerLinkedinActions({ registry, fetchImpl: wrappedFetch, now: () => NOW });
  const executeAction = createActionExecutor({
    registry, kvGet, kvSet, connectorLog: () => {},
    resolveConnectorType: (id) => (id.startsWith("linkedin") ? "linkedin" : id),
    approvalStore,
  });
  const publish = () => executeAction({ connectionId: "linkedin", actionId: "publish-post", input: { blockId: "custom-post-1" } });
  return { executeAction, publish, calls, rows };
}

const ok = async () => fakeResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:777" } });

test("publish-post publishes the stored block text and records the post", async () => {
  const { publish, calls, rows } = setup({ fetchImpl: ok });
  const result = await publish();
  assert.equal(result.ok, true);
  assert.equal(result.result.postUrn, "urn:li:share:777");
  assert.equal(result.result.postUrl, "https://www.linkedin.com/feed/update/urn:li:share:777");
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).commentary, "Hoy lanzamos \\#Lintaya");
  assert.equal(rows.get("connector-data-linkedin").posts["custom-post-1"].phase, "published");
});

test("the intent is written before LinkedIn is called", async () => {
  const { publish, calls } = setup({ fetchImpl: ok });
  await publish();
  assert.equal(calls[0].recordAtCall?.phase, "publishing");
});

test("publishing the same content twice returns the first post and never calls LinkedIn again", async () => {
  const { publish, calls } = setup({ fetchImpl: ok });
  await publish();
  const again = await publish();
  assert.equal(again.result.postUrn, "urn:li:share:777");
  assert.equal(calls.length, 1);
});

test("an edited block that was already published is refused instead of creating a second post", async () => {
  const env = setup({ fetchImpl: ok });
  await env.publish();
  env.rows.set("custom-blocks", [postBlock({ payload: { body: "Texto cambiado", link: null, linkAsFirstComment: false } })]);
  await assert.rejects(env.publish(), /linkedin-already-published/);
  assert.equal(env.calls.length, 1);
});

test("a network failure leaves the attempt unconfirmed and blocks any retry", async () => {
  const env = setup({ fetchImpl: async () => { throw new Error("socket hang up"); } });
  await assert.rejects(env.publish(), /linkedin-publish-unconfirmed/);
  await assert.rejects(env.publish(), /linkedin-publish-unconfirmed/);
  assert.equal(env.calls.length, 1, "no second call after an ambiguous failure");
});

test("a 5xx is ambiguous too, but a clear 4xx rejection can be retried", async () => {
  const ambiguous = setup({ fetchImpl: async () => fakeResponse({ status: 503 }) });
  await assert.rejects(ambiguous.publish(), /linkedin-publish-unconfirmed/);

  let first = true;
  const clear = setup({ fetchImpl: async () => { if (first) { first = false; return fakeResponse({ status: 422 }); } return ok(); } });
  await assert.rejects(clear.publish(), /linkedin-publish-failed/);
  const retried = await clear.publish();
  assert.equal(retried.result.postUrn, "urn:li:share:777");
  assert.equal(clear.calls.length, 2);
});

test("a recent in-flight attempt is a double click, an old one is unconfirmed; neither calls LinkedIn", async () => {
  const recent = setup({
    fetchImpl: ok,
    data: { posts: { "custom-post-1": { phase: "publishing", contentHash: "x", startedAt: new Date(NOW - 5000).toISOString() } } },
  });
  await assert.rejects(recent.publish(), /linkedin-publish-in-progress/);

  const stale = setup({
    fetchImpl: ok,
    data: { posts: { "custom-post-1": { phase: "publishing", contentHash: "x", startedAt: new Date(NOW - IN_FLIGHT_MS - 1).toISOString() } } },
  });
  await assert.rejects(stale.publish(), /linkedin-publish-unconfirmed/);
  assert.equal(recent.calls.length + stale.calls.length, 0);
});

test("an expired token without a refresh token asks to reconnect, and does not call LinkedIn", async () => {
  const env = setup({
    fetchImpl: ok,
    config: { clientId: "cid", clientSecret: "sec", accessToken: "tok", authorUrn: "urn:li:person:abc", expiresAt: new Date(NOW - 1000).toISOString() },
  });
  await assert.rejects(env.publish(), /linkedin-token-expired/);
  assert.equal(env.calls.length, 0);
});

test("a block from another connection, or of another kind, is not publishable", async () => {
  const env = setup({ fetchImpl: ok, blocks: [postBlock({ connectorId: "linkedin2" })] });
  await assert.rejects(env.publish(), /linkedin-block-not-found/);
  const qr = setup({ fetchImpl: ok, blocks: [postBlock({ kind: "qr" })] });
  await assert.rejects(qr.publish(), /linkedin-block-not-found/);
});

test("delete-post is destructive: the first request is pending and never reaches LinkedIn", async () => {
  const requests = [];
  const approvalStore = { request: (entry) => { requests.push(entry); return { id: "appr-1" }; } };
  const env = setup({
    fetchImpl: async () => { throw new Error("must not be called"); },
    approvalStore,
    data: { posts: { "custom-post-1": { phase: "published", contentHash: "x", postUrn: "urn:li:share:777", postUrl: "u", publishedAt: "2026-09-01T00:00:00Z" } } },
  });
  const result = await env.executeAction({ connectionId: "linkedin", actionId: "delete-post", input: { blockId: "custom-post-1" } });
  assert.equal(result.pending, true);
  assert.equal(result.error, "pending-approval");
  assert.equal(requests.length, 1);
  assert.equal(env.calls.length, 0);
});
