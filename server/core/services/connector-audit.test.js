const assert = require("node:assert/strict");
const { test } = require("node:test");

const { auditConnectorWrite } = require("./connector-audit");

function fakeReqRes({ method = "POST", url = "/api/x", statusCode = 200, headers = {} } = {}) {
  const req = { method, originalUrl: url, params: { provider: "github" }, get: (name) => headers[name.toLowerCase()] };
  const res = {
    statusCode,
    locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
  return { req, res };
}

test("throws without provider or action", () => {
  assert.throws(() => auditConnectorWrite(() => {}, { action: "x" }), TypeError);
  assert.throws(() => auditConnectorWrite(() => {}, { provider: "github" }), TypeError);
});

test("logs ok with the default message and captured endpoint on success", () => {
  const calls = [];
  const mw = auditConnectorWrite((...a) => calls.push(a), { provider: (r) => r.params.provider, action: "Preparar entorno" });
  const { req, res } = fakeReqRes();
  mw(req, res, () => {});
  res.json({ ok: true });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["github", "ok", "Preparar entorno", { endpoint: "POST /api/x" }]);
  assert.deepEqual(res.body, { ok: true }); // response is untouched
});

test("logs err with the body's error message when status >= 400", () => {
  const calls = [];
  const mw = auditConnectorWrite((...a) => calls.push(a), { provider: "gitlab", action: "git push" });
  const { req, res } = fakeReqRes({ statusCode: 502 });
  mw(req, res, () => {});
  res.status(502).json({ error: "auth failed" });

  assert.equal(calls[0][1], "err");
  assert.equal(calls[0][2], "git push falló: auth failed");
});

test("an X-Actor header is recorded as meta.actor", () => {
  const calls = [];
  const mw = auditConnectorWrite((...a) => calls.push(a), { provider: "gitlab", action: "git pull" });
  const { req, res } = fakeReqRes({ headers: { "x-actor": "claude-sonnet-5" } });
  mw(req, res, () => {});
  res.json({ ok: true });

  assert.deepEqual(calls[0][3], { endpoint: "POST /api/x", actor: "claude-sonnet-5" });
});

test("no X-Actor header means no actor field — assumed to be a human via the UI", () => {
  const calls = [];
  const mw = auditConnectorWrite((...a) => calls.push(a), { provider: "gitlab", action: "git pull" });
  const { req, res } = fakeReqRes();
  mw(req, res, () => {});
  res.json({ ok: true });

  assert.deepEqual(calls[0][3], { endpoint: "POST /api/x" });
});

test("a handler-set auditMessage/auditMeta override the defaults", () => {
  const calls = [];
  const mw = auditConnectorWrite((...a) => calls.push(a), { provider: "qportal", action: "Sync" });
  const { req, res } = fakeReqRes();
  mw(req, res, () => {});
  res.locals.auditMessage = "Sync OK · 100 requests";
  res.locals.auditMeta = { endpoints: ["GET /api/a", "GET /api/b"] };
  res.json({ ok: true });

  assert.equal(calls[0][2], "Sync OK · 100 requests");
  assert.deepEqual(calls[0][3], { endpoint: "POST /api/x", endpoints: ["GET /api/a", "GET /api/b"] });
});

test("a logger that throws never breaks the response", () => {
  const mw = auditConnectorWrite(() => { throw new Error("kv down"); }, { provider: "github", action: "clone" });
  const { req, res } = fakeReqRes();
  mw(req, res, () => {});
  assert.doesNotThrow(() => res.json({ ok: true }));
  assert.deepEqual(res.body, { ok: true });
});

test("a binary response is audited once through res.send", () => {
  const entries = [];
  const middleware = auditConnectorWrite((...args) => entries.push(args), { provider: "backups", action: "Exportar" });
  const { req, res } = fakeReqRes();
  middleware(req, res, () => res.send(Buffer.from("archive")));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], "ok");
  assert.equal(entries[0][2], "Exportar");
});
