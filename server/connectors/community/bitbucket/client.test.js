const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CLOUD_BASE_URL,
  bitbucketAuthHeader,
  bitbucketServerPathToString,
  mapWithConcurrency,
  resolveBitbucketRequestTarget,
  splitBitbucketId,
  syncBitbucket,
} = require("./client");

test("builds Cloud and Server authentication without exposing credentials", () => {
  assert.equal(
    bitbucketAuthHeader({ type: "server", token: "server-token" }),
    "Bearer server-token",
  );
  assert.equal(
    bitbucketAuthHeader({ type: "cloud", username: "lintaya", token: "cloud-token" }),
    `Basic ${Buffer.from("lintaya:cloud-token").toString("base64")}`,
  );
});

test("accepts safe Cloud pagination URLs and rejects another origin or API root", () => {
  assert.deepEqual(
    resolveBitbucketRequestTarget(
      { type: "cloud" },
      "https://api.bitbucket.org/2.0/repositories/lintaya?pagelen=100&page=2",
    ),
    {
      baseUrl: "https://api.bitbucket.org",
      path: "/2.0/repositories/lintaya?pagelen=100&page=2",
    },
  );
  assert.throws(
    () => resolveBitbucketRequestTarget(
      { type: "cloud" },
      "https://example.test/2.0/repositories?page=2",
    ),
    (error) => error.code === "CONNECTOR_URL_INVALID",
  );
  assert.throws(
    () => resolveBitbucketRequestTarget(
      { type: "cloud" },
      "https://api.bitbucket.org/untrusted?page=2",
    ),
    (error) => error.code === "CONNECTOR_URL_INVALID",
  );
  assert.equal(CLOUD_BASE_URL, "https://api.bitbucket.org/2.0");
});

test("normalizes Bitbucket IDs and Server browse paths", () => {
  assert.deepEqual(splitBitbucketId("TEAM/project"), ["TEAM", "project"]);
  assert.equal(
    bitbucketServerPathToString({ components: ["src", "lib"], name: "index.js" }),
    "src/lib/index.js",
  );
  assert.equal(bitbucketServerPathToString({ toString: "src/index.js" }), "src/index.js");
});

test("mapWithConcurrency preserves order and respects its limit", async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8]);
  assert.equal(maximum, 2);
});

test("sync maps and deduplicates Bitbucket Cloud repositories", async () => {
  const paths = [];
  const repository = {
    uuid: "{repo-1}",
    full_name: "lintaya/example",
    slug: "example",
    name: "example",
    workspace: { slug: "lintaya" },
    mainbranch: { name: "main" },
    updated_on: "2026-08-16T12:00:00Z",
    description: "Cloud fixture",
    is_private: true,
    language: "JavaScript",
    links: {
      html: { href: "https://bitbucket.org/lintaya/example" },
      clone: [{ name: "https", href: "https://bitbucket.org/lintaya/example.git" }],
    },
  };
  const request = async (cfg, path) => {
    paths.push(path);
    if (path.startsWith("/repositories/lintaya?")) {
      return {
        values: [repository, repository],
        next: "https://api.bitbucket.org/2.0/repositories/lintaya?pagelen=100&page=2",
      };
    }
    if (/^https:\/\//.test(path)) return { values: [], next: null };
    if (path.includes("/commits/")) return { values: [{
      hash: "abcdef1234567890",
      message: "feat: cloud fixture\n\nDetails",
      date: "2026-08-16T12:04:00Z",
      author: { user: { display_name: "Example Author" } },
      links: { html: { href: "https://bitbucket.org/commit/abcdef12" } },
    }] };
    if (path.includes("/pullrequests")) return { values: [{ id: 1 }] };
    if (path.includes("/refs/tags")) return { values: [{
      name: "v1.0.0",
      target: { date: "2026-08-16T12:03:00Z" },
    }] };
    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await syncBitbucket(
    { type: "cloud", username: "lintaya", workspace: "lintaya", token: "test-token" },
    { request },
  );

  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0], {
    id: "lintaya/example",
    name: "example",
    path: "lintaya/example",
    webUrl: "https://bitbucket.org/lintaya/example",
    cloneUrl: "https://bitbucket.org/lintaya/example.git",
    deploymentCount: 0,
    lastActivityAt: "2026-08-16T12:00:00Z",
    description: "Cloud fixture",
    defaultBranch: "main",
    group: "lintaya",
    topics: [],
    visibility: "private",
    pipelineStatus: null,
    language: "JavaScript",
    openMRs: 1,
    lastCommit: {
      sha: "abcdef12",
      message: "feat: cloud fixture",
      when: "2026-08-16T12:04:00Z",
    },
    latestTag: { name: "v1.0.0", when: "2026-08-16T12:03:00Z" },
  });
  assert.equal(result.commits.length, 1);
  assert.equal(paths.some((path) => /^https:\/\//.test(path)), true);
  assert.deepEqual(result.pagination.projects, { pages: 2, truncated: false });
});

test("sync maps Bitbucket Server repositories", async () => {
  const request = async (cfg, path) => {
    if (path.startsWith("/rest/api/1.0/repos?")) return {
      values: [{
        project: { key: "TEAM" },
        slug: "example",
        name: "Example",
        public: false,
        description: "Server fixture",
        links: {
          self: [{ href: "https://bitbucket.example.test/projects/TEAM/repos/example" }],
          clone: [{ name: "http", href: "https://bitbucket.example.test/scm/team/example.git" }],
        },
      }],
      isLastPage: true,
    };
    if (path.endsWith("/branches/default")) return { displayId: "main" };
    if (path.includes("/commits?")) return { values: [{
      id: "1234567890abcdef",
      message: "feat: server fixture",
      authorTimestamp: Date.parse("2026-08-16T12:04:00Z"),
      author: { name: "Server Author" },
    }] };
    if (path.includes("/pull-requests?")) return { values: [] };
    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await syncBitbucket(
    { type: "server", baseUrl: "https://bitbucket.example.test", token: "test-token" },
    { request },
  );

  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].id, "TEAM/example");
  assert.equal(result.projects[0].defaultBranch, "main");
  assert.equal(result.projects[0].visibility, "private");
  assert.equal(result.commits[0].date, "2026-08-16T12:04:00.000Z");
  assert.deepEqual(result.pagination.projects, { pages: 1, truncated: false });
});
