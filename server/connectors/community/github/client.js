const {
  buildHttpUrl,
  collectPages,
  requestJson,
} = require("../../sdk");

const DEFAULT_BASE_URL = "https://api.github.com";

function buildGithubUrl(baseUrl, apiPath) {
  return buildHttpUrl(baseUrl || DEFAULT_BASE_URL, apiPath);
}

function githubRequest(baseUrl, token, apiPath, method = "GET", body = null, extraHeaders = null, responseType = "json") {
  return requestJson({
    baseUrl: baseUrl || DEFAULT_BASE_URL,
    path: apiPath,
    method,
    body,
    responseType,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "lintaya",
      ...(extraHeaders || {}),
    },
  });
}

function normalizeGithubRunStatus(run) {
  if (!run) return null;
  if (run.status !== "completed") {
    if (run.status === "in_progress") return "running";
    if (run.status === "queued") return "pending";
    return run.status;
  }
  const statuses = {
    success: "success",
    failure: "failed",
    cancelled: "canceled",
    timed_out: "failed",
    action_required: "failed",
    startup_failure: "failed",
  };
  return statuses[run.conclusion] || run.conclusion || null;
}

async function syncGithub(cfg, options = {}) {
  const request = options.request || githubRequest;
  const repositoryPages = await collectPages({
    maxPages: 10,
    initialCursor: 1,
    fetchPage: page => request(
      cfg.baseUrl,
      cfg.token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    ),
    getItems: response => Array.isArray(response) ? response : [],
    getNext: (_response, batch, page) => batch.length === 100 ? page + 1 : null,
  });
  const repoList = repositoryPages.items;

  const allDeployments = [];
  const allCommits = [];
  const allPullRequests = [];
  const projects = await Promise.all(repoList.map(async (repository) => {
    const owner = repository.owner?.login || String(repository.full_name || "").split("/")[0];
    const name = repository.name;
    const branch = repository.default_branch || "main";
    let deployments = [];
    let lastCommit = null;

    try {
      const data = await request(cfg.baseUrl, cfg.token, `/repos/${owner}/${name}/deployments?per_page=10`);
      deployments = Array.isArray(data) ? data : [];
      for (const deployment of deployments) {
        allDeployments.push({
          id: deployment.id,
          projectId: repository.full_name,
          projectName: repository.name,
          environment: deployment.environment || "—",
          status: deployment.state || deployment.environment || "—",
          ref: deployment.ref,
          sha: (deployment.sha || "").slice(0, 8),
          user: deployment.creator?.login || null,
          createdAt: deployment.created_at,
          finishedAt: deployment.updated_at || null,
          webUrl: repository.html_url,
        });
      }
    } catch {}

    try {
      const commits = await request(
        cfg.baseUrl,
        cfg.token,
        `/repos/${owner}/${name}/commits?per_page=5&sha=${encodeURIComponent(branch)}`,
      );
      const list = Array.isArray(commits) ? commits : [];
      for (const commit of list) {
        allCommits.push({
          id: (commit.sha || "").slice(0, 8),
          title: (commit.commit?.message || "").split("\n")[0],
          author: commit.commit?.author?.name || null,
          date: commit.commit?.author?.date,
          projectId: repository.full_name,
          projectName: repository.name,
          webUrl: commit.html_url,
        });
      }
      if (list[0]) {
        lastCommit = {
          sha: (list[0].sha || "").slice(0, 8),
          message: (list[0].commit?.message || "").split("\n")[0],
          when: list[0].commit?.author?.date,
        };
      }
    } catch {}

    let pipelineStatus = null;
    try {
      const runs = await request(
        cfg.baseUrl,
        cfg.token,
        `/repos/${owner}/${name}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
      );
      pipelineStatus = normalizeGithubRunStatus(runs?.workflow_runs?.[0]);
    } catch {}

    let openMRs = 0;
    try {
      const pullRequests = await request(
        cfg.baseUrl,
        cfg.token,
        `/repos/${owner}/${name}/pulls?state=open&per_page=100`,
      );
      const list = Array.isArray(pullRequests) ? pullRequests : [];
      openMRs = list.length;
      // Esta llamada ya se hacía para contar; quedarse con la lista no cuesta
      // ninguna petición extra y es lo que alimenta el block de pull requests.
      for (const pullRequest of list) {
        allPullRequests.push({
          id: `${repository.full_name}#${pullRequest.number}`,
          number: pullRequest.number,
          title: pullRequest.title,
          projectId: repository.full_name,
          projectName: repository.name,
          draft: !!pullRequest.draft,
          author: pullRequest.user?.login || null,
          sourceBranch: pullRequest.head?.ref || null,
          targetBranch: pullRequest.base?.ref || null,
          createdAt: pullRequest.created_at,
          updatedAt: pullRequest.updated_at,
          webUrl: pullRequest.html_url,
        });
      }
    } catch {}

    // GitHub's tags endpoint isn't date-sorted, so a plain tag list can't
    // reliably surface the newest one with a single call — try the formal
    // "Releases" feature first (already sorted, newest first) and only fall
    // back to the first tag (best-effort, no date) when the repo has tags
    // but never published a Release.
    let latestTag = null;
    try {
      const release = await request(cfg.baseUrl, cfg.token, `/repos/${owner}/${name}/releases/latest`);
      if (release?.tag_name) latestTag = { name: release.tag_name, when: release.published_at || release.created_at || null };
    } catch {}
    if (!latestTag) {
      try {
        const tags = await request(cfg.baseUrl, cfg.token, `/repos/${owner}/${name}/tags?per_page=1`);
        const tag = Array.isArray(tags) ? tags[0] : null;
        if (tag?.name) latestTag = { name: tag.name, when: null };
      } catch {}
    }

    return {
      id: repository.full_name,
      name: repository.name,
      path: repository.full_name,
      webUrl: repository.html_url,
      cloneUrl: repository.clone_url,
      deploymentCount: deployments.length,
      lastActivityAt: repository.pushed_at || repository.updated_at,
      description: repository.description || "",
      defaultBranch: branch,
      group: owner || "—",
      topics: repository.topics || [],
      visibility: repository.private ? "private" : "public",
      pipelineStatus,
      language: repository.language || null,
      openMRs,
      lastCommit,
      latestTag,
      fork: !!repository.fork,
    };
  }));

  allDeployments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  allCommits.sort((a, b) => new Date(b.date) - new Date(a.date));
  allPullRequests.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return {
    projects, deployments: allDeployments, commits: allCommits, pullRequests: allPullRequests,
    pagination: { projects: { pages: repositoryPages.pageCount, truncated: repositoryPages.truncated } },
  };
}

