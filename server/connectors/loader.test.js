const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { REGISTER_EXPORT, registerConnectorInstance, registerConnectors } = require("./loader");
const { connectorManifests, loadConnectorManifests } = require("./registry");
const { AppError } = require("../core/errors");

function manifestMap(entries) {
  return new Map(entries.map(e => [e.id, {
    id: e.id,
    implementation: { mode: e.mode || "package", source: e.source || `server/connectors/community/${e.id}/index.js` },
    ...(e.instantiable ? { instantiable: true } : {}),
    ...(e.os ? { os: e.os } : {}),
  }]));
}

test("every package connector is loaded and registers itself", () => {
  const seen = [];
  const context = { app: "app" };
  const registered = registerConnectors({
    manifests: manifestMap([{ id: "alpha" }, { id: "beta" }]),
    context,
    load: (modulePath) => ({
      [REGISTER_EXPORT]: (ctx) => seen.push({ modulePath, ctx }),
    }),
  });

  assert.deepEqual(registered, ["alpha", "beta"]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].ctx, context, "the same context reaches every connector");
  assert.match(seen[0].modulePath, /alpha[\\/]index\.js$/);
});

test("legacy connectors are skipped, not loaded", () => {
  let loads = 0;
  const registered = registerConnectors({
    manifests: manifestMap([{ id: "modern" }, { id: "old", mode: "legacy" }]),
    context: {},
    load: () => { loads += 1; return { [REGISTER_EXPORT]: () => {} }; },
  });
  assert.deepEqual(registered, ["modern"]);
  assert.equal(loads, 1, "a legacy connector is never required");
});

test("a connector this machine cannot run is never mounted", () => {
  // Declaring the platform was not enough on its own: outlook-local says
  // `os: ["win32"]` and, until this, still loaded on Linux and macOS, mounted
  // its routes and offered itself for configuration — then failed at the first
  // call with a COM error that named nothing about the real reason.
  const other = process.platform === "win32" ? "linux" : "win32";
  const lines = [];
  const registered = registerConnectors({
    manifests: manifestMap([{ id: "portable" }, { id: "elsewhere", os: [other] }]),
    context: { log: { info: (message) => lines.push(message) } },
    load: () => ({ [REGISTER_EXPORT]: () => {} }),
  });

  assert.deepEqual(registered, ["portable"]);
  assert.match(lines.at(-1), /elsewhere/, "and it says which one, or the connector is just mysteriously absent");
});

test("an instantiable connector also registers its known extra instances", () => {
  // ADR-008/CONN-017: una instancia extra no es un manifest propio — el mismo
  // paquete se registra otra vez con un id distinto, leído del KV
  // "connector-instances" que el context ya trae (kvGet).
  const calls = [];
  const registered = registerConnectors({
    manifests: manifestMap([
      { id: "gitlab", instantiable: true },
      { id: "vcenter" }, // no instantiable — nunca debería mirar el registro de instancias
    ]),
    context: {
      app: "app",
      kvGet: (key) => key === "connector-instances"
        ? { value: { gitlab: ["gitlab2", "gitlab3"] } }
        : null,
    },
    load: () => ({ [REGISTER_EXPORT]: (ctx, instanceId) => calls.push(instanceId) }),
  });

  assert.deepEqual(registered, ["gitlab", "gitlab2", "gitlab3", "vcenter"]);
  // register(context) para la base — sin segundo argumento — y
  // register(context, extraId) por cada instancia extra, en orden.
  assert.deepEqual(calls, [undefined, "gitlab2", "gitlab3", undefined]);
});

test("an instantiable connector with no known extra instances registers only the base", () => {
  const registered = registerConnectors({
    manifests: manifestMap([{ id: "gitlab", instantiable: true }]),
    context: { app: "app", kvGet: () => null },
    load: () => ({ [REGISTER_EXPORT]: () => {} }),
  });
  assert.deepEqual(registered, ["gitlab"]);
});

test("registerConnectorInstance mounts a single new instance in place, no restart", () => {
  // POST /api/connectors/:typeId/instances la llama justo después de crear la
  // instancia — tiene que poder montar sus rutas sin repetir registerConnectors().
  const calls = [];
  registerConnectorInstance({
    typeId: "gitlab",
    instanceId: "gitlab4",
    manifests: manifestMap([{ id: "gitlab", instantiable: true }]),
    context: { app: "app" },
    load: () => ({ [REGISTER_EXPORT]: (ctx, instanceId) => calls.push(instanceId) }),
  });
  assert.deepEqual(calls, ["gitlab4"]);
});

test("registerConnectorInstance refuses an unknown type or a non-instantiable one", () => {
  assert.throws(
    () => registerConnectorInstance({ typeId: "nope", instanceId: "x", manifests: manifestMap([]), context: {} }),
    /Unknown connector type "nope"/,
  );
  assert.throws(
    () => registerConnectorInstance({
      typeId: "vcenter", instanceId: "x",
      manifests: manifestMap([{ id: "vcenter" }]),
      context: {},
    }),
    /"vcenter" is not instantiable/,
  );
});

