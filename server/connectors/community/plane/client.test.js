const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
} = require("./client");

const CFG = { baseUrl: "https://plane.test", apiKey: "plane_key", workspace: "acme" };

test("the base URL sheds a trailing API prefix so paths cannot double up", () => {
  // The connector always prefixes /api/v1; a base that already carries it would
  // produce /api/v1/api/v1/... now that the SDK concatenates instead of replacing.
  assert.equal(normalizePlaneBaseUrl("https://plane.test/api/v1"), "https://plane.test");
  assert.equal(normalizePlaneBaseUrl("https://plane.test/api/v1/"), "https://plane.test");
  assert.equal(normalizePlaneBaseUrl("https://plane.test/api"), "https://plane.test");
  assert.equal(normalizePlaneBaseUrl("https://plane.test///"), "https://plane.test");
  assert.equal(normalizePlaneBaseUrl(""), "https://api.plane.so", "falls back to the cloud default");
  // A path that merely contains "api" elsewhere is left alone.
  assert.equal(normalizePlaneBaseUrl("https://host.test/apiary"), "https://host.test/apiary");
});

test("requests carry the API key as a header and preserve a proxied subpath", async () => {
  const seen = [];
  await planeRequest("https://host.test/plane", "k", "/api/v1/users/me/", "GET", null, {
    request: async (opts) => { seen.push(opts); return {}; },
  });
  assert.equal(seen[0].baseUrl, "https://host.test/plane");
  assert.equal(seen[0].path, "/api/v1/users/me/");
  assert.equal(seen[0].headers["X-Api-Key"], "k");
  assert.equal(seen[0].headers.Authorization, undefined, "no bearer header is sent");
});

test("list responses are accepted bare or paginated", () => {
  assert.deepEqual(planeList([1, 2]), [1, 2]);
  assert.deepEqual(planeList({ results: [3] }), [3]);
  assert.deepEqual(planeList(null), []);
  assert.deepEqual(planeList({ count: 0 }), []);
});

test("path builders join without doubling slashes", () => {
  assert.equal(workspacePath("acme", "projects/"), "/api/v1/workspaces/acme/projects/");
  assert.equal(workspacePath("acme", "/projects/"), "/api/v1/workspaces/acme/projects/");
  assert.equal(projectPath("acme", "p1", "states/"), "/api/v1/workspaces/acme/projects/p1/states/");
});

test("a member's display name falls back through the available fields", () => {
  assert.equal(normalizePlaneMember({ first_name: "Ana", last_name: "Ruiz", email: "a@b.c" }).name, "Ana Ruiz");
  assert.equal(normalizePlaneMember({ display_name: "anaruiz", email: "a@b.c" }).name, "anaruiz");
  assert.equal(normalizePlaneMember({ email: "a@b.c" }).name, "a@b.c");
});

test("an issue is normalized with its state group and issue key", () => {
  const issue = normalizePlaneIssue(
    { id: "i1", name: "Fix login", priority: "high", state: "s1", sequence_id: 42, assignees: ["u1"], updated_at: "2026-08-01" },
    { id: "p1", name: "Web", identifier: "WEB" },
    { name: "In Progress", group: "started" },
  );
  assert.equal(issue.identifier, "WEB-42");
  assert.equal(issue.stateGroup, "started");
  assert.equal(issue.state, "In Progress");
  assert.equal(issue.title, "Fix login");
});

test("a module is normalized with its owning project", () => {
  const module = normalizePlaneModule({ id: "m1", name: "Gestores", status: "in-progress" }, { id: "p1", name: "Infra Ops MEX GDL" });
  assert.equal(module.id, "m1");
  assert.equal(module.name, "Gestores");
  assert.equal(module.projectId, "p1");
  assert.equal(module.projectName, "Infra Ops MEX GDL");
  assert.equal(module.status, "in-progress");
});

