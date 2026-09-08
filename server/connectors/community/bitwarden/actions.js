// AGENT-001 (ADR-011): Bitwarden's actions. `runBw`/`readVaultItems` have no
// sensible default the way `gitlabRequest` etc. do for the other pilots —
// they live in server.js's vault service (the CLI runner and the in-memory
// unlock session backing the whole /api/vault module, ~70 call sites), so
// they're required parameters here, same as `registerBitwardenRoutes`
// already requires them for the exact same reason (see that file's
// file-level comment — inverting the dependency would make a core subsystem
// depend on a connector package).
//
// Neither action needs a configured connection to run — `serverUrlOf(cfg)`
// falls back to the public Bitwarden server when `cfg` is null/has no
// `serverUrl`, exactly like routes.js's own `/test` and `/sync`, which never
// gate on `!cfg` — so both declare `requiresConfig: false`, same reasoning
// as outlook-local's actions.js sibling.
const {
  buildStatusRecord,
  bwApiKeyLogin,
  bwHealthCheck,
  hasApiKey,
  readCliStatus,
  serverUrlOf,
} = require("./client");

const EMPTY_INPUT_SCHEMA = { type: "object", additionalProperties: false };

const STATUS_RECORD_PROPERTIES = {
  status: { type: "string" },
  latency: { type: "string" },
  serverHealth: { type: "boolean" },
  serverUrl: { type: "string" },
  bwCliStatus: { type: ["string", "null"] },
  userEmail: { type: ["string", "null"] },
  lastError: { type: ["string", "null"] },
};

const STATUS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "latency", "serverHealth"],
  properties: STATUS_RECORD_PROPERTIES,
};

const SYNC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["itemsSynced", "syncedAt", "bwStatus", "serverHealth"],
  properties: {
    itemsSynced: { type: "integer", minimum: 0 },
    syncedAt: { type: "string" },
    bwStatus: { type: "string" },
    userEmail: { type: ["string", "null"] },
    serverHealth: { type: "boolean" },
  },
};

function registerBitwardenActions({
  registry,
  runBw,
  readVaultItems,
  binary,
  healthCheck = bwHealthCheck,
  apiKeyLogin = bwApiKeyLogin,
  now = Date.now,
  isoNow = () => new Date().toISOString(),
}) {
  for (const [name, dependency] of Object.entries({ runBw, readVaultItems })) {
    if (!dependency) throw new TypeError(`registerBitwardenActions requires ${name}`);
  }

  registry.registerAction({
    id: "status",
    connectorTypeId: "bw",
    title: "Check the Bitwarden server and CLI session status",
    effect: "read",
    requiresConfig: false,
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: STATUS_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const serverUrl = serverUrlOf(cfg);
      const startedAt = now();
      const health = await healthCheck(serverUrl);
      const cliStatus = await readCliStatus(runBw, "error");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const ok = health.ok;
      const record = buildStatusRecord({ ok, latency, health, cliStatus, serverUrl });
      services.store.setStatus({ ...record, lastTest: isoNow(), lastSync: cliStatus?.lastSync || null });
      return record;
    },
  });

  registry.registerAction({
    id: "sync",
    connectorTypeId: "bw",
    title: "Sync CLI session status and cached vault item count",
    effect: "write",
    requiresConfig: false,
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: SYNC_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const serverUrl = serverUrlOf(cfg);
      const startedAt = now();

      if (cfg?.serverUrl) {
        await runBw(["config", "server", cfg.serverUrl]).catch(() => {});
      }
      // Only auto-login when a key is configured AND the CLI has no session
      // at all — mirrors routes.js exactly, not a simplification.
      if (hasApiKey(cfg)) {
        const current = await readCliStatus(runBw, "unauthenticated");
        if (current.status === "unauthenticated") {
          await apiKeyLogin(cfg, { binary });
        }
      }

      const cliStatus = JSON.parse(await runBw(["status"]));
      // Item count comes from what the vault module cached when the user
      // last unlocked — this connector never opens the vault itself.
      const items = readVaultItems();
      const itemCount = Array.isArray(items) ? items.length : 0;
      const health = await healthCheck(serverUrl);
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const syncedAt = isoNow();

      const record = buildStatusRecord({ ok: true, latency, health, cliStatus, serverUrl, itemCount });
      record.lastSync = syncedAt;
      record.lastSyncBW = cliStatus.lastSync || null;
      services.store.setStatus(record);

      return {
        itemsSynced: itemCount,
        syncedAt,
        bwStatus: cliStatus.status,
        userEmail: cliStatus.userEmail || null,
        serverHealth: health.ok,
      };
    },
  });
}

module.exports = { registerBitwardenActions };
