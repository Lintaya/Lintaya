# Connector packages

This directory is the source of truth for connector product classification and
metadata. Folder placement communicates the product tier; the manifest repeats
that value so the registry can validate accidental moves or mismatches.

Only the community tier ships here. The enterprise and development tiers live in
their own repository — the connector pack — installed outside this tree
(ADR-014 Phase 3). A connector for either of those is written there, under the
same rules as this guide except the ones that depend on a folder.

Before adding or migrating a connector, read the
[`Connector Development Guide`](../../docs/connectors/DEVELOPMENT_GUIDE.md) and
complete its [`Review Checklist`](../../docs/connectors/REVIEW_CHECKLIST.md).

```text
connectors/
|-- community/       # Apache-licensed connectors, the only tier shipped here
|-- sdk/             # stable import boundary for shared connector services
|-- manifest.schema.json
`-- registry.js
```

## Installing a connector that does not ship here

A connector need not live in this tree at all (ADR-014). Discovery also scans a
user directory outside the repository — `LINTAYA_CONNECTORS_DIR`, defaulting to
`~/.lintaya/connectors/` — which survives a re-clone and an update, needs no
`.gitignore` entry, and keeps private code out of the public tree by
construction rather than by omission.

That directory is flat: one folder per connector, no tier folders.

```text
~/.lintaya/connectors/
`-- acme/
    |-- manifest.json
    |-- index.js
    `-- config.schema.json
```

Two differences from a manifest that ships here:

- **`implementation.source` is relative to the connector's own folder**
  (`"index.js"`), not to the repository root. Nothing outside the repository can
  be expected to know where the repository is.
- **The declared `tier` is not checked against a folder**, because there is no
  tier folder to check it against. It still has to be one of the three valid
  values.

- **The Connector SDK arrives in the context**, not through a relative
  `require`. A package outside this tree cannot resolve `../../sdk`, and a copy
  of it would be worse than the broken path: the SDK fronts the process-wide
  secret store, so a second copy builds a second store and the connector reads
  secrets the host never wrote. Any host dependency travels the same way —
  `express` among them. See section 8 of the Development Guide.
- **A connector bound to one platform says so.** `os: ["win32"]` and a
  `requires` sentence someone can act on. The registry does not mount it
  anywhere else, does not schedule it, and the card explains why instead of
  reading as merely disconnected.

Everything else is identical, including `config.schema.json` being read from
beside the manifest.

An id that collides with a connector shipped here is refused, naming both
manifests. The shipped one is never silently replaced.

Installing is cloning or copying the folder; removing is deleting it. Neither
needs a change in this repository.

Each connector owns a directory containing `manifest.json`. A legacy connector
points to `server.js`; an extracted connector uses `implementation.mode:
"package"` and owns its client, routes, schema, tests, fixtures, and
documentation. GitHub, GitLab, and Bitbucket are complete lifecycle packages
and serve as reference implementations for future SCM connectors. Outline is
the reference for knowledge-base connectors with read/write resource routes.

Connector packages import shared HTTP, storage, and secret-safe logging helpers
from `sdk/`. The SDK is an internal preview: its contract remains small and is
now validated across SCM, knowledge-base, and usage connectors. Paginated
clients use `sdk.collectPages()` to preserve provider order, enforce a hard
page bound, propagate errors, and report `{ pageCount, truncated }` instead of
silently presenting partial data as complete. The shared contract also checks
every registered Action's identity, effect and closed input/output schemas. A
connector generator is still required before declaring the SDK stable for
third-party connectors.

Connector package IDs and directory names describe the provider or integration,
never a customer, environment, region, or hostname. For example, use `vcenter`,
not an installation-specific name such as a city or site code.

The registry is loaded when the server starts. It rejects duplicate IDs,
invalid metadata, and — for a connector shipped here — a `tier` that does not
match the parent folder. Connector API responses include the validated tier,
lifecycle, license, version, and capabilities. `manifest.schema.json` describes
every field a manifest may carry, and a test validates every shipped manifest
against it, so the two cannot drift apart unnoticed. Run
`npm run test:connectors` from `server/` after changing a manifest.

Product tier and software license are different concepts. The enterprise
connectors are Apache-2.0 and now live in the connector pack, which is a
distribution boundary rather than a licensing one. A future proprietary module
must declare its own license, wherever it is distributed from.
