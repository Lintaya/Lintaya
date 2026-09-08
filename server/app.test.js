const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const { createApp, requireAuth } = require("./app");
const application = createApp({ token: "core-test-token" });
application.get("/api/protected-test", requireAuth, (req, res) => {
  res.json({ ok: true });
});

function request(method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const requestEvents = new EventEmitter();
    const responseEvents = new EventEmitter();
    const responseHeaders = new Map();
    const chunks = [];

    const req = {
      method,
      url,
      headers: Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      ),
      connection: {},
      socket: {},
      on: requestEvents.on.bind(requestEvents),
      once: requestEvents.once.bind(requestEvents),
      emit: requestEvents.emit.bind(requestEvents),
      resume() {},
    };

    const res = {
      statusCode: 200,
      headersSent: false,
      finished: false,
      setHeader(name, value) {
        responseHeaders.set(name.toLowerCase(), value);
      },
      getHeader(name) {
        return responseHeaders.get(name.toLowerCase());
      },
      getHeaders() {
        return Object.fromEntries(responseHeaders);
      },
      removeHeader(name) {
        responseHeaders.delete(name.toLowerCase());
      },
      write(chunk) {
        this.headersSent = true;
        if (chunk) chunks.push(Buffer.from(chunk));
        return true;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        this.headersSent = true;
        this.finished = true;
        responseEvents.emit("finish");
        resolve({
          status: this.statusCode,
          headers: Object.fromEntries(responseHeaders),
          text: Buffer.concat(chunks).toString("utf8"),
        });
      },
      on: responseEvents.on.bind(responseEvents),
      once: responseEvents.once.bind(responseEvents),
      emit: responseEvents.emit.bind(responseEvents),
    };

    application.handle(req, res, reject);
  });
}

test("GET /api/health is public and reports liveness", async () => {
  const response = await request("GET", "/api/health");
  assert.equal(response.status, 200);
  const body = JSON.parse(response.text);
  assert.equal(body.ok, true);
  assert.equal(typeof body.ts, "number");
});

test("protected routes reject a missing bearer token", async () => {
  const response = await request("GET", "/api/protected-test");
  assert.equal(response.status, 401);
  const body = JSON.parse(response.text);
  assert.equal(body.code, "UNAUTHORIZED");
  assert.equal(body.title, "Unauthorized");
  assert.equal(body.detail, "unauthorized");
  assert.ok(body.requestId);
  assert.match(response.headers["content-type"], /^application\/problem\+json/);
});

test("every response carries an X-Request-Id, echoing one supplied by the client", async () => {
  const generated = await request("GET", "/api/health");
  assert.ok(generated.headers["x-request-id"]);

  const echoed = await request("GET", "/api/health", { "x-request-id": "client-abc" });
  assert.equal(echoed.headers["x-request-id"], "client-abc");
});

test("protected routes accept the token passed to createApp", async () => {
  const response = await request("GET", "/api/protected-test", {
    authorization: "Bearer core-test-token",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { ok: true });
});
