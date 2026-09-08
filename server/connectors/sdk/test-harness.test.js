const assert = require("node:assert/strict");
const test = require("node:test");

const { createRouteHarness } = require("./test-harness");

function registerSampleRoutes({ app, requireAuth, kvGet, kvSet, connectorLog }) {
  app.get("/api/connectors/sample/config", requireAuth, (req, res) => {
    res.json({ configured: Boolean(kvGet("connector-config-sample")) });
  });
  app.post("/api/connectors/sample/config", requireAuth, (req, res) => {
    kvSet("connector-config-sample", req.body);
    connectorLog("sample", "ok", "saved");
    res.json({ ok: true });
  });
}

// Un conector que además usa PATCH (como Plane u Outline) y necesita un default
// inyectable (como `request`/`sync` en los conectores reales).
function registerSampleRoutesWithPatch({ app, requireAuth, greeting = "hi" }) {
  app.patch("/api/connectors/sample/items/:id", requireAuth, (req, res) => {
    res.json({ id: req.params.id, query: req.query, greeting, ...req.body });
  });
}

test("value mode passes the third argument straight through as the body", async () => {
  const createHarness = createRouteHarness(registerSampleRoutes);
  const harness = createHarness();

  const before = await harness.invoke("GET", "/api/connectors/sample/config");
  assert.deepEqual(before.body, { configured: false });

  const saved = await harness.invoke("POST", "/api/connectors/sample/config", { token: "t" });
  assert.deepEqual(saved.body, { ok: true });
  assert.deepEqual(harness.values.get("connector-config-sample"), { token: "t" });
  assert.equal(harness.logs[0].message, "saved");
});

test("envelope mode splits body/params/query and defaults them to {}", async () => {
  const createHarness = createRouteHarness(registerSampleRoutesWithPatch, {
    methods: ["patch"],
    mode: "envelope",
  });
  const harness = createHarness();

  const response = await harness.invoke("PATCH", "/api/connectors/sample/items/:id", {
    body: { name: "n" },
    params: { id: "42" },
    query: { verbose: "1" },
  });
  assert.deepEqual(response.body, { id: "42", query: { verbose: "1" }, greeting: "hi", name: "n" });
});

test("setup() defaults apply before overrides, and exposes extra state", async () => {
  const createHarness = createRouteHarness(registerSampleRoutesWithPatch, {
    methods: ["patch"],
    setup: () => {
      const seen = [];
      return {
        defaults: { greeting: "default-hi" },
        extra: { seen },
      };
    },
  });

  const withDefault = createHarness();
  const viaDefault = await withDefault.invoke("PATCH", "/api/connectors/sample/items/:id", {});
  assert.ok(Array.isArray(withDefault.seen));

  const withOverride = createHarness({ greeting: "override-hi" });
  const overridden = await withOverride.invoke("PATCH", "/api/connectors/sample/items/:id", undefined);
  assert.equal(overridden.body.greeting, "override-hi");
});

test("invoke() fails loudly when the route was never registered", async () => {
  const createHarness = createRouteHarness(registerSampleRoutes);
  const harness = createHarness();
  await assert.rejects(
    () => harness.invoke("DELETE", "/api/connectors/sample/config"),
    /Missing route DELETE/,
  );
});
