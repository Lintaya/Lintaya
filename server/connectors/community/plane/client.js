const { requestJson } = require("../../sdk");

const DEFAULT_BASE_URL = "https://api.plane.so";
const DEFAULT_TIMEOUT_MS = 10000;

// Plane's own API prefix. The connector always adds it, so a base URL that
// already carries it would double up once the SDK concatenates instead of
// replacing the path (which is what the legacy `new URL(path, base)` did).
const API_PREFIX = "/api/v1";

function normalizePlaneBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return trimmed.replace(/\/api(\/v1)?$/i, "") || DEFAULT_BASE_URL;
}

function planeRequest(baseUrl, apiKey, apiPath, method = "GET", body = null, options = {}) {
  const request = options.request || requestJson;
  return request({
    baseUrl: normalizePlaneBaseUrl(baseUrl),
    path: apiPath,
    method,
    body,
    headers: {
      // Plane CE and cloud both read X-Api-Key.
      "X-Api-Key": apiKey,
      Accept: "application/json",
      "User-Agent": "lintaya",
    },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    // Internal instances (10.x) commonly use self-signed certificates.
    requestOptions: { rejectUnauthorized: false },
  });
}

// Plane returns either a bare array or a paginated `{ results: [] }` envelope
// depending on endpoint and version.
function planeList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.results) ? payload.results : [];
}

const ISSUES_PAGE_SIZE = 100;
// A guard, not an expectation: 100 pages is 10k issues in one project.
const MAX_ISSUE_PAGES = 100;

