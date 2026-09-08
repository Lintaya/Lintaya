const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  connectorManifests,
  connectorMetadata,
  findManifestFiles,
  isSupportedHere,
  findUserManifestFiles,
  getConnectorConfigSchema,
  listAutoSyncTargets,
  listConnectorBlocks,
  listConnectorCatalog,
  listConnectorModules,
  loadConnectorManifests,
  userConnectorsDir,
  validateManifest,
} = require("./registry");

test("loads every connector from its tier folder", () => {
  // Deliberately loaded with an empty user directory. `connectorManifests` is
  // built with the real one, so asserting against it would describe whichever
  // connectors the machine running this happens to have installed rather than
  // what the repository ships — which is what this test is about.
  const shipped = loadConnectorManifests({ userDir: tempDir() });
  assert.equal(shipped.size, 7);
  assert.deepEqual(
    [...shipped.keys()].sort(),
    ["bitbucket", "bw", "github", "gitlab", "outline", "plane", "portainer"],
  );

  const tierCounts = { community: 0, enterprise: 0, development: 0 };
  for (const manifest of shipped.values()) {
    tierCounts[manifest.tier] += 1;
    assert.equal(manifest.license, "Apache-2.0");
  }
  // Instancias extra (ej. una segunda conexión GitLab) ya no son manifests
  // propios — el mismo paquete "gitlab" las registra bajo otro id en caliente
  // (ver connectors/loader.js y ADR-008/CONN-017 en el roadmap interno).
  // Los tiers enterprise y development ya no se entregan aquí: sus seis
  // conectores viven en su propio repositorio y se instalan bajo
  // LINTAYA_CONNECTORS_DIR (ADR-014 Fase 3).
  assert.deepEqual(tierCounts, { community: 7, enterprise: 0, development: 0 });
});

test("exposes safe connector metadata for API responses", () => {
  assert.deepEqual(connectorMetadata("portainer"), {
    tier: "community",
    lifecycle: "beta",
    license: "Apache-2.0",
    connectorVersion: "0.2.0",
    capabilities: ["containers.read", "endpoints.read", "logs.read"],
    modules: [{ id: "containers", label: "Contenedores", icon: "containers", component: "ContainersView", navOrder: 45 }],
  });
  assert.deepEqual(connectorMetadata("unknown"), {});
});

test("reads every connector's config.schema.json from beside its manifest", () => {
  for (const id of connectorManifests.keys()) {
    const schema = getConnectorConfigSchema(id);
    assert.ok(schema, `${id} is missing config.schema.json`);
    assert.equal(schema.type, "object");
    assert.ok(schema.properties && Object.keys(schema.properties).length > 0, `${id} has no properties`);
  }
  assert.equal(getConnectorConfigSchema("unknown"), null);
});

test("builds the New connection catalog from manifests and safe schema metadata", () => {
  const catalog = listConnectorCatalog();
  const github = catalog.find((connector) => connector.id === "github");
  assert.deepEqual(github, {
    id: "github",
    displayName: "GitHub",
    tier: "community",
    lifecycle: "beta",
    capabilities: ["repositories.read", "repositories.create", "repositories.clone", "pull-requests.read", "deployments.read", "workflows.read", "commits.read"],
    instantiable: true,
    config: {
      title: "GitHub connector configuration",
      description: "",
      fields: [
        { id: "baseUrl", label: "base Url", required: false, secret: false },
        { id: "token", label: "token", required: true, secret: true },
      ],
    },
  });
  assert.equal(catalog.some((connector) => Object.hasOwn(connector, "manifestPath")), false);
});

test("rejects a manifest stored under the wrong tier", () => {
  const root = path.join("tmp", "connectors");
  const manifestPath = path.join(root, "community", "example", "manifest.json");
  assert.throws(() => validateManifest({
    manifestVersion: 1,
    id: "example",
    displayName: "Example",
    version: "1.0.0",
    tier: "enterprise",
    lifecycle: "beta",
    license: "Apache-2.0",
    capabilities: ["projects.read"],
    implementation: { mode: "legacy", source: "server/server.js" },
  }, manifestPath, root), /does not match folder/);
});

function baseManifest(extra = {}) {
  return {
    manifestVersion: 1,
    id: "example",
    displayName: "Example",
    version: "1.0.0",
    tier: "community",
    lifecycle: "beta",
    license: "Apache-2.0",
    capabilities: ["projects.read"],
    implementation: { mode: "package", source: "server/connectors/community/example/index.js" },
    ...extra,
  };
}

