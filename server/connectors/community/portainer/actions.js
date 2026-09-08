// AGENT-001 (ADR-011): Portainer's actions — same pattern as the other
// standard pilots, reusing `client.js`'s `token()`/`fetch()`/`sync()`
// exactly as `routes.js`'s `/test` and `/sync` routes do.
const { portainerFetch, portainerToken, syncPortainer } = require("./client");

const EMPTY_INPUT_SCHEMA = { type: "object", additionalProperties: false };

const STATUS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "latency", "endpoints"],
  properties: {
    status: { type: "string" },
    latency: { type: "string" },
    endpoints: { type: "integer", minimum: 0 },
  },
};

const SYNC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["endpointCount", "containerCount", "syncedAt"],
  properties: {
    endpointCount: { type: "integer", minimum: 0 },
    containerCount: { type: "integer", minimum: 0 },
    syncedAt: { type: "string" },
  },
};

function registerPortainerActions({
  registry,
  fetch = portainerFetch,
  token = portainerToken,
  sync = syncPortainer,
  now = Date.now,
  isoNow = () => new Date().toISOString(),
}) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "portainer",
    title: "Check connection status",
    effect: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: STATUS_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const startedAt = now();
      const authToken = await token(cfg);
      const endpoints = await fetch(cfg, "/api/endpoints", authToken);
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      return { status: "ok", latency, endpoints: Array.isArray(endpoints) ? endpoints.length : 0 };
    },
  });

  registry.registerAction({
    id: "sync",
    connectorTypeId: "portainer",
    title: "Sync endpoints and containers",
    effect: "write",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: SYNC_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const { endpoints, total } = await sync(cfg, { fetch, token });
      const syncedAt = isoNow();
      services.store.setData({ endpoints, syncedAt });
      services.store.setStatus({ status: "ok", lastSync: syncedAt, lastError: null, itemsSynced: total });
      return { endpointCount: endpoints.length, containerCount: total, syncedAt };
    },
  });
}

module.exports = { registerPortainerActions };
