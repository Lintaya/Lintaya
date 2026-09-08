# Bitwarden CLI

English | [Español](bitwarden.es.md)

`bw` — Community, `beta` lifecycle, single-instance. Checks the Bitwarden
server's health and the local `bw` CLI's login/unlock status; the Passwords
page handles the vault itself.

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `serverUrl` | Yes | No | Bitwarden server base URL. Health is checked at `/alive`. |
| `email` | No | No | Account e-mail, kept for display only. |
| `clientId` | No | No | API key client id, used for unattended `bw login --apikey`. |
| `clientSecret` | No | Yes | API key client secret. Passed to the CLI as an environment variable, never as an argument. |

## Capabilities

`vault.status`, `server.health`, `items.count`

## Actions

Registered in the Action Registry (ADR-011): `status`, `sync` — both declare
`requiresConfig: false`, since `serverUrl` falls back to the public Bitwarden
server when nothing is stored.

## Dashboard integration

No Home block. Has its own module — **Passwords** — the vault itself.
