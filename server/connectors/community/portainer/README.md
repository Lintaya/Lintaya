# Portainer connector

Reads Docker endpoints and their containers from a Portainer instance.

The connector owns the core **Contenedores** module through its manifest. The
shell only shows that route while the base Portainer connection is configured,
connected and enabled; disabling Portainer removes the module from navigation
without deleting its synchronized data.

## Authentication

Portainer accepts two credentials, and this connector supports both:

- **API key** — sent as `X-API-Key`. No token exchange happens.
- **Username / password** — exchanged at `POST /api/auth` for a JWT, sent as
  `Authorization: Bearer`.

**The API key wins when both are stored.** `portainerToken()` returns `null` for
an API-key config, which is the signal to `portainerAuthHeaders()` to use the key
header instead of a bearer token.

TLS verification is disabled on these requests: self-hosted Portainer commonly
runs behind a self-signed certificate. This mirrors the other self-hosted
connectors and is a known gap, not an oversight — see the SDK README on the
pending vault-backed secret work.

## Exports used outside this package

`server.js` re-imports three of these for `/api/containers/inspect` and
`/api/containers/logs`, which read a single container rather than syncing:

- `portainerToken(cfg)`
- `portainerFetch(cfg, apiPath, token)`
- `portainerFetchBuffer(cfg, apiPath, token)`

Keep them exported. `portainerFetchBuffer` deliberately bypasses the SDK's
JSON/text helpers: Docker multiplexes container logs into framed binary chunks,
so the caller needs raw bytes rather than a decoded string.

## Behavior change on migration

The legacy implementation built URLs with `new URL(apiPath, baseUrl + "/")`. Because
`apiPath` starts with `/`, that **discarded any path prefix on the base URL** — a
Portainer reverse-proxied at `https://host/portainer` had its requests sent to
`https://host/api/...`. The SDK's `buildHttpUrl` concatenates instead, so the
prefix now survives. Instances configured with a bare host are unaffected.

## Sync

`syncPortainer()` lists endpoints, then fetches containers per endpoint:

- A failing endpoint yields an empty container list instead of aborting the sync —
  one unreachable agent should not blank the whole view.
- `hostIp` comes from the endpoint URL (`tcp://10.0.0.1:9001`). The `local`
  endpoint talks to a unix socket and has no IP of its own, so it falls back to
  the hostname of the configured base URL, which is the Portainer host itself.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/connectors/portainer/config` | Current configuration; never returns the API key or password |
| `POST /api/connectors/portainer/config` | Requires `baseUrl` plus either `apiKey` or `username`+`password` |
| `POST /api/connectors/portainer/test` | Lists endpoints; maps 401/403 to a credential hint |
| `POST /api/connectors/portainer/sync` | Stores endpoints and their containers |

The `GET /config` response keeps the legacy shape (`auth`, `username`,
`hasApiKey`) because `connectors.jsx` reads those fields directly.
