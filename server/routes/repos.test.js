const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AppError, sendAppError } = require("../core/errors");
const { registerReposRoutes } = require("./repos");

function setup({ commitIdentity, resolveConnectorType } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-repos-"));
  const store = new Map();
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers.at(-1)); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers.at(-1)); },
    put(route, ...handlers) { routes.set(`PUT ${route}`, handlers.at(-1)); },
    patch(route, ...handlers) { routes.set(`PATCH ${route}`, handlers.at(-1)); },
    delete(route, ...handlers) { routes.set(`DELETE ${route}`, handlers.at(-1)); },
  };
  const repos = registerReposRoutes({
    app,
    requireAuth(_req, _res, next) { next(); },
    auditWrite() { return (_req, _res, next) => next(); },
    kvGet(key) { return store.has(key) ? { value: store.get(key) } : null; },
    kvSet(key, value) { store.set(key, value); },
    connectorLog() {}, resolveConnectorType: resolveConnectorType || ((id) => id), insecureAgent: false,
    config: {
      serverDir: root,
      database: { reposPath: path.join(root, "repos.db") },
      networkTools: { host: "127.0.0.1", port: 3100, python: "python", servicePython: "python" },
      vscodeWebPort: 3101,
      git: { commitIdentity: commitIdentity || {} },
    },
    AppError, sendAppError,
  });
  const invoke = (method, route, { params = {}, body = {}, query = {}, id = "request-1" } = {}) => new Promise((resolve, reject) => {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler, `Missing ${method} ${route}`);
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    Promise.resolve(handler({ params, body, query, id }, res)).catch(reject);
  });
  return {
    root, store, invoke, repos,
    cleanup() { repos.reposDb.close(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test("repository analysis uses RFC 9457 when no report is available", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const result = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/analysis", {
    params: { provider: "gitlab", id: "project-1" },
  });
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, {
    type: "urn:lintaya:problem:not-found",
    title: "Not Found",
    status: 404,
    detail: "analysis-not-found",
    instance: "urn:lintaya:request:request-1",
    code: "NOT_FOUND",
    details: null,
    requestId: "request-1",
  });
});

test("repository file routes use RFC 9457 for a missing local clone", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const result = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/fs/duplicate", {
    params: { provider: "gitlab", id: "project-1" }, body: { path: "README.md" },
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.code, "NOT_FOUND");
  assert.equal(result.body.detail, "No hay clon local — clónalo primero.");
});

test("repository file routes reject path traversal with RFC 9457 details", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "clone");
  fs.mkdirSync(clonePath);
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });
  const result = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/fs/duplicate", {
    params: { provider: "gitlab", id: "project-1" }, body: { path: "../outside.txt" },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "BAD_REQUEST");
  assert.equal(result.body.detail, "path-fuera-del-repo");
});

test("local Git routes validate required input and reject paths outside the clone", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "clone");
  fs.mkdirSync(clonePath);
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });

  const missingFile = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/git/diff", {
    params: { provider: "gitlab", id: "project-1" },
  });
  assert.equal(missingFile.status, 400);
  assert.equal(missingFile.body.code, "BAD_REQUEST");
  assert.equal(missingFile.body.detail, "file-required");

  const traversal = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/git/stage", {
    params: { provider: "gitlab", id: "project-1" }, body: { file: "../outside.txt" },
  });
  assert.equal(traversal.status, 400);
  assert.equal(traversal.body.type, "urn:lintaya:problem:bad-request");
  assert.equal(traversal.body.detail, "path-outside-repo");
});

// Refs reach git's argv before the `--` separator, so a value starting with "-"
// is parsed as an option — and `log`/`show`/`diff` accept `--output=<file>`,
// which writes anywhere the caller names. Every ref-taking route must refuse it
// before spawning git.
test("local Git routes refuse refs that git would parse as options", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "clone");
  fs.mkdirSync(clonePath);
  fs.writeFileSync(path.join(clonePath, "README.md"), "# readme\n");
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });
  const params = { provider: "gitlab", id: "project-1" };
  const escape = path.join(harness.root, "escaped.txt");

  const log = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/git/log", {
    params, query: { branch: `--output=${escape}` },
  });
  assert.equal(log.status, 400);
  assert.equal(log.body.detail, "ref-invalid");

  const show = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/git/commit/:sha", {
    params: { ...params, sha: `--output=${escape}` },
  });
  assert.equal(show.status, 400);
  assert.equal(show.body.detail, "sha-invalid");

  const diffSince = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/git/file-diff-since", {
    params, query: { path: "README.md", sha: "abcdef0", ref: `--output=${escape}` },
  });
  assert.equal(diffSince.status, 400);
  assert.equal(diffSince.body.detail, "ref-invalid");

  const checkout = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/git/checkout", {
    params, body: { branch: `--output=${escape}` },
  });
  assert.equal(checkout.status, 400);
  assert.equal(checkout.body.detail, "ref-invalid");

  assert.equal(fs.existsSync(escape), false, "no route may write outside the clone");
});