test("an issue with an unknown state degrades instead of throwing", () => {
  const issue = normalizePlaneIssue({ id: "i", name: "x", sequence_id: 1 }, { id: "p", name: "P", identifier: "P" }, {});
  assert.equal(issue.state, "—");
  assert.equal(issue.stateGroup, "—");
  assert.equal(issue.priority, "none", "a missing priority reads as none");
});

test("sync gathers projects, issues, members, modules and the viewer id", async () => {
  const request = async (baseUrl, apiKey, path) => {
    if (path.endsWith("/users/me/")) return { id: "me-1" };
    if (path.endsWith("/members/")) return { results: [{ id: "u1", first_name: "Ana", email: "a@b.c" }] };
    if (path.endsWith("/projects/")) return [{ id: "p1", name: "Web", identifier: "WEB", created_at: "2026-01-01", description: "Repositorio: https://gitlab.internal/web" }];
    if (path.endsWith("/states/")) return [{ id: "s1", name: "Done", group: "completed" }];
    if (path.endsWith("/modules/")) return { results: [{ id: "m1", name: "Gestores" }] };
    if (path.includes("/issues/")) return { results: [{ id: "i1", name: "Ship", state: "s1", sequence_id: 7 }] };
    throw new Error(`unexpected path ${path}`);
  };

  const result = await syncPlane(CFG, { request });
  assert.equal(result.currentUserId, "me-1");
  assert.equal(result.members[0].name, "Ana");
  assert.equal(result.projects[0].issueCount, 1);
  assert.match(result.projects[0].description, /gitlab\.internal\/web/, "the project's own description is cached, e.g. a linked repo reference");
  assert.equal(result.issues[0].identifier, "WEB-7");
  assert.equal(result.issues[0].stateGroup, "completed");
  assert.equal(result.modules[0].name, "Gestores");
  assert.equal(result.modules[0].projectId, "p1");
});

test("sync survives a project it cannot read, and a missing /users/me", async () => {
  const request = async (baseUrl, apiKey, path) => {
    if (path.endsWith("/users/me/")) throw new Error("HTTP 403");
    if (path.endsWith("/members/")) throw new Error("HTTP 403");
    if (path.endsWith("/projects/")) return [{ id: "ok", name: "Fine", identifier: "OK" }, { id: "bad", name: "Denied", identifier: "NO" }];
    if (path.includes("/projects/bad/")) throw new Error("HTTP 403");
    if (path.endsWith("/states/")) return [];
    return { results: [{ id: "i1", name: "One", sequence_id: 1 }] };
  };

  const result = await syncPlane({ ...CFG, userId: "stored-me" }, { request });
  assert.equal(result.currentUserId, "stored-me", "the stored viewer id is kept when /users/me fails");
  assert.deepEqual(result.members, []);
  assert.equal(result.projects.length, 2);
  assert.equal(result.projects[1].issueCount, 0, "the denied project reports no issues");
  assert.equal(result.issues.length, 1);
});

const ISSUES = [
  { id: "a", priority: "low", stateGroup: "started", assignees: ["me"], updatedAt: "2026-08-10" },
  { id: "b", priority: "urgent", stateGroup: "started", assignees: ["other"], updatedAt: "2026-08-01" },
  { id: "c", priority: "high", stateGroup: "completed", assignees: ["me"], updatedAt: "2026-08-12" },
  { id: "d", priority: "urgent", stateGroup: "cancelled", assignees: ["me"], updatedAt: "2026-08-13" },
  { id: "e", priority: "medium", stateGroup: "unstarted", assignees: ["me"], updatedAt: "2026-08-14" },
];

test("project scopes the cached issues to one project, combinable with mine", () => {
  const withProjects = [
    { id: "a", projectId: "p1", priority: "low", stateGroup: "started", assignees: ["me"], updatedAt: "2026-08-10" },
    { id: "b", projectId: "p2", priority: "urgent", stateGroup: "started", assignees: ["me"], updatedAt: "2026-08-01" },
  ];
  assert.deepEqual(filterPlaneIssues(withProjects, { project: "p1" }, "me").issues.map((i) => i.id), ["a"]);
  assert.deepEqual(
    filterPlaneIssues(withProjects, { project: "p2", mine: "true" }, "me").issues.map((i) => i.id),
    ["b"],
    "project and mine apply together, not either/or",
  );
  assert.equal(filterPlaneIssues(withProjects, { project: "nope" }, "me").total, 0);
});

