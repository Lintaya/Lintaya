const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");
const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerQrLinksRoutes } = require("./qr-links");
const { request } = require("./test-http-harness");

function setup(options = {}) {
  const db = new Database(":memory:"); db.exec("CREATE TABLE qr_links (code TEXT PRIMARY KEY, destination TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, scan_count INTEGER NOT NULL DEFAULT 0, last_scanned_at TEXT)");
  const kv = new Map(); const audit = [];
  const app = createApp({ token: "test-token" });
  const routeState = registerQrLinksRoutes({ app, db, kvGet: key => kv.has(key) ? { value: kv.get(key) } : null, kvSet: (key, value) => kv.set(key, value), requireAuth, AppError, sendAppError, auditActivity: opts => (req, res, next) => { const old = res.json.bind(res); res.json = body => { audit.push({ ...opts, meta: res.locals.auditMeta }); return old(body); }; next(); }, ...options });
  return { app, db, audit, rateStateSize: routeState.rateStateSize, headers: { authorization: "Bearer test-token" } };
}

test("QR links enforce auth, validate destinations, retry collisions, and resolve publicly", async () => {
  let codes = ["abcdefghijkl", "abcdefghijkl", "mnopqrstuvwxyz"];
  const { app, db, headers } = setup({ codeFactory: () => codes.shift() });
  assert.equal((await request(app, "GET", "/api/qr-links")).status, 401);
  assert.equal((await request(app, "POST", "/api/qr-links", { headers, body: { destination: "javascript:alert(1)" } })).status, 400);
  const created = await request(app, "POST", "/api/qr-links", { headers, body: { destination: "https://example.com/next" } }); assert.equal(created.status, 200);
  const collision = await request(app, "POST", "/api/qr-links", { headers, body: { destination: "https://example.org" } }); assert.equal(collision.status, 200); assert.equal(collision.json().code, "mnopqrstuvwxyz");
  const resolved = await request(app, "GET", "/r/abcdefghijkl"); assert.equal(resolved.status, 302); assert.equal(resolved.headers.location, "https://example.com/next"); assert.equal(resolved.headers["cache-control"], "no-store, private");
  assert.equal(db.prepare("SELECT scan_count FROM qr_links WHERE code = ?").get("abcdefghijkl").scan_count, 1);
  await request(app, "HEAD", "/r/abcdefghijkl"); assert.equal(db.prepare("SELECT scan_count FROM qr_links WHERE code = ?").get("abcdefghijkl").scan_count, 1);
  assert.equal((await request(app, "GET", "/r/unknown-code")).status, 404);
});

test("builder settings default off, validate strictly, and classify QR base URL reachability", async () => {
  const { app, headers } = setup();
  assert.deepEqual((await request(app, "GET", "/api/settings/builder", { headers })).json(), { qr: { dynamicEnabled: false } });
  assert.equal((await request(app, "PUT", "/api/settings/builder", { headers, body: { qr: { dynamicEnabled: true }, extra: true } })).status, 400);
  assert.deepEqual((await request(app, "PUT", "/api/settings/builder", { headers, body: { qr: { dynamicEnabled: true } } })).json(), { qr: { dynamicEnabled: true } });
  const local = await request(app, "GET", "/api/settings/qr-base-url", { headers });
  assert.equal(local.json().baseUrlReachability, "public");
  await request(app, "PUT", "/api/settings/qr-base-url", { headers, body: { baseUrl: "http://127.0.0.1:3000" } });
  assert.equal((await request(app, "GET", "/api/settings/qr-base-url", { headers })).json().baseUrlReachability, "private");
  await request(app, "PUT", "/api/settings/qr-base-url", { headers, body: { baseUrl: "https://example.com" } });
  assert.equal((await request(app, "GET", "/api/settings/qr-base-url", { headers })).json().baseUrlReachability, "public");
  const link = await request(app, "POST", "/api/qr-links", { headers, body: { destination: "https://destination.example" } });
  await request(app, "PUT", "/api/settings/builder", { headers, body: { qr: { dynamicEnabled: false } } });
  assert.equal((await request(app, "GET", `/r/${link.json().code}`)).status, 302);
});

test("QR links audit destination changes, disable distinctly, and rate-limit scans", async () => {
  const { app, db, headers, audit } = setup({ rateLimit: 2 });
  const created = await request(app, "POST", "/api/qr-links", { headers, body: { destination: "https://one.example" } }); const code = created.json().code;
  await request(app, "PUT", `/api/qr-links/${code}`, { headers, body: { destination: "https://two.example" } }); assert.deepEqual(audit.at(-1).meta, { oldDestination: "https://one.example", newDestination: "https://two.example" });
  await request(app, "POST", `/api/qr-links/${code}/disable`, { headers }); assert.equal((await request(app, "GET", `/r/${code}`)).status, 404); assert.ok(db.prepare("SELECT code FROM qr_links WHERE code = ?").get(code));
  const second = await request(app, "POST", "/api/qr-links", { headers, body: { destination: "https://three.example" } }); const code2 = second.json().code; assert.equal((await request(app, "GET", `/r/${code2}`)).status, 302); assert.equal((await request(app, "GET", `/r/${code2}`)).status, 404);
});

test("destination filtering covers reserved IP forms and allows ordinary public names", () => {
  const { validateDestination } = require("./qr-links");
  for (const host of ["169.254.169.254", "169.254.1.1", "0.0.0.0", "2130706433", "0x7f000001", "0177.0.0.1", "[::ffff:127.0.0.1]", "[fc00::1]", "localhost", "service.internal"]) assert.throws(() => validateDestination(`https://${host}/`));
  for (const host of ["mi.local.example.com", "example.com"]) assert.doesNotThrow(() => validateDestination(`https://${host}/`));
});

test("disabled QR links can be enabled and expired rate windows are evicted", async () => {
  let now = 0; const { app, rateStateSize, headers } = setup({ rateLimit: 10, rateWindowMs: 100, clock: () => now });
  const created = await request(app, "POST", "/api/qr-links", { headers, body: { destination: "https://example.com" } }); const code = created.json().code;
  await request(app, "POST", `/api/qr-links/${code}/disable`, { headers }); assert.equal((await request(app, "GET", `/r/${code}`)).status, 404); await request(app, "POST", `/api/qr-links/${code}/enable`, { headers }); assert.equal((await request(app, "GET", `/r/${code}`)).status, 302);
  for (let i = 0; i < 50; i++) { await request(app, "GET", `/r/${code}`); } assert.equal(rateStateSize(), 1); now += 200; await request(app, "GET", `/r/${code}`); assert.equal(rateStateSize(), 1);
});
