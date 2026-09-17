const {
  ConnectorHttpError,
  buildHttpUrl,
  collectPages,
  requestJson,
} = require("../../sdk");

const CLOUD_BASE_URL = "https://api.bitbucket.org/2.0";
const MAX_PAGES = 10;
const PROJECT_CONCURRENCY = 6;

// Atlassian does not document the response shape of /user/workspaces. These
// two locations are the shapes observed in Cloud responses and are accepted
// defensively until the API contract is published.
function workspaceSlug(value) {
  return value?.workspace?.slug || value?.slug || null;
}

async function listBitbucketWorkspaces(cfg, request) {
  const result = await collectPages({
    maxPages: MAX_PAGES,
    initialCursor: "/user/workspaces?pagelen=100",
    fetchPage: next => request(cfg, next),
    getItems: data => (Array.isArray(data?.values) ? data.values : []).map(workspaceSlug).filter(Boolean),
    getNext: data => data?.next || null,
  });
  return [...new Set(result.items)];
}

function bitbucketApiBase(cfg) {
  return cfg?.type === "server" ? cfg.baseUrl : CLOUD_BASE_URL;
}

function bitbucketAuthHeader(cfg) {
  if (cfg?.type === "server") return `Bearer ${cfg.token}`;
  return `Basic ${Buffer.from(`${cfg?.username || ""}:${cfg?.token || ""}`, "utf8").toString("base64")}`;
}

