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
