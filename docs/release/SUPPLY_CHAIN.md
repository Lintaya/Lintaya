# Supply-chain policy

English | [Español](SUPPLY_CHAIN.es.md)

Status: required preparation for the first public Lintaya repository. This
policy inventories risk; it does not treat an audit report as a remediation.

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

The baseline was measured on 2026-08-25 using lockfile-only runtime audits:

| Component | Result | Release status |
|---|---|---|
| CLI | 0 vulnerabilities | Clear at this baseline. |
| Server | 14 vulnerabilities: 10 high, 1 moderate, 3 low | Blocked. Several high findings are transitive to the direct `@bitwarden/cli` dependency. |

Do not suppress these findings with broad audit exceptions or a lower threshold.
Create a remediation issue that records the dependency path, fixed version,
compatibility test, and any time-limited human-approved exception. Re-run the
audit after every lockfile change.

## Public snapshot procedure

1. Run the full-history secret scan against the private source repository and
   rotate any credential it finds.
2. Create the new public repository from the reviewed snapshot; never fork the
   private repository or copy its Git directory.
3. Confirm the history scan passes against the new public repository.
4. Download the server and CLI audit artifacts and the SPDX SBOM from the same
   workflow run; retain them with the release decision.
5. Resolve every high or critical runtime finding before tagging a public beta.
6. Configure branch protection so the Supply chain workflow is required after
   the repository is public.

The `npm-audit` job intentionally publishes a baseline report even while known
findings remain. Dependency Review prevents new risky runtime dependency changes
in public pull requests; the release gate prevents publishing with the existing
server findings unresolved.
