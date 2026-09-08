# Bitwarden CLI

[English](bitwarden.md) | Español

`bw` — Community, ciclo de vida `beta`, instancia única. Revisa la salud del
servidor de Bitwarden y el estado de login/desbloqueo de la CLI `bw` local;
la página de Passwords maneja el vault en sí.

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `serverUrl` | Sí | No | URL base del servidor Bitwarden. La salud se revisa en `/alive`. |
| `email` | No | No | Correo de la cuenta, solo para mostrar. |
| `clientId` | No | No | Client id de la API key, usado para `bw login --apikey` desatendido. |
| `clientSecret` | No | Sí | Client secret de la API key. Se pasa a la CLI como variable de entorno, nunca como argumento. |

## Capacidades

`vault.status`, `server.health`, `items.count`

## Acciones

Registradas en el Registro de acciones (ADR-011): `status`, `sync` — ambas
declaran `requiresConfig: false`, ya que `serverUrl` cae al servidor público
de Bitwarden cuando no hay nada guardado.

## Integración con el dashboard

Sin block de Home. Tiene módulo propio — **Passwords** — el vault en sí.
