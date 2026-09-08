const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp, requireAuth } = require("../app");
const { AppError, sendAppError } = require("../core/errors");
const { registerModulePagesRoutes } = require("./module-pages");
const { request } = require("./test-http-harness");
const ZoneTree = require("../../app/zone-tree");

function setup(overrides = {}) {
  const store = new Map();
  const kvGet = (key) => (store.has(key) ? { value: store.get(key) } : null);
  const kvSet = (key, value) => store.set(key, value);
  const auditLog = [];
  const auditActivity = (options) => (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => { auditLog.push({ ...options, message: res.locals.auditMessage }); return originalJson(body); };
    next();
  };

  const app = createApp({ token: "test-token" });
  registerModulePagesRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError, ...overrides });
  const headers = { authorization: "Bearer test-token" };
  return { app, store, auditLog, headers };
}

const SAMPLE_TREE = { t: "z", k: "z1", blocks: ["gitlab.recent-commits"] };

test("GET /api/module-pages is empty when nothing was created", async () => {
  const { app, headers } = setup();
  const res = await request(app, "GET", "/api/module-pages", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), []);
});

test("POST /api/module-pages requires title and tree", async () => {
  const { app, headers } = setup();
  const res = await request(app, "POST", "/api/module-pages", { headers, body: { title: "Ops" } });
  assert.equal(res.status, 400);
  assert.equal(res.json().code, "BAD_REQUEST");
});

test("POST creates a page, defaults icon/active/sidebar visibility, and GET reflects it back", async () => {
  const { app, headers, auditLog } = setup();
  const created = await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Operación diaria", tree: SAMPLE_TREE },
  });
  assert.equal(created.status, 200);
  const page = created.json();
  assert.equal(page.title, "Operación diaria");
  assert.equal(page.icon, "grid", "icon defaults to grid when not given");
  assert.equal(page.active, true, "active defaults to true when not given");
  assert.equal(page.showInSidebar, true, "showInSidebar defaults to true when not given");
  assert.deepEqual(page.tree, SAMPLE_TREE);
  assert.ok(page.id.startsWith("page-"));
  assert.ok(page.createdAt && page.updatedAt);

  const list = await request(app, "GET", "/api/module-pages", { headers });
  assert.deepEqual(list.json(), [page]);
  assert.equal(auditLog[0].message, 'Crear página "Operación diaria"');
});

test("POST honors explicit icon, active:false, and showInSidebar:false", async () => {
  const { app, headers } = setup();
  const created = await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Borrador", icon: "gauge", active: false, showInSidebar: false, tree: SAMPLE_TREE },
  });
  const page = created.json();
  assert.equal(page.icon, "gauge");
  assert.equal(page.active, false);
  assert.equal(page.showInSidebar, false);
});

test("PUT updates an existing page and bumps updatedAt; 404s on unknown id", async () => {
  const { app, headers, auditLog } = setup();
  const created = await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Ops", tree: SAMPLE_TREE },
  });
  const page = created.json();

  const updatedTree = { t: "s", k: "s1", dir: "v", ratio: 0.5, a: SAMPLE_TREE, b: { t: "z", k: "z2", blocks: [] } };
  const updated = await request(app, "PUT", `/api/module-pages/${page.id}`, {
    headers, body: { title: "Ops renombrada", active: false, tree: updatedTree },
  });
  assert.equal(updated.status, 200);
  const body = updated.json();
  assert.equal(body.title, "Ops renombrada");
  assert.equal(body.active, false);
  assert.equal(body.showInSidebar, true, "unspecified sidebar visibility is preserved");
  assert.deepEqual(body.tree, updatedTree);
  assert.equal(body.icon, "grid", "unspecified fields are preserved");
  assert.notEqual(body.updatedAt, page.updatedAt);
  assert.equal(auditLog.at(-1).message, 'Editar página "Ops renombrada"');

  const notFound = await request(app, "PUT", "/api/module-pages/does-not-exist", { headers, body: { title: "x" } });
  assert.equal(notFound.status, 404);
});

