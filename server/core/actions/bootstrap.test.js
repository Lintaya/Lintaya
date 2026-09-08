const assert = require("node:assert/strict");
const { test } = require("node:test");

const os = require("node:os");
const path = require("node:path");

const { createActionRegistry } = require("./registry");
const { registerAllActions } = require("./bootstrap");
const { loadConnectorManifests } = require("../../connectors/registry");

// What the repository ships, with the user directory deliberately empty. Left
// to its default, registerAllActions reads the live manifest set, which also
// carries whatever connectors the machine running this has installed — so
// these assertions would describe that machine instead of this repository.
const SHIPPED = loadConnectorManifests({ userDir: path.join(os.tmpdir(), "lintaya-no-connectors") });

// registerBitwardenActions requires runBw/readVaultItems with no default —
// stub them so registration itself (never invoked here) doesn't throw.
function setup() {
  const registry = createActionRegistry();
  registerAllActions(registry, {
    bitwarden: { runBw: async () => "", readVaultItems: () => [] },
  }, { manifests: SHIPPED });
  return registry;
}

test("registers every connector type this repository ships", () => {
  const registry = setup();
  const types = new Set(registry.listActions().map((a) => a.connectorTypeId));
  assert.deepEqual(
    [...types].sort(),
    ["bitbucket", "bw", "github", "gitlab", "outline", "plane", "portainer"].sort(),
  );
});

test("every type registers at least status/sync (or their equivalent read+write pair)", () => {
  const registry = setup();
  for (const typeId of ["gitlab", "github", "bitbucket", "plane", "outline", "portainer", "bw"]) {
    const actions = registry.listActionsForType(typeId);
    assert.ok(actions.length >= 2, `${typeId} should register at least 2 actions, got ${actions.length}`);
  }
});

test("the inventory of remote destructive provider actions is explicit and gated", () => {
  const registry = setup();
  const destructive = registry.listActions()
    .filter((action) => action.effect === "destructive")
    .map((action) => `${action.connectorTypeId}.${action.id}`)
    .sort();
  assert.deepEqual(destructive, ["outline.delete-document", "plane.delete-issue"]);
});

test("throws when registerAllActions is called without bitwarden's required runBw/readVaultItems", () => {
  const registry = createActionRegistry();
  assert.throws(() => registerAllActions(registry), /registerBitwardenActions requires/);
});

test("registering twice on the same registry throws (no silent double-registration)", () => {
  const registry = setup();
  assert.throws(
    () => registerAllActions(registry, { bitwarden: { runBw: async () => "", readVaultItems: () => [] } }),
    /already registered/,
  );
});
