# Bitbucket

[English](bitbucket.md) | Español

`bitbucket` — Community, ciclo de vida `beta`, instantiable. Lee
repositorios, pull requests y commits desde Bitbucket Cloud o Bitbucket
Server/Data Center.

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `type` | Sí | No | `cloud` o `server` — elige qué forma de API y autenticación usa esta conexión. |
| `baseUrl` | No | No | Requerido para Bitbucket Server o Data Center. |
| `username` | No | No | Usuario de Bitbucket Cloud. |
| `workspace` | No | No | Alcance opcional de workspace de Bitbucket Cloud. |
| `token` | Sí | Sí | Token de API de Cloud/app password, o Personal Access Token de Server. |

## Capacidades

`repositories.read`, `repositories.clone`, `pull-requests.read`, `commits.read`

## Acciones

Registradas en el Registro de acciones (ADR-011): `status`, `sync`.

## Integración con el dashboard

Sin block de Home. Tiene módulo propio — **Repos {nombre del conector}** —
para explorar y clonar repositorios.
