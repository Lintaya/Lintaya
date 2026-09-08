const assert = require("node:assert/strict");
const test = require("node:test");

const { guardAsyncRoute } = require("./route-guard");

function fakeRes() {
  return {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
  };
}

test("guardAsyncRoute passes through a handler that responds normally", async () => {
  const res = fakeRes();
  const guarded = guardAsyncRoute(async (req, r) => { r.json({ ok: true }); });
  await guarded({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("guardAsyncRoute maps a vault-locked throw to 401", async () => {
  const res = fakeRes();
  const guarded = guardAsyncRoute(async () => {
    const error = new Error("bitwarden vault is locked");
    error.code = "vault-locked";
    throw error;
  });
  await guarded({}, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "vault-locked" });
});

test("guardAsyncRoute maps an unexpected throw to a generic 500 without leaking the message", async () => {
  const res = fakeRes();
  const guarded = guardAsyncRoute(async () => {
    throw new Error("token=super-secret-value should never reach the client");
  });
  await guarded({}, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "unexpected-error" });
});

test("guardAsyncRoute does nothing if the handler already sent a response before throwing", async () => {
  const res = fakeRes();
  const guarded = guardAsyncRoute(async (req, r) => {
    r.json({ ok: true });
    throw new Error("late failure after the response was already sent");
  });
  await guarded({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("guardAsyncRoute forwards req/res/next unchanged to the wrapped handler", async () => {
  const res = fakeRes();
  const req = { marker: "request" };
  const next = () => {};
  let received;
  const guarded = guardAsyncRoute(async (r, s, n) => { received = [r, s, n]; s.json({ ok: true }); });
  await guarded(req, res, next);
  assert.deepEqual(received, [req, res, next]);
});
