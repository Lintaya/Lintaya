# Lintaya documentation index

English | [Español](INDEX.es.md)

Use this page as the starting point for repository documentation. The in-app
Documentation viewer currently serves the focused guides under docs/app; this
index also links to operational and contributor material in the repository.

## Use Lintaya

| Guide | Use it for |
|---|---|
| [Get started](app/get-started/introduccion.md) | Run a local server, enter the token, and configure a first connection. |
| [Blocks](app/block/introduccion.md) | Create Markdown blocks and add connector blocks. |
| [Boards](app/module/introduccion.md) | Build persistent layouts from zones and blocks. |
| [Dashboards](app/dashboard/introduccion.md) | Group Boards as tabs, reorder them, and present them full screen. |
| [SSH](app/ssh/introduccion.md) | Open terminals from VMs, Devices, and Containers; understand concurrent sessions, credentials, jump hosts, and transcripts. |
| [Connectors](app/connectors/introduccion.md) | Configure Connections and understand ConnectorType manifests. |
| [Connector contracts](connectors/CONTRACTS.md) | Compare every shipped ConnectorType: manifests, configuration, cache, sync, and limits. |
| [CLI](../cli/README.md) | Read Lintaya through profiles, TUI, JSON, and stable numeric shortcuts. |

## Operate safely

| Guide | Use it for |
|---|---|
| [README](../README.md) | Product scope, status, entry points, and license. |
| [Setup](../SETUP.md) | Local configuration, Secret Store, Bitwarden, backup, and recovery. |
| [Architecture](../ARCHITECTURE.md) | Runtime boundaries, persistence, connectors, Boards, and agents. |
| [Security](../SECURITY.md) | Report vulnerabilities and protect credentials. |
| [Support](../SUPPORT.md) | Ask for help without exposing private data. |

## Extend Lintaya

The next reference set is being migrated to bilingual documentation:

- Connector development guide and review checklist.
- Connector package README files and Connector SDK preview.
- Analyzer contracts and test guidance.
- OpenAPI and API error standard.
- Action Registry, MCP, CLI, and Team architecture decisions.

Until those pairs are complete, use the English source documents in docs/,
server/, and server/connectors/.

## Project decisions and planning

| Guide | Use it for |
|---|---|
| [ADRs](adr/) | Accepted and proposed architectural decisions. |
| [i18n policy](i18n/README.md) | How bilingual documentation is paired and verified. |

A document is authoritative only when it describes current code or is explicitly
marked historical. Update both language files and its i18n record in the same
change.
