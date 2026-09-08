const {
  buildHttpUrl,
  collectPages,
  requestJson,
} = require("../../sdk");

const DEFAULT_BASE_URL = "https://gitlab.com";

function buildGitlabUrl(baseUrl, apiPath) {
  return buildHttpUrl(baseUrl || DEFAULT_BASE_URL, apiPath);
}

function gitlabRequest(baseUrl, token, apiPath, method = "GET", body = null, extraHeaders = null, responseType = "json", timeoutMs = undefined) {
  return requestJson({
    baseUrl: baseUrl || DEFAULT_BASE_URL,
    path: apiPath,
    method,
    body,
    responseType,
    headers: {
      "PRIVATE-TOKEN": token,
      Accept: "application/json",
      "User-Agent": "lintaya",
      ...(extraHeaders || {}),
    },
    // Compatibility with existing self-hosted installations. A future config
    // migration will make insecure TLS an explicit per-connector opt-in.
    requestOptions: { rejectUnauthorized: false },
    ...(timeoutMs != null ? { timeoutMs } : {}),
  });
}

async function syncGitlab(cfg, options = {}) {
  const request = options.request || gitlabRequest;
  const projectPages = await collectPages({
    maxPages: 10,
    initialCursor: 1,
    fetchPage: page => request(
      cfg.baseUrl,
      cfg.token,
      `/api/v4/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at&sort=desc`,
    ),
    getItems: response => Array.isArray(response) ? response : [],
    getNext: (_response, batch, page) => batch.length === 100 ? page + 1 : null,
  });
  const projectList = projectPages.items;

  const allDeployments = [];
  const allCommits = [];
  const projects = await Promise.all(projectList.map(async (project) => {
    let deployments = [];
    let lastCommit = null;

    try {
      const data = await request(
        cfg.baseUrl,
        cfg.token,
        `/api/v4/projects/${project.id}/deployments?per_page=10&order_by=created_at&sort=desc`,
      );
      deployments = Array.isArray(data) ? data : [];
      for (const deployment of deployments) {
        allDeployments.push({
          id: deployment.id,
          projectId: project.id,
          projectName: project.name,
          environment: deployment.environment?.name || "—",
          status: deployment.status,
          ref: deployment.ref,
          sha: (deployment.sha || "").slice(0, 8),
          user: deployment.user?.name || deployment.deployable?.user?.name || null,
          createdAt: deployment.created_at,
          finishedAt: deployment.deployable?.finished_at || null,
          webUrl: deployment.deployable?.web_url || project.web_url,
        });
      }
    } catch {}

    try {
      const commits = await request(
        cfg.baseUrl,
        cfg.token,
        `/api/v4/projects/${project.id}/repository/commits?per_page=5&ref_name=${encodeURIComponent(project.default_branch || "")}`,
      );
      const list = Array.isArray(commits) ? commits : [];
      for (const commit of list) {
        allCommits.push({
          id: commit.short_id || (commit.id || "").slice(0, 8),
          title: commit.title || (commit.message || "").split("\n")[0],
          author: commit.author_name || null,
          date: commit.committed_date || commit.authored_date,
          projectId: project.id,
          projectName: project.name,
          webUrl: commit.web_url || `${project.web_url}/-/commit/${commit.id}`,
        });
      }
      if (list[0]) {
        lastCommit = {
          sha: list[0].short_id || (list[0].id || "").slice(0, 8),
          message: list[0].title || (list[0].message || "").split("\n")[0],
          when: list[0].committed_date || list[0].authored_date,
        };
      }
    } catch {}

    let pipelineStatus = null;
    try {
      const pipelines = await request(
        cfg.baseUrl,
        cfg.token,
        `/api/v4/projects/${project.id}/pipelines?ref=${encodeURIComponent(project.default_branch || "")}&per_page=1&order_by=id&sort=desc`,
      );
      pipelineStatus = Array.isArray(pipelines) && pipelines[0] ? pipelines[0].status : null;
    } catch {}

    let language = null;
    try {
      const languages = await request(
        cfg.baseUrl,
        cfg.token,
        `/api/v4/projects/${project.id}/languages`,
      );
      const entries = Object.entries(languages || {});
      if (entries.length) language = entries.sort((a, b) => b[1] - a[1])[0][0];
    } catch {}

    let openMRs = 0;
    try {
      const mergeRequests = await request(
        cfg.baseUrl,
        cfg.token,
        `/api/v4/projects/${project.id}/merge_requests?state=opened&per_page=100`,
      );
      openMRs = Array.isArray(mergeRequests) ? mergeRequests.length : 0;
    } catch {}

    // Most-recently-updated tag — a plain `git tag` reliably shows up here
    // even when the project never used GitLab's separate "Releases" feature
    // (a Release is an optional record attached to a tag; the tag itself is
    // what most repos actually have).
    let latestTag = null;
    try {
      const tags = await request(
        cfg.baseUrl,
        cfg.token,
        `/api/v4/projects/${project.id}/repository/tags?order_by=updated&sort=desc&per_page=1`,
      );
      const tag = Array.isArray(tags) ? tags[0] : null;
      if (tag) latestTag = { name: tag.name, when: tag.commit?.committed_date || null };
    } catch {}

    return {
      id: project.id,
      name: project.name,
      path: project.path_with_namespace,
      webUrl: project.web_url,
      cloneUrl: project.http_url_to_repo || project.ssh_url_to_repo || `${project.web_url}.git`,
      deploymentCount: deployments.length,
      lastActivityAt: project.last_activity_at,
      description: project.description || "",
      defaultBranch: project.default_branch || "main",
      group: (project.path_with_namespace || "").split("/").slice(0, -1).join("/") || "—",
      topics: project.topics || project.tag_list || [],
      visibility: project.visibility || "private",
      pipelineStatus,
      language,
      openMRs,
      lastCommit,
      latestTag,
      fork: !!project.forked_from_project,
    };
  }));

  allDeployments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  allCommits.sort((a, b) => new Date(b.date) - new Date(a.date));
  return {
    projects, deployments: allDeployments, commits: allCommits,
    pagination: { projects: { pages: projectPages.pageCount, truncated: projectPages.truncated } },
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  buildGitlabUrl,
  gitlabRequest,
  syncGitlab,
};
