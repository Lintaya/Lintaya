# GitLab

[English](gitlab.md) | Español

`gitlab` — Community, ciclo de vida `beta`, instantiable. Lee repositorios,
merge/pull requests, deployments, workflows y commits desde una instancia de
GitLab. "GitLab CICD" (id `gitlab2`) es una Connection extra de este mismo
ConnectorType, no un tipo aparte — ver CORE-003 / ADR-010.

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `baseUrl` | Sí | No | URL base de la instancia de GitLab. |
| `token` | Sí | Sí | Personal, Project o Group Access Token de GitLab. |

## Capacidades

`repositories.read`, `repositories.clone`, `pull-requests.read`,
`deployments.read`, `workflows.read`, `commits.read`

## Acciones

Registradas en el Registro de acciones (ADR-011): `status`, `sync` — una
conexión extra de GitLab ("GitLab CICD") ya tiene ambas, sin necesitar
registro aparte.

## Integración con el dashboard

Un block de Home: **recent-commits**. Tiene módulo propio — **Repos {nombre
del conector}** — para explorar y clonar repositorios.
