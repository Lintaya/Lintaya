// The public build ships the community connector tier only (ADR-014). These
// tests encode what that requires of core, because both ways it can break are
// silent until someone actually removes a tier and the server refuses to start.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { createActionRegistry } = require("./actions/registry");
const { registerAllActions } = require("./actions/bootstrap");
const { connectorManifests, listAutoSyncTargets } = require("../connectors/registry");

const SERVER_DIR = path.join(__dirname, "..");
const OPTIONAL_TIERS = /connectors\/(enterprise|development)\//;

// Everything core, which is all of server/ except the connector packages
// themselves and anything generated or installed.
function coreSourceFiles(dir = SERVER_DIR, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["connectors", "node_modules", "ssh-logs", "backups", "docs-files", "gitlab-clones"].includes(entry.name)) continue;
      coreSourceFiles(full, found);
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      found.push(full);
    }
  }
  return found;
}

function communityOnly() {
  return new Map([...connectorManifests].filter(([, manifest]) => manifest.tier === "community"));
}

// Phase 0 allowed core to name an optional tier as long as it did so through
// requireOptional. Phase 1 removed the last such reference, so the line moves:
// core may not name one of those packages at all. A connector reaches core
// through its manifest and the loader's context, never through a path.
function referencesOptionalTier(line) {
  return /require(Optional)?\s*\(/.test(line) && OPTIONAL_TIERS.test(line);
}

test("the reference detector recognises both shapes", () => {
  // Without this, the guard below would pass just as happily if the detector
  // quietly stopped matching anything at all.
  assert.equal(referencesOptionalTier('const x = require("./connectors/enterprise/vcenter");'), true);
  assert.equal(referencesOptionalTier('const x = requireOptional("./connectors/enterprise/vcenter", require);'), true);
  assert.equal(referencesOptionalTier('const x = require("./connectors/community/github");'), false);
});

test("core never requires a connector the public build may not ship", () => {
  const files = coreSourceFiles();
  assert.ok(files.length > 20, "the scan must actually reach core's source files");

  const offenders = [];
  for (const file of files) {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (referencesOptionalTier(line)) offenders.push(`${path.relative(SERVER_DIR, file)}:${index + 1}`);
    });
  }

  assert.deepEqual(offenders, [], `core must not name an optional tier: ${offenders.join(", ")}`);
});

test("every action registers from a community-only manifest set", () => {
  const registry = createActionRegistry();

  registerAllActions(
    registry,
    { bitwarden: { runBw: async () => "", readVaultItems: () => [], binary: "bw" } },
    { manifests: communityOnly() },
  );

  const types = new Set(registry.listActions().map(action => action.connectorTypeId));
  assert.ok(!types.has("vcenter"), "an absent tier must contribute no actions");
  assert.ok(types.has("github"), "community actions must still register");
});

test("scheduled sync survives a tier being absent", () => {
  const targets = listAutoSyncTargets(communityOnly());

  assert.equal(targets.length, communityOnly().size);
  assert.ok(!targets.some(target => target.id === "vcenter"));
  assert.ok(targets.some(target => target.id === "github"));
});

test("the registry loads a tree that has no enterprise or development tier", () => {
  // findManifestFiles skips a tier folder that is not there, so a public
  // checkout simply yields fewer manifests rather than an error.
  const tiers = new Set([...connectorManifests.values()].map(manifest => manifest.tier));

  assert.ok(tiers.has("community"));
  assert.equal(communityOnly().size > 0, true);
});