test("validates the optional autoSync block", () => {
  const root = path.join("tmp", "connectors");
  const manifestPath = path.join(root, "community", "example", "manifest.json");
  const check = (autoSync) => validateManifest(baseManifest({ autoSync }), manifestPath, root);

  assert.ok(check({ group: "slow", path: "/api/connectors/x/y/sync" }));
  assert.ok(check({ enabled: false }));
  assert.throws(() => check([]), /autoSync must be an object/);
  assert.throws(() => check({ group: "medium" }), /fast or slow/);
  assert.throws(() => check({ path: "connectors/x/sync" }), /autoSync.path must be an/);
  assert.throws(() => check({ enabled: "no" }), /must be a boolean/);
});

test("every connector is a scheduled-sync target without saying so", () => {
  // Derived from the manifests rather than hand-kept. The list this replaced
  // had drifted and silently omitted two connectors, so what matters is that
  // every one of them is here without having to declare anything.
  const shipped = loadConnectorManifests({ userDir: tempDir() });
  const targets = listAutoSyncTargets(shipped);

  assert.equal(targets.length, shipped.size);
  for (const id of shipped.keys()) {
    assert.ok(targets.some(target => target.id === id), `${id} must be scheduled`);
  }

  const github = targets.find(target => target.id === "github");
  assert.deepEqual(github, { id: "github", path: "/api/connectors/github/sync", group: "fast" });
});

test("a connector declares its own cadence and route when it is the exception", () => {
  // Stated as a manifest rather than borrowed from a shipped connector: the one
  // that used to prove this — vCenter, slow and instance-scoped — now lives in
  // its own repository, and the rule it exercised is core's, not vCenter's.
  const manifests = new Map([
    ["slow-one", { id: "slow-one", autoSync: { group: "slow", path: "/api/connectors/slow-one/slow-one/sync" } }],
  ]);
  const target = listAutoSyncTargets(manifests).find(t => t.id === "slow-one");

  assert.equal(target.group, "slow");
  assert.equal(target.path, "/api/connectors/slow-one/slow-one/sync");
});

test("every shipped manifest validates against manifest.schema.json", () => {
  // The schema existed and nothing read it, so it had drifted: it declared
  // fourteen fields with additionalProperties:false while real manifests used
  // seventeen. A contract nobody checks describes what someone once intended,
  // not what is there — and this is the file a new connector gets written from.
  // El schema declara draft 2020-12, que tiene su propio punto de entrada.
  const Ajv = require("ajv/dist/2020");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.schema.json"), "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

  for (const [id, manifest] of loadConnectorManifests({ userDir: tempDir() })) {
    // manifestPath and packageRoot are recorded by the registry as it loads;
    // they are not part of the file on disk.
    const { manifestPath, packageRoot, ...onDisk } = manifest;
    assert.ok(
      validate(onDisk),
      `${id}: ${(validate.errors || []).map(e => `${e.instancePath || "/"} ${e.message}`).join("; ")}`,
    );
  }
});

test("a connector runs everywhere unless its manifest says otherwise", () => {
  assert.equal(isSupportedHere({ id: "a" }), true, "no platforms declared means every platform");
  assert.equal(isSupportedHere({ id: "a", os: [] }), true, "an empty list is not a claim");
  assert.equal(isSupportedHere({ id: "a", os: ["win32"] }, "win32"), true);
  assert.equal(isSupportedHere({ id: "a", os: ["win32"] }, "linux"), false);
  assert.equal(isSupportedHere({ id: "a", os: ["darwin", "linux"] }, "linux"), true);
});

test("a connector this machine cannot run is not scheduled", () => {
  // outlook-local drives the Outlook desktop app through PowerShell and COM.
  // Scheduling it on Linux means a failure every cycle for a reason no log
  // line explains — the field was declared long before anything read it.
  const manifests = new Map([
    ["everywhere", { id: "everywhere" }],
    ["windows-only", { id: "windows-only", os: ["win32"] }],
  ]);
  const ids = listAutoSyncTargets(manifests).map(target => target.id);

  assert.ok(ids.includes("everywhere"));
  assert.equal(ids.includes("windows-only"), process.platform === "win32");
});

test("a connector can opt out of the scheduler", () => {
  const manifests = new Map([
    ["a", { id: "a" }],
    ["b", { id: "b", autoSync: { enabled: false } }],
  ]);

  assert.deepEqual(listAutoSyncTargets(manifests).map(target => target.id), ["a"]);
});