function resolveBitbucketRequestTarget(cfg, apiPath) {
  const baseUrl = bitbucketApiBase(cfg);
  const rawPath = String(apiPath || "");
  if (!/^https?:\/\//i.test(rawPath)) return { baseUrl, path: rawPath };

  const configured = buildHttpUrl(baseUrl, "");
  let absolute;
  try {
    absolute = new URL(rawPath);
  } catch (cause) {
    throw new ConnectorHttpError("Invalid Bitbucket pagination URL", {
      code: "CONNECTOR_URL_INVALID",
      cause,
    });
  }
  if (!["http:", "https:"].includes(absolute.protocol) || absolute.username || absolute.password) {
    throw new ConnectorHttpError("Invalid Bitbucket pagination URL", {
      code: "CONNECTOR_URL_INVALID",
    });
  }
  const prefix = configured.pathname.replace(/\/+$/, "");
  const pathAllowed = !prefix || prefix === "/"
    || absolute.pathname === prefix
    || absolute.pathname.startsWith(`${prefix}/`);
  if (absolute.origin !== configured.origin || !pathAllowed) {
    throw new ConnectorHttpError("Bitbucket pagination URL left the configured API", {
      code: "CONNECTOR_URL_INVALID",
      url: `${absolute.origin}${absolute.pathname}`,
    });
  }
  return {
    baseUrl: absolute.origin,
    path: absolute.pathname + absolute.search,
  };
}

function bitbucketRequest(cfg, apiPath, method = "GET", body = null, options = null) {
  let target;
  try {
    target = resolveBitbucketRequestTarget(cfg, apiPath);
  } catch (error) {
    return Promise.reject(error);
  }
  const responseType = options?.raw === "buffer" ? "buffer" : options?.raw ? "text" : "json";
  return requestJson({
    ...target,
    method,
    body,
    responseType,
    headers: {
      Authorization: bitbucketAuthHeader(cfg),
      Accept: options?.raw ? "*/*" : "application/json",
      "User-Agent": "lintaya",
      ...(options?.headers || {}),
    },
    // Preserves compatibility with existing Server/Data Center installations
    // using private certificates. New connectors must make this explicit.
    requestOptions: cfg?.type === "server" ? { rejectUnauthorized: false } : {},
  });
}

function splitBitbucketId(id) {
  const value = String(id || "");
  const separator = value.indexOf("/");
  return separator === -1
    ? [value, ""]
    : [value.slice(0, separator), value.slice(separator + 1)];
}

function bitbucketServerPathToString(pathObject) {
  if (!pathObject || typeof pathObject !== "object") return String(pathObject || "");
  if (typeof pathObject.toString === "string") return pathObject.toString;
  return [...(pathObject.components || []), pathObject.name].filter(Boolean).join("/");
}

function toIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function deploymentStatus(deployment) {
  const raw = deployment?.state?.status?.name || deployment?.state?.name || "";
  const value = String(raw).toLowerCase().replace(/\s+/g, "_");
  if (["successful", "success", "succeeded"].includes(value)) return "success";
  if (["failed", "failure", "error", "stopped"].includes(value)) return "failure";
  if (["in_progress", "started", "running"].includes(value)) return "in_progress";
  if (["pending", "queued", "paused"].includes(value)) return "pending";
  return value || "pending";
}

function deploymentUser(deployment) {
  const user = deployment?.state?.trigger?.actor || deployment?.state?.trigger?.user
    || deployment?.release?.creator || deployment?.creator;
  return user?.display_name || user?.nickname || user?.username || user?.name || null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function repositoryIdentity(repository, isServer) {
  if (isServer) return `${repository.project?.key || ""}/${repository.slug || repository.name || ""}`;
  return repository.full_name || repository.uuid || `${repository.workspace?.slug || ""}/${repository.slug || ""}`;
}

async function listBitbucketRepositories(cfg, request, options = {}) {
  const isServer = cfg.type === "server";
  let result;
  if (isServer) {
    result = await collectPages({
      maxPages: MAX_PAGES,
      initialCursor: 0,
      fetchPage: start => request(cfg, `/rest/api/1.0/repos?permission=REPO_READ&limit=100&start=${start}`),
      getItems: data => Array.isArray(data?.values) ? data.values : [],
      getNext: (data, batch) => data?.isLastPage === false && batch.length ? data.nextPageStart : null,
    });
  } else if (cfg.workspace) {
    result = await collectPages({
      maxPages: MAX_PAGES,
      initialCursor: `/repositories/${encodeURIComponent(cfg.workspace)}?role=member&pagelen=100`,
      fetchPage: next => request(cfg, next),
      getItems: data => Array.isArray(data?.values) ? data.values : [],
      getNext: data => data?.next || null,
    });
  } else {
    const workspaces = await listBitbucketWorkspaces(cfg, request);
    const workspaceResults = await Promise.all(workspaces.map(workspace => collectPages({
      maxPages: MAX_PAGES,
      initialCursor: `/repositories/${encodeURIComponent(workspace)}?role=member&pagelen=100`,
      fetchPage: next => request(cfg, next),
      getItems: data => Array.isArray(data?.values) ? data.values : [],
      getNext: data => data?.next || null,
    })));
    result = { items: workspaceResults.flatMap(page => page.items), pageCount: workspaceResults.reduce((sum, page) => sum + page.pageCount, 0), truncated: workspaceResults.some(page => page.truncated) };
  }

  const repositories = result.items;
  if (options.pagination) Object.assign(options.pagination, { pages: result.pageCount, truncated: result.truncated });
  const unique = new Map();
  for (const repository of repositories) {
    const identity = repositoryIdentity(repository, isServer);
    if (identity && !unique.has(identity)) unique.set(identity, repository);
  }
  return [...unique.values()];
}

async function syncBitbucket(cfg, options = {}) {
  const request = options.request || bitbucketRequest;
  const isServer = cfg.type === "server";
  const repositoryPagination = {};
  const rawRepositories = await listBitbucketRepositories(cfg, request, { pagination: repositoryPagination });
  const allCommits = [];
  const allPullRequests = [];
  const allIssues = [];
  const allDeployments = [];

  const projects = await mapWithConcurrency(
    rawRepositories,
    options.concurrency || PROJECT_CONCURRENCY,
    async (repository) => {
      const namespace = isServer
        ? repository.project?.key
        : (repository.workspace?.slug || String(repository.full_name || "").split("/")[0]);
      const slug = isServer
        ? repository.slug
        : (repository.slug || String(repository.full_name || "").split("/")[1]);
      const id = isServer
        ? `${namespace}/${slug}`
        : (repository.full_name || `${namespace}/${slug}`);
      let branch = isServer ? null : (repository.mainbranch?.name || "master");

      if (isServer) {
        try {
          const defaultBranch = await request(
            cfg,
            `/rest/api/1.0/projects/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(slug)}/branches/default`,
          );
          branch = defaultBranch?.displayId || "master";
        } catch {
          branch = "master";
        }
      }

      let lastCommit = null;
      try {
        const commits = isServer
          ? await request(
            cfg,
            `/rest/api/1.0/projects/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(slug)}/commits?limit=5&until=${encodeURIComponent(branch || "")}`,
          )
          : await request(
            cfg,
            `/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/commits/${encodeURIComponent(branch || "")}?pagelen=5`,
          );
        const list = commits?.values || [];
        for (const commit of list) {
          const sha = isServer ? commit.id : commit.hash;
          const date = isServer ? toIsoDate(commit.authorTimestamp) : commit.date;
          allCommits.push({
            id: (sha || "").slice(0, 8),
            title: (commit.message || "").split("\n")[0],
            author: isServer
              ? (commit.author?.name || null)
              : (commit.author?.user?.display_name || commit.author?.raw || null),
            date,
            projectId: id,
            projectName: repository.name,
            webUrl: isServer ? null : (commit.links?.html?.href || null),
          });
        }
        if (list[0]) {
          const commit = list[0];
          const sha = isServer ? commit.id : commit.hash;
          lastCommit = {
            sha: (sha || "").slice(0, 8),
            message: (commit.message || "").split("\n")[0],
            when: isServer ? toIsoDate(commit.authorTimestamp) : commit.date,
          };
        }
      } catch {}

      let latestTag = null;
      try {
        const tags = isServer
          ? await request(
            cfg,
            `/rest/api/1.0/projects/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(slug)}/tags?orderBy=MODIFICATION&limit=1`,
          )
          : await request(
            cfg,
            `/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/refs/tags?sort=-target.date&pagelen=1`,
          );
        const tag = (tags?.values || [])[0];
        if (tag) latestTag = { name: isServer ? tag.displayId : tag.name, when: isServer ? null : (tag.target?.date || null) };
      } catch {}

      let openMRs = 0;
      try {
        const pullRequestPage = isServer
          ? await request(
            cfg,
            `/rest/api/1.0/projects/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(slug)}/pull-requests?state=OPEN&limit=100`,
          )
          : await request(
            cfg,
            `/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/pullrequests?state=OPEN&pagelen=100`,
          );
        const pullRequests = pullRequestPage?.values || [];
        openMRs = pullRequests.length;
        for (const pullRequest of pullRequests) {
          allPullRequests.push({
            id: `${id}!${pullRequest.id}`,
            number: pullRequest.id,
            title: pullRequest.title || "",
            author: isServer ? (pullRequest.author?.user?.displayName || pullRequest.author?.name || null) : (pullRequest.author?.display_name || null),
            projectId: id,
            projectName: repository.name,
            sourceBranch: isServer ? pullRequest.fromRef?.displayId : pullRequest.source?.branch?.name,
            targetBranch: isServer ? pullRequest.toRef?.displayId : pullRequest.destination?.branch?.name,
            updatedAt: toIsoDate(isServer ? pullRequest.updatedDate : pullRequest.updated_on),
            webUrl: isServer ? null : (pullRequest.links?.html?.href || null),
            draft: !!pullRequest.draft,
          });
        }
      } catch {}

      if (!isServer) {
        try {
          const issuesQuery = encodeURIComponent('state IN ("new", "open", "on hold")');
          const issues = await request(cfg, `/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/issues?q=${issuesQuery}&pagelen=100`);
          for (const issue of issues?.values || []) allIssues.push({ id: `${id}#${issue.id}`, number: issue.id, title: issue.title || "", author: issue.reporter?.display_name || null, projectId: id, projectName: repository.name, labels: (issue.labels || []).map(label => label.name || label), comments: issue.comment_count || 0, updatedAt: toIsoDate(issue.updated_on), webUrl: issue.links?.html?.href || null });
        } catch { /* El issue tracker puede estar desactivado por repositorio. */ }
        try {
          const deployments = await request(cfg, `/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/deployments?pagelen=100`);
          for (const deployment of deployments?.values || []) allDeployments.push({ id: deployment.uuid || deployment.key, projectId: id, projectName: repository.name, environment: deployment.environment?.name || "—", status: deploymentStatus(deployment), sha: deployment.release?.commit?.hash?.slice(0, 8) || deployment.commit?.hash?.slice(0, 8) || null, user: deploymentUser(deployment), createdAt: toIsoDate(deployment.release?.created_on || deployment.created_on), finishedAt: toIsoDate(deployment.state?.completion_date || deployment.state?.started_on), webUrl: deployment.links?.self?.href || repository.links?.html?.href || null });
        } catch {}
      }

      const webUrl = isServer
        ? (repository.links?.self?.[0]?.href || null)
        : (repository.links?.html?.href || null);
      const cloneUrl = isServer
        ? (repository.links?.clone?.find((link) => link.name === "http")?.href
          || repository.links?.clone?.[0]?.href)
        : (repository.links?.clone?.find((link) => link.name === "https")?.href
          || repository.links?.clone?.[0]?.href);

      return {
        id,
        name: repository.name,
        path: id,
        webUrl,
        cloneUrl,
        deploymentCount: 0,
        lastActivityAt: isServer ? null : (repository.updated_on || null),
        description: repository.description || "",
        defaultBranch: branch || "master",
        group: namespace || "—",
        topics: [],
        visibility: isServer
          ? (repository.public ? "public" : "private")
          : (repository.is_private ? "private" : "public"),
        pipelineStatus: null,
        language: repository.language || null,
        openMRs,
        lastCommit,
        latestTag,
      };
    },
  );

  allCommits.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return { projects, deployments: allDeployments, commits: allCommits, pullRequests: allPullRequests, issues: allIssues, pagination: { projects: repositoryPagination } };
}

module.exports = {
  CLOUD_BASE_URL,
  MAX_PAGES,
  PROJECT_CONCURRENCY,
  bitbucketApiBase,
  bitbucketAuthHeader,
  bitbucketRequest,
  bitbucketServerPathToString,
  listBitbucketRepositories,
  listBitbucketWorkspaces,
  mapWithConcurrency,
  resolveBitbucketRequestTarget,
  splitBitbucketId,
  syncBitbucket,
  toIsoDate,
};
