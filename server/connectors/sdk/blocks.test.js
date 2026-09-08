const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeBlockItem, registerBlockRoute } = require("./blocks");

test("normalizes block items and drops the ones without id or title", () => {
  assert.equal(normalizeBlockItem(null), null);
  assert.equal(normalizeBlockItem({ title: "no id" }), null);
  assert.equal(normalizeBlockItem({ id: "x" }), null);

  assert.deepEqual(normalizeBlockItem({ id: 7, title: "numeric id" }), { id: "7", title: "numeric id" });
  assert.deepEqual(
    normalizeBlockItem({
      id: "a",
      title: "full",
      subtitle: "sub",
      timestamp: "2026-08-15T10:00:00Z",
      url: "https://example.test/a",
      badge: { text: "new", color: "#f00", extra: "dropped" },
      extra: "dropped",
    }),
    {
      id: "a",
      title: "full",
      subtitle: "sub",
      timestamp: "2026-08-15T10:00:00Z",
      url: "https://example.test/a",
      badge: { text: "new", color: "#f00" },
    },
  );
  // A badge without text is noise, not a badge.
  assert.deepEqual(normalizeBlockItem({ id: "b", title: "t", badge: { color: "#f00" } }), { id: "b", title: "t" });
});

test("registerBlockRoute mounts the standard route and validates its inputs", async () => {
  const routes = new Map();
  const app = { get: (routePath, _auth, handler) => routes.set(routePath, handler) };
  const requireAuth = () => {};

  assert.throws(() => registerBlockRoute({ app, requireAuth, id: "x", blockId: "y" }), /getBlock/);

  registerBlockRoute({
    app,
    requireAuth,
    id: "example",
    blockId: "recent-items",
    getBlock: () => ({ items: [{ id: 1, title: "ok" }, { title: "dropped" }], updatedAt: "2026-08-16T00:00:00Z" }),
  });

  const handler = routes.get("/api/connectors/example/blocks/recent-items");
  assert.ok(handler);

  const invoke = async () => new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    handler({}, res);
  });

  assert.deepEqual(await invoke(), {
    status: 200,
    body: { items: [{ id: "1", title: "ok" }], updatedAt: "2026-08-16T00:00:00Z" },
  });
});

test("getBlock receives the request, so a connector can read scope/limit from the query string", async () => {
  const routes = new Map();
  const app = { get: (routePath, _auth, handler) => routes.set(routePath, handler) };
  const requireAuth = () => {};
  let seenReq = null;

  registerBlockRoute({
    app,
    requireAuth,
    id: "example",
    blockId: "scoped",
    getBlock: (req) => { seenReq = req; return { items: [] }; },
  });

  const handler = routes.get("/api/connectors/example/blocks/scoped");
  const req = { query: { scope: "repo-a", limit: "10" } };
  await new Promise(resolve => {
    handler(req, { status() { return this; }, json: resolve });
  });

  assert.equal(seenReq, req);
  assert.equal(seenReq.query.scope, "repo-a");
});
