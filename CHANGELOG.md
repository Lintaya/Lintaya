# Changelog

All notable user-facing changes to Lintaya will be documented in this file.

The format follows the principles of Keep a Changelog. Public releases use
Semantic Versioning, beginning with prereleases before the first stable release.

## [Unreleased]

### Changed

- Home's two zones are separated by the same handle the Dashboard uses, and at
  the same distance. The zones sat 44 px apart — the grid added its own gap on
  each side of the 12 px handle — against the Dashboard's 12 px, and blocks
  stacked 16 px apart against its 10 px. The handle is now the Dashboard's own
  component rather than a copy of its looks, so the two screens cannot drift
  apart again; its keyboard step moves by a percentage of the width, which
  makes an arrow press shift the divider by the same amount in either
  direction, and dragging accepts touch and pen and not only a mouse.
- Home is headed by its own title, like every other view.

- The public build ships the community connectors only. The enterprise and
  development tiers — Qportal, UCS Manager, vCenter, Outlook, Outlook local and
  Lintaya remote — moved to their own repository, installed from a directory
  outside this tree (ADR-014 Phase 3). Anthropic moved with them: it is not
  ready to be public. Nothing about installing them is special-cased; they are
  discovered the way any dropped-in connector is, and removing the directory
  removes the connectors. The pack carries code and never credentials, so each
  machine is still configured once through the UI.

### Added

- The sidebar answers a right-click on any entry with a menu to move it up or
  down and to hide it. It is a second door into what Settings → Navigation and
  each Board's "show in sidebar" toggle already did, so anything hidden from
  here can still be brought back from where it always lived: built-in sections
  from Settings, and a Board or Dashboard from its own editor. Ordering a Board
  or Dashboard is new — until now its place in the menu came from its place in
  the list that loaded it and could not be changed — and, like the order of the
  built-in sections, it is remembered per browser. An entry published by a
  connector keeps its position and visibility from the connector, and the menu
  says so rather than offering an action that would leave it unreachable.
- Home's "+ Block" menu opens on a search box, scrolls instead of growing, and
  keeps "new note" in view at the bottom. The menu listed every available block
  at full height, which a catalogue of any size makes unusable. Accents are
  ignored when matching, because block titles arrive from connectors with them
  and nobody types them when searching.

- An installed connector can ship its own documentation page. Anything under
  `<connector>/docs/` in the connector directory is indexed beside the
  application's own docs and appears as its own section, labelled with the name
  the connector gives itself. It is deliberately not merged into "Connectors":
  what you read there came with the connector rather than with Lintaya, and the
  tree should say so rather than leave it to be deduced. A connector with no
  docs contributes nothing, and no installed directory at all is the normal
  case.

- A connector installed outside this repository can now use the Connector SDK
  (ADR-014, prerequisite for Phase 3). It could not before: every packaged
  connector reaches the SDK by a relative path that only resolves under the
  tier folders shipped here, and shipping a copy of the SDK alongside the
  connector would have been worse than the broken path — the SDK fronts the
  process-wide secret store, so a copy would have built a second one and read
  secrets the host never wrote. The SDK now travels in the connector context
  the loader hands to every package, alongside `express`, which an installed
  connector cannot resolve either. Verified with six connectors loaded from a
  directory outside the repository, with both optional tiers removed from the
  tree: they register and mount their routes, and a context without the SDK
  fails loudly instead of silently finding something else.

- A connector can be installed without touching this repository (ADR-014
  Phase 2). Discovery now scans a user directory outside the working tree —
  `LINTAYA_CONNECTORS_DIR`, defaulting to `~/.lintaya/connectors/` — as well as
  the tier folders that ship here. Installing is copying or cloning a folder;
  removing is deleting it. That directory is flat, one folder per connector,
  and a manifest there points at its own folder rather than at a repository it
  cannot know the location of. A connector whose id collides with one Lintaya
  ships is refused outright, naming both manifests: letting a folder in a home
  directory quietly stand in for `github` is the kind of substitution nobody
  would notice. A missing directory, or a folder in it with no manifest, is
  ignored rather than treated as an error.
- vCenter now owns every vCenter route (ADR-014 Phase 1). Its live VM/Host
  projections and its on-demand diagnostics were core route modules that
  `server.js` imported and wired by hand, which is the reason core had to
  reference the package at all; both moved into the connector and register
  through its `register()` like any other. Fabric correlation kept a third
  reference the plan had not counted: the MAC indexes it joins against called
  the vCenter client directly. Core now owns only the join and asks a registry
  of workload sources, which vCenter joins when it loads — an install without
  the enterprise tier correlates fabric with every MAC unnamed instead of not
  correlating at all. VMs and Hosts are published by vCenter's manifest, so
  they leave the sidebar when that connection is disconnected, the way
  Containers already followed Portainer. No core file names an optional
  connector package any more, and the test that holds that line was tightened
  to say so.
