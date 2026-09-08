# Conectores Community

[English](introduccion.md) | Español

Community es una integración comunitaria de propósito general — el nivel al
que pertenecen la mayoría de los tipos de conector hoy. Los ocho tienen ciclo
de vida `beta`.

| Conector | ID | Instantiable | Capacidades |
|---|---|---|---|
| [Bitbucket](bitbucket.es.md) | `bitbucket` | Sí | repositories.read, repositories.clone, pull-requests.read, commits.read |
| [Bitwarden CLI](bitwarden.es.md) | `bw` | No | vault.status, server.health, items.count |
| [GitHub](github.es.md) | `github` | Sí | repositories.read, repositories.clone, pull-requests.read, deployments.read, workflows.read, commits.read |
| [GitLab](gitlab.es.md) | `gitlab` | Sí | repositories.read, repositories.clone, pull-requests.read, deployments.read, workflows.read, commits.read |
| [Outline](outline.es.md) | `outline` | Sí | collections.read, documents.read, documents.write, documents.delete |
| [Plane.so](plane.es.md) | `plane` | Sí | projects.read, projects.write, issues.read, issues.write, modules.write, members.read, members.write |
| [Portainer](portainer.es.md) | `portainer` | Sí | containers.read, endpoints.read, logs.read |

"Instantiable" significa que el tipo permite más de una conexión configurada
— ver [Conectores](../introduccion.es.md). Bitwarden CLI es de
instancia única intencionalmente por ahora. La página de cada conector abajo
tiene sus campos de configuración, acciones registradas e integración con el
dashboard.