test("legacy pages without showInSidebar stay unchanged until the field is explicitly saved", async () => {
  const { app, store, headers } = setup();
  const legacy = { id: "page-legacy", title: "Legacy", icon: "grid", active: true, tree: SAMPLE_TREE };
  store.set("module-pages", [legacy]);

  const before = await request(app, "GET", "/api/module-pages", { headers });
  assert.equal(Object.hasOwn(before.json()[0], "showInSidebar"), false, "GET preserves the old stored shape");

  const titleOnly = await request(app, "PUT", "/api/module-pages/page-legacy", {
    headers, body: { title: "Legacy renamed" },
  });
  assert.equal(Object.hasOwn(titleOnly.json(), "showInSidebar"), false, "unrelated updates do not rewrite legacy data");

  const hidden = await request(app, "PUT", "/api/module-pages/page-legacy", {
    headers, body: { showInSidebar: false },
  });
  assert.equal(hidden.json().active, true, "sidebar visibility does not deactivate the Board");
  assert.equal(hidden.json().showInSidebar, false);
});

test("DELETE removes the page and 404s on an unknown id", async () => {
  const { app, headers, auditLog } = setup();
  const created = await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Temporal", tree: SAMPLE_TREE },
  });
  const page = created.json();

  const deleted = await request(app, "DELETE", `/api/module-pages/${page.id}`, { headers });
  assert.deepEqual(deleted.json(), { ok: true });
  assert.equal(auditLog.at(-1).message, 'Borrar página "Temporal"');

  const list = await request(app, "GET", "/api/module-pages", { headers });
  assert.deepEqual(list.json(), []);

  const notFound = await request(app, "DELETE", `/api/module-pages/${page.id}`, { headers });
  assert.equal(notFound.status, 404);
});

test("zone-tree removal compacts an empty leaf and preserves the occupied sibling", () => {
  const tree = {
    t: "s", k: "s1", dir: "v", ratio: 0.35,
    a: { t: "z", k: "z1", blocks: ["gitlab.recent-commits"] },
    b: {
      t: "s", k: "s2", dir: "h", ratio: 0.6,
      a: { t: "z", k: "z2", blocks: ["outline.recent-docs"] },
      b: { t: "z", k: "z3", blocks: ["content-runbook"] },
    },
  };

  const compacted = ZoneTree.removeBlockAndCompact(tree, "z1", 0);
  assert.equal(compacted.k, "s2", "the occupied sibling is promoted into the released space");
  assert.equal(compacted.ratio, 0.6, "ratios inside the surviving subtree are preserved");
  assert.deepEqual(ZoneTree.flatten(compacted).zones.map(z => z.blocks), [
    ["outline.recent-docs"],
    ["content-runbook"],
  ]);
});

test("zone-tree removal keeps ordered siblings in a non-empty zone", () => {
  const tree = { t: "z", k: "z1", blocks: ["a", "b", "c"] };
  const next = ZoneTree.removeBlockAndCompact(tree, "z1", 1);
  assert.deepEqual(next, { t: "z", k: "z1", blocks: ["a", "c"] });
});

test("zone-tree removal of the final Block returns one valid empty leaf", () => {
  const next = ZoneTree.removeBlockAndCompact(
    { t: "z", k: "legacy-zone", blocks: ["only-block"] },
    "legacy-zone",
    0,
  );
  assert.equal(next.t, "z");
  assert.deepEqual(next.blocks, []);
  assert.equal(ZoneTree.countBlocks(next), 0);
  assert.ok(ZoneTree.firstZoneKey(next));
});

test("zone-tree compaction accepts the existing Board tree shape unchanged", () => {
  const legacyTree = {
    t: "s", k: "s8", dir: "v", ratio: 0.42,
    a: { t: "z", k: "z4", blocks: ["one"] },
    b: { t: "z", k: "z7", blocks: ["two"] },
  };
  assert.deepEqual(ZoneTree.compactTree(legacyTree), legacyTree);
});