- The server no longer needs the enterprise and development connector tiers to
  be present (ADR-014 Phase 0). Removing them used to stop it from booting:
  `server.js` imported the vCenter package directly and `core/actions/
  bootstrap.js` imported all thirteen connectors by path. Action registration
  and the scheduled-sync target list are now derived from the manifests, so a
  tier that is not installed simply contributes nothing, and the one remaining
  reference to vCenter resolves optionally — its absence is a missing feature,
  never a server that will not start. Deriving the sync list also fixed a
  drift the hand-kept version had: `lintaya-remote` and `outlook-local` were
  never scheduled at all. A connector that is not on the fast cadence, or
  whose sync route is shaped differently, now says so with `autoSync` in its
  own manifest instead of core knowing.
- The Boards page no longer invents rows. It showed five hardcoded example
  connectors whenever the module list was empty — not only while it loaded —
  so a fresh install advertised connectors it may not even ship, and the real
  empty state was never reached. The Calls badge likewise stops naming one
  provider: it takes the connection id from whichever connector publishes the
  Calls module, and asks for nothing when none does.
- Test scripts use globs instead of 95 hand-listed paths, so a new test file
  is picked up by being written, and a tier that is not installed no longer
  breaks `npm test`.

- Documentation for SSH and for how pages reach the sidebar, both of which had
  no written explanation. A new bilingual SSH guide (`docs/app/ssh/`) covers
  opening terminals from VMs, Devices, and Containers, concurrent sessions and
  server-side reattach, the replay buffer and idle timeout, how a password is
  resolved from the vault or the machine mapping, jump hosts, and the session
  transcripts the SSH Logs module reads. A new "Pages and modules" section in
  `ARCHITECTURE.md` maps every route to its component and file, and separates
  core pages from the ones a connector publishes — the view code always ships in
  `app/`; a connector only decides whether the page appears, which is why
  GitLab, GitHub, and Bitbucket all publish the same `ReposView`.
  Dashboards were documented but unreachable from the index and had no
  bilingual-pair record; both are fixed, along with the missing language
  switcher on that page. An acronym folder no longer renders as "Ssh" in the
  in-app documentation tab.

- The GitHub connector can create repositories
  (`POST /api/connectors/github/repositories`, and the `create-repository`
  action), so a new repository can be provisioned from Lintaya with the token it
  already holds instead of out-of-band. `private` is required and must be a
  boolean: the API refuses to infer visibility, because a public repository can
  be cloned, forked, and indexed before a mistake is noticed. The repository is
  created empty so existing history can be pushed into it, the connector log
  records the visibility in words, and the route never overwrites connection
  status — a rejected name says nothing about the health of the connection.

- Release management foundation: product candidate version 0.1.0-beta.1,
  root VERSION source, server alignment check, separate CLI SemVer, documented
  release process, and CI coverage for CLI checks.
