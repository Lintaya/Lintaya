# ADR-014: connector distribution and the drop-in model

English | [Español](014-connector-distribution-and-drop-in.es.md)

- Status: Proposed
- Date: 2026-09-03
- Depends on: ADR-010
- Enables: public release without the enterprise and development tiers

## Context

The public release ships the community tier only. The enterprise connectors
(qportal, ucsm, vcenter) and the development ones (outlook, outlook-local,
lintaya-remote) stay private. Someone who installs the public build must be able
to add those connectors back on another machine and have their modules, blocks,
and routes appear, without editing the product.

The registry already works that way. `findManifestFiles()` scans the tier
directories and loads any `manifest.json` it finds, and the loader calls each
package's `register()` export without a line in `server.js`. That was the exit
criterion of the roadmap's Phase 2.

The product contradicts it. Removing both tiers from a clean snapshot and
starting the server fails immediately:

```
Error: Cannot find module './connectors/enterprise/vcenter'
```

The verified blockers:

| Blocker | Location | Effect |
|---|---|---|
| Direct `require` of a connector package | server.js:32 | The server does not start. Four functions, 14 call sites. |
| Connector-specific route files in core | routes/live-vcenter.js, routes/vcenter-diagnostics.js | 268 lines registered unconditionally for one connector. |
| Test paths listed one by one | server/package.json | 17 paths in absent tiers; `npm test` fails. |
| Scheduled sync target list | server.js:740 | Names qportal, outlook, ucsm, vcenter by hand. |
| Provider names and icons in the shell | app/app.jsx, block-catalog.jsx, block-builder.jsx, connectors.jsx | Orphan views and a direct fetch to `/api/connectors/outlook/events`. |
| Action registration listing every connector | core/actions/bootstrap.js | 13 hardcoded requires, 5 in absent tiers. Found while implementing Phase 0, not in the first analysis. |
| Core pages that only render one connector's data | VMs, Hosts | Two modules a public user can never fill. |

The install location matters as much as the loading. A folder inside the working
tree has to be gitignored, is lost on a fresh clone, and competes with ordinary
git operations. Hermes (NousResearch) resolves the same problem by discovering
skills from a user directory outside the project, and layering a sharing hub on
top of that directory convention rather than instead of it.

## Decision

**Connectors are discovered, never imported.** No file outside
`server/connectors/` may reference a connector package by path. Core depends on
the registry and the loader, never on a provider.

**A connector is installed outside the repository.** Discovery scans
`server/connectors/<tier>/` as it does today, and additionally a user directory
(`LINTAYA_CONNECTORS_DIR`, defaulting to `~/.lintaya/connectors/`). The user
directory is the documented way to add a private connector: it survives a
re-clone and an update, needs no `.gitignore` entry, and keeps private code out
of the public tree by construction rather than by omission.

**The private connectors keep their own repository.** They move to a private
git repo with their own history and CI, and are installed by cloning into the
user directory. A `.gitignore` hides a folder; it does not version, back up, or
move it to another machine.

**A connector owns the pages it feeds.** VMs and Hosts move into vCenter's
`modules[]`, the way Portainer already publishes Containers. Without a vCenter
connection they do not appear, so a public installation shows no page it cannot
fill.

**Core keeps no connector-specific route files.** `live-vcenter.js` and
`vcenter-diagnostics.js` move into the vCenter package and register through
`register()`.

## Consequences

The public build starts, tests, and runs with the community tier alone. Adding a
private connector is copying a folder; removing one is deleting it. The shell
stops naming providers it may not ship, which also removes the standing risk of
a public build advertising an internal system.

The cost is real. vCenter is mentioned 55 times in `server.js`, and moving its
routes changes a working integration; this must land behind the existing tests
rather than alongside a release. Two connector packages will also grow view
code, which the current model does not allow — a connector declares a component
and the shell resolves it from `app/`, so a connector that ships its own page
needs a loading path that does not exist yet. Until it does, VMs and Hosts stay
core files published by vCenter's manifest, which is enough for the sidebar
behaviour and defers the harder problem.

## Plan

**Phase 0 — make absence survivable.** Blocking for the public release.

1. Replace the 17 hardcoded test paths with globs. `node --test` accepts them;
   verified.
2. Derive `AUTO_SYNC_TARGETS` from the registry instead of a literal list.
3. Guard the shell's provider assumptions: drop `DUMMY_CONNECTOR_MODULES`, make
   the Outlook events fetch conditional on the connection existing, and let
   unknown providers fall back to a default icon and label.
4. Derive action registration from the manifests too. A tier that is absent has
   no manifest, so nothing is required for it.
5. Resolve the vCenter package optionally, through a shared helper, so its
   absence is a missing feature and not a server that will not boot. This is the
   minimal part of Phase 1 pulled forward: the boot test cannot pass without it,
   and a phase called "make absence survivable" that leaves the server unable to
   start would not deserve the name. Moving the routes stays in Phase 1.
