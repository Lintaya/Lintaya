// AGENT-001 (ADR-011): GitHub's actions — same shape and same reasoning as
// server/connectors/community/gitlab/actions.js (registered alongside, not
// instead of, routes.js's legacy REST routes; handlers call the exact same
// client.js functions `POST /:id/test` and `POST /:id/sync` already use, so
// there is exactly one implementation of GitHub status/sync, not two).
const { createGithubRepository, githubRequest, syncGithub } = require("./client");

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

const CREATE_REPOSITORY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // "private" is required rather than defaulted: a caller that forgets the flag
  // must get a validation error, never a public repository.
  required: ["name", "private"],
  properties: {
    name: { type: "string", minLength: 1 },
    private: { type: "boolean" },
    description: { type: "string" },
    org: { type: "string", description: "Create under this organization instead of the token's own account." },
    autoInit: { type: "boolean", description: "Let GitHub write an initial commit. Leave false to push existing history." },
  },
};

const CREATE_REPOSITORY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fullName", "private", "cloneUrl"],
  properties: {
    id: { type: ["integer", "null"] },
    name: { type: "string" },
    fullName: { type: ["string", "null"] },
    private: { type: "boolean" },
    webUrl: { type: ["string", "null"] },
    cloneUrl: { type: ["string", "null"] },
    sshUrl: { type: ["string", "null"] },
    defaultBranch: { type: ["string", "null"] },
  },
};

function registerGithubActions({
  registry,
  request = githubRequest,
  sync = syncGithub,
  createRepository = createGithubRepository,
  now = Date.now,
  isoNow = () => new Date().toISOString(),
}) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "github",
    title: "Check connection status",
    effect: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: STATUS_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const startedAt = now();
      const user = await request(cfg.baseUrl, cfg.token, "/user");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      return { status: "ok", latency, user: user?.login || null };
    },
  });

  registry.registerAction({
    id: "sync",
    connectorTypeId: "github",
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

  registry.registerAction({
    id: "create-repository",
    connectorTypeId: "github",
    title: "Create a repository",
    effect: "write",
    inputSchema: CREATE_REPOSITORY_INPUT_SCHEMA,
    outputSchema: CREATE_REPOSITORY_OUTPUT_SCHEMA,
    handler: async ({ services, input }) => {
      const cfg = services.store.getConfig();
      return createRepository(cfg, input, { request });
    },
  });
}

module.exports = { registerGithubActions };
