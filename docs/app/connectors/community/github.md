# GitHub

English | [Español](github.es.md)

`github` — Community, `beta` lifecycle, instantiable. Reads repositories,
pull requests, deployments, workflows, and commits from GitHub.com or GitHub
Enterprise Server. Targets the GitHub REST API (version `2022-11-28`,
supported until 2028-03-10).

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `baseUrl` | No | No | GitHub REST API base URL, including `/api/v3` for GitHub Enterprise Server. |
| `token` | Yes | Yes | Fine-grained or classic Personal Access Token. |

## Capabilities

`repositories.read`, `repositories.clone`, `pull-requests.read`,
`deployments.read`, `workflows.read`, `commits.read`

## Actions

Registered in the Action Registry (ADR-011): `status`, `sync`.

## Dashboard integration

Three Home blocks: **recent-commits**, **recent-deployments**,
**repos-overview**. Has its own module — **Repos {connector name}** — for
browsing and cloning repositories. An extra GitHub connection (instantiable)
reuses the same actions and blocks as the base type — see CORE-003.