6. Add tests that hold the line: core may not hard-require a connector from an
   optional tier, and both action registration and scheduled sync must work from
   a community-only manifest set.

**Status: implemented.** The server now starts, serves, and passes its suite
with the enterprise and development tiers removed.

**Phase 1 — move vCenter out of core.** Move both route files into the package,
register them through `register()`, delete the optional import and the four
injected functions Phase 0 left behind, and move VMs and Hosts into vCenter's
`modules[]`. When this lands, core must not name an enterprise or development
package at all — not even through `requireOptional`.

**Status: implemented.** Two corrections to the plan above, both found while
carrying it out.

The exit criterion was first written as "`requireOptional` should have no
callers". That is the wrong test. `core/actions/bootstrap.js` uses the helper
for something unrelated and permanent: a connector need not declare an
`actions.js` at all (lintaya-remote does not), and that absence is expected
whatever tier it belongs to. The criterion that matters is the one now stated —
no core file names an optional package — and `core/tier-independence.test.js`
enforces exactly that, having been tightened from "no bare require" to "no
reference of either shape".

The plan also counted two consumers of the vCenter client in core and there
were three. `getWorkloadIndex()` and `getHostMacIndex()` — the MAC indexes
fabric correlation joins against — called the client directly. Deleting the
import without them was impossible, and leaving them would have kept core
knowing a provider by name. They moved into the package behind a new registry,
`core/services/workload-sources.js`: core owns the join and asks every
registered source, vCenter registers itself when it loads, and an install
without the tier correlates fabric with every MAC unnamed rather than failing.
That is the same shape `FABRIC_ADAPTERS` already had for the plane side, which
is why the section's own comment claimed providers could plug in "without
touching the engine" while one of them was in fact hardcoded.

One exit claim of this phase was too broad, and is corrected here. Moving VMs and
Hosts into vCenter's `modules[]` did not on its own stop a public install
advertising two pages it cannot fill. The shell hid a connector-owned core route
only while the connector was present and Disconnected; a build that does not
install the connector publishes no module at all, so there was no `coreRoute`
to hide and the entry survived. `NAV_ROUTES` now marks the nine routes a
connector owns, and a single rule covers both cases: an owned route appears only
while some available module publishes it.

**Phase 2 — user-scoped connector directory.** Extend `findManifestFiles()` to
scan `LINTAYA_CONNECTORS_DIR`, document precedence when an id exists in both
places, and reject a connector whose id collides with a shipped one.

**Status: implemented.** Discovery now reads the shipped tier folders first and
then `LINTAYA_CONNECTORS_DIR` (default `~/.lintaya/connectors/`). Three
decisions the phase left open:

*The user directory is flat.* One folder per connector, no tier folders. Tiers
describe how this repository organises what it ships; making someone `mkdir
enterprise` before dropping in a connector would be ceremony with nothing
behind it. An installed connector still declares its `tier`, which is validated
against the allowed set — the folder/tier agreement check is the one rule that
does not apply outside the repo, because there is no folder to agree with.

*Precedence is refusal, not shadowing.* Shipped manifests load first, so a
clash can only be an installed connector claiming an id Lintaya already ships.
That fails loudly and names both manifest paths. Letting the user directory win
would mean a folder in a home directory could silently replace `github`, which
is the substitution nobody would notice; letting the shipped one win silently
would leave an installed connector mysteriously absent. Neither is worth the
convenience.

*`implementation.source` resolves against a recorded base.* A shipped manifest
writes it from the repository root, which is what it has always meant and what
fourteen manifests already say. An installed connector knows nothing of this
repository, so its source is relative to its own folder (`index.js`). The
registry records that base on each manifest as `packageRoot`, and both
`connectors/loader.js` and `core/actions/bootstrap.js` resolve through it
instead of assuming the repository root.

A missing or unset directory is the normal case rather than an error, and a
folder without a `manifest.json` is skipped rather than failing the scan — a
half-finished clone in that directory must not stop the server.

**Phase 3 — distribution.** Create the private repository, move the six
connectors, and document install and update as a clone and a pull.

**Status: done.** Seven connectors — the three enterprise, the three
development, and `anthropic`, moved out of community because it is not ready to
be public — now live in their own repository and install under
`LINTAYA_CONNECTORS_DIR`. This repository ships the community tier only.

Doing it surfaced an assumption Phase 2 never tested — an installed connector
could not reach the SDK at all, and every one of them needs it.

`require("../../sdk")` is a relative path that only resolves under the shipped
tier layout; from a flat user directory it lands one level too high. Copying the
SDK into the pack is not the answer either. `sdk/index.js` reaches into
`core/services/connector-store`, which reaches `core/services/secret-store`
and its process-wide default, so a second copy would build a second connector
store over a second secret store, and the connector would quietly read secrets
the host never wrote. An installed connector has to reach the host's own module
instances, not equivalents of them.

