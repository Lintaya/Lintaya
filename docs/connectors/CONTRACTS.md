# Connector contracts

English | [Español](CONTRACTS.es.md)

Status: current implementation reference. This catalog lists the ConnectorTypes
shipped in this repository. A configured installation is a **Connection** of
one of these types. It complements the [development guide](DEVELOPMENT_GUIDE.md),
which defines how a new or changed connector must be built.

## Common contract

Each package has a startup-validated `manifest.json`. Its `id` is the stable
type identity; a Connection can use a distinct instance ID such as `gitlab2`.
`tier` and `lifecycle` describe classification and maturity, not commercial
license. `capabilities` only declares implemented product operations; it does
not grant credentials or agent approval. `blocks`, `modules`, and
`instantiable` declare optional UI contributions and whether the type can have
separately named Connections.

`GET /config` never returns `writeOnly` / `x-lintaya-secret` fields. The normal
lifecycle is `POST /config`, `POST /test`, then `POST /sync`; test and sync read
the provider and do not intentionally modify it. SDK packages cache public
configuration, status, and synced data under `connector-config-<connection-id>`,
`connector-status-<connection-id>`, and `connector-data-<connection-id>`.
Caches are local snapshots and can be stale.

## Shipped ConnectorTypes

| Type | Manifest: tier / lifecycle / capabilities | Configuration and secrets | Sync and local cache | Limits, compatibility, and known boundary |
|---|---|---|---|---|
| Anthropic | Community / beta · `usage.read`, `usage.local-transcripts`, `costs.read` | Optional transcript path, 1–365-day lookback, metric/windows; optional secret Admin API key. | Aggregates local Claude Code JSONL and optional organization reports; `calibrate` persists user-derived quota limits. | At most 400 transcript files; default lookback is 30 days. It sees only this machine; cost is list-price estimation and subscription limits require observation or calibration. |
| Bitbucket | Community / beta · `repositories.read`, `repositories.clone`, `pull-requests.read`, `commits.read` | Cloud: username + secret token, optional workspace. Server/DC: base URL + secret personal token. | Caches normalized projects, deployments, and commits; it contributes a repository module. | At most 10 pages. Self-hosted private-certificate TLS is legacy compatibility and must become explicit before stable. |
| Bitwarden CLI | Community / beta · `vault.status`, `server.health`, `items.count` | Requires server URL; optional e-mail, API client ID, and secret client secret. | Refreshes CLI state and vault-module cached item count; contributes Passwords module. | A locked vault is normal. Actual vault reads use `/api/vault/*`, need unlock after restart, and are not connector cache data. |
| GitHub | Community / beta · `repositories.read`, `repositories.clone`, `pull-requests.read`, `deployments.read`, `workflows.read`, `commits.read` | Default base URL is GitHub Cloud; GitHub Enterprise API root is supported. Fine-grained/classic token is secret. | Caches repositories, deployments, commits; contributes three blocks and repository module. | 10 × 100 repositories; per repository: 10 deployments, 5 commits, 1 workflow run, 100 open PRs. Enrichment failure does not discard a repository. |
| GitLab | Community / beta · `repositories.read`, `repositories.clone`, `pull-requests.read`, `deployments.read`, `workflows.read`, `commits.read` | Requires instance base URL and secret Personal, Project, or Group Access Token. | Caches projects, deployments, commits; contributes recent-commits block and repository module. | 10 × 100 projects; per project: 10 deployments, 5 commits, 1 pipeline, 100 open MRs. Private/self-signed TLS is legacy compatibility. |
| Outline | Community / beta · `collections.read`, `documents.read`, `documents.write`, `documents.delete` | Requires root base URL and secret API key with collection/document permissions. | Caches collections and document summaries; document detail is live. Create/delete operate remotely; delete is recoverable trash. | Collections and documents each stop at 10 × 100 items. Private-certificate TLS is a beta compatibility gap. |
| Plane | Community / beta · `projects.read`, `projects.write`, `issues.read`, `issues.write`, `modules.write`, `members.read`, `members.write` | Requires secret API key and workspace; base URL is normalized to exclude `/api` and `/api/v1`. | Caches projects, issues, members, modules, user ID, and truncated projects; cached list routes do not call Plane. | 10-second timeout; issue pages are 100 items with 100-page guard per project. Agent-governed destructive effects await Action Registry/approval policy. |
| Portainer | Community / beta · `containers.read`, `endpoints.read`, `logs.read` | Requires base URL and either secret API key or username + secret password; key wins when both exist. | Caches endpoints and normalized containers; inspect/log reads may be live. | JSON timeout 12s, logs 15s. One failed endpoint stays empty without failing all sync. TLS verification is disabled for self-hosted compatibility. |
| Outlook Local | Development / development · `mail.read`, `mail.send`, `calendar.events.read`, `contacts.read` | No stored credential; optional local account SMTP and recent limit 1–50. | Caches recent mail; recent/sent/agenda refresh local slices. Exposes account, contact, mail, send, reply, forward, and draft routes. | Windows only, classic Win32 Outlook only, 20-second COM timeout. Send/reply/forward are writes not yet classified by Action Registry. |
| Outlook Calendar | Development / development · `calendar.events.read`, `identity.read` | Requires Entra client ID; optional tenant; rotating refresh token is secret and acquired through device-code OAuth. | Caches signed-in identity and next seven days of expanded calendar occurrences; temporary device code expires absolutely. | Development maturity; needs an Entra app and Graph permissions. Missing client ID differs from an unlinked account; times use Mexico Central preference. |
| Qportal | Enterprise / beta · `metrics.read`, `requests.read`, `vrf-catalog.read`, `assigned-resources.read` | Requires base URL, e-mail, secret password; managed cached token is secret. | Caches metrics, first-page requests, VRF catalog, assigned resources, pagination metadata; request filters are cached while metrics are live. | 15-second timeout; only first 100 requests are cached and total may be an upper bound. VPN is normally required; legacy HTTP semantics can misreport invalid test payloads. |
| UCS Manager | Enterprise / beta · `chassis.read`, `blades.read`, `inventory.read` | Requires username, secret password, `hosts.MEX`, and `hosts.GDL`; sites share credentials. | Caches chassis/blades by site. Test logs in/out of both; a failed site leaves prior cache instead of partial inventory. | XML `/nuova` timeout 12s; auth errors can be HTTP 200 and are parsed from XML. Self-signed TLS and VPN access to both VIPs are current requirements. |
| VMware vCenter | Enterprise / beta · `vms.read`, `hosts.read`, `clusters.read`, `datastores.read`, `networks.read`, `tags.read` | Requires host URL, username, and secret password for REST and SOAP sessions. | Caches inventory, tags, and derived maps at legacy `vcenter-data-<connection-id>`; config/status use connector keys. Legacy `vc-mex` routes remain compatible. | REST/SOAP degrade independently; failed sync retains previous inventory. SOAP parsing and duplicated MCP client code are technical debt; certificates require review before stable. |

## Reading provider details

The table is a contract summary, not a replacement for package tests. Each
provider has an implementation README next to its manifest under
`server/connectors/`; use it for provider API quirks, route-level behavior,
and troubleshooting. The [review checklist](REVIEW_CHECKLIST.md) is mandatory
when changing a manifest, configuration schema, or capability.

## Compatibility and safety

Connection IDs, including legacy route IDs, remain compatible during the
ConnectorType/Connection migration. Do not infer a capability from a cached
field, a UI button, or a legacy endpoint: consult the manifest and route
contract. Report vulnerabilities through the repository [security policy](../../SECURITY.md)
and never attach production tokens, private hostnames, vault exports, or synced
data to an issue.
