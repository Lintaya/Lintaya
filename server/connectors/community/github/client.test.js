const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildGithubUrl,
  createGithubRepository,
  normalizeGithubRunStatus,
  syncGithub,
} = require("./client");

test("preserves the GitHub Enterprise /api/v3 base path", () => {
  assert.equal(
    buildGithubUrl("https://github.example.test/api/v3", "/user/repos?page=2").toString(),
    "https://github.example.test/api/v3/user/repos?page=2",
  );
});

test("normalizes GitHub Actions status and conclusion", () => {
  assert.equal(normalizeGithubRunStatus({ status: "queued" }), "pending");
  assert.equal(normalizeGithubRunStatus({ status: "in_progress" }), "running");
  assert.equal(normalizeGithubRunStatus({ status: "completed", conclusion: "success" }), "success");
  assert.equal(normalizeGithubRunStatus({ status: "completed", conclusion: "failure" }), "failed");
  assert.equal(normalizeGithubRunStatus(null), null);
});

test("sync maps GitHub responses to the normalized repository model", async () => {
  const paths = [];
  const request = async (baseUrl, token, path) => {
    paths.push(path);
    if (path.startsWith("/user/repos")) return [{
      full_name: "lintaya/example",
      name: "example",
      owner: { login: "lintaya" },
      default_branch: "main",
      html_url: "https://github.com/lintaya/example",
      clone_url: "https://github.com/lintaya/example.git",
      pushed_at: "2026-08-16T12:00:00Z",
      description: "Example connector fixture",
      topics: ["lintaya"],
      private: false,
      language: "JavaScript",
    }];
    if (path.includes("/deployments")) return [{
      id: 10,
      environment: "production",
      state: "active",
      ref: "main",
      sha: "1234567890abcdef",
      creator: { login: "octocat" },
      created_at: "2026-08-16T12:05:00Z",
      updated_at: "2026-08-16T12:06:00Z",
    }];
    if (path.includes("/commits")) return [{
      sha: "abcdef1234567890",
      html_url: "https://github.com/lintaya/example/commit/abcdef12",
      commit: {
        message: "feat: example\n\nDetails",
        author: { name: "Example Author", date: "2026-08-16T12:04:00Z" },
      },
    }];
    if (path.includes("/actions/runs")) {
      return { workflow_runs: [{ status: "completed", conclusion: "success" }] };
    }
    if (path.includes("/pulls")) return [{ id: 1 }, { id: 2 }];
    if (path.includes("/releases/latest")) return { tag_name: "v1.0.0", published_at: "2026-08-16T12:03:00Z" };
    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await syncGithub(
    { baseUrl: "https://api.github.com", token: "test-token" },
    { request },
  );

  assert.equal(paths.filter((path) => path.startsWith("/user/repos")).length, 1);
  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0], {
    id: "lintaya/example",
    name: "example",
    path: "lintaya/example",
    webUrl: "https://github.com/lintaya/example",
    cloneUrl: "https://github.com/lintaya/example.git",
    deploymentCount: 1,
    lastActivityAt: "2026-08-16T12:00:00Z",
    description: "Example connector fixture",
    defaultBranch: "main",
    group: "lintaya",
    topics: ["lintaya"],
    visibility: "public",
    pipelineStatus: "success",
    language: "JavaScript",
    openMRs: 2,
    lastCommit: {
      sha: "abcdef12",
      message: "feat: example",
      when: "2026-08-16T12:04:00Z",
    },
    latestTag: { name: "v1.0.0", when: "2026-08-16T12:03:00Z" },
    fork: false,
  });
  assert.equal(result.deployments.length, 1);
  assert.equal(result.commits.length, 1);
  assert.deepEqual(result.pagination.projects, { pages: 1, truncated: false });
});

