const {
  ConnectorHttpError,
  buildHttpUrl,
  errorCodeForStatus,
  requestJson,
} = require("../../core/services/http");
const { createConnectorLogger } = require("../../core/services/connector-logger");
const { connectorKeys, createConnectorStore, getConnectorConfig } = require("../../core/services/connector-store");
const { publicConnectorConfig, redactText } = require("../../core/services/secrets");
const { normalizeBlockItem, registerBlockRoute } = require("./blocks");
const { assertActionsContract, assertConnectorContract } = require("./contracts");
const { collectPages } = require("./pagination");
const { guardAsyncRoute } = require("./route-guard");

module.exports = Object.freeze({
  ConnectorHttpError,
  assertActionsContract,
  assertConnectorContract,
  buildHttpUrl,
  collectPages,
  connectorKeys,
  createConnectorLogger,
  createConnectorStore,
  errorCodeForStatus,
  getConnectorConfig,
  guardAsyncRoute,
  normalizeBlockItem,
  publicConnectorConfig,
  redactText,
  registerBlockRoute,
  requestJson,
});
