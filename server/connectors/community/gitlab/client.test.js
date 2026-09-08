const assert = require("node:assert/strict");
const test = require("node:test");

const { buildGitlabUrl, syncGitlab } = require("./client");

test("preserves a self-hosted GitLab base path", () => {
  assert.equal(
    buildGitlabUrl("https://scm.example.test/gitlab", "/api/v4/user").toString(),
    "https://scm.example.test/gitlab/api/v4/user",
  );
});

test("sync maps GitLab responses to the normalized repository model", async () => {
  const paths = [];
  const request = async (baseUrl, token, path) => {
    paths.push(path);
    if (path.startsWith("/api/v4/projects?")) return [{
      id: 42,
      name: "example",
      path_with_namespace: "lintaya/example",
      web_url: "https://gitlab.example.test/lintaya/example",
      http_url_to_repo: "https://gitlab.example.test/lintaya/example.git",
      default_branch: "main",
      last_activity_at: "2026-08-16T12:00:00Z",
      description: "Example GitLab fixture",
      topics: ["lintaya"],
      visibility: "private",
    }];
    if (path.includes("/deployments")) return [{
      id: 10,
      environment: { name: "production" },
      status: "success",
      ref: "main",
      sha: "1234567890abcdef",
      user: { name: "Example User" },
      created_at: "2026-08-16T12:05:00Z",
      deployable: {
        finished_at: "2026-08-16T12:06:00Z",
        web_url: "https://gitlab.example.test/jobs/10",
      },
    }];
    if (path.includes("/repository/commits")) return [{
      id: "abcdef1234567890",
      short_id: "abcdef12",
      title: "feat: example",
      author_name: "Example Author",
      committed_date: "2026-08-16T12:04:00Z",
      web_url: "https://gitlab.example.test/commit/abcdef12",
    }];
    if (path.includes("/pipelines")) return [{ status: "success" }];
    if (path.endsWith("/languages")) return { JavaScript: 75, CSS: 25 };
    if (path.includes("/merge_requests")) return [{ id: 1 }, { id: 2 }];
    if (path.includes("/repository/tags")) return [{
      name: "v1.0.0",
      commit: { committed_date: "2026-08-16T12:03:00Z" },
    }];
    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await syncGitlab(
    { baseUrl: "https://gitlab.example.test", token: "test-token" },
    { request },
  );

  assert.equal(paths.filter((path) => path.startsWith("/api/v4/projects?")).length, 1);
  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0], {
    id: 42,
    name: "example",
    path: "lintaya/example",
    webUrl: "https://gitlab.example.test/lintaya/example",
    cloneUrl: "https://gitlab.example.test/lintaya/example.git",
    deploymentCount: 1,
    lastActivityAt: "2026-08-16T12:00:00Z",
    description: "Example GitLab fixture",
    defaultBranch: "main",
    group: "lintaya",
    topics: ["lintaya"],
    visibility: "private",
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

test("sync marks a forked project as fork: true", async () => {
  const request = async (baseUrl, token, path) => {
    if (path.startsWith("/api/v4/projects?")) return [{
      id: 43,
      name: "example-fork",
      path_with_namespace: "octocat/example-fork",
      web_url: "https://gitlab.example.test/octocat/example-fork",
      http_url_to_repo: "https://gitlab.example.test/octocat/example-fork.git",
      last_activity_at: "2026-08-16T12:00:00Z",
      description: "",
      topics: [],
      visibility: "public",
      forked_from_project: { id: 42, path_with_namespace: "lintaya/example" },
    }];
    if (path.includes("/deployments")) return [];
    if (path.includes("/repository/commits")) return [];
    if (path.includes("/pipelines")) return [];
    if (path.includes("/merge_requests")) return [];
    if (path.includes("/languages")) return {};
    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await syncGitlab(
    { baseUrl: "https://gitlab.example.test", token: "test-token" },
    { request },
  );

  assert.equal(result.projects[0].fork, true);
});
