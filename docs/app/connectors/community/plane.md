# Plane.so

English | [Español](plane.es.md)

`plane` — Community, `beta` lifecycle, instantiable. Reads and writes
projects, issues, and modules from a Plane.so instance.

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `baseUrl` | No | No | Plane instance base URL, without the `/api/v1` prefix — the connector adds it. A trailing `/api` or `/api/v1` is stripped on save. |
| `apiKey` | Yes | Yes | Plane API token from Settings → API Tokens, sent as the `X-Api-Key` header. |
| `workspace` | Yes | No | Workspace slug, as it appears in the Plane URL. |
| `userId` | No | No | Cached id of the token's own user, resolved during sync so "my issues" works between syncs. Not user-editable. |

## Capabilities

`projects.read`, `projects.write`, `issues.read`, `issues.write`,
`modules.write`, `members.read`, `members.write`

## Actions

Registered in the Action Registry (ADR-011): `list-issues` (read, reads
already-synced data — never hits the network), `create-issue` (write, takes
`projectId` as an input field rather than a URL parameter), and `delete-issue`
(**destructive** — creates `pending-approval` and only calls Plane after a
local human approves the exact request in Approval Center).

## Dashboard integration

One Home block: **my-issues**. No dedicated module.
