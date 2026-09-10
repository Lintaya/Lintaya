# Get started

English | [Español](introduccion.es.md)

Lintaya is a local-first PWA served by the Node.js server in this repository.
The server owns local state and connector configuration; every other caller —
the browser, the CLI, and MCP — talks to it only through its HTTP API and
never opens the local database directly.

## Start here

```text
1. Install Node.js 22/24
          │
          ▼
2. Run the local server ───────► 3. Open the browser
          │                              │
          │                              ▼
          │                       4. Add an API token
          │                              │
          └──────────────► 5. Configure and test a connector
                                         │
                                         ▼
                              6. Use the workspace, CLI, or MCP
```

Use this index to jump directly to the task you need:

| I want to… | Go to |
|---|---|
| Understand the web workspace | [Ways to connect](#ways-to-connect) and [First browser session](#first-browser-session) |
| Install and run Lintaya | [Run locally](#run-locally) and [SETUP.md](../../../SETUP.md) |
| Use the terminal or scripts | [Connect via CLI](via-cli.md) |
| Give an AI agent controlled access | [Connect via MCP](via-mcp.md) |
| Connect a provider | [First connector](#first-connector) and [Community connectors](../connectors/community/introduccion.md) |
| Build a dashboard | [Blocks](../block/introduccion.md), [Boards](../module/introduccion.md), and [Dashboards](../dashboard/introduccion.md) |
| Manage inventory and SSH | [Devices](../devices/introduccion.md) and [SSH](../ssh/introduccion.md) |
| Configure the application | [System](../system/introduccion.md) and [Settings](../system/ajustes.md) |
| Understand the complete structure | [Architecture](architecture.md) |

## Ways to connect

| | What it's for | Setup |
|---|---|---|
| **Web** | The dashboard itself — Home, Boards, Connectors, Vault | This page, below |
| **CLI** | Scripted or terminal access: profiles, health, connectors, blocks, Boards, Dashboards, and writes through `api post/put/delete` | [Connect via CLI](via-cli.md) |
| **MCP** | Giving an AI agent (like Claude Code) tool access to your connectors | [Connect via MCP](via-mcp.md) |

All three are thin callers over the same server: they see the same
connections, the same synced data, and (for actions) the same
read/write/destructive contract — see [ADR-011](../../adr/011-connector-actions-rest-mcp.md).

## Run locally

Install Node.js 22 or 24, then run the server from the repository:

```powershell
Set-Location server
npm ci
Copy-Item start-dev.example.js start-dev.js
node .\start-dev.js
```

Open the Local URL printed by the server, normally http://localhost:3000. Set a
strong LINTAYA_TOKEN in the gitignored start-dev.js before using a real connector.

After the server starts, the browser is the recommended first path: it lets you
configure the token, inspect the workspace, and set up the first connector
without learning the API first.

## First browser session

Lintaya asks for the server API token in Settings. Browser storage is per
origin, so a different port asks for the same token again. GET /api/health and
GET /api/ai-context are available for discovery; other API routes require the
Bearer token.

## First connector

Open Connectors, select a registered connector type, create a connection, save
its configuration, then use Test and Sync. Connector data is available only when
its provider, credentials, and network access are available.

Do not place tokens, database files, backups, vault exports, or internal
hostnames in an issue, screenshot, or commit. Read
[SETUP.md](../../../SETUP.md) for secret-store and backup guidance.

After the first connector works, continue with [Blocks](../block/introduccion.md),
[Boards](../module/introduccion.md), and [Dashboards](../dashboard/introduccion.md)
to build a workspace page.
