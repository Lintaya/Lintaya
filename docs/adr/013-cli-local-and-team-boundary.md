# ADR-013: cross-platform CLI and the Local / Team boundary

English | [Español](013-cli-local-and-team-boundary.es.md)

- Status: Proposed
- Date: 2026-08-22
- Deciders: Lintaya project

## Context

Lintaya is currently a local single-user installation. The project needs a CLI
for people and agents such as Codex or Claude Code, and later collaboration
between local installations through a Team server: offered/accepted tasks,
comments, and reviews on a Git artifact. This must not be confused with syncing
local SQLite databases between computers.

## Decision

Create an independent cli/ package, distributed through npm, using Node.js 22/24
and no third-party dependencies for its first release. Its binary uses only a
documented HTTP API of a remote instance.

~~~text
cli/
  bin/                 npm entry point (lintaya)
  src/                 parser, profiles, HTTP client, presentation
  test/                tests without a real Lintaya server
  README.md            installation and user contract

server/                local Lintaya: connectors, vault, SQLite, API
team/                  reserved until its auth, data, and API are designed
docs/adr/              compatibility and public-boundary decisions
~~~

The CLI never imports server modules, opens personal-hq.db, or calls provider
SDKs. A profile holds an API URL and token. This lets local, team-dev, and
team-prod coexist, and lets one binary work on Windows, macOS, and Linux.

The first release was read-only: profiles, health, status, agent context,
connector discovery, blocks/pages reads, and api get for documented public
endpoints. It withheld generic POST, PUT, and DELETE until ADR-011 and
AGENT-001. Both have landed, so the CLI now also reads Dashboards and
approvals, and writes through api post, api put, and api delete. Each write
takes the full path: the CLI composes no endpoint for you, so the shell
history records exactly what was written. Creating a Block, Board, or
Dashboard still goes straight to its REST route — approvals cover destructive
connector actions, not local resource creation, so a batch of creations cannot
yet be proposed as a single approval. An actor is supplied explicitly through --actor or LINTAYA_ACTOR;
the CLI never impersonates or invents an agent identity.

Tokens are not command-line arguments. They come from LINTAYA_TOKEN or
--token-stdin; the profile file is stored in each operating system's user
configuration location and restricts permissions where supported. Native
credential storage is the next improvement before broad public distribution.

## Local numeric aliases

Numeric shortcuts (connector 1, block 1, board 1) are local profile ergonomics.
They are assigned stably by resource type and saved only in CLI configuration;
they are not API IDs, are not sent to the server, and do not change Connector,
Block, or Module Page data. Numbers are not recycled after deletion and are not
shared between profiles or installations.

## Consequences

- **Code source of truth:** Git. Markdown/code changes travel through commit,
  branch, PR, or Git remote, not Lintaya synchronization.
- **Future coordination source of truth:** the Team server. It will own spaces,
  members, roles, tasks, accept/reject, comments, notifications, and auditing.
  A local Lintaya only receives an offer for its user to accept or reject.
- **Agents:** CLI and future MCP are clients of the same action registry
  (ADR-011). A local agent works only after local user authorization; incoming
  work never starts a remote agent automatically.
- **Enterprise connectors:** run on the server that owns them. CLI consumes
  API-exposed capabilities and never downloads connector packages or secrets
  from another computer.
- **License:** CLI may remain Apache-2.0 with the core. Hosted Team, support,
  and commercial connectors may ship separately without changing the released
  CLI license.

## Rejected alternatives

1. Put CLI inside server/: that couples installation, dependencies, and release
   cycles, and encourages direct SQLite access.
2. P2P SQLite synchronization: it creates conflicts, secret replicas, and
   ambiguous auditing. Git and a central service each solve their own boundary.
3. Allow every HTTP method from day one: an agent could write without risk
   classification, confirmation, or AGENT-001 canonical auditing.

## Out of scope

- Implementing Team server or a task table.
- Synchronizing configuration or AI context between installations.
- A worker that remotely activates Codex/Claude Code.
- Keychain, Credential Manager, or Secret Service integration.
- Action Registry and MCP adapter implementation (ADR-011, AGENT-001/002).
