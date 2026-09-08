const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  ConnectorHttpError,
  buildHttpUrl,
  requestJson,
} = require("./http");

function fakeTransport(scenario, capture = {}) {
  return {
    request(options, onResponse) {
      capture.options = options;
      const request = new EventEmitter();
      request.destroy = () => { capture.destroyed = true; };
      request.write = (body) => { capture.body = body; };
      request.end = () => {
        queueMicrotask(() => {
          if (scenario === "timeout") {
            request.emit("timeout");
            return;
          }
          if (scenario.error) {
            request.emit("error", scenario.error);
            return;
          }
          const response = new EventEmitter();
          response.statusCode = scenario.statusCode || 200;
          response.headers = scenario.headers || {};
          onResponse(response);
          if (scenario.body) response.emit("data", scenario.body);
          response.emit("end");
        });
      };
      return request;
    },
  };
}

test("buildHttpUrl preserves a self-hosted API base path", () => {
  assert.equal(
    buildHttpUrl("https://scm.example.test/api/v3/", "/projects?page=2").toString(),
    "https://scm.example.test/api/v3/projects?page=2",
  );
  assert.throws(
    () => buildHttpUrl("file:///tmp/repository", "/projects"),
    (error) => error.code === "CONNECTOR_URL_INVALID",
  );
  assert.throws(
    () => buildHttpUrl("not-a-url", "/projects"),
    (error) => error.code === "CONNECTOR_URL_INVALID",
  );
  assert.throws(
    () => buildHttpUrl("https://user:secret@scm.example.test", "/projects"),
    (error) => error.code === "CONNECTOR_URL_INVALID",
  );
});

test("requestJson sends JSON and returns a parsed response", async () => {
  const capture = {};
  const result = await requestJson({
    baseUrl: "https://api.example.test/v1",
    path: "/items?limit=1",
    method: "POST",
    headers: { Authorization: "Bearer test" },
    body: { name: "Lintaya" },
    transport: fakeTransport({ statusCode: 200, body: '{"ok":true}' }, capture),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(capture.options.path, "/v1/items?limit=1");
  assert.equal(capture.options.method, "POST");
  assert.equal(capture.options.timeout, 12000);
  assert.equal(capture.options.headers.Authorization, "Bearer test");
  assert.equal(capture.body, '{"name":"Lintaya"}');
});

test("requestJson preserves raw text when requested", async () => {
  const result = await requestJson({
    baseUrl: "https://api.example.test",
    path: "/source/config.json",
    responseType: "text",
    transport: fakeTransport({ statusCode: 200, body: '{"kept":"as text"}' }),
  });
  assert.equal(result, '{"kept":"as text"}');
});

test("requestJson returns raw bytes untouched in buffer mode, not corrupted through a text decode", async () => {
  // JPEG magic bytes — not valid UTF-8, so string-concatenating the chunk
  // (the old `body += chunk` approach) would replace them with U+FFFD.
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const result = await requestJson({
    baseUrl: "https://api.example.test",
    path: "/assets/logo.jpg",
    responseType: "buffer",
    transport: fakeTransport({ statusCode: 200, body: jpegHeader }),
  });
  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual(result, jpegHeader);
});

test("requestJson normalizes authentication and rate-limit responses", async () => {
  await assert.rejects(
    requestJson({
      baseUrl: "https://api.example.test",
      path: "/user",
      transport: fakeTransport({ statusCode: 401, body: "invalid token" }),
    }),
    (error) => error instanceof ConnectorHttpError
      && error.status === 401
      && error.code === "CONNECTOR_AUTH_FAILED",
  );

  await assert.rejects(
    requestJson({
      baseUrl: "https://api.example.test",
      path: "/items?access_token=must-not-leak",
      transport: fakeTransport({
        statusCode: 429,
        body: "slow down",
        headers: { "retry-after": "30" },
      }),
    }),
    (error) => error.code === "CONNECTOR_RATE_LIMITED"
      && error.retryAfter === "30"
      && error.url === "https://api.example.test/items",
  );
});

test("requestJson enforces timeout and normalizes network errors", async () => {
  const timeoutCapture = {};
  await assert.rejects(
    requestJson({
      baseUrl: "https://api.example.test",
      transport: fakeTransport("timeout", timeoutCapture),
    }),
    (error) => error.code === "CONNECTOR_TIMEOUT",
  );
  assert.equal(timeoutCapture.destroyed, true);

  await assert.rejects(
    requestJson({
      baseUrl: "https://api.example.test",
      transport: fakeTransport({ error: new Error("socket closed") }),
    }),
    (error) => error.code === "CONNECTOR_NETWORK_ERROR" && error.message === "socket closed",
  );
});

test("requestJson supports cancellation through AbortSignal", async () => {
  const controller = new AbortController();
  const capture = {};
  controller.abort();

  await assert.rejects(
    requestJson({
      baseUrl: "https://api.example.test",
      signal: controller.signal,
      transport: fakeTransport({ statusCode: 200, body: "{}" }, capture),
    }),
    (error) => error.code === "CONNECTOR_ABORTED",
  );
  assert.equal(capture.destroyed, true);
  assert.equal(capture.body, undefined);
});
