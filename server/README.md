# Lintaya server

The backend is being extracted incrementally from `server.js` without changing
the existing HTTP routes.

## Application lifecycle

- `app.js` owns the Express application factory and shared authentication
  middleware. Importing it has no database, seed, timer, or network side effect.
- `core/config.js` validates environment configuration and supplies typed runtime
  values from one place.
- `core/database.js` opens SQLite, applies versioned migrations, and exposes the
  shared KV store.
- `connectors/` classifies connectors by product tier and validates each
  `manifest.json` through the central registry.
- `connectors/community/github/` owns GitHub config/test/sync routes, REST
  transport, normalized repository mapping, configuration schema, and tests.
- `connectors/community/gitlab/` provides the equivalent lifecycle package for
  GitLab.com and self-hosted GitLab instances.
- `connectors/community/bitbucket/` supports Bitbucket Cloud and self-hosted
  Server/Data Center instances through the same normalized lifecycle.
- `connectors/community/outline/` owns Outline configuration, synchronization,
  and document read/write routes with bounded pagination.
- `connectors/sdk/` is the connector-facing boundary for shared services.
- `core/services/` implements HTTP transport, normalized connector errors,
  storage helpers, public config filtering, and log redaction.
- `server.js` currently composes the legacy domain routes, SQLite services,
  schedulers, integrations, and WebSocket terminal.
- `startServer()` calls `listen()` only when `server.js` is the process entrypoint.
  Requiring the module does not open a port.

```js
const { createApp } = require("./app");

const app = createApp({ token: "test-token" });
```

`createApp()` currently provides the application shell, JSON parsing, liveness
endpoint, and token configuration. Domain routes will move from `server.js` into
explicit registration modules during `CORE-002`.

## Tests

```bash
npm run test:http
npm run test:core
npm run test:connectors
npm run test:analysis
npm run check
```

`app.test.js` invokes Express directly through `application.handle()`. It does
not bind a TCP port and it does not load `better-sqlite3`. The tests cover:

- public liveness at `GET /api/health`;
- rejection of missing bearer credentials;
- acceptance of the token passed to `createApp()`.

`connectors/registry.test.js` verifies the folder/tier boundary, unique IDs and
the metadata exposed to API consumers. GitHub, GitLab, Bitbucket, and Outline
package tests cover provider base paths, pagination, normalized models,
secret-safe configuration, connection status, resource operations, and sync
persistence. Core service tests
cover timeout, network, authentication, rate-limit, storage, and redaction
behavior. Other integrations still use
`implementation.mode: "legacy"`
until their clients and routes are extracted into their own directories.

Future domain-route tests can use an isolated database by setting:

```text
LINTAYA_DB_PATH=:memory:
LINTAYA_DISABLE_SEEDS=1
```

These variables are intended for tests and controlled development tools. Normal
runtime behavior continues to use `server/personal-hq.db` and optional local
seed configuration.

## Current boundary

The factory and core-service extraction prevent foundational tests from
depending on native SQLite. GitHub, GitLab, Bitbucket, and Outline demonstrate
dependency-injected route registration across SCM and knowledge-base services.
The next connector step is to extract a reusable contract-test suite and
generator while remaining legacy connectors are separated incrementally.
