const assert = require("node:assert/strict");
const test = require("node:test");

const { registerGithubRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const createHarness = createRouteHarness(registerGithubRoutes);
// Only the ?scope=/?limit= tests need query access — "value" mode (the rest
// of this file) hardcodes req.query to {}, same convention as gitlab/routes.test.js.
const createEnvelopeHarness = createRouteHarness(registerGithubRoutes, { mode: "envelope" });

test("configuration never returns the stored token", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-github", {
    baseUrl: "https://github.example.test/api/v3",
    token: "must-not-leak",
  });

  const response = await harness.invoke("GET", "/api/connectors/github/config");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    configured: true,
    baseUrl: "https://github.example.test/api/v3",
    hasToken: true,
  });
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"), false);
});

test("configuration validates the token and normalizes the base URL", async () => {
  const harness = createHarness();
  const invalid = await harness.invoke("POST", "/api/connectors/github/config", {
    baseUrl: "https://api.github.com/",
  });
  assert.equal(invalid.status, 400);

  const invalidBaseUrl = await harness.invoke("POST", "/api/connectors/github/config", {
    baseUrl: "file:///tmp/github",
    token: "test-token",
  });
  assert.equal(invalidBaseUrl.status, 400);
  assert.deepEqual(invalidBaseUrl.body, {
    error: "baseUrl must be a valid HTTP(S) URL",
  });

  const saved = await harness.invoke("POST", "/api/connectors/github/config", {
    baseUrl: "https://github.example.test/api/v3///",
    token: " test-token ",
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(harness.values.get("connector-config-github"), {
    baseUrl: "https://github.example.test/api/v3",
    token: "test-token",
  });
});

test("connection test persists normalized status", async () => {
  let currentTime = 1000;
  const harness = createHarness({
    request: async () => ({ login: "lintaya-bot" }),
    now: () => { currentTime += 25; return currentTime; },
    isoNow: () => "2026-08-16T12:00:00.000Z",
  });
  harness.values.set("connector-config-github", {
    baseUrl: "https://api.github.com",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/github/test");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, latency: "25ms", user: "lintaya-bot" });
  assert.equal(harness.values.get("connector-status-github").status, "ok");
  assert.equal(harness.logs[0].id, "github");
});

test("connection errors redact the active token from responses, status, and logs", async () => {
  const harness = createHarness({
    request: async () => { throw new Error("service echoed test-token"); },
  });
  harness.values.set("connector-config-github", {
    baseUrl: "https://api.github.com",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/github/test");
  assert.equal(response.status, 502);
  assert.equal(response.body.error, "service echoed [REDACTED]");
  assert.equal(
    harness.values.get("connector-status-github").lastError,
    "service echoed [REDACTED]",
  );
  assert.equal(harness.logs[0].message.includes("test-token"), false);
});

test("sync preserves the existing response and KV contracts", async () => {
  let currentTime = 2000;
  const harness = createHarness({
    sync: async () => ({
      projects: [{ id: "lintaya/example" }],
      deployments: [{ id: 10 }],
      commits: [{ id: "abcdef12" }],
    }),
    now: () => { currentTime += 40; return currentTime; },
    isoNow: () => "2026-08-16T12:10:00.000Z",
  });
  harness.values.set("connector-config-github", {
    baseUrl: "https://api.github.com",
    token: "test-token",
  });

  const response = await harness.invoke("POST", "/api/connectors/github/sync");
  assert.equal(response.status, 200);
  assert.equal(response.body.projectCount, 1);
  assert.equal(response.body.deploymentCount, 1);
  assert.equal(response.body.commitCount, 1);
  assert.equal(response.body.total, 3);
  assert.equal(harness.values.get("connector-data-github").syncedAt, "2026-08-16T12:10:00.000Z");
  assert.equal(harness.values.get("connector-status-github").itemsSynced, 3);
});

test("commit detail resolves the repository from synced data and maps the provider payload", async () => {
  const calls = [];
  const harness = createEnvelopeHarness({
    request: (baseUrl, token, path) => {
      calls.push(path);
      return Promise.resolve({
        sha: "bbb2220000000000000000000000000000000000",
        commit: {
          message: "newer feature\n\nwhy it was needed",
          author: { name: "dev", date: "2026-08-15T10:00:00Z" },
          verification: { verified: true },
        },
        author: { login: "dev-login", avatar_url: "https://avatars.example/dev.png" },
        html_url: "https://github.com/lintaya/hq/commit/bbb222",
        parents: [{ sha: "aaa1110000000000000000000000000000000000" }],
        stats: { additions: 12, deletions: 3 },
        files: [{ filename: "server/app.js", status: "modified", additions: 12, deletions: 3 }],
      });
    },
  });
  harness.values.set("connector-config-github", { baseUrl: "https://api.github.com", token: "test-token" });
  harness.values.set("connector-data-github", {
    commits: [{ id: "bbb222", title: "newer feature", projectId: "lintaya/hq", projectName: "hq" }],
  });

  const response = await harness.invoke("GET", "/api/connectors/github/commits/:sha", { params: { sha: "bbb222" } });
  assert.equal(response.status, 200);
  assert.equal(calls[0], "/repos/lintaya/hq/commits/bbb222", "el repositorio sale de los datos ya sincronizados");
  assert.equal(response.body.sha, "bbb22200");
  assert.equal(response.body.title, "newer feature");
  assert.equal(response.body.body, "why it was needed", "el cuerpo se separa del titulo");
  assert.equal(response.body.projectId, "lintaya/hq");
  assert.equal(response.body.verified, true);
  assert.deepEqual(response.body.stats, { additions: 12, deletions: 3 });
  assert.deepEqual(response.body.files, [{ path: "server/app.js", status: "modified", additions: 12, deletions: 3 }]);
});

test("commit detail refuses a sha the sync never saw, without calling the provider", async () => {
  const calls = [];
  const harness = createEnvelopeHarness({ request: (...args) => { calls.push(args); return Promise.resolve({}); } });
  harness.values.set("connector-config-github", { baseUrl: "https://api.github.com", token: "test-token" });
  harness.values.set("connector-data-github", { commits: [{ id: "bbb222", projectId: "lintaya/hq" }] });

  const response = await harness.invoke("GET", "/api/connectors/github/commits/:sha", { params: { sha: "zzz999" } });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "commit-not-synced" });
  assert.equal(calls.length, 0, "sin repositorio conocido no hay a quien preguntar");
});

test("Home block recent-commits maps synced commits to the normalized shape, newest first", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-github", {
    baseUrl: "https://api.github.com",
    token: "test-token",
  });
  harness.values.set("connector-data-github", {
    commits: [
      { id: "aaa111", title: "older fix", author: "dev", date: "2026-08-01T10:00:00Z", projectId: "lintaya/hq", projectName: "hq", webUrl: "https://github.com/lintaya/hq/commit/aaa111" },
      { id: "bbb222", title: "newer feature", author: null, date: "2026-08-15T10:00:00Z", projectId: "lintaya/hq", projectName: "hq", webUrl: "https://github.com/lintaya/hq/commit/bbb222" },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const response = await harness.invoke("GET", "/api/connectors/github/blocks/recent-commits");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    items: [
      { id: "bbb222", title: "newer feature", subtitle: "bbb222 · — · hq", timestamp: "2026-08-15T10:00:00Z", url: "https://github.com/lintaya/hq/commit/bbb222" },
      { id: "aaa111", title: "older fix", subtitle: "aaa111 · dev · hq", timestamp: "2026-08-01T10:00:00Z", url: "https://github.com/lintaya/hq/commit/aaa111" },
    ],
    updatedAt: "2026-08-16T12:10:00.000Z",
  });
});

test("Home block recent-commits honors ?scope= (by projectId) and ?limit=", async () => {
  const harness = createEnvelopeHarness();
  harness.values.set("connector-config-github", { baseUrl: "https://api.github.com", token: "test-token" });
  harness.values.set("connector-data-github", {
    commits: [
      { id: "aaa111", title: "hq fix", date: "2026-08-01T10:00:00Z", projectId: "lintaya/hq", projectName: "hq" },
      { id: "bbb222", title: "hq feature", date: "2026-08-15T10:00:00Z", projectId: "lintaya/hq", projectName: "hq" },
      { id: "ccc333", title: "cli fix", date: "2026-08-10T10:00:00Z", projectId: "lintaya/cli", projectName: "cli" },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const scoped = await harness.invoke("GET", "/api/connectors/github/blocks/recent-commits", { query: { scope: "lintaya/hq" } });
  assert.deepEqual(scoped.body.items.map(i => i.id), ["bbb222", "aaa111"]);

  const limited = await harness.invoke("GET", "/api/connectors/github/blocks/recent-commits", { query: { limit: "1" } });
  assert.deepEqual(limited.body.items.map(i => i.id), ["bbb222"]);
});

test("Home block recent-deployments maps status/user/sha into the normalized shape, newest first", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-github", { baseUrl: "https://api.github.com", token: "test-token" });
  harness.values.set("connector-data-github", {
    deployments: [
      { id: 10, projectId: "lintaya/hq", projectName: "hq", environment: "production", status: "success", sha: "aaa111a", user: "octocat", createdAt: "2026-08-01T10:00:00Z", finishedAt: "2026-08-01T10:05:00Z", webUrl: "https://github.com/lintaya/hq" },
      { id: 11, projectId: "lintaya/hq", projectName: "hq", environment: "production", status: "failure", sha: "bbb222b", user: null, createdAt: "2026-08-15T10:00:00Z", finishedAt: "2026-08-15T10:05:00Z", webUrl: "https://github.com/lintaya/hq" },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const response = await harness.invoke("GET", "/api/connectors/github/blocks/recent-deployments");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    items: [
      {
        id: "11", title: "hq → production", subtitle: "failure · — · bbb222b",
        timestamp: "2026-08-15T10:05:00Z", url: "https://github.com/lintaya/hq",
        badge: { text: "failure", color: "#dc2626" },
      },
      {
        id: "10", title: "hq → production", subtitle: "success · octocat · aaa111a",
        timestamp: "2026-08-01T10:05:00Z", url: "https://github.com/lintaya/hq",
        badge: { text: "success", color: "#16a34a" },
      },
    ],
    updatedAt: "2026-08-16T12:10:00.000Z",
  });
});

test("Home block repos-overview maps repo metadata, sorted by last activity, with an open-PR badge", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-github", { baseUrl: "https://api.github.com", token: "test-token" });
  harness.values.set("connector-data-github", {
    projects: [
      { id: "lintaya/hq", name: "hq", language: "JavaScript", visibility: "private", pipelineStatus: "success", lastActivityAt: "2026-08-01T10:00:00Z", webUrl: "https://github.com/lintaya/hq", openMRs: 0 },
      { id: "lintaya/cli", name: "cli", language: "Go", visibility: "public", pipelineStatus: null, lastActivityAt: "2026-08-15T10:00:00Z", webUrl: "https://github.com/lintaya/cli", openMRs: 3 },
    ],
    syncedAt: "2026-08-16T12:10:00.000Z",
  });

  const response = await harness.invoke("GET", "/api/connectors/github/blocks/repos-overview");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    items: [
      {
        id: "lintaya/cli", title: "cli", subtitle: "Go · public",
        timestamp: "2026-08-15T10:00:00Z", url: "https://github.com/lintaya/cli",
        badge: { text: "3 PRs", color: "#2563eb" },
      },
      {
        id: "lintaya/hq", title: "hq", subtitle: "JavaScript · private · CI: success",
        timestamp: "2026-08-01T10:00:00Z", url: "https://github.com/lintaya/hq",
      },
    ],
    updatedAt: "2026-08-16T12:10:00.000Z",
  });
});

test("Home blocks require GitHub to be configured", async () => {
  const harness = createHarness();
  for (const blockId of ["recent-commits", "recent-deployments", "repos-overview"]) {
    const response = await harness.invoke("GET", `/api/connectors/github/blocks/${blockId}`);
    assert.equal(response.status, 400, blockId);
    assert.equal(response.body.error, "connector-not-configured", blockId);
  }
});

const CONFIGURED = { baseUrl: "https://api.github.com", token: "secret-pat" };

const GITHUB_REPO = {
  id: 7,
  name: "lintaya",
  full_name: "octo/lintaya",
  private: true,
  html_url: "https://github.com/octo/lintaya",
  clone_url: "https://github.com/octo/lintaya.git",
  ssh_url: "git@github.com:octo/lintaya.git",
  default_branch: "main",
};

function createRepoHarness(response = GITHUB_REPO) {
  const sent = [];
  const harness = createHarness({
    request: async (baseUrl, token, path, method, body) => {
      sent.push({ path, method, body });
      if (response instanceof Error) throw response;
      return response;
    },
    now: () => 0,
  });
  harness.values.set("connector-config-github", CONFIGURED);
  return { harness, sent };
}

test("creating a repository returns 201 and logs what was created", async () => {
  const { harness, sent } = createRepoHarness();

  const response = await harness.invoke("POST", "/api/connectors/github/repositories", {
    name: "lintaya",
    private: true,
    description: "Local-first workspace",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.repository.fullName, "octo/lintaya");
  assert.equal(response.body.repository.cloneUrl, "https://github.com/octo/lintaya.git");
  assert.equal(sent[0].path, "/user/repos");
  assert.equal(sent[0].method, "POST");
  assert.equal(sent[0].body.private, true);
  assert.ok(harness.logs.at(-1).message.includes("Repositorio creado · octo/lintaya · privado"));
});

test("a request without an explicit visibility is refused before reaching GitHub", async () => {
  for (const body of [{ name: "lintaya" }, { name: "lintaya", private: "true" }, { name: "lintaya", private: null }]) {
    const { harness, sent } = createRepoHarness();

    const response = await harness.invoke("POST", "/api/connectors/github/repositories", body);

    assert.equal(response.status, 400, `${JSON.stringify(body)} must be refused`);
    assert.match(response.body.error, /private must be a boolean/);
    assert.equal(sent.length, 0, "nothing may reach GitHub");
  }
});

test("a public repository is only created when the caller says so", async () => {
  const { harness, sent } = createRepoHarness({ ...GITHUB_REPO, private: false });

  const response = await harness.invoke("POST", "/api/connectors/github/repositories", {
    name: "lintaya",
    private: false,
  });

  assert.equal(response.status, 201);
  assert.equal(sent[0].body.private, false);
  // The log has to make an unusual, unreversible choice easy to spot later.
  assert.match(harness.logs.at(-1).message, /PÚBLICO/);
});

test("a blank name is refused before reaching GitHub", async () => {
  const { harness, sent } = createRepoHarness();

  const response = await harness.invoke("POST", "/api/connectors/github/repositories", { name: "  ", private: true });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "name is required" });
  assert.equal(sent.length, 0);
});

test("an unconfigured connector cannot create anything", async () => {
  const harness = createHarness();

  const response = await harness.invoke("POST", "/api/connectors/github/repositories", { name: "a", private: true });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "connector-not-configured" });
});

