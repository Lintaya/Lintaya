const assert = require("node:assert/strict");
const test = require("node:test");

const { connectorManifests, getConnectorConfigSchema } = require("../registry");
const { createActionRegistry } = require("../../core/actions/registry");
const { registerAllActions } = require("../../core/actions/bootstrap");
const { createConnectorLogger } = require("../../core/services/connector-logger");
const { createConnectorStore } = require("../../core/services/connector-store");
const { assertActionsContract, assertConnectorContract, secretFieldsFromSchema } = require("./contracts");
const { collectPages } = require("./pagination");

test("shared pagination preserves provider order without loss or duplication", async () => {
  const pages = [
    { values: [{ id: 1 }, { id: 2 }], next: "b" },
    { values: [{ id: 3 }, { id: 4 }], next: "c" },
    { values: [{ id: 5 }], next: null },
  ];
  const result = await collectPages({
    fetchPage: async (_cursor, index) => pages[index],
    getItems: page => page.values,
    getNext: page => page.next,
  });
  assert.deepEqual(result.items.map(item => item.id), [1, 2, 3, 4, 5]);
  assert.equal(new Set(result.items.map(item => item.id)).size, result.items.length);
  assert.deepEqual({ pageCount: result.pageCount, truncated: result.truncated }, { pageCount: 3, truncated: false });
});

test("shared pagination reports truncation and propagates provider errors", async () => {
  const result = await collectPages({
    maxPages: 2,
    fetchPage: async (_cursor, index) => ({ values: [index + 1], next: `page-${index + 2}` }),
    getItems: page => page.values,
    getNext: page => page.next,
  });
  assert.deepEqual(result, { items: [1, 2], pageCount: 2, truncated: true });
  await assert.rejects(collectPages({
    fetchPage: async () => { throw new Error("rate-limited"); },
    getItems: page => page.values,
    getNext: page => page.next,
  }), /rate-limited/);
});

test("every registered connector action has a closed, classified contract", () => {
  const registry = createActionRegistry();
  registerAllActions(registry, { bitwarden: { runBw: async () => "", readVaultItems: () => [] } });
  for (const connectorTypeId of new Set(registry.listActions().map(action => action.connectorTypeId))) {
    assertActionsContract({ connectorTypeId, actions: registry.listActionsForType(connectorTypeId) });
  }
});

test("every connector redacts exactly the secrets declared by its config schema", () => {
  for (const manifest of connectorManifests.values()) {
    const schema = getConnectorConfigSchema(manifest.id);
    const secretFields = secretFieldsFromSchema(schema);
    // outlook-local drives whichever account is already signed into the local
    // Outlook desktop app via COM — there is no credential it stores, so it
    // has nothing to declare as secret. Every remote-API connector still must.
    if (!secretFields.length) {
      assert.equal(manifest.id, "outlook-local", `${manifest.id}: config schema must declare its sensitive fields`);
      continue;
    }
    const values = new Map();
    const store = createConnectorStore({
      id: manifest.id,
      kvGet: (key) => values.has(key) ? { value: values.get(key) } : null,
      kvSet: (key, value) => values.set(key, value),
    });
    const secrets = Object.fromEntries(secretFields.map((field) => [field, `${manifest.id}-${field}-secret`]));
    store.setConfig({ endpoint: "https://example.test", ...secrets });
    const publicConfig = assertConnectorContract({ manifest, store, schema });
    for (const field of secretFields) {
      assert.equal(publicConfig[`has${field.charAt(0).toUpperCase()}${field.slice(1)}`], true, `${manifest.id}: ${field} presence is retained`);
      assert.equal(JSON.stringify(publicConfig).includes(secrets[field]), false, `${manifest.id}: ${field} value leaked`);
    }
  }
});

test("shared connector logger redacts every secret declared by every connector schema", () => {
  for (const manifest of connectorManifests.values()) {
    const secretFields = secretFieldsFromSchema(getConnectorConfigSchema(manifest.id));
    if (!secretFields.length) continue; // outlook-local: no credentials, see the test above
    const secrets = secretFields.map((field) => `${manifest.id}-${field}-secret`);
    const entries = [];
    const logger = createConnectorLogger({ id: manifest.id, getSecrets: () => secrets, write: (...args) => entries.push(args) });
    logger("error", secrets.join(" "), { nested: { secret: secrets[0] }, values: secrets });
    const recorded = JSON.stringify(entries[0]);
    for (const secret of secrets) assert.equal(recorded.includes(secret), false, `${manifest.id}: logger leaked ${secretFields[secrets.indexOf(secret)]}`);
    assert.match(recorded, /\[REDACTED\]/, `${manifest.id}: logger did not redact a secret`);
  }
});
