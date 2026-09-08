# Portainer

English | [Español](portainer.es.md)

`portainer` — Community, `beta` lifecycle, instantiable. Reads containers,
endpoints, and logs from a Portainer instance, authenticating with either an
API key or a username/password pair.

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `baseUrl` | Yes | No | Portainer instance base URL, e.g. `https://portainer.example.com`. |
| `apiKey` | No | Yes | Portainer API access token, sent as the `X-API-Key` header. |
| `username` | No | No | Portainer username, used to mint a JWT when no API key is set. |
| `password` | No | Yes | Password for the username above. |

## Capabilities

`containers.read`, `endpoints.read`, `logs.read`

## Actions

Registered in the Action Registry (ADR-011): `status`, `sync`.

## Dashboard integration

No Home block and no dedicated module today.
