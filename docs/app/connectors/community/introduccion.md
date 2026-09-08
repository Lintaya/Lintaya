# Community connectors

English | [Español](introduccion.es.md)

Community is a general-purpose community integration — the tier most
connector types belong to today. All seven ship with Lintaya and are `beta`
lifecycle.

| Connector | ID | Instantiable | Capabilities |
|---|---|---|---|
| [Bitbucket](bitbucket.md) | `bitbucket` | Yes | repositories.read, repositories.clone, pull-requests.read, commits.read |
| [Bitwarden CLI](bitwarden.md) | `bw` | No | vault.status, server.health, items.count |
| [GitHub](github.md) | `github` | Yes | repositories.read, repositories.clone, pull-requests.read, deployments.read, workflows.read, commits.read |
| [GitLab](gitlab.md) | `gitlab` | Yes | repositories.read, repositories.clone, pull-requests.read, deployments.read, workflows.read, commits.read |
| [Outline](outline.md) | `outline` | Yes | collections.read, documents.read, documents.write, documents.delete |
| [Plane.so](plane.md) | `plane` | Yes | projects.read, projects.write, issues.read, issues.write, modules.write, members.read, members.write |
| [Portainer](portainer.md) | `portainer` | Yes | containers.read, endpoints.read, logs.read |

"Instantiable" means the type allows more than one configured connection —
see [Connectors](../introduccion.md). Bitwarden CLI is intentionally
single-instance today. Each connector's page below has its
configuration fields, registered actions, and dashboard integration.
