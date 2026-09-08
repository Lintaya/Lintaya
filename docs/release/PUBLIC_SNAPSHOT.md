# Public repository snapshot

English | [Español](PUBLIC_SNAPSHOT.es.md)

Status: draft for the first Lintaya public repository. This document defines the
allowlist for a new repository; it does not copy, delete, rewrite history, or
rotate credentials.

## Goal

Publish a clean, independently initialized Lintaya repository with the product
source, reproducible development instructions, community files, and no user
data or private operational material. Create a new GitHub repository rather
than a fork, because a fork retains the original history.

## Proposed public structure

~~~text
lintaya/
├── .github/                 CI, Dependabot, issue forms, PR template
├── app/                     browser PWA views and API client
├── assets/                  reviewed brand and social assets
├── bitwarden/               reviewed examples only; no deployment secrets
├── cli/                     cross-platform command-line client
├── docs/                    public product, architecture, and contributor docs
├── icons/                   reviewed application icons
├── scripts/                 validation and repository-maintenance scripts
├── server/                  Express API, connector packages, tests, examples
├── .gitignore
├── .nvmrc
├── LICENSE
├── NOTICE
├── Lintaya.html
├── manifest.webmanifest
├── README.md
└── sw.js
~~~

## Include

| Path | Reason | Conditions before the first public commit |
|---|---|---|
| app/, server/, cli/ | Product source, tests, and runtime contracts. | Run secret scan; keep runtime data excluded by .gitignore. |
| docs/, README*, SETUP*, ARCHITECTURE* | User and contributor documentation. | Remove private operational context; label beta limitations accurately. |
| .github/, scripts/ | Reproducible validation and community workflow. | CI must test server and CLI on supported Node versions. |
| LICENSE, NOTICE, CONTRIBUTING*, SECURITY*, SUPPORT*, CODE_OF_CONDUCT*, CHANGELOG.md | Legal and community baseline. | Confirm final copyright holder in NOTICE. |
| assets/, icons/ | Product identity. | Confirm origin, redistribution rights, and source files. |
| bitwarden/ | Example configuration and integration support. | Include only examples/templates; inspect every file for deployment-specific data. |
| .vscode/launch.json | Optional public debugging configuration. | Exclude all other editor-local state. |

## Exclude

| Path or class | Reason |
|---|---|
| .git/ and the original repository history | The new repository starts with a reviewed initial commit. |
| node_modules/, tmp/, *.log, *.err | Generated or local runtime output. |
| server/*.db, WAL/SHM files, server/backups/, server/docs-files/, server/gitlab-clones/ | User data, backups, uploads, and cloned third-party repositories. |
| server/start-dev.js, server/vault-seed.js, bitwarden/settings.env, .env* | Local credentials and deployment settings. |
| .claude/, .mcp.json, personal agent session/configuration state | Local tool state and possible credentials. |

## Review before inclusion

| Path | Default decision | Required review |
|---|---|---|
| AGENTS.md and CLAUDE.md | Review | Keep only generic contributor guidance; remove local assumptions and credentials. |
| .cursor/ and .codex/ | Exclude by default | Publish only reusable rules, skills, or examples with no user state; otherwise omit the folders. |
| Local handoff notes and private evidence tools | Exclude | Keep outside the public snapshot unless deliberately rewritten as public documentation. |
| assets/ and icons/ | Review | Record license, source, and redistribution rights for every non-original asset. |
| bitwarden/ | Review | Confirm every tracked file is an example and contains no server-specific values. |
| docs/ | Include after review | Remove personal, customer, VPN, hostname, IP, and internal-process references. |

## Pending preparation plan

This is the prioritized plan agreed before creating the public snapshot. It is
recorded here for continuity; none of these steps authorizes publication by
itself.

1. **Classify the review group.** Inspect `bitwarden/`, `assets/`, `icons/`,
   `AGENTS.md`, `CLAUDE.md`, `.cursor/`, and `.codex/`.
   Record an include, exclude, or redact decision with evidence for each item.
2. **Rotate local development credentials.** The project owner must revoke,
   replace, or explicitly classify every credential that was used while the
   private workspace was active. Never copy ignored runtime configuration into
   the new repository.
3. **Separate development cache busting from source changes.** Done. The tracked
   `sw.js` now carries a placeholder cache key and the server injects the real
   one while serving `/sw.js`: the release version in production, a fingerprint
   of the client sources in development, so an edited view still retires the old
   cache without restarting the server. See `server/core/services/sw-version.js`.
   No development workflow rewrites a tracked file any more.
4. **Make release documentation discoverable.** Link this snapshot policy and
   the release/version process from the public documentation index, preserving
   the English/Spanish pairing.
5. **Reconcile the open-source roadmap.** Update its stale decision text,
   connector/block counts, and completion states so it distinguishes delivered
   work from the remaining public-release gate.

## Release gate

The snapshot is ready to initialize only when all items are true:

- [ ] The allowlist has a decision for every top-level file and folder.
- [ ] A scan of the selected snapshot finds no credentials, databases, backups,
  private hostnames, internal IPs, or personal data.
- [ ] Every credential previously used for development is rotated, revoked, or
  confirmed non-production by the project owner.
- [ ] The selected snapshot passes JSON, secret, bilingual-documentation,
  server, and CLI checks from a clean clone on Node 22 and Node 24.
- [ ] The [supply-chain policy](SUPPLY_CHAIN.md) has a passing secret-history
  scan, a retained SPDX SBOM, and no unresolved high or critical runtime
  vulnerability.
- [ ] The README and setup instructions work using only public information.
- [ ] License, NOTICE copyright holder, asset rights, and package/repository
  naming are confirmed.
- [ ] VERSION, server/package.json, CLI release notes, and CHANGELOG.md describe
  the intended beta version consistently.
- [ ] Beta limitations are explicit: Approval Center/destructive actions, Team,
  and sandboxed repository execution are not released features.
- [ ] The selected files are reviewed in a clean worktree before the initial
  commit.

## Initial publication procedure

1. Create a new empty GitHub repository named for the approved public project.
2. Copy only the reviewed allowlist into a separate clean directory.
3. Initialize Git there and run all release-gate checks.
4. Review the resulting initial diff; it must contain no unrelated history.
5. Commit the reviewed snapshot, push the default branch, and create a clearly
   labelled pre-release tag such as v0.1.0-beta.1.

Do not publish until the release gate is complete. The original private project
remains the source workspace until the new repository is verified.
