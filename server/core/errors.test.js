const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { AppError, requestContext, sendAppError, errorMiddleware, toAppError } = require("./errors");

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("AppError factories set the expected code/status", () => {
  assert.equal(AppError.badRequest("bad").status, 400);
  assert.equal(AppError.unauthorized().code, "UNAUTHORIZED");
  assert.equal(AppError.forbidden().status, 403);
  assert.equal(AppError.notFound().status, 404);
  assert.equal(AppError.conflict("dup").code, "CONFLICT");
  assert.equal(AppError.unprocessable("invalid").status, 422);
  assert.equal(AppError.badGateway().status, 502);
  assert.equal(AppError.unavailable().status, 503);
  assert.equal(AppError.unavailable().code, "SERVICE_UNAVAILABLE");
  assert.equal(AppError.internal().expose, false);
});

test("toAppError wraps a plain Error as a hidden-message internal error", () => {
  const wrapped = toAppError(new Error("db exploded"));
  assert.equal(wrapped.code, "INTERNAL_ERROR");
  assert.equal(wrapped.status, 500);
  assert.equal(wrapped.expose, false);
});

test("toAppError passes an AppError through unchanged", () => {
  const original = AppError.badRequest("nope");
  assert.equal(toAppError(original), original);
});

test("sendAppError writes RFC 9457 Problem Details and reuses req.id", () => {
  const res = fakeRes();
  const appErr = sendAppError(res, AppError.notFound("missing repo"), { id: "req-123" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    type: "urn:lintaya:problem:not-found",
    title: "Not Found",
    status: 404,
    detail: "missing repo",
    instance: "urn:lintaya:request:req-123",
    code: "NOT_FOUND",
    details: null,
    requestId: "req-123",
  });
  assert.equal(res.headers["Content-Type"], "application/problem+json");
  assert.equal(appErr.code, "NOT_FOUND");
});

test("sendAppError hides the message/details of non-exposed errors", () => {
  const res = fakeRes();
  sendAppError(res, new Error("stack trace secret"), {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.detail, "Internal server error");
  assert.equal(res.body.details, null);
  assert.ok(res.body.requestId);
});

test("requestContext echoes an inbound X-Request-Id and sets req.id", () => {
  const middleware = requestContext();
  const req = { headers: { "x-request-id": "client-supplied-id" } };
  const res = fakeRes();
  let called = false;
  middleware(req, res, () => { called = true; });
  assert.equal(req.id, "client-supplied-id");
  assert.equal(res.headers["X-Request-Id"], "client-supplied-id");
  assert.ok(called);
});

test("requestContext generates an id when none is supplied", () => {
  const middleware = requestContext();
  const req = { headers: {} };
  const res = fakeRes();
  middleware(req, res, () => {});
  assert.ok(req.id && req.id.length > 0);
  assert.equal(res.headers["X-Request-Id"], req.id);
});

test("errorMiddleware formats the error and logs at warn for 4xx", () => {
  const logs = [];
  const middleware = errorMiddleware({
    warn: (msg, meta) => logs.push({ level: "warn", msg, meta }),
    error: (msg, meta) => logs.push({ level: "error", msg, meta }),
  });
  const res = fakeRes();
  middleware(AppError.badRequest("bad input"), { id: "req-1", method: "POST", originalUrl: "/api/x" }, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "warn");
});

test("errorMiddleware logs at error for 5xx and defers to next() if headers already sent", () => {
  const logs = [];
  const middleware = errorMiddleware({
    warn: (msg, meta) => logs.push({ level: "warn", msg, meta }),
    error: (msg, meta) => logs.push({ level: "error", msg, meta }),
  });
  const res = fakeRes();
  middleware(new Error("boom"), { id: "req-2" }, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(logs[0].level, "error");

  let deferred = false;
  const sentRes = { ...fakeRes(), headersSent: true };
  middleware(new Error("already sent"), { id: "req-3" }, sentRes, (err) => { deferred = !!err; });
  assert.ok(deferred);
});

test("active inline API routes do not bypass RFC 9457 with ad-hoc error JSON", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.doesNotMatch(source, /legacySshRoutesRetired/, "the retired SSH implementation must not return");
  assert.doesNotMatch(
    source,
    /res\.status\([^)]*\)\.json\(\{\s*(?:error|ok\s*:\s*false)/,
    "active inline routes must use sendAppError/AppError for HTTP failures",
  );
  assert.match(source, /req\.path\.startsWith\("\/api\/"\)[\s\S]{0,160}sendAppError\(res, AppError\.notFound/);
});
