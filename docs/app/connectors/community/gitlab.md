# GitLab

English | [Español](gitlab.es.md)

`gitlab` — Community, `beta` lifecycle, instantiable. Reads repositories,
pull/merge requests, deployments, workflows, and commits from a GitLab
instance. "GitLab CICD" (id `gitlab2`) is an extra Connection of this same
ConnectorType, not a separate type — see CORE-003 / ADR-010.

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `baseUrl` | Yes | No | GitLab instance base URL. |
| `token` | Yes | Yes | GitLab Personal, Project, or Group Access Token. |

## Capabilities

`repositories.read`, `repositories.clone`, `pull-requests.read`,
`deployments.read`, `workflows.read`, `commits.read`

## Actions

Registered in the Action Registry (ADR-011): `status`, `sync` — an extra
GitLab connection ("GitLab CICD") already has both, no separate registration
needed.

## Dashboard integration

One Home block: **recent-commits**. Has its own module — **Repos {connector
name}** — for browsing and cloning repositories.