// The guard must not be so tight that it rejects refs git accepts — branch
// names legitimately carry @, +, # and non-ASCII characters.
test("local Git ref validation still accepts ordinary branch names", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "clone");
  fs.mkdirSync(clonePath);
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });

  for (const branch of ["main", "origin/main", "feature/PROJ-12_fix", "release@v2", "fix+hotfix", "rama-ñ"]) {
    const result = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/git/log", {
      params: { provider: "gitlab", id: "project-1" }, query: { branch },
    });
    // The clone is not a real repository, so git fails — the point is that it
    // got as far as running, rather than being rejected as a bad ref.
    assert.notEqual(result.body.detail, "ref-invalid", branch);
  }
});

test("local Git execution failures use a safe RFC 9457 bad-gateway response", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "not-a-git-repository");
  fs.mkdirSync(clonePath);
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });

  const result = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/git/status", {
    params: { provider: "gitlab", id: "project-1" },
  });
  assert.deepEqual(result, {
    status: 502,
    body: {
      type: "urn:lintaya:problem:upstream-error",
      title: "Bad Gateway",
      status: 502,
      detail: "Git operation failed",
      instance: "urn:lintaya:request:request-1",
      code: "UPSTREAM_ERROR",
      details: null,
      requestId: "request-1",
    },
  });
});

test("remote Git actions normalize an unconfigured connector", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const result = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/git/fetch", {
    params: { provider: "gitlab", id: "project-1" },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "BAD_REQUEST");
  assert.equal(result.body.detail, "connector-not-configured");
});

test("repository file reading normalizes invalid and missing local paths", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "clone");
  fs.mkdirSync(clonePath);
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });

  const missingPath = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/file", {
    params: { provider: "gitlab", id: "project-1" }, query: { source: "local" },
  });
  assert.equal(missingPath.status, 400);
  assert.equal(missingPath.body.detail, "path-required");

  const traversal = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/file", {
    params: { provider: "gitlab", id: "project-1" }, query: { source: "local", path: "../outside.txt" },
  });
  assert.equal(traversal.status, 400);
  assert.equal(traversal.body.detail, "path-outside-repo");

  const missingFile = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/file", {
    params: { provider: "gitlab", id: "project-1" }, query: { source: "local", path: "missing.txt" },
  });
  assert.equal(missingFile.status, 404);
  assert.equal(missingFile.body.code, "NOT_FOUND");
  assert.equal(missingFile.body.detail, "file-not-found");
});

test("pipeline routes return RFC 9457 validation details", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const missingConfig = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/pipelines", {
    params: { provider: "gitlab", id: "project-1" },
  });
  assert.equal(missingConfig.status, 400);
  assert.equal(missingConfig.body.detail, "connector-not-configured");

  harness.store.set("connector-config-gitlab", { baseUrl: "https://gitlab.example.test", token: "test-token" });
  const missingRef = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/pipelines", {
    params: { provider: "gitlab", id: "project-1" }, body: {},
  });
  assert.equal(missingRef.status, 400);
  assert.equal(missingRef.body.code, "BAD_REQUEST");
  assert.equal(missingRef.body.detail, "ref-required");
});

