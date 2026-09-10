# Architecture

English | [Español](architecture.es.md)

English | [Español](introduccion.es.md)

Lintaya is a local-first workspace. The browser is the user interface, while
the Node.js server is the boundary that owns authentication, local state,
connector configuration, synchronization, and the HTTP API.

## Runtime flow

```text
Browser PWA (React + JSX)
          │ HTTP + Bearer token
          ▼
Node.js / Express (auth, API, jobs)
          │
   ┌──────┼────────┬─────────────┐
   ▼      ▼        ▼             ▼
 SQLite  Secret   Connectors   CLI / MCP
 state   Store    sync/actions  HTTP callers
 cache   secrets      │
                      ▼
              External providers
```

The CLI and MCP are additional HTTP callers of the same server. They do not
open SQLite or read connector secrets directly, so all callers share the same
authentication, audit, and action rules.

## Repository structure

| Path | Responsibility |
|---|---|
| `Lintaya.html` | Browser entry point and script load order. |
| `app/` | PWA views, navigation, settings, and API helpers. |
| `server/app.js` | Express app factory and authentication. |
| `server/server.js` | Runtime composition and route registration. |
| `server/core/` | Database, migrations, actions, logging, and shared services. |
| `server/routes/` | Domain HTTP routes. |
| `server/connectors/community/` | Public connector packages shipped with Lintaya. |
| `server/connectors/sdk/` | Connector contracts and test helpers. |
| `cli/` | Cross-platform HTTP client. |
| `docs/` | User, contributor, architecture, and release documentation. |
| `scripts/` | Repository checks and release validation. |
| `vendor/` | Browser dependencies vendored for offline use. |

## Data and security boundaries

The server opens the SQLite databases and Secret Store. SQLite contains local
state, cached connector data, audit records, and repository settings; live
database, WAL, backup, and vault files are runtime data and must not be copied
into the repository. Connector secrets are kept separate from public
configuration and are never returned in API responses or logs.

Protected API routes require `Authorization: Bearer <LINTAYA_TOKEN>`.
`/api/health` and `/api/ai-context` are the discovery exceptions. Provider
responses, imported files, repositories, and logs are treated as untrusted
input.

## Frontend loading model

There is no frontend build step. `Lintaya.html` loads the JSX files as browser
Babel scripts. Each script has its own scope and exposes its view through
`window`; `app/app.jsx` is loaded last and mounts the shell. Frontend changes
normally require editing the relevant file and reloading the browser.

## Connector model

A **ConnectorType** is the integration definition, such as GitHub or GitLab. A
**Connection** is one configured instance of that type. Connections own their
configuration, status, synchronized data, activity, and secret references.

Connector data can become reusable **Blocks**. **Boards** arrange Blocks into a
layout, and **Dashboards** reference ordered Boards without copying their trees.
Destructive provider actions go through the approval flow when registered as
destructive actions.

Board layouts use a tree of resizable zones rather than absolute positioning.
Adding a Block to an occupied zone creates a sibling pane with its own
separator. Drag a separator, or focus it with `Tab` and use the left/right or
up/down arrow keys, to change the zone ratio. The ratio belongs to that Board's
tree and is saved with the Board; resizing one Board does not change another.
See [Boards](../module/introduccion.md) for the editing steps.

For the repository-level design and migration decisions, see
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) and the related ADRs in
[`docs/adr/`](../../adr/README.md).