test("cached issues hide completed and cancelled work by default", () => {
  const { total, issues } = filterPlaneIssues(ISSUES, {}, "me");
  assert.equal(total, 3);
  assert.deepEqual(issues.map((i) => i.id), ["b", "e", "a"], "urgent first, then medium, then low");
});

test("active=false brings back the finished work", () => {
  assert.equal(filterPlaneIssues(ISSUES, { active: "false" }, "me").total, 5);
  assert.equal(filterPlaneIssues(ISSUES, { active: false }, "me").total, 5, "the boolean form works too");
});

test("mine filters to the viewer, and an explicit assignee overrides it", () => {
  assert.deepEqual(filterPlaneIssues(ISSUES, { mine: "true" }, "me").issues.map((i) => i.id), ["e", "a"]);
  // `assignee` wins even when `mine` is also set.
  assert.deepEqual(filterPlaneIssues(ISSUES, { mine: "true", assignee: "other" }, "me").issues.map((i) => i.id), ["b"]);
  // Without a known viewer, `mine` cannot filter anything out.
  assert.equal(filterPlaneIssues(ISSUES, { mine: "true" }, null).total, 3);
});

test("priority filter and limit are applied after sorting", () => {
  assert.deepEqual(filterPlaneIssues(ISSUES, { priority: "urgent" }, "me").issues.map((i) => i.id), ["b"]);
  const limited = filterPlaneIssues(ISSUES, { limit: 2 }, "me");
  assert.equal(limited.total, 3, "total reports the full match count, not the page size");
  assert.equal(limited.issues.length, 2);
});

test("an unknown priority sorts last rather than crashing the comparator", () => {
  const odd = [{ id: "x", priority: "weird", stateGroup: "started", updatedAt: "2026-08-20" }, ...ISSUES];
  const { issues } = filterPlaneIssues(odd, {}, "me");
  assert.equal(issues.at(-1).id, "x");
  assert.equal(PRIORITY_ORDER.weird, undefined);
});

test("an issue without updatedAt does not corrupt the ordering", () => {
  // A NaN comparator return does not merely misplace one row — it scrambles the
  // whole sort, which is why this is checked on same-priority issues.
  const issues = [
    { id: "old", priority: "high", stateGroup: "started", updatedAt: "2026-08-01" },
    { id: "undated", priority: "high", stateGroup: "started" },
    { id: "newest", priority: "high", stateGroup: "started", updatedAt: "2026-08-20" },
    { id: "mid", priority: "high", stateGroup: "started", updatedAt: "2026-08-10" },
  ];
  const { issues: sorted } = filterPlaneIssues(issues, {}, null);
  assert.deepEqual(sorted.map((i) => i.id), ["newest", "mid", "old", "undated"]);
});

test("an unparseable updatedAt is treated as undated, not as a crash", () => {
  const issues = [
    { id: "bad", priority: "low", stateGroup: "started", updatedAt: "not-a-date" },
    { id: "good", priority: "low", stateGroup: "started", updatedAt: "2026-08-05" },
  ];
  assert.deepEqual(filterPlaneIssues(issues, {}, null).issues.map((i) => i.id), ["good", "bad"]);
});