test("advisory detail routes exist for each source and refuse an adapter that lacks them", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  harness.store.set("connector-config-bitbucket", { baseUrl: "https://bitbucket.example.test", token: "test-token" });

  for (const [ruta, parametros] of [
    ["security-advisories/:advisoryId", { advisoryId: "GHSA-xxxx" }],
    ["code-scanning-alerts/:alertNumber", { alertNumber: "1" }],
    ["dependabot-alerts/:alertNumber", { alertNumber: "1" }],
  ]) {
    const respuesta = await harness.invoke("GET", `/api/connectors/:provider/projects/:id/${ruta}`, {
      params: { provider: "bitbucket", id: "team/repo", ...parametros },
    });
    assert.equal(respuesta.status, 400, `${ruta} debe contestar, no faltar`);
    assert.equal(respuesta.body.detail, "advisory-detail-not-supported");
  }
});

test("advisory routes validate the connector and report which providers implement them", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());

  for (const resource of ["security-advisories", "code-scanning-alerts"]) {
    const missingConfig = await harness.invoke("GET", `/api/connectors/:provider/projects/:id/${resource}`, {
      params: { provider: "github", id: "owner/repo" },
    });
    assert.equal(missingConfig.status, 400);
    assert.equal(missingConfig.body.detail, "connector-not-configured");
  }

  // Bitbucket resuelve a un adaptador real que no declara estos metodos.
  harness.store.set("connector-config-bitbucket", { baseUrl: "https://bitbucket.example.test", token: "test-token" });
  const advisories = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/security-advisories", {
    params: { provider: "bitbucket", id: "team/repo" },
  });
  assert.equal(advisories.status, 400);
  assert.equal(advisories.body.detail, "security-advisories-not-supported");

  const scanning = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/code-scanning-alerts", {
    params: { provider: "bitbucket", id: "team/repo" },
  });
  assert.equal(scanning.status, 400);
  assert.equal(scanning.body.detail, "code-scanning-not-supported");
});

test("pull request and issue routes validate the connector and the provider", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());

  for (const resource of ["pull-requests", "issues"]) {
    const missingConfig = await harness.invoke("GET", `/api/connectors/:provider/projects/:id/${resource}`, {
      params: { provider: "github", id: "owner/repo" },
    });
    assert.equal(missingConfig.status, 400);
    assert.equal(missingConfig.body.detail, "connector-not-configured");
  }

  const unknownProvider = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/pull-requests", {
    params: { provider: "not-a-provider", id: "owner/repo" },
  });
  assert.equal(unknownProvider.status, 404);
});

test("pull requests and issues report which providers implement them", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  // Bitbucket resuelve a un adaptador real que no declara estos metodos: la
  // ruta debe decir "no soportado aqui" y no romperse llamando a undefined.
  harness.store.set("connector-config-bitbucket", { baseUrl: "https://bitbucket.example.test", token: "test-token" });

  const pulls = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/pull-requests", {
    params: { provider: "bitbucket", id: "team/repo" },
  });
  assert.equal(pulls.status, 400);
  assert.equal(pulls.body.detail, "pull-requests-not-supported");

  const issues = await harness.invoke("GET", "/api/connectors/:provider/projects/:id/issues", {
    params: { provider: "bitbucket", id: "team/repo" },
  });
  assert.equal(issues.status, 400);
  assert.equal(issues.body.detail, "issues-not-supported");
});

test("editing a GitLab project rejects other providers, empty bodies, and never leaks the slug through", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());

  const wrongProvider = await harness.invoke("PATCH", "/api/connectors/:provider/projects/:id", {
    params: { provider: "github", id: "1" }, body: { name: "Enova" },
  });
  assert.equal(wrongProvider.status, 400);
  assert.equal(wrongProvider.body.detail, "provider-not-supported");

  harness.store.set("connector-config-gitlab", { baseUrl: "https://gitlab.example.test", token: "test-token" });

  const noFields = await harness.invoke("PATCH", "/api/connectors/:provider/projects/:id", {
    params: { provider: "gitlab", id: "1" }, body: {},
  });
  assert.equal(noFields.status, 400);
  assert.equal(noFields.body.detail, "no-fields");

  // `path` is the repo slug baked into the Docker image name and clone URL
  // everywhere else in the ecosystem — stripping it here is what keeps a
  // display-name rename from silently breaking production.
  const pathOnly = await harness.invoke("PATCH", "/api/connectors/:provider/projects/:id", {
    params: { provider: "gitlab", id: "1" }, body: { path: "enova" },
  });
  assert.equal(pathOnly.status, 400, "path alone must not reach GitLab as a no-op-looking request");
  assert.equal(pathOnly.body.detail, "no-fields");
});

