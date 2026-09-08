// AGENT-001 / SEC-003 (ADR-011): Plane's actions. Three, deliberately different in
// shape from the GitLab/GitHub/Bitbucket pilots:
//
// - `list-issues` is `read` and hits no network at all — same as
//   `GET /:id/issues` in routes.js, it answers from `store.getData()`
//   (populated by the connector's own periodic /sync, unrelated to this
//   registry) via the same pure `filterPlaneIssues()` client.js already
//   exports. Two entry points, one filtering implementation.
// - `create-issue` is `write` and does call the live Plane API — same
//   request shape `POST /:id/issues/:projectId` builds, reusing
//   `planeRequest`/`projectPath` from client.js. The projectId that used to
//   be a URL param is now a required `input` field instead (an action has
//   no path segments of its own beyond connectionId/actionId).
// - `delete-issue` is `destructive`. It uses the exact same provider path as
//   the historic DELETE route, but the executor persists an approval before
//   this handler can make a remote call.
const { filterPlaneIssues, planeRequest, projectPath } = require("./client");

const LIST_ISSUES_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    project: { type: "string" },
    assignee: { type: "string" },
    mine: { type: "boolean" },
    priority: { type: "string", enum: ["urgent", "high", "medium", "low", "none"] },
    active: { type: "boolean" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
};

const ISSUE_ITEM_SCHEMA = {
  type: "object",
  required: ["id", "title", "identifier", "projectId", "priority", "stateGroup"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    identifier: { type: "string" },
    projectId: { type: "string" },
    projectName: { type: "string" },
    priority: { type: "string" },
    state: { type: "string" },
    stateGroup: { type: "string" },
    assignees: { type: "array" },
    dueDate: { type: ["string", "null"] },
    createdAt: { type: ["string", "null"] },
    updatedAt: { type: ["string", "null"] },
  },
};

const LIST_ISSUES_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["total", "issues"],
  properties: {
    total: { type: "integer", minimum: 0 },
    syncedAt: { type: ["string", "null"] },
    currentUserId: { type: ["string", "null"] },
    issues: { type: "array", items: ISSUE_ITEM_SCHEMA },
  },
};

const CREATE_ISSUE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projectId", "name"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    priority: { type: "string", enum: ["urgent", "high", "medium", "low", "none"] },
    assignees: { type: "array", items: { type: "string" } },
  },
};

const CREATE_ISSUE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: ["string", "null"] },
    sequenceId: { type: ["integer", "null"] },
  },
};

const DELETE_ISSUE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projectId", "issueId"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    issueId: { type: "string", minLength: 1 },
  },
};

const DELETE_ISSUE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function registerPlaneActions({ registry, request = planeRequest }) {
  registry.registerAction({
    id: "list-issues",
    connectorTypeId: "plane",
    title: "List cached issues",
    effect: "read",
    inputSchema: LIST_ISSUES_INPUT_SCHEMA,
    outputSchema: LIST_ISSUES_OUTPUT_SCHEMA,
    handler: async ({ input, services }) => {
      const data = services.store.getData();
      const currentUserId = data?.currentUserId || services.store.getConfig()?.userId || null;
      // filterPlaneIssues() reads `active` as the string "false" (its own
      // query-string heritage from GET /:id/issues) — an action's input is
      // already a real boolean, so it's translated here rather than teaching
      // the shared filter a second truthy convention.
      const query = { ...input, active: input.active === false ? "false" : undefined };
      const { total, issues } = filterPlaneIssues(data?.issues || [], query, currentUserId);
      return { total, syncedAt: data?.syncedAt || null, currentUserId, issues };
    },
  });

  registry.registerAction({
    id: "create-issue",
    connectorTypeId: "plane",
    title: "Create an issue in a project",
    effect: "write",
    inputSchema: CREATE_ISSUE_INPUT_SCHEMA,
    outputSchema: CREATE_ISSUE_OUTPUT_SCHEMA,
    handler: async ({ input, services }) => {
      const cfg = services.store.getConfig();
      const call = (path, method, body) => request(cfg.baseUrl, cfg.apiKey, path, method, body);
      const body = { name: input.name };
      if (input.description) body.description_html = input.description;
      if (input.priority) body.priority = input.priority;
      if (Array.isArray(input.assignees) && input.assignees.length) body.assignees = input.assignees;
      const created = await call(projectPath(cfg.workspace, input.projectId, "issues/"), "POST", body);
      return { id: created?.id || null, sequenceId: created?.sequence_id ?? null };
    },
  });

  registry.registerAction({
    id: "delete-issue",
    connectorTypeId: "plane",
    title: "Delete an issue permanently",
    effect: "destructive",
    inputSchema: DELETE_ISSUE_INPUT_SCHEMA,
    outputSchema: DELETE_ISSUE_OUTPUT_SCHEMA,
    handler: async ({ input, services }) => {
      const cfg = services.store.getConfig();
      await request(
        cfg.baseUrl,
        cfg.apiKey,
        projectPath(cfg.workspace, input.projectId, `issues/${input.issueId}/`),
        "DELETE",
      );
      return { ok: true };
    },
  });
}

module.exports = { registerPlaneActions };
