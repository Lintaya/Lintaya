# Set up Lintaya

English | [Español](SETUP.es.md)

This guide starts Lintaya on one computer for development or a private LAN/VPN
deployment. It does not deploy a public multi-tenant service. Read
[SECURITY.md](SECURITY.md) before adding real credentials.

## Prerequisites

| Requirement | Why it is needed |
|---|---|
| Git | Obtain and update the source. |
| Node.js 22 or 24 | Run the server and CLI; Node 24 is preferred. |
| npm | Install the committed server dependencies. |
| Docker (optional) | Run a self-hosted Bitwarden service. |
| Network access (optional) | Reach systems configured through connectors. |

On Windows, better-sqlite3 may require Visual Studio Build Tools if a prebuilt
binary is unavailable. Use a supported Node.js LTS release and run npm ci before
diagnosing a build-tool problem.

## Start a local development server

```powershell
git clone <repository-url> lintaya
Set-Location lintaya\server
npm ci
npm run check
npm run dev
```

Open http://localhost:3000. This command injects local demonstration defaults.
It is appropriate for development only and must not be used as a shared or
production configuration.

## Create a local configuration

Copy the example without committing the resulting file:

```powershell
Copy-Item start-dev.example.js start-dev.js
```

Set HQ_TOKEN to a strong, unique value in start-dev.js, then start the server:

```powershell
node .\start-dev.js
```

In the browser, enter that token in Settings when prompted. Browser storage is
per origin: http://localhost:3000 and http://localhost:3001 each ask once for
the same server token. The unauthenticated GET /api/health endpoint is useful
for checking that the server is alive; authenticated API routes require
Authorization: Bearer <HQ_TOKEN>.

Do not commit start-dev.js, personal-hq.db, vault exports, backup files, tokens,
or private keys.

## Configure connector secrets

Connector configuration uses LINTAYA_SECRET_STORE. Keep secrets outside the
repository in every mode.

| Mode | Use | Requirement |
|---|---|---|
| legacy | Compatibility with existing local data. | Secrets remain in local connector KV data. |
| local | Encrypt connector secret fields locally. | Set a strong LINTAYA_SECRET_KEY. |
| bitwarden | Store connector secrets in a Bitwarden Secure Note. | Use VAULT_MODE=bitwarden and unlock the vault. |

For local, set both values before starting the server:

```powershell
$env:LINTAYA_SECRET_STORE = "local"
$env:LINTAYA_SECRET_KEY = "<strong-secret-kept-outside-git>"
node .\start-dev.js
```

The first read of an existing connection may migrate its secret fields into the
configured store. Deleting a connection also removes its stored secrets. A
locked Bitwarden vault prevents operations that need those secrets until it is
unlocked.

## Optional: Bitwarden

Bitwarden is optional. The default example runs with VAULT_MODE=demo; all other
local features can be developed without a vault.

For a self-hosted vault, configure the separate bitwarden/ directory using its
example environment file and follow Bitwarden's official hosting guidance. Then
set VAULT_MODE=bitwarden, BW_CLIENTID, and BW_CLIENTSECRET in the gitignored
start-dev.js. Never place those values in source control or a public issue.

## Back up and move a local instance

Use **Settings → Backups** to create an encrypted .lhq backup and restore it on
the destination server. The backup can contain Lintaya data and configured
connector values, so transfer it only through a trusted encrypted channel and
keep its password separately.

Do not copy a live SQLite database, its -wal/-shm files, or an active Bitwarden
volume by hand. Stop the relevant service first, or use the product's logical
export/import process. A .lhq backup does not include a Bitwarden master
password, an unlocked vault session, local repository clones, or third-party
account recovery material.

## Verify and troubleshoot

```powershell
Invoke-WebRequest http://localhost:3000/api/health | Select-Object -Expand Content
Set-Location ..\cli
node bin/lintaya.js health --url http://localhost:3000
```

If a connector cannot reach a provider, verify its URL, credentials, network or
VPN access, and connector status in the app. If an operation reports
vault-locked, unlock Bitwarden in the Passwords module and retry. Do not paste
tokens, private hostnames, or complete diagnostic responses into public issues.