// Creates a repository under the token's own account, or under `org` when the
// repository must belong to an organization. GitHub answers 201 with the full
// repository object; only the fields Lintaya actually shows are returned.
async function createGithubRepository(cfg, input, options = {}) {
  const request = options.request || githubRequest;
  const name = String(input?.name || "").trim();
  if (!name) throw new Error("name is required");
  const org = String(input?.org || "").trim();

  const body = {
    name,
    // Private unless the caller explicitly said otherwise. A public repository
    // is not reversible in practice — it can be cloned, forked, and indexed
    // before anyone notices the mistake — so an absent or malformed flag must
    // never be read as "public".
    private: input?.private !== false,
    // An empty repository is what a migration pushes into; auto_init would add
    // a first commit that the local history then has to reconcile with.
    auto_init: input?.autoInit === true,
  };
  if (input?.description) body.description = String(input.description);

  const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : "/user/repos";
  const repo = await request(cfg.baseUrl, cfg.token, path, "POST", body);
  return {
    id: repo?.id ?? null,
    name: repo?.name ?? name,
    fullName: repo?.full_name ?? null,
    private: Boolean(repo?.private),
    webUrl: repo?.html_url ?? null,
    cloneUrl: repo?.clone_url ?? null,
    sshUrl: repo?.ssh_url ?? null,
    defaultBranch: repo?.default_branch ?? null,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  buildGithubUrl,
  createGithubRepository,
  githubRequest,
  normalizeGithubRunStatus,
  syncGithub,
};