test("validates declared Home blocks", () => {
  const root = path.join("tmp", "connectors");
  const manifestPath = path.join(root, "community", "example", "manifest.json");
  const check = (blocks) => validateManifest(baseManifest({ blocks }), manifestPath, root);

  assert.ok(check([{ id: "recent-items", title: "Example — items", type: "list" }]));
  assert.throws(() => check([]), /non-empty/);
  assert.throws(() => check([{ id: "Bad Id", title: "x", type: "list" }]), /invalid block id/);
  assert.throws(() => check([
    { id: "dup", title: "x", type: "list" },
    { id: "dup", title: "y", type: "list" },
  ]), /duplicate block id/);
  assert.throws(() => check([{ id: "no-title", title: "  ", type: "list" }]), /needs a title/);
  assert.throws(() => check([{ id: "bad-type", title: "x", type: "table" }]), /unsupported type/);
});

test("validates connector-owned full modules", () => {
  const root = path.join("tmp", "connectors");
  const manifestPath = path.join(root, "community", "example", "manifest.json");
  const check = (modules) => validateManifest(baseManifest({ modules }), manifestPath, root);

  assert.ok(check([{ id: "overview", label: "Overview", icon: "apps", component: "OverviewView", navOrder: 10 }]));
  assert.throws(() => check([]), /non-empty/);
  assert.throws(() => check([{ id: "Bad Id", label: "x", icon: "apps", component: "OverviewView" }]), /invalid module id/);
  assert.throws(() => check([{ id: "overview", label: "x", icon: "apps", component: "not-valid" }]), /invalid module component/);
  assert.throws(() => check([{ id: "overview", label: "x", icon: "apps", component: "OverviewView", navOrder: -1 }]), /invalid module navOrder/);
});

test("validates the optional upstreamApi block", () => {
  const root = path.join("tmp", "connectors");
  const manifestPath = path.join(root, "community", "example", "manifest.json");
  const check = (upstreamApi) => validateManifest(baseManifest({ upstreamApi }), manifestPath, root);

  assert.ok(check({ name: "GitHub REST API", version: "2022-11-28", supportedUntil: "2028-03-10" }));
  assert.ok(check({ name: "GitHub REST API", version: "2022-11-28" }), "supportedUntil/docs are optional");
  assert.throws(() => check({ version: "2022-11-28" }), /upstreamApi\.name is required/);
  assert.throws(() => check({ name: "GitHub REST API" }), /upstreamApi\.version is required/);
  assert.throws(() => check({ name: "GitHub REST API", version: "2022-11-28", supportedUntil: "not-a-date" }), /YYYY-MM-DD/);
});

test("github declares its pinned REST API version and EOL", () => {
  const github = connectorManifests.get("github");
  assert.deepEqual(github.upstreamApi, {
    name: "GitHub REST API",
    version: "2022-11-28",
    supportedUntil: "2028-03-10",
    docs: "https://docs.github.com/en/rest/about-the-rest-api/api-versions",
  });
});

test("flattens declared blocks into the Home catalog", () => {
  const blocks = listConnectorBlocks();
  const ids = blocks.map(b => b.id);
  assert.ok(ids.includes("gitlab.recent-commits"));
  assert.ok(ids.includes("outline.recent-docs"));

  assert.deepEqual(blocks.find(b => b.id === "gitlab.recent-commits"), {
    id: "gitlab.recent-commits",
    connectorId: "gitlab",
    blockId: "recent-commits",
    title: "GitLab — últimos commits",
    icon: "🔧",
    type: "list",
  });

  // Declared blocks also travel with the connector metadata the API exposes.
  assert.deepEqual(connectorMetadata("gitlab").blocks, [
    { id: "recent-commits", title: "GitLab — últimos commits", icon: "🔧", type: "list" },
  ]);
});

test("flattens declared full modules into the navigation catalog", () => {
  const modules = listConnectorModules(loadConnectorManifests({ userDir: tempDir() }));
  assert.deepEqual(modules.filter((module) => ["bw", "gitlab", "portainer"].includes(module.connectorId)), [
    { connectorId: "portainer", moduleId: "containers", label: "Contenedores", icon: "containers", component: "ContainersView", navOrder: 45 },
    { connectorId: "bw", moduleId: "passwords", label: "Passwords", icon: "passwords", component: "PasswordsView", navOrder: 75 },
    { connectorId: "gitlab", moduleId: "repositories", label: "Repos {connectorName}", icon: "repos", component: "ReposView", navOrder: 90 },
  ]);
  assert.deepEqual(connectorMetadata("portainer").modules, [
    { id: "containers", label: "Contenedores", icon: "containers", component: "ContainersView", navOrder: 45 },
  ]);
});

