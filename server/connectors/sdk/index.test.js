const assert = require("node:assert/strict");
const test = require("node:test");

const sdk = require(".");

test("Connector SDK exposes a frozen, explicit service boundary", () => {
  assert.equal(Object.isFrozen(sdk), true);
  assert.deepEqual(Object.keys(sdk).sort(), [
    "ConnectorHttpError",
    "assertActionsContract",
    "assertConnectorContract",
    "buildHttpUrl",
    "collectPages",
    "connectorKeys",
    "createConnectorLogger",
    "createConnectorStore",
    "errorCodeForStatus",
    "getConnectorConfig",
    "guardAsyncRoute",
    "normalizeBlockItem",
    "publicConnectorConfig",
    "redactText",
    "registerBlockRoute",
    "requestJson",
  ]);
  for (const service of Object.values(sdk)) assert.equal(typeof service, "function");
});
