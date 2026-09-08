// AGENT-001 (ADR-011): Bitbucket's actions — same shape/reasoning as the
// GitLab and GitHub pilots (server/connectors/community/{gitlab,github}/actions.js).
// One real difference worth flagging: Bitbucket's `request(cfg, path)` takes
// the whole config object (Cloud vs. Server need different auth/paths),
// unlike GitLab/GitHub's `request(baseUrl, token, path)` — and "status" picks
// a different probe endpoint per `cfg.type`, mirrored here exactly from
// routes.js's `/test` route rather than simplified, so both entry points stay
// behaviorally identical.
const { bitbucketRequest, syncBitbucket } = require("./client");

const EMPTY_INPUT_SCHEMA = { type: "object", additionalProperties: false };

const STATUS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "latency"],
  properties: {
    status: { type: "string" },
    latency: { type: "string" },
    // Cloud/Server don't share a "username" concept the way GitLab/GitHub
    // do — this is a human-readable label ("Bitbucket Server", "N repo(s)
    // accesibles"), same field name as the other pilots for a uniform shape,
    // different meaning underneath (matches the legacy /test route's own
    // `user: label` field).
    user: { type: ["string", "null"] },
  },
};

const SYNC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projectCount", "deploymentCount", "commitCount", "syncedAt"],
  properties: {
    projectCount: { type: "integer", minimum: 0 },
    deploymentCount: { type: "integer", minimum: 0 },
    commitCount: { type: "integer", minimum: 0 },
    syncedAt: { type: "string" },
  },
};

function registerBitbucketActions({
  registry,
  request = bitbucketRequest,
  sync = syncBitbucket,
  now = Date.now,
  isoNow = () => new Date().toISOString(),
}) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "bitbucket",
    title: "Check connection status",
    effect: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: STATUS_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const startedAt = now();
      const result = cfg.type === "server"
        ? await request(cfg, "/rest/api/1.0/application-properties")
        : cfg.workspace
          ? await request(cfg, `/repositories/${encodeURIComponent(cfg.workspace)}?pagelen=1`)
          : await request(cfg, "/user/permissions/repositories?pagelen=1");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      const label = cfg.type === "server"
        ? (result?.displayName || "Bitbucket Server")
        : (result?.size != null ? `${result.size} repo(s) accesibles` : "Bitbucket Cloud");
      return { status: "ok", latency, user: label };
    },
  });

  registry.registerAction({
    id: "sync",
    connectorTypeId: "bitbucket",
    title: "Sync repos, deployments, and commits",
    effect: "write",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: SYNC_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const { projects, deployments, commits } = await sync(cfg, { request });
      const syncedAt = isoNow();
      services.store.setData({ projects, deployments, commits, syncedAt });
      services.store.setStatus({
        status: "ok",
        lastSync: syncedAt,
        lastError: null,
        itemsSynced: projects.length + deployments.length + commits.length,
      });
      return {
        projectCount: projects.length,
        deploymentCount: deployments.length,
        commitCount: commits.length,
        syncedAt,
      };
    },
  });
}

module.exports = { registerBitbucketActions };