- Connector secret store completed (SEC-004): a real Bitwarden adapter (one
  Secure Note per connection, reusing the Passwords module's vault session)
  joins the existing local AES-256-GCM store behind the same SecretStore
  boundary — `legacy` (plaintext KV), `local`, and `bitwarden` are all
  selectable via `LINTAYA_SECRET_STORE` without touching connector code.
  Every direct KV consumer of connector config (Repos providers, Portainer
  container inspection, live vCenter routes, vCenter diagnostics, the
  Bitwarden CLI sync's own re-auth) now reads through the store via a shared
  `getConnectorConfig(id)` helper instead of bypassing it, so `local`/
  `bitwarden` mode secrets reach every consumer, not just each connector's
  own routes. vCenter's own `/config`, `/test`, and `/sync` routes were also
  migrated — they predated `createConnectorStore` and read/wrote the
  password in plaintext directly, bypassing SEC-004 entirely even after the
  rest of the migration landed. Deleting a connection (base or extra
  instance) now also clears its secret-store entry — previously only its
  plaintext config was cleared, leaving an orphaned encrypted/Bitwarden
  record behind. Every async connector route handler across the 12
  connector packages that have secret fields is now wrapped with the SDK's
  new `guardAsyncRoute()`: Express 4 does not forward a rejected
  async-handler promise to error middleware, so a `vault-locked` throw from
  `store.getConfig()`/`setConfig()` (an expected, common state under
  `bitwarden` mode before the vault is unlocked) used to hang the request
  instead of returning 401 — this closes that gap for every connector's own
  routes without changing their business logic. `legacy` remains the default
  during the gradual migration.
- Lintaya brand system, light/dark assets and social media kit.
- Repository classification, GitOps inventory and analysis foundations.
- Community contribution, security, conduct and support policies.
- GitHub issue and pull-request templates.
- Continuous integration for supported Node.js versions and baseline secret
  detection.
- Dependabot configuration for npm and GitHub Actions.
- Apache License 2.0, NOTICE, and the initial open-core commercial model.
- Express `createApp()` foundation and port-free HTTP tests for liveness and authentication.
- Centralized runtime configuration, versioned SQLite migrations, and an extracted KV store.
- Visual Community, Enterprise, and In development classifications for connectors.
- Canonical connector folders by product tier, validated manifests, registry
  tests, and connector metadata in API responses.
- Modular GitHub connector package with its own REST client, Express routes,
  configuration schema, normalized models, and contract tests.
- Internal Connector SDK preview with shared HTTP error normalization, timeout/cancellation,
  storage-key helpers, public config filtering, and secret-safe logging.
- Modular GitLab connector package with paginated project discovery, normalized
  repository data, secret-safe lifecycle routes, schema, and contract tests.
- Modular Bitbucket Cloud and Server/Data Center connector package with safe
  pagination, bounded project enrichment, normalized repositories, lifecycle
  routes, schema, and contract tests.
- Modular Outline connector package with bounded collection/document
  pagination, secret-safe configuration, synchronization, and tested document
  read, create, update, and recoverable trash operations.
- Agentic Repository Workspace UX specification covering responsive panels,
  terminal, diffs, approvals, artifacts, accessibility, and a future Desktop HUD.
- Connector development guide and review checklist covering product tiers,
  naming, manifests, SDK usage, security, normalized models, UI, and testing.

### Removed

- Every hardcoded internal network inventory and personal identity left in the
  tree ahead of the public snapshot: the dead `VLAN_DATA` constant in the VMs
  module (392 real addresses, hostnames, admin accounts and people's names, no
  longer referenced since the IP reference view switched to `PUBLIC_VLAN_DATA`)
  and a sample hostname used as a form placeholder in Devices.

### Fixed

- Home no longer announces "No connectors configured" while connectors are
  connected and syncing. The line was chosen by whether vCenter specifically
  was configured, so every install without that one connector was told it had
  none at all.

- One page that fails no longer takes the application with it. A view throwing
  during render used to take down the whole React tree — a blank screen,
  including the Connectors page you would go to in order to disable whatever
  was at fault, with a reload as the only way out. Route content now renders
  inside an error boundary: the page that failed says so, the rest of the app
  stays up, and moving to another page recovers without reloading.
- A connector that only runs on one platform is no longer offered on the others.
  outlook-local drives the Outlook desktop app through PowerShell and COM and
  has always said so in its manifest, but nothing read the field: on Linux or
  macOS it loaded, mounted its routes and offered itself for configuration, then
  failed at the first call with a COM error that named nothing about the real
  reason. It is now left unmounted and unscheduled there, and its card explains
  what the machine would need instead of reading as merely disconnected.
- The sidebar no longer offers a page that no installed connector can fill. A
  core route owned by a connector — Passwords, Containers, VMs, Hosts,
  Llamadas, Correo, Repos <provider> — was hidden only while its connector was
  present and disconnected. A build that does not install the connector at all
  publishes no module, so there was nothing to hide against and the entry
  stayed, leading to a page that could never load. Such a route is now shown
  only while some available module publishes it.
- The Llamadas badge counted nothing. It looked for the connector publishing
  the Calls module by comparing a module route against `"calls"`, but a module
  route reads `module:<connector>:<module>`, so the match never succeeded and
  the count stayed at zero.
- Git operations on a local clone no longer report every failure as one opaque
  502 "Git operation failed". A diverged branch, a rejected push, a merge
  conflict, uncommitted local changes, a missing upstream, an empty commit,
  rejected credentials, an unreachable remote and a command timeout each get
  their own status and stable `GIT_*` code, so the UI can say what to do about
  it. Git's stderr is still never forwarded to the client - it runs with the
  provider token in `-c http.extraheader`, so the messages are fixed strings.

### Changed

- The service worker's cache key is no longer stored in the tracked `sw.js`.
  The dev entry-point used to rewrite that file on every start, so a clean clone
  went dirty just by running the server and each restart produced a meaningless
  version bump in history. `sw.js` now carries a placeholder and the server
  injects the real key while serving `/sw.js`
  (`server/core/services/sw-version.js`): the release version in production, and
  in development a fingerprint of the client sources, so editing a view retires
  the stale cache on the next load without restarting the server.

- The committer identity used for commits on local clones is no longer
  hardcoded in `server/routes/repos.js`. It is now a per-connection setting
  edited from the connector's detail panel (kv `connector-commit-identity`,
  `GET`/`POST /api/connectors/:id/commit-identity`), resolved connection → base
  type → the `GIT_COMMIT_IDENTITY` environment variable, which remains as the
  headless/CI fallback. Unset by default, in which case git keeps resolving the
  identity itself. It is deliberately a structured field rather than a line of
  the connector's AI context: the server applies it to every commit, whether the
  caller is the user or an agent, so an agent must not be able to redefine it.
- Public product identity changed from Personal HQ / Personalv2 to Lintaya.
- Entry point renamed `Personal HQ.html` → `Lintaya.html`; the server keeps a
  301 redirect from the old path so PWA installs made before the rename keep
  working.
- Mobile layouts now collapse dashboard and catalog grids, keep the navigation
  drawer scrollable, and respect safe areas without overlapping content.
- The Lintaya logo remains visible in the mobile header on every route.
- The environment-specific vCenter connector ID `vc-mex` was replaced by the
  generic `vcenter` ID, with automatic migration of existing local data.
- Supported Node.js runtime policy moved to maintained LTS lines.
- Server startup now calls `listen()` only from the executable entrypoint.

## Release links

Release comparison links will be added when the public repository URL and first
version tag are available.
