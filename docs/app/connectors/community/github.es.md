# GitHub

[English](github.md) | Español

`github` — Community, ciclo de vida `beta`, instantiable. Lee repositorios,
pull requests, deployments, workflows y commits desde GitHub.com o GitHub
Enterprise Server. Usa la GitHub REST API (versión `2022-11-28`, soportada
hasta el 2028-03-10).

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `baseUrl` | No | No | URL base de la GitHub REST API, incluyendo `/api/v3` para GitHub Enterprise Server. |
| `token` | Sí | Sí | Personal Access Token fine-grained o clásico. |

## Capacidades

`repositories.read`, `repositories.clone`, `pull-requests.read`,
`deployments.read`, `workflows.read`, `commits.read`

## Acciones

Registradas en el Registro de acciones (ADR-011): `status`, `sync`.

## Integración con el dashboard

Tres blocks de Home: **recent-commits**, **recent-deployments**,
**repos-overview**. Tiene módulo propio — **Repos {nombre del conector}** —
para explorar y clonar repositorios. Una conexión extra de GitHub
(instantiable) reutiliza las mismas acciones y blocks que el tipo base — ver
CORE-003.
