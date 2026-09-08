const assert = require("node:assert/strict");
const { test } = require("node:test");

const { classifyGitFailure, gitFailureError } = require("./git-errors");

// The real stderr git produced for each case, so the patterns are checked
// against actual output rather than a paraphrase of it.
const SAMPLES = {
  GIT_DIVERGED: "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint: \tgit merge --no-ff\nfatal: Not possible to fast-forward, aborting.",
  GIT_PUSH_REJECTED: " ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'http://gitlab.example/g/p.git'",
  GIT_MERGE_CONFLICT: "Auto-merging app.py\nCONFLICT (content): Merge conflict in app.py\nAutomatic merge failed; fix conflicts and then commit the result.",
  GIT_LOCAL_CHANGES: "error: Your local changes to the following files would be overwritten by merge:\n\tapp.py\nPlease commit your changes or stash them before you merge.",
  GIT_NO_UPSTREAM: "fatal: The current branch feature has no upstream branch.",
  GIT_NOTHING_TO_COMMIT: "On branch main\nnothing to commit, working tree clean",
  GIT_AUTH_FAILED: "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'http://gitlab.example/g/p.git/'",
  // Verbatim from a real fetch with a token that could not see the repository:
  // GitHub 404s instead of 403ing, so nothing in it says "denied".
  GIT_REPO_NOT_FOUND: "remote: Repository not found.\nfatal: repository 'https://github.com/Ender618X/personalhq.git/' not found",
  GIT_REMOTE_UNREACHABLE: "fatal: unable to access 'http://gitlab.example/g/p.git/': Failed to connect to gitlab.example port 8070 after 21055 ms: Could not connect to server",
};

test("each recognized git failure maps to its own code", () => {
  for (const [code, stderr] of Object.entries(SAMPLES)) {
    const result = classifyGitFailure(Object.assign(new Error(stderr), { stderr }));
    assert.equal(result?.code, code, `expected ${code} for: ${stderr.slice(0, 60)}`);
  }
});

test("a diverged pull is a 409 the UI can act on, not an opaque 502", () => {
  const err = Object.assign(new Error("boom"), { stderr: SAMPLES.GIT_DIVERGED });

  const appError = gitFailureError(err);

  assert.equal(appError.status, 409);
  assert.equal(appError.code, "GIT_DIVERGED");
  assert.match(appError.message, /diverged/i);
  assert.equal(appError.cause, err);
});

test("a push rejected for being behind is distinguished from a diverged pull", () => {
  assert.equal(gitFailureError(Object.assign(new Error(""), { stderr: SAMPLES.GIT_PUSH_REJECTED })).code, "GIT_PUSH_REJECTED");
});

test("a subprocess timeout is classified from the error, not from stderr", () => {
  const appError = gitFailureError(Object.assign(new Error("Command timed out after 1200000ms"), { code: "ETIMEDOUT" }));

  assert.equal(appError.code, "GIT_TIMEOUT");
  assert.equal(appError.status, 502);
});

test("an unrecognized failure keeps the generic upstream error", () => {
  const appError = gitFailureError(Object.assign(new Error("fatal: something new"), { stderr: "fatal: something new" }));

  assert.equal(appError.status, 502);
  assert.equal(appError.code, "UPSTREAM_ERROR");
  assert.equal(appError.message, "Git operation failed");
});

test("classification never echoes git output back to the client", () => {
  // git runs with `-c http.extraheader=Authorization: …`, so any stderr
  // passthrough is a credential leak. Every message must be our own text.
  const stderr = "fatal: Authentication failed\nAuthorization: Bearer glpat-SUPERSECRETTOKEN";
  const appError = gitFailureError(Object.assign(new Error(stderr), { stderr }));

  assert.equal(appError.code, "GIT_AUTH_FAILED");
  assert.doesNotMatch(appError.message, /glpat|Bearer|Authorization/);
  assert.equal(appError.details, null);
});

test("an empty or missing error does not crash the classifier", () => {
  assert.equal(classifyGitFailure(null), null);
  assert.equal(classifyGitFailure(Object.assign(new Error(""), { stderr: "" })), null);
  assert.equal(gitFailureError(undefined).code, "UPSTREAM_ERROR");
});
