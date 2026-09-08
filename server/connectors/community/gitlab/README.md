# GitLab connector

This package owns the GitLab REST client and the existing configuration,
connection-test, and synchronization routes. It uses `connectors/sdk` for HTTP,
normalized errors, KV storage, public config filtering, and credential
redaction.

## Files

- `manifest.json`: product metadata, lifecycle, and capabilities.
- `config.schema.json`: public configuration contract; `token` is write-only.
- `client.js`: REST transport, pagination, and normalized repository mapping.
- `routes.js`: config, connection-test, and sync route registration.
- `index.js`: package entry point used by the server composition root.
- `*.test.js`: client and route tests without network or SQLite.

The package keeps these routes unchanged:

- `GET /api/connectors/gitlab/config`
- `POST /api/connectors/gitlab/config`
- `POST /api/connectors/gitlab/test`
- `POST /api/connectors/gitlab/sync`

Pipeline, job, avatar proxy, local workspace, and generic repository routes are
still composed in `server.js`, but they reuse this package's exported client.
They can move behind smaller routers in later increments without changing the
public API.
