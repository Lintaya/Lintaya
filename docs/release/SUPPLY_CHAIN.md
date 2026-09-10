# Supply-chain policy

English | [Español](SUPPLY_CHAIN.es.md)

Status: release preparation for the first public Lintaya repository. The latest
local runtime audit is clean; the remaining release controls are history,
licensing, asset, and snapshot reviews.

## Controls

| Control | Scope | Automation | Release expectation |
|---|---|---|---|
| Current-file secret baseline | Versionable workspace files | `scripts/check-secrets.mjs` in CI | Passes with no sensitive paths or detected credentials. |
| Secret-history scan | Every reachable Git commit | `gitleaks/gitleaks-action` with full checkout | Passes in the new public repository. Rotate any exposed credential even if its commit is removed. |
| Dependency and license review | New runtime dependency changes in public pull requests | GitHub Dependency Review | No new high/critical vulnerability or denied license. Unknown licenses require human review. |
| Runtime audit | Server and CLI lockfiles | Weekly, push, pull-request, and manual `npm audit` reports | No unresolved high or critical production vulnerability at release. |
| SBOM | Complete repository dependency inventory | Syft SPDX artifact from `anchore/sbom-action` | Attach the generated artifact to the candidate release record. |

The repository uses Apache-2.0. New dependencies under strong copyleft licenses
listed in `.github/dependency-review-config.yml` are denied. A license that is
unknown or not covered by that rule is a legal-review item, not an automatic
approval. If the public repository belongs to a GitHub organization rather than
a personal account, configure its `GITLEAKS_LICENSE` secret before enabling the
history scan.

## Current baseline

The latest baseline was measured on 2026-09-10 using lockfile-only runtime
audits (`npm audit --omit=dev --audit-level=high`):

| Component | Result | Release status |
|---|---|---|
| CLI | 0 vulnerabilities | Clear at this baseline. |
| Server | 0 vulnerabilities | Clear. |

The CLI and server are both clear at this baseline. Keep the audit threshold at
high severity or stricter, and re-run the audit after every lockfile change.
This result does not replace the full-history secret scan, SBOM generation, or
manual license and asset review required for the public snapshot.

## Public snapshot procedure

1. Run the full-history secret scan against the private source repository and
   rotate any credential it finds.
2. Create the new public repository from the reviewed snapshot; never fork the
   private repository or copy its Git directory.
3. Confirm the history scan passes against the new public repository.
4. Download the server and CLI audit artifacts and the SPDX SBOM from the same
   workflow run; retain them with the release decision.
5. Complete the manual review of licenses, `NOTICE`, assets, and documentation.
6. Create the clean snapshot without `.git/` or private history, then verify it
   independently before publication.
7. Tag the verified public repository as `v0.1.0-beta.1`.
8. Configure branch protection so the Supply chain workflow is required after
   the repository is public.

The `npm-audit` job publishes the current clean baseline. Dependency Review
prevents new risky runtime dependency changes in public pull requests; the
release gate still requires the independent snapshot, history scan, SBOM, and
manual review to pass before publication.