test("editor, environment, and link-existing routes normalize local-clone validation", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const params = { provider: "gitlab", id: "project-1" };

  const editor = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/open-vscode", { params });
  assert.equal(editor.status, 404);
  assert.equal(editor.body.detail, "No hay clon local — clónalo primero.");

  const environment = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/prepare-env", { params });
  assert.equal(environment.status, 404);
  assert.equal(environment.body.code, "NOT_FOUND");
  assert.equal(environment.body.detail, "No local clone found");

  harness.store.set("connector-config-gitlab", { baseUrl: "https://gitlab.example.test", token: "test-token" });
  const link = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/link-existing", { params, body: {} });
  assert.equal(link.status, 400);
  assert.equal(link.body.code, "BAD_REQUEST");
  assert.equal(link.body.detail, "path-requerido");
});

test("runtime launchers return RFC 9457 when a local clone is unavailable", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const runtime = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/runtime/play", {
    params: { provider: "gitlab", id: "project-1" },
  });
  assert.equal(runtime.status, 404);
  assert.equal(runtime.body.code, "NOT_FOUND");
  assert.equal(runtime.body.detail, "Este repo no está clonado localmente.");

  const networkTools = await harness.invoke("POST", "/api/repos/network-tools/play");
  assert.equal(networkTools.status, 404);
  assert.equal(networkTools.body.type, "urn:lintaya:problem:not-found");
  assert.equal(networkTools.body.detail, "network-tools-no-local-clone");
});

test("the committer identity resolves connection first, then base type, then env", (t) => {
  const harness = setup({
    commitIdentity: {
      gitlab: { name: "Env Fallback", email: "env@example.com" },
      github: { name: "Env Github", email: "env-gh@example.com" },
    },
    resolveConnectorType: (id) => id.replace(/\d+$/, ""),
  });
  t.after(() => harness.cleanup());
  harness.store.set("connector-commit-identity", {
    gitlab: { name: "Saved Base", email: "base@example.com" },
    gitlab3: { name: "Saved Instance", email: "instance@example.com" },
  });

  // The exact connection wins over its base type and over the environment.
  assert.deepEqual(harness.repos.commitIdentityFor("gitlab3"),
    { name: "Saved Instance", email: "instance@example.com" });
  // A second instance with no entry of its own falls back to the base type.
  assert.deepEqual(harness.repos.commitIdentityFor("gitlab2"),
    { name: "Saved Base", email: "base@example.com" });
  // Nothing saved for GitHub, so the environment fallback applies.
  assert.deepEqual(harness.repos.commitIdentityFor("github"),
    { name: "Env Github", email: "env-gh@example.com" });
  // Neither saved nor configured — git keeps resolving the identity itself.
  assert.equal(harness.repos.commitIdentityFor("bitbucket"), null);
});

test("with no saved or configured identity every provider defers to git", (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());

  assert.equal(harness.repos.commitIdentityFor("gitlab"), null);
});

test("a recognized Git failure reaches the client as its own code, not the generic 502", async (t) => {
  const harness = setup();
  t.after(() => harness.cleanup());
  const clonePath = path.join(harness.root, "empty-repo");
  fs.mkdirSync(clonePath);
  // A real repository with nothing staged: `git commit` exits non-zero with
  // "nothing to commit", which the classifier maps to a 400 the UI can explain.
  const { spawnSync } = require("node:child_process");
  spawnSync("git", ["-C", clonePath, "init", "-q"]);
  // The fixture carries its own identity. Without one, `git commit` stops at
  // "Author identity unknown" before it ever reaches "nothing to commit", so
  // the classifier sees an error it does not recognize and answers 502 — which
  // is what happens on a clean machine and on CI, where no global identity is
  // configured. The test is about the classifier, not about git config.
  spawnSync("git", ["-C", clonePath, "config", "user.email", "fixture@example.test"]);
  spawnSync("git", ["-C", clonePath, "config", "user.name", "Fixture"]);
  harness.store.set("gitlab-clone-state", { "project-1": { path: clonePath } });

  const result = await harness.invoke("POST", "/api/connectors/:provider/projects/:id/git/commit", {
    params: { provider: "gitlab", id: "project-1" },
    body: { message: "nothing here" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.code, "GIT_NOTHING_TO_COMMIT");
  assert.match(result.body.detail, /nothing staged/i);
});
