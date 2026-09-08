const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const {
  DEFAULT_SERVER_URL,
  buildStatusRecord,
  bwApiKeyLogin,
  bwHealthCheck,
  hasApiKey,
  readCliStatus,
  serverUrlOf,
} = require("./client");

// Minimal stand-in for a spawned bw process.
function fakeChild({ code = 0, stdout = "", stderr = "" } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    child.emit("close", code);
  });
  return child;
}

function fakeTransport(handler) {
  return {
    request(options, callback) {
      const request = new EventEmitter();
      request.end = () => handler({ options, request, callback });
      request.destroy = () => {};
      return request;
    },
  };
}

test("a missing server URL falls back to the local default", () => {
  assert.equal(serverUrlOf(null), DEFAULT_SERVER_URL);
  assert.equal(serverUrlOf({}), DEFAULT_SERVER_URL);
  assert.equal(serverUrlOf({ serverUrl: "https://vault.test" }), "https://vault.test");
});

test("an API key counts only when both halves are present", () => {
  assert.equal(hasApiKey({ clientId: "a", clientSecret: "b" }), true);
  assert.equal(hasApiKey({ clientId: "a" }), false);
  assert.equal(hasApiKey({ clientSecret: "b" }), false);
  assert.equal(hasApiKey(null), false);
});

test("health check reports a reachable server", async () => {
  const transport = fakeTransport(({ options, callback }) => {
    assert.equal(options.path, "/alive");
    const response = new EventEmitter();
    response.statusCode = 200;
    callback(response);
    setImmediate(() => { response.emit("data", "ok "); response.emit("end"); });
  });
  const result = await bwHealthCheck("https://vault.test", { transport });
  assert.deepEqual(result, { ok: true, statusCode: 200, body: "ok" });
});

test("a 5xx is reported as not ok rather than thrown", async () => {
  const transport = fakeTransport(({ callback }) => {
    const response = new EventEmitter();
    response.statusCode = 503;
    callback(response);
    setImmediate(() => response.emit("end"));
  });
  const result = await bwHealthCheck("https://vault.test", { transport });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 503);
});

test("a transport failure resolves instead of rejecting", async () => {
  // An unreachable vault is a status to display, not an exception to handle.
  const transport = fakeTransport(({ request }) => {
    setImmediate(() => request.emit("error", new Error("ECONNREFUSED")));
  });
  const result = await bwHealthCheck("https://vault.test", { transport });
  assert.deepEqual(result, { ok: false, error: "ECONNREFUSED" });
});

test("a timeout resolves as a timeout", async () => {
  const transport = fakeTransport(({ request }) => {
    setImmediate(() => request.emit("timeout"));
  });
  assert.deepEqual(await bwHealthCheck("https://vault.test", { transport }), { ok: false, error: "timeout" });
});

test("a malformed server URL is reported, not thrown", async () => {
  const result = await bwHealthCheck("not a url");
  assert.equal(result.ok, false);
  assert.ok(result.error, "the parse failure is surfaced as an error string");
});

test("CLI status is parsed, and a broken CLI yields the fallback status", async () => {
  assert.deepEqual(
    await readCliStatus(async () => '{"status":"unlocked","userEmail":"a@b.c"}'),
    { status: "unlocked", userEmail: "a@b.c" },
  );

  const failed = await readCliStatus(async () => { throw new Error("bw not found"); }, "unauthenticated");
  assert.equal(failed.status, "unauthenticated", "the caller's fallback is used");
  assert.match(failed.error, /bw not found/);

  // Non-JSON output is a failure too, not a silent empty object.
  const garbage = await readCliStatus(async () => "not json", "error");
  assert.equal(garbage.status, "error");
});

test("API key login passes credentials via env, never as arguments", async () => {
  let seen;
  await bwApiKeyLogin({ clientId: "CID", clientSecret: "CSECRET" }, {
    binary: { bin: "bw" },
    spawn: (bin, args, opts) => { seen = { bin, args, opts }; return fakeChild({ stdout: "logged in" }); },
  });

  assert.equal(seen.args.includes("CSECRET"), false, "the secret must not reach a process listing");
  assert.equal(seen.args.includes("CID"), false);
  assert.deepEqual(seen.args, ["login", "--apikey", "--nointeraction"]);
  assert.equal(seen.opts.env.BW_CLIENTSECRET, "CSECRET");
  assert.equal(seen.opts.env.BW_CLIENTID, "CID");
});

test("a script-style binary prefixes the script path", async () => {
  let seen;
  await bwApiKeyLogin({ clientId: "a", clientSecret: "b" }, {
    binary: { bin: "node", script: "/path/bw.js" },
    spawn: (bin, args) => { seen = { bin, args }; return fakeChild({}); },
  });
  assert.equal(seen.bin, "node");
  assert.deepEqual(seen.args, ["/path/bw.js", "login", "--apikey", "--nointeraction"]);
});

test("a failed login rejects with the CLI's stderr", async () => {
  await assert.rejects(
    () => bwApiKeyLogin({ clientId: "a", clientSecret: "b" }, {
      binary: { bin: "bw" },
      spawn: () => fakeChild({ code: 1, stderr: "invalid api key" }),
    }),
    /invalid api key/,
  );
});

test("a missing binary is refused before spawning anything", async () => {
  let spawned = false;
  await assert.rejects(
    () => bwApiKeyLogin({ clientId: "a", clientSecret: "b" }, {
      binary: null,
      spawn: () => { spawned = true; return fakeChild({}); },
    }),
    /bw-binary-unavailable/,
  );
  assert.equal(spawned, false);
});

test("the status record joins server health with CLI session state", () => {
  const record = buildStatusRecord({
    ok: true,
    latency: "12ms",
    health: { ok: true },
    cliStatus: { status: "locked", userEmail: "a@b.c", serverUrl: "https://from-cli" },
    serverUrl: "https://from-config",
    itemCount: 42,
  });
  assert.equal(record.status, "ok");
  assert.equal(record.bwCliStatus, "locked", "a locked vault is a normal state");
  assert.equal(record.serverUrl, "https://from-cli", "the CLI's own view wins when it has one");
  assert.equal(record.itemsSynced, 42);
  assert.equal(record.lastError, null);
});

test("an unreachable server produces an error record carrying the reason", () => {
  const record = buildStatusRecord({
    ok: false,
    latency: "5001ms",
    health: { ok: false, error: "timeout" },
    cliStatus: { status: "unauthenticated" },
    serverUrl: "https://vault.test",
  });
  assert.equal(record.status, "error");
  assert.equal(record.lastError, "timeout");
  assert.equal(record.serverUrl, "https://vault.test", "falls back to the configured URL");
  assert.equal("itemsSynced" in record, false, "no count is claimed when none was taken");
});

test("a missing health reason still yields a usable message", () => {
  const record = buildStatusRecord({ ok: false, latency: "1ms", health: { ok: false }, cliStatus: null, serverUrl: "u" });
  assert.equal(record.lastError, "server unreachable");
  assert.equal(record.bwCliStatus, null);
});