test("issue pages are followed to the end, not truncated at the first", () => {
  // Three projects in the live data sat at exactly 100 issues — the page size —
  // which is the signature of reading only the first page.
  const pages = {
    "": { results: [{ id: "a" }], next_page_results: true, next_cursor: "C1" },
    C1: { results: [{ id: "b" }], next_page_results: true, next_cursor: "C2" },
    C2: { results: [{ id: "c" }], next_page_results: false },
  };
  const seen = [];
  return fetchAllIssues(async (path) => {
    seen.push(path);
    const cursor = (path.match(/cursor=([^&]*)/) || [, ""])[1];
    return pages[cursor];
  }, "/issues/").then(({ issues, truncated }) => {
    assert.deepEqual(issues.map((i) => i.id), ["a", "b", "c"]);
    assert.equal(truncated, false);
    assert.equal(seen.length, 3);
    assert.match(seen[0], /per_page=100/);
    assert.match(seen[1], /cursor=C1/);
  });
});

test("a deployment that reports no pagination still yields its single page", async () => {
  // Older Plane versions omit next_page_results entirely; behavior must match
  // what the connector did before pagination existed.
  let calls = 0;
  const { issues, truncated } = await fetchAllIssues(async () => {
    calls += 1;
    return { results: [{ id: "only" }] };
  }, "/issues/");
  assert.equal(calls, 1, "no second request is attempted");
  assert.equal(issues.length, 1);
  assert.equal(truncated, false);
});

test("a bare-array response ends pagination instead of looping forever", async () => {
  let calls = 0;
  const { issues } = await fetchAllIssues(async () => { calls += 1; return [{ id: "x" }]; }, "/issues/");
  assert.equal(calls, 1);
  assert.deepEqual(issues.map((i) => i.id), ["x"]);
});

test("the page guard stops a runaway cursor and reports the truncation", async () => {
  // A server that always claims another page must not spin indefinitely.
  const { issues, truncated } = await fetchAllIssues(
    async () => ({ results: [{ id: "n" }], next_page_results: true, next_cursor: "always" }),
    "/issues/",
    { maxPages: 4 },
  );
  assert.equal(issues.length, 4);
  assert.equal(truncated, true, "the caller can tell the sync was partial");
});

test("sync reports which projects were left partial", async () => {
  const request = async (baseUrl, apiKey, path) => {
    if (path.endsWith("/users/me/")) return { id: "me" };
    if (path.endsWith("/members/")) return [];
    if (path.endsWith("/projects/")) return [{ id: "p1", name: "Huge", identifier: "HUG" }];
    if (path.includes("/states/")) return [];
    return { results: [{ id: "i", name: "n", sequence_id: 1 }], next_page_results: true, next_cursor: "more" };
  };
  const result = await syncPlane(CFG, { request, maxPages: 2 });
  assert.deepEqual(result.truncatedProjects, ["Huge"]);
});

test("sync works through the real planeRequest, as routes.js wires it", async () => {
  // Regression: routes.js calls sync(cfg, { request: planeRequest }). syncPlane
  // used to forward that whole options bag into planeRequest, whose own
  // `request` option is an SDK-style single-object transport — so planeRequest
  // called itself with an object in the baseUrl slot and every sync died with
  // "Invalid connector URL". Every earlier test injected a positional mock and
  // never went through planeRequest at all, so none of them saw it.
  const seen = [];
  const transport = async (opts) => {
    seen.push(opts);
    if (opts.path.endsWith("/users/me/")) return { id: "me" };
    if (opts.path.endsWith("/members/")) return [];
    if (opts.path.endsWith("/projects/")) return [{ id: "p1", name: "Web", identifier: "WEB" }];
    if (opts.path.includes("/states/")) return [];
    return { results: [{ id: "i1", name: "Ship", sequence_id: 3 }] };
  };

  const result = await syncPlane(CFG, { request: planeRequest, transport });

  assert.equal(result.issues.length, 1, "the sync completed instead of failing on the URL");
  assert.equal(result.issues[0].identifier, "WEB-3");
  // Every hop reached the SDK with a real string base URL, never an object.
  for (const opts of seen) {
    assert.equal(typeof opts.baseUrl, "string");
    assert.equal(opts.baseUrl, "https://plane.test");
    assert.match(opts.path, /^\/api\/v1\//);
  }
});