test("adding to an empty zone keeps one pane, then adding again creates a resizable split", () => {
  const empty = { t: "z", k: "z1", blocks: [] };
  const first = ZoneTree.addBlockAsPane(empty, "z1", "first");
  assert.deepEqual(first, { t: "z", k: "z1", blocks: ["first"] });

  const second = ZoneTree.addBlockAsPane(first, "z1", "second");
  assert.equal(second.t, "s");
  assert.equal(second.dir, "h");
  assert.equal(second.ratio, 0.5);
  assert.deepEqual(ZoneTree.flatten(second).zones.map(zone => zone.blocks), [["first"], ["second"]]);
});

test("closing a newly added pane compacts back to the surviving Block", () => {
  const first = { t: "z", k: "z1", blocks: ["first"] };
  const withSibling = ZoneTree.addBlockAsPane(first, "z1", "second");
  const addedZone = ZoneTree.flatten(withSibling).zones.find(zone => zone.blocks[0] === "second");
  const compacted = ZoneTree.removeBlockAndCompact(withSibling, addedZone.k, 0);
  assert.deepEqual(compacted, first);
});

test("updating one Board tree leaves another Board and the global Block library untouched", async () => {
  const { app, store, headers } = setup();
  const sharedTree = { t: "z", k: "z1", blocks: ["content-shared"] };
  const first = (await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Board A", tree: sharedTree },
  })).json();
  // The route uses Date.now() ids; keep the isolation fixtures distinct even
  // when the test runner completes two requests inside the same millisecond.
  await new Promise(resolve => setTimeout(resolve, 2));
  const second = (await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Board B", tree: sharedTree },
  })).json();
  const globalBlocks = [{ id: "content-shared", title: "Reusable" }];
  store.set("home-custom-blocks", globalBlocks);

  const emptyTree = ZoneTree.removeBlockAndCompact(first.tree, "z1", 0);
  const updated = await request(app, "PUT", `/api/module-pages/${first.id}`, {
    headers, body: { tree: emptyTree },
  });
  assert.equal(updated.status, 200);

  const boards = (await request(app, "GET", "/api/module-pages", { headers })).json();
  assert.deepEqual(boards.find(board => board.id === first.id).tree.blocks, []);
  assert.deepEqual(boards.find(board => board.id === second.id).tree, sharedTree);
  assert.deepEqual(store.get("home-custom-blocks"), globalBlocks);
});

test("resizing one Board persists only that Board's split ratio", async () => {
  const { app, headers } = setup();
  const originalTree = {
    t: "s", k: "s1", dir: "v", ratio: 0.5,
    a: { t: "z", k: "z1", blocks: ["left"] },
    b: { t: "z", k: "z2", blocks: ["right"] },
  };
  const first = (await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Resizable A", tree: originalTree },
  })).json();
  // The compatibility route currently derives page ids from Date.now(). Keep
  // the two fixtures in distinct milliseconds so this isolation assertion is
  // about Board trees rather than an incidental id collision in the harness.
  await new Promise(resolve => setTimeout(resolve, 2));
  const second = (await request(app, "POST", "/api/module-pages", {
    headers, body: { title: "Resizable B", tree: originalTree },
  })).json();

  const resizedTree = ZoneTree.setRatio(first.tree, "s1", 0.7);
  const updated = await request(app, "PUT", `/api/module-pages/${first.id}`, {
    headers, body: { tree: resizedTree },
  });
  assert.equal(updated.status, 200);

  const boards = (await request(app, "GET", "/api/module-pages", { headers })).json();
  assert.equal(boards.find(board => board.id === first.id).tree.ratio, 0.7);
  assert.equal(boards.find(board => board.id === second.id).tree.ratio, 0.5);
});
