# Bitbucket

English | [Español](bitbucket.es.md)

`bitbucket` — Community, `beta` lifecycle, instantiable. Reads repositories,
pull requests, and commits from Bitbucket Cloud or Bitbucket Server/Data
Center.

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `type` | Yes | No | `cloud` or `server` — selects which API shape and auth this connection uses. |
| `baseUrl` | No | No | Required for Bitbucket Server or Data Center. |
| `username` | No | No | Bitbucket Cloud username. |
| `workspace` | No | No | Optional Bitbucket Cloud workspace scope. |
| `token` | Yes | Yes | Cloud API token/app password or Server Personal Access Token. |

## Capabilities

`repositories.read`, `repositories.clone`, `pull-requests.read`, `commits.read`

## Actions

Registered in the Action Registry (ADR-011): `status`, `sync`.

## Dashboard integration

No Home block. Has its own module — **Repos {connector name}** — for
browsing and cloning repositories.
