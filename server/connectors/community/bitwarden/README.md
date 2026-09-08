# Bitwarden CLI connector

Reports the Bitwarden server's health, what the `bw` CLI says about its session,
and how many vault items were cached at the last unlock.

## This connector does not own the CLI

Unlike every other connector, the machinery here belongs to something bigger.
`bw()` — the CLI runner — plus `BW_BIN`, the in-memory vault session and the
`requireUnlockedVault` middleware live in `server.js` and back the entire
`/api/vault/*` module, across ~70 call sites.

So `registerBitwardenRoutes()` takes **`runBw`, `binary` and `readVaultItems` as
injected dependencies** instead of importing them. Moving them into this package
would make a core subsystem depend on a connector, which is backwards. Both are
required at registration and there is a test asserting registration fails
without them.

If that runner ever deserves a home of its own, it is a core service
(`server/core/services/`), not this package.

## What it does and does not need

**It never needs the vault unlocked.** The item count is read from what the vault
module cached when the user last unlocked (`vault-items`), so this connector
answers with `bw` locked — as the live check confirms: `bwCliStatus: "locked"`
alongside a real item count. A vault that has never been unlocked reports `0`
rather than failing.

## A locked vault is not a broken connector

`buildStatusRecord()` joins two independent signals:

- **Server health** — `GET /alive`, which decides the verdict.
- **CLI session state** — `locked`, `unlocked`, `unauthenticated`. All are normal.

`POST /test` therefore returns 502 only when the *server* is unreachable, even if
the CLI answered perfectly. `POST /sync` does **not** gate on server health and
reports `ok: true` with `serverHealth: false`. That asymmetry is inherited from
the original implementation and preserved deliberately — sync's job is to refresh
what is knowable, and the CLI status and item count are knowable with the server
down. It is worth knowing when reading the two responses side by side.

`bwHealthCheck()` never rejects: an unreachable vault is a status to display, not
an exception for the caller to handle.

## The API key never reaches a process listing

`bwApiKeyLogin()` bypasses `bw()` on purpose. The credentials go in as one-shot
`BW_CLIENTID` / `BW_CLIENTSECRET` environment variables rather than argv, so they
never appear in a process list or in the connector's logs. There is a test
asserting the secret is absent from the spawned arguments.

Auto-login fires only when **both** halves of a key are configured **and** the CLI
reports `unauthenticated`. A `locked` vault already has a session; logging in
again would be wrong, and there is a test for that too.

## Configuration is best-effort about the CLI

`POST /config` saves first, then tries to point the CLI at the server. A missing
CLI or a down server does not lose the configuration.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/connectors/bw/config` | Server URL, e-mail, whether an API key exists; never the secret |
| `POST /api/connectors/bw/config` | Requires `serverUrl`; points the CLI at it, best-effort |
| `POST /api/connectors/bw/test` | Server health plus CLI status; 502 only on server failure |
| `POST /api/connectors/bw/sync` | Optional auto-login, CLI status, cached item count |

Reading actual secrets is the vault module's job (`/api/vault/*`) and needs the
master password. Every server restart locks the vault again.