// ── Installed connectors (ADR-014 Phase 2) ───────────────────────────────────
// A connector that does not ship with Lintaya lives outside the repository,
// under LINTAYA_CONNECTORS_DIR. These build one in a temp directory rather than
// stubbing the filesystem, because the whole point of the phase is that a real
// folder someone dropped in is discovered and loaded.

function installedConnector(dir, overrides = {}) {
  const manifest = {
    manifestVersion: 1,
    id: "acme",
    displayName: "ACME Internal",
    version: "1.0.0",
    tier: "enterprise",
    lifecycle: "beta",
    license: "Apache-2.0",
    capabilities: ["widgets.read"],
    implementation: { mode: "package", source: "index.js" },
    ...overrides,
  };
  const home = path.join(dir, manifest.id);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(home, "index.js"), "module.exports = { register() {} };");
  return home;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-connectors-"));
}

test("a connector installed outside the repository is discovered and loaded", () => {
  const dir = tempDir();
  const home = installedConnector(dir);

  const manifests = loadConnectorManifests({ userDir: dir });
  const acme = manifests.get("acme");

  assert.ok(acme, "the installed connector must be in the registry");
  assert.equal(acme.tier, "enterprise");
  // Its source is relative to its own folder, not to this repository, so the
  // recorded packageRoot is what makes the loader able to require it.
  assert.equal(acme.packageRoot, home);
  assert.equal(manifests.get("github").packageRoot, path.join(__dirname, "..", ".."));
});

test("an installed connector declares its own tier, having no tier folder", () => {
  const dir = tempDir();
  installedConnector(dir, { tier: "community" });

  // In-repo the folder and the manifest must agree; there is no folder to agree
  // with here, so the declared tier simply has to be one that exists.
  assert.equal(loadConnectorManifests({ userDir: dir }).get("acme").tier, "community");

  const bogus = tempDir();
  installedConnector(bogus, { tier: "invented" });
  assert.throws(() => loadConnectorManifests({ userDir: bogus }), /invalid tier/);
});

test("an installed connector may not take the id of one Lintaya ships", () => {
  const dir = tempDir();
  installedConnector(dir, { id: "github", displayName: "Not GitHub" });

  // Shadowing a shipped connector is the substitution nobody would notice, so
  // it fails loudly and names both manifests rather than picking a winner.
  assert.throws(
    () => loadConnectorManifests({ userDir: dir }),
    (error) => /Duplicate connector id: github/.test(error.message)
      && error.message.includes("collides with"),
  );
});

test("every other manifest rule applies to an installed connector too", () => {
  const dir = tempDir();
  installedConnector(dir, { capabilities: [] });

  assert.throws(() => loadConnectorManifests({ userDir: dir }), /capabilities must not be empty/);
});

test("a missing or unset user directory is the normal case, not an error", () => {
  assert.deepEqual(findUserManifestFiles(path.join(tempDir(), "nope")), []);
  assert.deepEqual(findUserManifestFiles(undefined), []);

  // The shipped set loads unchanged when nothing is installed. Counted from the
  // tier folders rather than from `connectorManifests`, which carries whatever
  // is installed on this machine too.
  assert.equal(loadConnectorManifests({ userDir: tempDir() }).size, findManifestFiles(__dirname).length);
});

test("the user directory is read from the environment, with a home default", () => {
  assert.equal(userConnectorsDir({ LINTAYA_CONNECTORS_DIR: "/opt/lintaya" }), "/opt/lintaya");
  assert.equal(userConnectorsDir({}), path.join(os.homedir(), ".lintaya", "connectors"));
});

test("a folder without a manifest is skipped rather than failing the scan", () => {
  const dir = tempDir();
  installedConnector(dir);
  // A stray folder — a half-finished clone, a README, an editor's leftovers.
  fs.mkdirSync(path.join(dir, "not-a-connector"), { recursive: true });
  fs.writeFileSync(path.join(dir, "loose-file.txt"), "ignored");

  assert.deepEqual(findUserManifestFiles(dir).map(p => path.basename(path.dirname(p))), ["acme"]);
});
