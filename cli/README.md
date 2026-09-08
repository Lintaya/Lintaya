# ⛯ Lintaya CLI

English | [Español](README.es.md)

Lintaya CLI is a cross-platform Node.js HTTP client for one Lintaya server. It
uses the public API and a local profile file; it never opens the server SQLite
database, loads connector packages, or reads connector secrets.

## First run

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

Run the help command without a server:

```powershell
node bin/lintaya.js --help
```

Use a plain URL such as http://localhost:3000, not a Markdown link. On macOS or
Linux, set LINTAYA_TOKEN with export. When published to npm, installing
@lintaya/cli globally will expose lintaya on Windows, macOS, and Linux.

### PowerShell completion

Load completion once per PowerShell session from the repository root:

```powershell
Invoke-Expression ((& node .\cli\bin\lintaya.js completion powershell) -join "`n")
```

It adds the lintaya shortcut and Tab completion for commands, subcommands, and
known connector or block references.

## Profiles and token handling

- profile add, profile list, profile use, and profile remove manage named
  servers such as local, team-dev, and team-prod.
- A token is never accepted as a command-line argument. Use LINTAYA_TOKEN or
  --token-stdin when adding a profile.
- LINTAYA_TOKEN temporarily overrides a saved token. LINTAYA_CONFIG_PATH selects
  another configuration file for tests or automation.
- The configuration file is per user: AppData on Windows, Application Support
  on macOS, and XDG_CONFIG_HOME or .config on Linux.

Local file permissions are restricted where the operating system supports it.
Native credential-manager integration is future work; do not treat the profile
file as a replacement for an operating-system secret manager.

## Command reference

```text
# Profiles and shell integration
lintaya profile add <name> --url <url> [--token-stdin]
lintaya profile list
lintaya profile use <name>
lintaya profile remove <name>
lintaya completion powershell

# Discovery and dashboard data
lintaya tui
lintaya health [--profile <name> | --url <url>]
lintaya status [--profile <name> | --url <url>]
lintaya context
lintaya connector <number>
lintaya connectors <list|catalog|modules>
lintaya connectors <schema|context> <id>
lintaya blocks <catalog|custom|show <id>>
lintaya block <number>
lintaya boards list
lintaya board <number>
lintaya pages list
lintaya search <query> [--limit <n>]

# Diagnostics
lintaya api get </api/...> [--profile <name> | --url <url>]
lintaya version
lintaya --help
```

The CLI reads configured Connections, ConnectorType catalog entries, modules,
Blocks, and Module Builder pages called Boards. Context returns the public agent
capability map. The api get command accepts only an /api/ path and always writes
raw JSON, making it suitable for scripts.

All current server operations use GET. The CLI does not create or delete
connections, blocks, Boards, tasks, or remote provider records.

### Output and JSON

Readable summaries and tables are the default. Add --json when a person, script,
or agent needs the complete response.

```powershell
lintaya connectors list --json
lintaya blocks show gitlab.recent-commits --json
```

Human output is intentionally not a stable machine contract. For low-level
automation, use --json or api get and validate the documented API response.

### Stable numeric shortcuts

Each profile maintains separate stable numbers for Connections, Blocks, and
Boards. List a resource first to assign and display its number, then use the
short form.

```powershell
lintaya connectors list
lintaya connector 1
lintaya blocks catalog
lintaya block 1
lintaya boards list
lintaya board 1
```

Numbers are local CLI aliases, not server identifiers. They are never sent to
the server, are independent by resource kind, and are not recycled after an
item is removed. pages list remains a compatible spelling for boards list.

## TUI

In an interactive terminal, lintaya without a command and lintaya tui open the
keyboard-driven [Ink](https://github.com/vadimdemedes/ink) dashboard. Use arrow
keys or j/k to select, r to refresh, and q or Escape to exit.

Press colon to open the read-only command prompt. Question mark opens help,
Tab completes a known command or identifier, and the result panel truncates
large output. Run the equivalent normal command for complete output. Profile
management and completion setup remain normal-terminal commands because they
change local CLI state.

## Agent and team boundary

Pass --actor <model-id>, or set LINTAYA_ACTOR, only when an identified agent
initiates a request. The CLI sends it as X-Actor for future audit attribution;
it does not grant permission and never invents an identity.

`api post`, `api put`, and `api delete` write to any documented endpoint, each
requiring the full path. MCP, synchronization between computers, and team tasks
remain outside this release. So does proposing a batch of writes as a single
approval: approvals cover destructive connector actions, not local resource
creation. See
[ADR-013](../docs/adr/013-cli-local-and-team-boundary.md).
