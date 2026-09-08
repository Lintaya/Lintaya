# Contributing to Lintaya

English | [Español](CONTRIBUTING.es.md)

Contributions of code, documentation, tests, analyzers, connectors, and
reproducible bug reports are welcome.

## Before you begin

- Read the [architecture](ARCHITECTURE.md), the
  [public snapshot checklist](docs/release/PUBLIC_SNAPSHOT.md), and the
  [release process](docs/release/RELEASE_PROCESS.md).
- Search existing issues before opening a new one.
- Never include credentials, private repository data, production logs, database
  files, or personal documents in a public contribution.
- Report vulnerabilities through [SECURITY.md](SECURITY.md), never a public
  issue.

## Development setup

Lintaya supports Node.js 22 and 24, with Node 24 preferred. The frontend is
browser-loaded React/JSX; the server, package lock, and tests live in `server/`.

```bash
git clone <your-fork-url> lintaya
cd lintaya/server
npm ci
npm run check
```

Start with local-only defaults when you need a running app:

```bash
npm run dev
```

For configuration, backups, and optional vault integration, read
[SETUP.md](SETUP.md). Do not reuse development secrets in a shared or
production environment.

## Change checklist

1. Create a focused branch from the current default branch.
2. Keep changes reviewable; do not mix unrelated formatting or refactors.
3. Add or update proportional tests.
4. From `server/`, run `npm run check` and the focused test suite relevant to
   the change.
5. Update documentation, the matching Spanish/English pair, and its
   `.i18n.yaml` record. Run `node scripts/verify-translation-pairing.mjs --recorded`.
6. Update `CHANGELOG.md`
   when a user or extension contract changes.
7. Open a pull request using the repository template.

## Analyzers and connectors

Analyzer code belongs in `server/analysis/analyzers/`; reusable fact collection
belongs in `server/analysis/inventory/`. Follow
[`server/analysis/README.md`](server/analysis/README.md), include stable finding
IDs, evidence, recommendations, fixtures, and tests independent of private
services.

Before implementing a connector, read the
[`Connector Development Guide`](docs/connectors/DEVELOPMENT_GUIDE.md) and use
the [`Connector Review Checklist`](docs/connectors/REVIEW_CHECKLIST.md). A
substantial connector proposal should first identify the provider,
authentication, pagination, rate limits, and needed capabilities.

Useful focused test commands from `server/` are:

```bash
npm run test:connectors
npm run test:analysis
npm run test:http
npm run test:routes
npm run test:core
```

## Review and licensing

A pull request is ready when CI passes, no secrets or personal data are present,
compatibility is preserved or a migration is documented, errors are actionable,
and new permissions or dependencies are explained.

Lintaya's open core uses Apache License 2.0. Unless explicitly agreed otherwise
before submission, accepted intentional contributions are provided under that
same license. Do not submit proprietary code or code you cannot license.