test("the source path is resolved from the repository root", () => {
  const seen = [];
  registerConnectors({
    manifests: manifestMap([{ id: "x", source: "server/connectors/enterprise/x/index.js" }]),
    context: {},
    root: path.join("/repo"),
    load: (p) => { seen.push(p); return { [REGISTER_EXPORT]: () => {} }; },
  });
  assert.equal(seen[0], path.join("/repo", "server/connectors/enterprise/x/index.js"));
});

test("a package without register() is named in the error", () => {
  // Without the id, a missing export surfaces as an anonymous startup failure.
  assert.throws(
    () => registerConnectors({
      manifests: manifestMap([{ id: "broken" }]),
      context: {},
      load: () => ({ somethingElse: () => {} }),
    }),
    /Connector "broken" must export register\(\)/,
  );
});

test("a module that cannot be required names the connector and its source", () => {
  assert.throws(
    () => registerConnectors({
      manifests: manifestMap([{ id: "missing", source: "server/connectors/community/missing/index.js" }]),
      context: {},
      load: () => { throw new Error("Cannot find module"); },
    }),
    (error) => /Connector "missing" could not be loaded/.test(error.message)
      && /missing\/index\.js/.test(error.message)
      && error.cause instanceof Error,
  );
});

test("a connector that throws while registering is identified", () => {
  assert.throws(
    () => registerConnectors({
      manifests: manifestMap([{ id: "angry" }]),
      context: {},
      load: () => ({ [REGISTER_EXPORT]: () => { throw new Error("missing dependency"); } }),
    }),
    (error) => /Connector "angry" failed to register: missing dependency/.test(error.message)
      && error.cause instanceof Error,
  );
});

test("registration refuses to run without a context", () => {
  assert.throws(() => registerConnectors({ manifests: manifestMap([]) }), /requires a context/);
});

test("every real connector in the registry exports register()", () => {
  // The contract that makes auto-registration possible — a package added
  // without it would only fail at server startup.
  const missing = [];
  for (const manifest of connectorManifests.values()) {
    if (manifest.implementation.mode !== "package") continue;
    // Through packageRoot, so this still holds on a machine that has a
    // connector installed under LINTAYA_CONNECTORS_DIR.
    const connector = require(path.join(manifest.packageRoot, manifest.implementation.source));
    if (typeof connector[REGISTER_EXPORT] !== "function") missing.push(manifest.id);
  }
  assert.deepEqual(missing, []);
});

test("every connector this repository ships registers against a fake app", () => {
  // Exercises the actual packages, not stubs: each one must survive being
  // handed the shared context and must claim its own routes. Loaded with an
  // empty user directory so it covers what the repository ships and not
  // whatever the machine running it happens to have installed.
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath) => routes.push(`${method.toUpperCase()} ${routePath}`);
  }

  const registered = registerConnectors({
    manifests: loadConnectorManifests({ userDir: path.join(os.tmpdir(), "lintaya-no-connectors") }),
    context: {
      app,
      requireAuth: (req, res, next) => next(),
      kvGet: () => null,
      kvSet: () => {},
      kvDelete: () => {},
      connectorLog: () => {},
      runBw: async () => "{}",
      binary: { bin: "bw" },
      readVaultItems: () => [],
      // vCenter's live and diagnostics routers moved out of core in ADR-014
      // Phase 1 and need these, so the shared context carries them. Mirrors
      // CONNECTOR_CONTEXT in server.js — a connector may only ask for what is
      // actually handed to every one of them.
      auditActivity: () => (req, res, next) => next(),
      AppError,
      sendAppError: () => {},
      log: { warn: () => {}, info: () => {} },
      workloadSources: { register: () => {} },
      // A connector installed outside the tree cannot resolve either by
      // relative path, so the context carries both (ADR-014). Passing them here
      // is also what production does — a harness that hands over something
      // else is how the logger-shape defect stayed invisible.
      sdk: require("./sdk"),
      express: require("express"),
    },
  });

  assert.equal(registered.length, 7);
  assert.ok(routes.length > 40, `expected the full route surface, got ${routes.length}`);

  // Each connector claimed routes under its own id.
  for (const id of registered) {
    const prefix = id === "vcenter" ? "/api/connectors/vcenter/" : `/api/connectors/${id}/`;
    assert.ok(
      routes.some(r => r.includes(prefix)),
      `connector "${id}" registered no route under ${prefix}`,
    );
  }

  // No two connectors claimed the same method+path.
  const duplicates = routes.filter((r, i) => routes.indexOf(r) !== i);
  assert.deepEqual(duplicates, [], "connectors must not register the same route twice");
});

test("a connector installed outside the repository registers from its own folder", () => {
  // ADR-014 Phase 2: the registry records the base each manifest's
  // implementation.source resolves against. Without honouring it, an installed
  // connector's path would be joined to the repository root and never found.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-loader-"));
  const home = path.join(dir, "acme");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, "index.js"),
    "module.exports = { register: (ctx) => ctx.app.get('/api/connectors/acme/ping', () => {}) };",
  );

  const routes = [];
  const registered = registerConnectors({
    manifests: new Map([["acme", {
      id: "acme",
      implementation: { mode: "package", source: "index.js" },
      packageRoot: home,
    }]]),
    context: { app: { get: (routePath) => routes.push(routePath) } },
  });

  assert.deepEqual(registered, ["acme"]);
  assert.deepEqual(routes, ["/api/connectors/acme/ping"]);
});
