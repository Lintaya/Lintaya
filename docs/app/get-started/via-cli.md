# Connect via CLI

English | [Español](via-cli.es.md)

Lintaya CLI is a cross-platform Node.js HTTP client for one Lintaya server. It
uses the public API and a local profile file; it never opens the server SQLite
database, loads connector packages, or reads connector secrets.

## Setup

Use Node.js 22 or 24. Start Lintaya in one terminal:

```powershell
Set-Location server
node .\start-dev.js
```

Open a second terminal in the repository:

```powershell
Set-Location cli
$env:LINTAYA_TOKEN = "your-token"
node bin/lintaya.js profile add local --url http://localhost:3000
node bin/lintaya.js health
node bin/lintaya.js status
```

`profile add` saves the URL and token under a name (`local`, `team-dev`, …) so
later commands don't need `--url`/`--token` again. A token is never accepted
as a plain command-line argument — use `LINTAYA_TOKEN` or `--token-stdin`.

## What it can do today

```text
lintaya health
lintaya status
lintaya context
lintaya connectors <list|catalog|modules>
lintaya blocks <list|catalog|custom|show <id>>
lintaya boards list
lintaya api get </api/...>
lintaya tui
```

The named commands are reads — connections, the ConnectorType catalog, Blocks,
Boards, Dashboards, and pending approvals. To write, use `api post`, `api put`,
or `api delete` with the full path, for example
`lintaya api post /api/home/custom-blocks --body-stdin`. Syncing is not
exposed, and a batch of writes cannot yet be proposed as one approval. Add `--json` to any command for the full response
instead of the human-readable summary.

## Full reference

The complete command list, profile management, PowerShell completion, and the
interactive TUI are documented in [`cli/README.md`](../../../cli/README.md).

## Coming next

Write commands (`lintaya action run <type>.<action> --connection <id>`) were
blocked on the Action Registry existing at all — it now does (see
[Connect via MCP](via-mcp.md) and [ADR-011](../../adr/011-connector-actions-rest-mcp.md)),
so CLI write support is next up, still gated behind the same
read/write/destructive contract every other caller uses.
