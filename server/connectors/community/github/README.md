# GitHub connector

This is the first connector extracted from the legacy `server.js` composition
root. It keeps the existing HTTP and KV contracts while making the provider
client and lifecycle routes independently testable.

## Files

- `manifest.json`: product metadata, version, lifecycle, and capabilities.
- `config.schema.json`: public configuration contract; `token` is write-only.
- `client.js`: GitHub REST transport, status normalization, pagination, and
  repository mapping.
- `routes.js`: config, connection-test, sync, and repository-creation route
  registration.
- `actions.js`: the same operations as ADR-011 actions, sharing `client.js`
  with the routes so there is one implementation, not two.
- `index.js`: package entry point consumed by the server composition root.
- `*.test.js`: client and route contract tests without network or SQLite.

The client and routes consume shared services only through `connectors/sdk`.
This provides consistent URL handling, timeout/error codes, KV key ownership,
public configuration filtering, and credential redaction in logs.

## Runtime contract

A sync stores `projects`, `deployments`, `commits`, `pullRequests` and
`issues`. Issues cost one extra request per repository — nothing was fetching
them before — and GitHub's `/issues` returns pull requests too (it models them
as issues with a `pull_request` key), so they are filtered out or the issues
block would repeat the pull-requests block in full. The
open pull requests were already being fetched to count `openMRs` per
repository; keeping the list costs no extra request and is what feeds the
`open-pull-requests` block. Both writers — the `POST /sync` route and the
`sync` action — must persist all four, or a block silently empties depending on
which one ran.

```js
const { registerGithubRoutes } = require("./connectors/community/github");

registerGithubRoutes({
  app,
  requireAuth,
  kvGet,
  kvSet,
  connectorLog,
});
```

The module owns these unchanged routes:

- `GET /api/connectors/github/config`
- `POST /api/connectors/github/config`
- `POST /api/connectors/github/test`
- `POST /api/connectors/github/sync`
- `POST /api/connectors/github/repositories`
- `GET /api/connectors/github/commits/:sha`
- `GET /api/connectors/github/blocks/<blockId>` for `recent-commits`,
  `recent-deployments`, `open-pull-requests` and `repos-overview`

### Commit detail

`GET /api/connectors/github/commits/:sha` answers the full message, author,
`+/-` totals, signature flag, parents and changed files for one commit.

The repository is **not** in the path. A Home block item carries only
`{ id, title, subtitle, timestamp, url, badge }`, so there is nowhere to put it,
and the `recent-commits` item id is the short sha — a shape already published
and pinned by a test. The route therefore resolves the sha against the commits
the last sync stored, which know their repository. A sha the sync never saw
answers `404 commit-not-synced` **without calling GitHub**: with no repository
there is nobody to ask.

The comparison is by prefix in both directions, because the block stores the
short sha while GitHub accepts either length.

### Approving a pull request

Approving is the `approve-pull-request` action (`write`), not a REST route:
every remote mutation goes through the Action Registry with its schemas. It
submits `POST /repos/{project}/pulls/{number}/reviews` with
`event: "APPROVE"`, and takes an optional `body` comment.

It is **not** `destructive` — nothing is deleted and an approval can be
withdrawn from GitHub — so it does not go through the Approval Center.

GitHub answers `422` when the token's own account authored the pull request:
nobody approves their own. The connector does not try to predict that (it would
cost an extra call on every open) and lets the provider's message through.

### Opening a pull request

`create-pull-request` (`write`) opens one: `project`, `title`, `head` and
`base` are all required, plus an optional `body` and `draft`.

`base` has no default on purpose. Guessing the target branch — "it will be
main" — is how a pull request ends up opened against the wrong one, and that is
discovered after somebody has already reviewed it. The caller states both
branches or gets a `400`.

With `update-pull-request` and `approve-pull-request` this closes the loop:
open, correct and approve without leaving for the provider's own tooling, and
all three land in the connector log with the `X-Actor` that asked.

### Editing a pull request

`update-pull-request` (`write`) patches a pull request's title, its body, or
both. At least one of the two is required: a call carrying neither is not "change
nothing", it is a malformed request, and accepting it would leave a write in the
activity log that wrote nothing.

`body` **replaces** the description rather than appending to it. GitHub has no
append, and pretending otherwise would invite losing text without warning. A
call that names only `title` sends only `title`, so the description is left
alone — there is a test pinning exactly that.

Like every remote mutation it goes through the Action Registry, which is also
how an agent's edit ends up in Logs → Connectors/Activity carrying the
`X-Actor` that asked for it. That is how the project tells apart what an agent
did from what the user did, so an agent should prefer this over editing through
the provider's own tooling.

### Creating a repository

`POST /api/connectors/github/repositories` creates a repository under the
token's account, or under `org` when one is given, and answers `201` with the
normalized repository (`fullName`, `cloneUrl`, `sshUrl`, `webUrl`,
`defaultBranch`). The same operation is available as the `create-repository`
action.

```http
POST /api/connectors/github/repositories
{ "name": "lintaya", "private": true, "description": "optional", "org": "optional" }
```

`private` is **required and must be a boolean**. It is deliberately not
defaulted at the API boundary: a caller that forgets it gets `400`, never a
public repository. Publishing is not reversible in practice — a public
repository can be cloned, forked, and indexed before anyone notices — so the
choice has to be stated, and the connector log records it in words.

The repository is created empty (`auto_init: false`) so an existing local
history can be pushed into it without reconciling against a commit GitHub
wrote. Pass `autoInit: true` only when you want GitHub to seed it.

This route never writes connector status: a rejected repository name says
nothing about the health of the connection.

Repository clone, branch, tree, and file operations still use the shared
provider adapter in `server.js`, but that adapter now imports this package's
HTTP client. The Connector SDK boundary will be validated further as GitLab and
Bitbucket follow the same pattern.

Run `npm run test:connectors` from `server/` after any connector change.
