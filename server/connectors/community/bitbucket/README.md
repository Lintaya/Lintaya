# Bitbucket connector

This Community connector supports Bitbucket Cloud and Bitbucket Server/Data
Center through one normalized repository model. It uses `connectors/sdk` for
HTTP, normalized errors, KV storage, public configuration, and secret-safe
logging.

## Lifecycle and license

- Product tier: `community`
- Lifecycle: `beta`
- License: `Apache-2.0`

Cloud mode uses a username plus API token/app password and may be limited to a
workspace. Server mode uses a Personal Access Token and requires an explicit
base URL. Pagination URLs are accepted only when they stay on the configured
origin and API path, preventing credentials from being forwarded elsewhere.

Server mode temporarily preserves the legacy behavior of accepting private or
self-signed TLS certificates. This compatibility setting must become explicit
and opt-in before the connector can move from beta to stable.

## Files

- `manifest.json`: product metadata, lifecycle, and capabilities.
- `config.schema.json`: Cloud/Server configuration; `token` is write-only.
- `client.js`: authentication, safe pagination, project enrichment, and model
  normalization.
- `routes.js`: configuration, connection-test, and synchronization routes.
- `index.js`: package entry point used by the server composition root.
- `*.test.js`: client and route tests without network or SQLite.

The lifecycle package owns these existing routes:

- `GET /api/connectors/bitbucket/config`
- `POST /api/connectors/bitbucket/config`
- `POST /api/connectors/bitbucket/test`
- `POST /api/connectors/bitbucket/sync`

Advanced repository routes such as clone, branches, tree, and file access are
still composed in `server.js`, but they reuse this package's exported client.
They can be extracted incrementally without changing the public API.