The SDK therefore travels in the connector context, the way `runBw` and
`workloadSources` already did, and `getConnectorConfig` joins its exports
because vCenter was the only caller reaching past that facade into core.
`express` needed the same treatment for the same reason: `outlook-local` uses
`express.raw` for attachment uploads, and a package outside the repository
resolves `require("express")` against the user directory rather than
`server/node_modules`. In both cases the relative `require` stays as a
fallback that is only ever evaluated where it resolves.

Verified with the six installed from a directory outside the repository and both
optional tiers removed from the tree: fourteen connectors register, 120 routes
mount, and each of the six claims its own. Without the SDK in the context the
load fails loudly — `Cannot find module '../../sdk'` — rather than finding a
stale copy.

The tests needed a story of their own. They reach further than the runtime ever
did: past the SDK's harness into `core/actions/registry`, `core/errors` and
`core/services/secret-store`, and — for vCenter's two route suites — into the
Express application itself. None of that can be vendored without becoming a copy
that drifts, so the pack resolves a Lintaya checkout instead, through
`LINTAYA_REPO` or a sibling directory, and every suite that needs one skips with
a printed reason when there is none. Silence there would have been the same trap
as the platform field: coverage that quietly stops covering anything.

They also had to start passing the SDK — and `express` — the way the host does.
That is not a workaround: a harness that hands over something other than what
production hands over is exactly how the logger-shape defect stayed invisible
for a day.

Taking the connectors out broke five tests in this repository and left a sixth
passing by luck. All six read `connectorManifests`, which is built with the real
user directory, so they described whichever connectors the machine running them
happened to have installed. One asserted "fourteen connectors" and stayed green
only because the pack was lending it six. They now load with an empty user
directory on purpose, and the ones that used a moved connector as a fixture use
a shipped one instead. The suite is 691 either way now; it was not before.

One more field turned out to be decoration. `os` was declared by
`outlook-local` — Windows only, through PowerShell and COM — and read by
nothing: on Linux or macOS it loaded, mounted its routes and offered itself for
configuration, then failed at the first call with a COM error that named nothing
about the real reason. The registry now refuses to mount a connector this
platform is not on, keeps it out of the scheduler, and the card says so with the
connector's own `requires` text rather than reading as merely disconnected.
`manifest.schema.json` had drifted the same way — fourteen fields declared with
`additionalProperties: false` against seventeen in use, and nothing reading it.
It is current now, and a test holds it there.

A smaller thing fell out of the same reading. `CONFIG_KEY`, `DATA_KEY` and
`STATUS_KEY` were built at module scope in six connectors and exported, and
nothing outside those files ever read them — not even their own tests. They now
live inside `register()`, beside the `connectorKeys` that builds them.

**Phase 4 — sharing.** Deferred until Phases 0–3 are done and the manifest has
proven stable across a real out-of-tree install. The options are a Lintaya
instance publishing its connectors to another over the existing
`lintaya-remote` connector, or a signed package index. Neither is worth
designing before the directory contract has been used in anger.

The same shape appeared once more, in the documentation viewer, and that half is
settled. It now indexes `<connector>/docs/` from the installed directory
alongside `docs/app/`, as a section of its own rather than merged into
"Connectors": what you read there came with the connector and not with Lintaya,
and the tree should say so rather than leave it to be deduced. The pages for the
seven that moved stay here too, because you may want to read what a type does
before deciding to install it.

Answering it meant restating why that viewer injects rendered markdown without a
sandbox. The reason was "these docs are versioned in this repository", which
stops being true the moment an installed connector can contribute one. The real
reason is that such a connector already runs its `index.js` inside the server
process, with the database and the secret store: whoever can drop a folder there
owns the server already, so its markdown crosses no boundary that was not
crossed at install. Phase 4 is exactly what would invalidate that — a connector
installed from a remote index, reviewed by nobody — and the comment now says so,
because a justification that quietly stops applying is how the next person makes
a confident wrong call.

It also has to answer a question this ADR never asked: whether a connector may
own its user interface. Today it may not. A manifest names a component Lintaya
has already loaded — `app/app.jsx` resolves `window[module.component]` and says
so plainly, that it "never sends executable UI over the API" — and
`Lintaya.html` loads every view through a hardcoded script tag. So the four
views the six connectors publish stay in the public `app/` even after the
packages leave. There is an argument for changing that, since a connector's
`index.js` already runs in the server process and the trust boundary is crossed
at install time, but it is a decision about executable code from a user
directory and deserves its own ADR.

Phase 0 is the only phase the public release depends on. Phases 1 and 2 make the
model honest; Phase 3 makes it portable.
