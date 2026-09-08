# Plane.so

[English](plane.md) | Español

`plane` — Community, ciclo de vida `beta`, instantiable. Lee y escribe
proyectos, issues y modules desde una instancia de Plane.so.

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `baseUrl` | No | No | URL base de la instancia de Plane, sin el prefijo `/api/v1` — el conector lo agrega. Un `/api` o `/api/v1` final se quita al guardar. |
| `apiKey` | Sí | Sí | Token de API de Plane desde Settings → API Tokens, enviado como header `X-Api-Key`. |
| `workspace` | Sí | No | Slug del workspace, tal como aparece en la URL de Plane. |
| `userId` | No | No | Id cacheado del usuario dueño del token, resuelto durante el sync para que "mis issues" funcione entre syncs. No editable por el usuario. |

## Capacidades

`projects.read`, `projects.write`, `issues.read`, `issues.write`,
`modules.write`, `members.read`, `members.write`

## Acciones

Registradas en el Registro de acciones (ADR-011): `list-issues` (read, lee
datos ya sincronizados — nunca toca la red), `create-issue` (write, recibe
`projectId` como campo de input en vez de parámetro de URL) y `delete-issue`
(**destructive** — crea `pending-approval` y solo llama a Plane cuando una
persona local aprueba la solicitud exacta en Approval Center).

## Integración con el dashboard

Un block de Home: **my-issues**. Sin módulo propio.
