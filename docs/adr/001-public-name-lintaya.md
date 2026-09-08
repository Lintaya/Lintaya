# ADR-001: Lintaya as the public product name

- Status: Accepted
- Date: 2026-08-16

## Context

The project needs a short public identity that can cover Git repository
management, static analysis, lifecycle visibility, and future connectors without
being tied to a single provider or repository type.

The working names `Personal HQ` and `Personalv2` describe the project's origin,
but not its public purpose. The lighthouse/watchtower concept communicates
visibility, guidance, and early warning. The name also needs to work in English
and Spanish.

## Decision

The public product and brand name is **Lintaya**. The primary tagline is:

> Every project tells a story. Lintaya reveals it.

New public documentation, UI labels, manifests, and community assets use
Lintaya. Historical internal filenames and data paths may remain temporarily
when renaming them would break an existing installation.

## Consequences

- Public-facing references converge on Lintaya.
- Compatibility-sensitive names require an explicit migration instead of a
  blind rename.
- Package names intended for publication must be checked for availability before
  release.
- Trademark and domain clearance remain separate release tasks.

## Update — 2026-08-19

The entry-point filename migration mentioned above happened: `Personal HQ.html`
was renamed to `Lintaya.html` (manifest `start_url`, `sw.js` cache list, and the
server's shell route all follow it). The old path still works — the server
answers `/Personal HQ.html` and its `%20`-encoded form with a 301 to
`/Lintaya.html` — so PWA installs that predate this change are not broken,
matching the "explicit migration instead of a blind rename" consequence above.
