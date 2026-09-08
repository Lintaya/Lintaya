// Reusable, provider-agnostic assertions for Connector SDK integrations.
// These are deliberately independent from a remote provider: a connector must
// prove that its local contract never leaks configured secrets and that its
// declared manifest identity remains stable. HTTP timeout/cancel behavior is
// guaranteed once by core/services/http.test.js through requestJson().
const assert = require("node:assert/strict");

function secretFieldsFromSchema(schema) {
  return Object.entries(schema?.properties || {})
    .filter(([, property]) => property?.["x-lintaya-secret"] || property?.writeOnly)
    .map(([field]) => field);
}

function secretPresenceKey(field) {
  return `has${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

function assertConnectorContract({ manifest, store, schema, secretFields }) {
  assert.ok(manifest?.id, "connector contract requires a manifest id");
  assert.ok(Array.isArray(manifest.capabilities), `${manifest.id}: capabilities must be declared`);
  assert.equal(typeof store?.getPublicConfig, "function", `${manifest.id}: connector store is required`);
  const declaredSecrets = secretFields || secretFieldsFromSchema(schema);
  const publicConfig = store.getPublicConfig(declaredSecrets);
  const storedConfig = typeof store.getConfig === "function" ? store.getConfig() : null;
  for (const field of declaredSecrets) {
    assert.equal(Object.hasOwn(publicConfig, field), false, `${manifest.id}: secret ${field} leaked from public config`);
    if (storedConfig && Object.hasOwn(storedConfig, field)) {
      assert.equal(Object.hasOwn(publicConfig, secretPresenceKey(field)), true, `${manifest.id}: secret ${field} lost its presence marker`);
    }
  }
  return publicConfig;
}

function assertActionsContract({ connectorTypeId, actions }) {
  assert.ok(connectorTypeId, "actions contract requires a connector type id");
  assert.ok(Array.isArray(actions) && actions.length > 0, `${connectorTypeId}: at least one action is required`);
  const ids = new Set();
  for (const action of actions) {
    assert.equal(action.connectorTypeId, connectorTypeId, `${connectorTypeId}: action belongs to another connector type`);
    assert.ok(action.id && !ids.has(action.id), `${connectorTypeId}: action ids must be present and unique`);
    ids.add(action.id);
    assert.ok(["read", "write", "destructive"].includes(action.effect), `${connectorTypeId}.${action.id}: invalid effect`);
    for (const [name, schema] of [["input", action.inputSchema], ["output", action.outputSchema]]) {
      assert.equal(schema?.type, "object", `${connectorTypeId}.${action.id}: ${name} schema must describe an object`);
      assert.equal(schema.additionalProperties, false, `${connectorTypeId}.${action.id}: ${name} schema must reject undeclared fields`);
    }
    assert.equal(typeof action.handler, "function", `${connectorTypeId}.${action.id}: handler is required`);
  }
  return actions;
}

module.exports = { assertActionsContract, assertConnectorContract, secretFieldsFromSchema };