test("sync marks a forked repository as fork: true", async () => {
  const request = async (baseUrl, token, path) => {
    if (path.startsWith("/user/repos")) return [{
      full_name: "octocat/example-fork",
      name: "example-fork",
      owner: { login: "octocat" },
      default_branch: "main",
      html_url: "https://github.com/octocat/example-fork",
      clone_url: "https://github.com/octocat/example-fork.git",
      pushed_at: "2026-08-16T12:00:00Z",
      description: "",
      topics: [],
      private: false,
      language: null,
      fork: true,
    }];
    if (path.includes("/deployments")) return [];
    if (path.includes("/commits")) return [];
    if (path.includes("/actions/runs")) return { workflow_runs: [] };
    if (path.includes("/pulls")) return [];
    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await syncGithub(
    { baseUrl: "https://api.github.com", token: "test-token" },
    { request },
  );

  assert.equal(result.projects[0].fork, true);
});

const CREATED_REPO = {
  id: 42,
  name: "lintaya",
  full_name: "octo/lintaya",
  private: true,
  html_url: "https://github.com/octo/lintaya",
  clone_url: "https://github.com/octo/lintaya.git",
  ssh_url: "git@github.com:octo/lintaya.git",
  default_branch: "main",
};

function captureCreate(response = CREATED_REPO) {
  const calls = [];
  const request = async (baseUrl, token, path, method, body) => {
    calls.push({ baseUrl, token, path, method, body });
    return response;
  };
  return { calls, request };
}

const CFG = { baseUrl: "https://api.github.com", token: "t" };

test("creating a repository posts to the account and maps the response", async () => {
  const { calls, request } = captureCreate();

  const repo = await createGithubRepository(CFG, { name: "lintaya", private: true }, { request });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/user/repos");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(repo, {
    id: 42,
    name: "lintaya",
    fullName: "octo/lintaya",
    private: true,
    webUrl: "https://github.com/octo/lintaya",
    cloneUrl: "https://github.com/octo/lintaya.git",
    sshUrl: "git@github.com:octo/lintaya.git",
    defaultBranch: "main",
  });
});

test("an omitted or malformed visibility flag still creates a private repository", async () => {
  for (const input of [{ name: "a" }, { name: "a", private: undefined }, { name: "a", private: "false" }]) {
    const { calls, request } = captureCreate();
    await createGithubRepository(CFG, input, { request });
    assert.equal(calls[0].body.private, true, `${JSON.stringify(input)} must not create a public repo`);
  }
});

test("only an explicit false makes the repository public", async () => {
  const { calls, request } = captureCreate({ ...CREATED_REPO, private: false });

  const repo = await createGithubRepository(CFG, { name: "a", private: false }, { request });

  assert.equal(calls[0].body.private, false);
  assert.equal(repo.private, false);
});

test("the repository is left empty so existing history can be pushed into it", async () => {
  const { calls, request } = captureCreate();

  await createGithubRepository(CFG, { name: "a", private: true }, { request });

  assert.equal(calls[0].body.auto_init, false);
});

test("an organization target posts to that organization and is URL-encoded", async () => {
  const { calls, request } = captureCreate();

  await createGithubRepository(CFG, { name: "a", private: true, org: "my org" }, { request });

  assert.equal(calls[0].path, "/orgs/my%20org/repos");
});

test("a description is sent only when there is one", async () => {
  const withDescription = captureCreate();
  await createGithubRepository(CFG, { name: "a", private: true, description: "hi" }, { request: withDescription.request });
  assert.equal(withDescription.calls[0].body.description, "hi");

  const without = captureCreate();
  await createGithubRepository(CFG, { name: "a", private: true }, { request: without.request });
  assert.equal("description" in without.calls[0].body, false);
});

test("a blank name is rejected before any request is made", async () => {
  const { calls, request } = captureCreate();

  await assert.rejects(
    () => createGithubRepository(CFG, { name: "   ", private: true }, { request }),
    /name is required/,
  );
  assert.equal(calls.length, 0);
});