// Plane paginates issues with a cursor and reports whether more remain. Reading
// only the first page silently truncates any project past the page size — and
// silently, because the response still looks like a complete list.
//
// Older deployments omit these fields entirely; when they do, the loop stops
// after one page, which is exactly the previous behavior.
async function fetchAllIssues(call, basePath, options = {}) {
  const pageSize = options.pageSize || ISSUES_PAGE_SIZE;
  const maxPages = options.maxPages || MAX_ISSUE_PAGES;
  const issues = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = `?per_page=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const payload = await call(`${basePath}${query}`);
    issues.push(...planeList(payload));

    // Absent fields mean "no more pages", which is also how older deployments
    // that do not report pagination at all end up exiting here.
    if (payload?.next_page_results !== true || !payload?.next_cursor) {
      return { issues, truncated: false };
    }
    cursor = payload.next_cursor;
  }
  // Only reachable by exhausting the guard, so more issues genuinely remain.
  return { issues, truncated: true };
}

function workspacePath(workspace, suffix = "") {
  return `${API_PREFIX}/workspaces/${workspace}/${String(suffix).replace(/^\/+/, "")}`;
}

function projectPath(workspace, projectId, suffix = "") {
  return workspacePath(workspace, `projects/${projectId}/${String(suffix).replace(/^\/+/, "")}`);
}

function normalizePlaneMember(member) {
  return {
    id: member.id,
    name: [member.first_name, member.last_name].filter(Boolean).join(" ")
      || member.display_name
      || member.email,
    email: member.email,
  };
}

function normalizePlaneModule(module, project) {
  return {
    id: module.id,
    name: module.name,
    projectId: project.id,
    projectName: project.name,
    status: module.status || null,
  };
}

function normalizePlaneIssue(issue, project, stateInfo = {}) {
  return {
    id: issue.id,
    title: issue.name,
    priority: issue.priority || "none",
    state: stateInfo.name || issue.state || "—",
    stateGroup: stateInfo.group || "—",
    projectId: project.id,
    projectName: project.name,
    identifier: `${project.identifier}-${issue.sequence_id}`,
    assignees: issue.assignees || [],
    dueDate: issue.due_date || null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    completedAt: issue.completed_at || null,
  };
}

async function syncPlane(cfg, options = {}) {
  const request = options.request || planeRequest;
  // `options` must NOT be forwarded here. Two different call conventions share
  // the name `request`: this function's is positional (planeRequest's own
  // signature), while planeRequest's is an SDK-style single-object transport.
  // Forwarding made planeRequest call itself with an options object in the
  // `baseUrl` slot, producing "[object Object]" and an invalid URL — a failure
  // that only appeared through the real wiring, never through a positional mock.
  //
  // `transport` is the explicit, unambiguous way to stub the SDK underneath.
  const transportOptions = options.transport ? { request: options.transport } : undefined;
  const call = (path, method, body) => request(cfg.baseUrl, cfg.apiKey, path, method, body, transportOptions);

  // Needed to answer "my issues" later. A failure here is not fatal: the sync
  // still has value without the viewer's identity.
  let currentUserId = cfg.userId || null;
  try {
    const me = await call(`${API_PREFIX}/users/me/`);
    currentUserId = me?.id || currentUserId;
  } catch {
    // keep whatever was stored
  }

  // Populates the "view a teammate's tasks" pickers.
  let members = [];
  try {
    members = planeList(await call(workspacePath(cfg.workspace, "members/"))).map(normalizePlaneMember);
  } catch {
    // optional
  }

  const rawProjects = planeList(await call(workspacePath(cfg.workspace, "projects/")));

  const allIssues = [];
  // Modules — one flat list across projects, mirrors allIssues, so "which
  // module is this called" can be answered from cached data instead of a
  // live API round trip (there was no way to answer that before this synced).
  const allModules = [];
  // Projects that hit the page cap, so a partial sync is visible rather than
  // looking like a complete one.
  const truncatedProjects = [];
  const projects = await Promise.all(rawProjects.map(async (project) => {
    let issues = [];
    try {
      // States come first: the issue list carries a state id but no
      // state_detail, so the group has to be resolved separately.
      const stateMap = {};
      for (const state of planeList(await call(projectPath(cfg.workspace, project.id, "states/")))) {
        stateMap[state.id] = { name: state.name, group: state.group };
      }

      const page = await fetchAllIssues(call, projectPath(cfg.workspace, project.id, "issues/"), options);
      issues = page.issues;
      if (page.truncated) truncatedProjects.push(project.name);
      for (const issue of issues) {
        allIssues.push(normalizePlaneIssue(issue, project, stateMap[issue.state] || {}));
      }
    } catch {
      // One inaccessible project must not abort the whole sync.
    }
    try {
      for (const module of planeList(await call(projectPath(cfg.workspace, project.id, "modules/")))) {
        allModules.push(normalizePlaneModule(module, project));
      }
    } catch {
      // Modules are informational — same tolerance as issues above.
    }
    return {
      id: project.id,
      name: project.name,
      identifier: project.identifier,
      issueCount: issues.length,
      network: project.network,
      createdAt: project.created_at,
      description: project.description || "",
    };
  }));

  return { projects, issues: allIssues, members, modules: allModules, currentUserId, truncatedProjects };
}

const PRIORITY_ORDER = Object.freeze({ urgent: 0, high: 1, medium: 2, low: 3, none: 4 });

// -Infinity keeps an undated issue at the bottom of its priority band while
// leaving the comparator total — never NaN.
function updatedAtValue(issue) {
  const parsed = Date.parse(issue?.updatedAt ?? "");
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

// Filters and orders the cached issue list. Pure on purpose — this is the part
// with real branching, and it answers every /issues query without a round trip.
function filterPlaneIssues(issues, query = {}, currentUserId = null) {
  const { priority, assignee = null, limit, project = null } = query;
  const mine = query.mine === true || query.mine === "true";
  // Completed and cancelled work is hidden unless explicitly requested.
  const activeOnly = query.active !== "false" && query.active !== false;

  let filtered = Array.isArray(issues) ? issues : [];
  if (activeOnly) {
    filtered = filtered.filter((issue) => issue.stateGroup !== "completed" && issue.stateGroup !== "cancelled");
  }
  if (project) {
    filtered = filtered.filter((issue) => issue.projectId === project);
  }
  // An explicit assignee wins over `mine`.
  if (assignee) {
    filtered = filtered.filter((issue) => (issue.assignees || []).includes(assignee));
  } else if (mine && currentUserId) {
    filtered = filtered.filter((issue) => (issue.assignees || []).includes(currentUserId));
  }
  if (priority) {
    filtered = filtered.filter((issue) => issue.priority === priority);
  }

  const sorted = [...filtered].sort((a, b) => {
    const byPriority = (PRIORITY_ORDER[a.priority] ?? 5) - (PRIORITY_ORDER[b.priority] ?? 5);
    if (byPriority !== 0) return byPriority;
    // A missing or unparseable date must not reach the subtraction: NaN from a
    // comparator does not merely misplace that row, it corrupts the whole
    // ordering. Undated issues sort last within their priority instead.
    return updatedAtValue(b) - updatedAtValue(a);
  });

  const max = Number.parseInt(limit, 10) || 50;
  return { total: sorted.length, issues: sorted.slice(0, max) };
}

module.exports = {
  API_PREFIX,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  PRIORITY_ORDER,
  fetchAllIssues,
  filterPlaneIssues,
  normalizePlaneBaseUrl,
  normalizePlaneIssue,
  normalizePlaneMember,
  normalizePlaneModule,
  planeList,
  planeRequest,
  projectPath,
  syncPlane,
  workspacePath,
};
