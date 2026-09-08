// Turns a failed `git` subprocess into a specific, actionable API error.
//
// Every git route used to funnel its failures through one generic
// 502 "Git operation failed", which is indistinguishable for a diverged
// branch, an expired token and an unreachable remote — the UI could only show
// "something went wrong". This classifies the failure modes we can recognize
// and leaves the generic 502 as the last resort.
//
// The messages here are FIXED STRINGS, never git's own stderr. Git is invoked
// with `-c http.extraheader=Authorization: …` (see gitAuthArgs in
// server/routes/repos.js), so echoing its output back to a client would risk
// handing out a provider token in an error body. Classify, don't forward.
// Each entry also carries a stable `code` so the bilingual UI can translate on
// the code instead of matching English prose.
const { AppError } = require("../errors");

// Ordered: the first pattern that matches wins, so put the more specific
// symptoms before the broader ones they could otherwise fall into.
const GIT_FAILURES = [
  {
    code: "GIT_DIVERGED",
    status: 409,
    // `pull --ff-only` against a branch that has local commits the remote
    // doesn't have. Git's wording changed in 2.34, so match both.
    match: /diverging branches can't be fast-forwarded|not possible to fast-forward/i,
    message: "The local branch has diverged from the remote: it has commits the remote does not. Push or rebase it before pulling.",
  },
  {
    code: "GIT_PUSH_REJECTED",
    status: 409,
    match: /non-fast-forward|updates were rejected|failed to push some refs/i,
    message: "The remote has commits the local clone does not. Pull first, then push.",
  },
  {
    code: "GIT_MERGE_CONFLICT",
    status: 409,
    match: /^conflict \(|automatic merge failed|fix conflicts and then commit/im,
    message: "The merge left conflicts that have to be resolved in the working copy.",
  },
  {
    code: "GIT_LOCAL_CHANGES",
    status: 409,
    match: /local changes to the following files would be overwritten|please commit your changes or stash/i,
    message: "Uncommitted local changes would be overwritten. Commit or discard them first.",
  },
  {
    code: "GIT_NO_UPSTREAM",
    status: 409,
    match: /no upstream branch|there is no tracking information/i,
    message: "The current branch tracks no remote branch, so there is nothing to synchronize with.",
  },
  {
    code: "GIT_NOTHING_TO_COMMIT",
    status: 400,
    match: /nothing to commit|no changes added to commit|nothing added to commit/i,
    message: "There is nothing staged to commit.",
  },
  {
    code: "GIT_AUTH_FAILED",
    status: 502,
    match: /authentication failed|invalid username or password|could not read username|terminal prompts disabled|returned error: 40[13]|access denied/i,
    message: "The provider rejected the stored credentials. Check the connector's token.",
  },
  {
    // GitHub answers 404 for a private repository the token cannot see, rather
    // than 403, so it never says "denied" and GIT_AUTH_FAILED does not match.
    // Read literally this looks like a missing repository; it is far more often
    // a token without access to one that is right there, so the message names
    // both and puts the likelier cause first.
    code: "GIT_REPO_NOT_FOUND",
    status: 502,
    match: /remote: repository not found|repository '[^']*' not found|does not appear to be a git repository/i,
    message: "The provider cannot see this repository — usually a token without access to it, or a repository that no longer exists under that name.",
  },
  {
    code: "GIT_REMOTE_UNREACHABLE",
    status: 502,
    match: /could not resolve host|failed to connect|connection timed out|connection refused|unable to access|could not read from remote repository/i,
    message: "The remote could not be reached. Check the network or VPN and that the server is up.",
  },
];

// A subprocess that never exited (runProcess's own timeout) reports ETIMEDOUT
// rather than anything on stderr, so it is matched on the error itself.
const GIT_TIMEOUT = {
  code: "GIT_TIMEOUT",
  status: 502,
  message: "The git command did not finish in time and was cancelled.",
};

// Returns { code, status, message } for a recognized failure, or null so the
// caller can fall back to its generic error.
function classifyGitFailure(err) {
  if (!err) return null;
  if (err.code === "ETIMEDOUT") return { ...GIT_TIMEOUT };
  const text = `${err.stderr || ""}\n${err.stdout || ""}\n${err.message || ""}`;
  if (!text.trim()) return null;
  const hit = GIT_FAILURES.find((failure) => failure.match.test(text));
  return hit ? { code: hit.code, status: hit.status, message: hit.message } : null;
}

// The AppError a git route should send. `cause` is kept for the server-side
// log; sendAppError never serializes it, so stderr stays server-side.
function gitFailureError(err) {
  const known = classifyGitFailure(err);
  if (!known) return AppError.badGateway("Git operation failed", { cause: err });
  return new AppError(known.message, {
    cause: err,
    code: known.code,
    status: known.status,
  });
}

module.exports = { classifyGitFailure, gitFailureError };
