# Portainer

[English](portainer.md) | Español

`portainer` — Community, ciclo de vida `beta`, instantiable. Lee
contenedores, endpoints y logs desde una instancia de Portainer, autenticando
con una API key o un par usuario/contraseña.

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `baseUrl` | Sí | No | URL base de la instancia de Portainer, ej. `https://portainer.example.com`. |
| `apiKey` | No | Sí | Token de acceso de API de Portainer, enviado como header `X-API-Key`. |
| `username` | No | No | Usuario de Portainer, usado para generar un JWT cuando no hay API key. |
| `password` | No | Sí | Contraseña del usuario anterior. |

## Capacidades

`containers.read`, `endpoints.read`, `logs.read`

## Acciones

Registradas en el Registro de acciones (ADR-011): `status`, `sync`.

## Integración con el dashboard

Sin block de Home y sin módulo propio por ahora.
