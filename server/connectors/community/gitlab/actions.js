// AGENT-001 pilot (ADR-011): GitLab's actions, registered against the Action
// Registry alongside (not instead of) `routes.js`'s legacy REST routes. Both
// entry points call the exact same `client.js` functions the existing
// `POST /:id/test` and `POST /:id/sync` routes already use — this file adds
// a second, uniform way to invoke the same business logic, it does not
// reimplement GitLab sync/status a second time (that duplication is exactly
// what ADR-011 exists to prevent).
//
// Every handler here receives `{ connection, input, services }` from
// server/core/actions/execute.js — `services.store`/`services.log` are
// already scoped to `connection.id` and already config-checked (execute.js
// throws connector-not-configured before a handler ever runs), so a handler
// never needs its own "is this configured" branch the way a route.js handler
// does.
const { gitlabRequest, syncGitlab } = require("./client");

const EMPTY_INPUT_SCHEMA = { type: "object", additionalProperties: false };

const STATUS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "latency"],
  properties: {
    status: { type: "string" },
    latency: { type: "string" },
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

// `request`/`sync`/`now`/`isoNow` are injectable the same way
// registerGitlabRoutes()'s are, for the same reason: actions.test.js stubs
// them instead of hitting a real GitLab instance.
function registerGitlabActions({
  registry,
  request = gitlabRequest,
  sync = syncGitlab,
  now = Date.now,
  isoNow = () => new Date().toISOString(),
}) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "gitlab",
    title: "Check connection status",
    effect: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: STATUS_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const startedAt = now();
      const user = await request(cfg.baseUrl, cfg.token, "/api/v4/user");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      return { status: "ok", latency, user: user?.username || null };
    },
  });

  registry.registerAction({
    id: "sync",
    connectorTypeId: "gitlab",
    title: "Sync projects, deployments, and commits",
    effect: "write",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: SYNC_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const { projects, deployments, commits } = await sync(cfg, { request });
      const syncedAt = isoNow();
      // Same two KV keys the legacy /sync route writes — a client reading
      // connector-data-<id>/connector-status-<id> (e.g. the Repos UI, or
      // GET /api/connectors/status) cannot tell whether the last sync came
      // through the old route or through this action.
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

module.exports = { registerGitlabActions };
