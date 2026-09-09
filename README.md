# ⛯ Lintaya

English | [Español](README.es.md)

<p align="center">
  <img src="assets/brand/lintaya-logo-light.png" alt="Lintaya — open source Git project intelligence" width="420">
</p>

**Every project tells a story. Lintaya reveals it.**

Lintaya is an open-source, local-first workspace for bringing Git providers and
operational systems into one browser workspace. It combines dashboards, reusable
blocks, Boards, connector modules, repository views, a CLI, and an HTTP API in a
small Node.js application.

The application runs locally and keeps its state on the Lintaya server. It is
not a hosted multi-tenant service.

> **Status: pre-release (`0.1.0-beta.1`).** Public APIs, connector contracts,
> actions, and analyzers are still stabilizing. Do not use this beta with
> unreviewed production credentials.

## What you can do

- Connect GitHub, GitLab, Bitbucket, Outline, Plane, Portainer, or Bitwarden.
- Organize synchronized information in Blocks, Boards, and Dashboards.
- Use connector-owned modules such as repositories, containers, and passwords
  when the corresponding connection is configured.
- Open audited SSH terminal sessions from VMs, devices, and containers.
- Inspect local repositories and provider data through the browser or CLI.
- Use the local Assistant with read tools and approval-gated proposals.
- Add connectors from a separate directory without modifying the core tree.
- Run offline with the vendored browser dependencies under `vendor/`.

The public repository ships the Community connector tier. Enterprise and
Development connectors are separate packages and are not required for a clean
installation.

## Quick start

Requirements: Git, Node.js 22 or 24, and npm. Node.js 24 is preferred.

```powershell
git clone <repository-url> lintaya
Set-Location lintaya\server
npm ci
npm run check
npm run dev
```

Open `http://localhost:3000`. The development command uses local demonstration
defaults only. For a configurable local server, copy
`server/start-dev.example.js` to the gitignored `server/start-dev.js`, set a
strong `LINTAYA_TOKEN`, and run:

```powershell
node .\start-dev.js
```

For connector secrets, use the local Secret Store or Bitwarden. Read
[`SETUP.md`](SETUP.md) and [`SECURITY.md`](SECURITY.md) before adding real
credentials. Never commit tokens, databases, backups, vault exports, or private
keys.

## CLI

The CLI is a cross-platform HTTP client. It does not open SQLite or read
connector secrets directly.

```powershell
Set-Location lintaya\cli
npm ci
$env:LINTAYA_TOKEN = "your-token"
node bin/lintaya.js profile add local --url http://localhost:3000
node bin/lintaya.js tui
```

See [`cli/README.md`](cli/README.md) for profiles, commands, Boards, Blocks,
JSON output, and the current read/write boundary.

## Documentation

| Guide | Purpose |
|---|---|
| [`SETUP.md`](SETUP.md) | Installation, local configuration, Secret Store, backups, and recovery. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Runtime boundaries, persistence, connectors, pages, and APIs. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Development workflow and pull-request expectations. |
| [`docs/INDEX.md`](docs/INDEX.md) | User, operator, contributor, and in-app documentation map. |
| [`docs/release/PUBLIC_SNAPSHOT.md`](docs/release/PUBLIC_SNAPSHOT.md) | Public repository allowlist and snapshot procedure. |
| [`docs/release/RELEASE_PROCESS.md`](docs/release/RELEASE_PROCESS.md) | Versioning, changelog, and release procedure. |
| [`docs/release/SUPPLY_CHAIN.md`](docs/release/SUPPLY_CHAIN.md) | Secrets, dependency, SBOM, and provenance controls. |
| [`docs/connectors/DEVELOPMENT_GUIDE.md`](docs/connectors/DEVELOPMENT_GUIDE.md) | Connector structure, SDK, lifecycle, and testing. |
| [`docs/connectors/REVIEW_CHECKLIST.md`](docs/connectors/REVIEW_CHECKLIST.md) | Connector security and review criteria. |
| [`docs/app/ssh/introduccion.md`](docs/app/ssh/introduccion.md) | SSH sessions, credentials, jump hosts, transcripts, and broadcast. |
| [`docs/i18n/README.md`](docs/i18n/README.md) | English/Spanish documentation policy and verifier. |

## Security and current limitations

- Treat provider responses, imported files, repositories, and logs as untrusted
  input.
- Repository execution on the host is not a released safe feature; sandboxing
  remains a future milestone.
- Destructive connector actions require the Approval Center when registered
  through the Action Registry.
- The local Assistant is not a privileged bypass and does not receive secrets.
- The CLI and API contracts may change during the beta.
- Enterprise, Development, Team, Cloud, billing, and multi-tenant features are
  outside this public Community release.

Report security issues privately through [`SECURITY.md`](SECURITY.md). For
general questions, see [`SUPPORT.md`](SUPPORT.md). Do not include credentials,
private repository data, logs with secrets, or customer information in public
issues or pull requests.

## Contributing

Contributions to code, documentation, tests, analyzers, and Community
connectors are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then
read the architecture and the relevant connector or analyzer guide.

## License

The Lintaya open core is licensed under [Apache License 2.0](LICENSE). See
[`NOTICE`](NOTICE) for copyright and third-party notices. Future hosted services,
support, SLAs, or commercial modules are separate offerings and do not change
the license of this repository.
