const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionRegistry, publicActionShape } = require("./registry");

function baseAction(overrides = {}) {
  return {
    id: "sync",
    connectorTypeId: "gitlab",
    title: "Sync",
    effect: "write",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    handler: async () => ({}),
    ...overrides,
  };
}

test("registers an action and finds it by connectorTypeId + id", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  const found = registry.getAction("gitlab", "sync");
  assert.ok(found);
  assert.equal(found.title, "Sync");
  assert.equal(found.effect, "write");
});

test("getAction returns null for an unknown type or id", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  assert.equal(registry.getAction("gitlab", "unknown"), null);
  assert.equal(registry.getAction("unknown-type", "sync"), null);
});

test("rejects a duplicate connectorTypeId.id registration", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  assert.throws(() => registry.registerAction(baseAction()), /already registered/);
});

test("rejects registration missing a required field", () => {
  const registry = createActionRegistry();
  for (const field of ["id", "connectorTypeId", "title", "inputSchema", "outputSchema", "handler"]) {
    const action = baseAction();
    delete action[field];
    assert.throws(() => registry.registerAction(action), new RegExp(field), `missing ${field} should throw`);
  }
});

test("rejects a non-function handler", () => {
  const registry = createActionRegistry();
  assert.throws(() => registry.registerAction(baseAction({ handler: "not-a-function" })), /must be a function/);
});

test("an action with no declared effect defaults to destructive (fail-safe, not fail-loud)", () => {
  const registry = createActionRegistry();
  const action = baseAction();
  delete action.effect;
  registry.registerAction(action);
  assert.equal(registry.getAction("gitlab", "sync").effect, "destructive");
});

test("an action with an unrecognized effect value also defaults to destructive", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction({ effect: "delete-everything" }));
  assert.equal(registry.getAction("gitlab", "sync").effect, "destructive");
});

test("requiresConfig defaults to true when not declared (opt-out, not opt-in)", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  assert.equal(registry.getAction("gitlab", "sync").requiresConfig, true);
});

test("requiresConfig: false is preserved when explicitly declared", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction({ requiresConfig: false }));
  assert.equal(registry.getAction("gitlab", "sync").requiresConfig, false);
});

test("supportsCancellation defaults to false when not declared", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  assert.equal(registry.getAction("gitlab", "sync").supportsCancellation, false);
});

test("listActions returns every registered action across types", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  registry.registerAction(baseAction({ id: "status", connectorTypeId: "gitlab", effect: "read" }));
  registry.registerAction(baseAction({ id: "list-issues", connectorTypeId: "plane", effect: "read" }));
  assert.equal(registry.listActions().length, 3);
});

test("listActionsForType filters to one connectorTypeId", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  registry.registerAction(baseAction({ id: "status", connectorTypeId: "gitlab", effect: "read" }));
  registry.registerAction(baseAction({ id: "list-issues", connectorTypeId: "plane", effect: "read" }));
  const gitlabActions = registry.listActionsForType("gitlab");
  assert.equal(gitlabActions.length, 2);
  assert.ok(gitlabActions.every((a) => a.connectorTypeId === "gitlab"));
});

test("two separate createActionRegistry() instances do not share state", () => {
  const a = createActionRegistry();
  const b = createActionRegistry();
  a.registerAction(baseAction());
  assert.equal(a.getAction("gitlab", "sync") !== null, true);
  assert.equal(b.getAction("gitlab", "sync"), null);
});

test("publicActionShape strips the handler function", () => {
  const registry = createActionRegistry();
  registry.registerAction(baseAction());
  const shape = publicActionShape(registry.getAction("gitlab", "sync"));
  assert.equal(shape.handler, undefined);
  assert.equal(shape.id, "sync");
  assert.equal(shape.connectorTypeId, "gitlab");
  assert.equal(shape.effect, "write");
});