test("a duplicate name is reported as such instead of as a raw 422", async () => {
  const { harness } = createRepoHarness(Object.assign(new Error("Validation Failed"), { status: 422 }));

  const response = await harness.invoke("POST", "/api/connectors/github/repositories", { name: "lintaya", private: true });

  assert.equal(response.status, 502);
  assert.match(response.body.error, /ya exista/);
});

test("creating a repository never overwrites the connection status", async () => {
  const { harness } = createRepoHarness(Object.assign(new Error("Validation Failed"), { status: 422 }));
  harness.values.set("connector-status-github", { status: "ok", lastError: null });

  await harness.invoke("POST", "/api/connectors/github/repositories", { name: "lintaya", private: true });

  // A rejected name says nothing about the health of the connection.
  assert.deepEqual(harness.values.get("connector-status-github"), { status: "ok", lastError: null });
});

test("the token never leaks into the failure log", async () => {
  const { harness } = createRepoHarness(Object.assign(new Error("boom secret-pat boom"), { status: 500 }));

  const response = await harness.invoke("POST", "/api/connectors/github/repositories", { name: "a", private: true });

  assert.equal(JSON.stringify(response.body).includes("secret-pat"), false);
  assert.equal(JSON.stringify(harness.logs).includes("secret-pat"), false);
});
