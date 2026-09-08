# ADR-010: `ConnectorType` versus `Connection`

- Status: Accepted
- Date: 2026-08-21
- Accepted: 2026-08-23
- Precedes: CORE-003 (see the internal project roadmap, section 12) —
  completed 2026-08-24, see section 17's progress log for the closing audit
- Depends on: ADR-009 (multiple connector instances, accepted and implemented)

## Context

Today a connector's *type* (what GitLab is, what fields it needs, what it can
do) and a *connection* (one configured GitLab account) are the same thing at
the storage and routing level. There is no record that says "connection X is
an instance of type gitlab" other than a naming convention and one KV blob.

Concretely, as implemented right now:

- **Type identity** comes from `manifest.json`, one per connector package
  under `server/connectors/{community,enterprise,development}/<id>/`, loaded
  and validated by [`server/connectors/registry.js`](../../server/connectors/registry.js)
  into `connectorManifests` (a `Map<typeId, manifest>`). `manifest.id` is the
  type's only identity, validated against `^[a-z][a-z0-9-]*$` and required to
  be unique. The manifest also owns `displayName`, `tier`, `lifecycle`,
  `license`, `capabilities`, `instantiable`, `blocks`, `modules`, and
  `implementation.source`. A sibling `config.schema.json` (found by
  convention, not by manifest reference) owns the config shape and marks
  secret fields with `x-lintaya-secret`/`writeOnly`.
- **Connection identity** is *derived*, not modeled. The base connection's id
  equals its type id (`gitlab`). An extra connection's id is
  `${typeId}${n}` for the smallest free `n ≥ 2` (`nextInstanceId()` in
  [`server/server.js:314`](../../server/server.js)), and membership is
  tracked in a single KV entry `connector-instances = { [typeId]: [extraIds] }`
  (`getConnectorInstances`/`addConnectorInstance`/`removeConnectorInstance`,
  `server/server.js:284-312`). `resolveConnectorType(id)` is the one function
  that walks that map to answer "which type implements this id" — every
  route, the loader, and the status aggregator go through it.
- **Config, synced data, and status** are three KV entries keyed by that same
  id: `connector-config-<id>`, `connector-data-<id>`, `connector-status-<id>`
  (`connectorKeys()` in
  [`server/core/services/connector-store.js`](../../server/core/services/connector-store.js)).
  Nothing enforces that `<id>` resolves to a real type — a stale id would
  silently read as unconfigured.
- **Card metadata** (display name, icon, color, docs link, sample endpoints)
  lives in a SQL table `connectors` (`server/core/database.js`), keyed by the
  same id, `INSERT OR IGNORE`-seeded once from `seedConnectors()` for the base
  connections and inserted per-row when an extra instance is created (`POST
  /api/connectors/:typeId/instances` in
  [`server/routes/connectors.js:210`](../../server/routes/connectors.js)).
  This table already carries most of what a `Connection` record needs
  (`id`, `name`, `created_at`, plus fields like `kind`/`feeds`/`docs` that
  duplicate what the manifest now provides via `connectorMetadata()`).
- **Secrets** are plain fields inside the `connector-config-<id>` JSON value,
  distinguished only by the connection's config schema (which is the type's
  schema). They never leave that KV entry unredacted:
  `publicConnectorConfig()`/`secretPresenceKey()`
  (`server/core/services/secrets.js`) replace a secret field with a
  `has<Field>` boolean before any config reaches an HTTP response, and
  `redactText()` strips known secret values out of connector logs. There is
  no separate secret store — redaction is the only boundary.
- **Loading an instance** is mechanical: `server/connectors/loader.js` calls
  each package's `register(context, instanceId)` once per known id
  (`registerConnectors()` at boot, `registerConnectorInstance()` on demand
  from the create-instance route). `instanceId` defaults to the type id, so
  the base connection needs no special case.
- Only **8 of 13 types** declare `instantiable: true` (gitlab, github,
  bitbucket, outline, portainer, qportal, outlook, plane). vCenter, Anthropic,
  UCS Manager, and Bitwarden are deliberately excluded — vCenter in
  particular has single-instance assumptions spread across live VM/host
  views, fabric correlation, and the AI chat context, which ADR-009 scoped
  out as its own future project.

This works and is tested (see `server/routes/connectors.test.js`,
`server/connectors/loader.test.js`), but it means: an id is overloaded to mean
both "the type" and "the connection" depending on context; there is no place
to hang connection-only metadata (e.g. a note, a health check schedule,
future per-connection permissions) without another parallel KV map; and nothing
stops a bug from treating an extra connection's id as if it were a type id (or
vice versa) except callers remembering to call `resolveConnectorType()` first.

## Decision

Introduce `ConnectorType` and `Connection` as distinct, explicit concepts.
This ADR defines the model; it does not implement it. CORE-003 implements it,
following the migration strategy below.

### Definitions

**`ConnectorType`** — an installed connector package. Identity: `manifest.id`.
Source of truth: `manifest.json` + its sibling `config.schema.json`, both
read-only at runtime (never written to by the app). A `ConnectorType` is
never created or deleted through the API — it appears when a package is
installed and disappears when the package is removed from disk. There is
exactly one `ConnectorType` record per manifest, no matter how many
connections use it.

**`Connection`** — a configured instance of a `ConnectorType`. Identity:
`connection.id` (a string, format unchanged from today — see Compatibility
below). Created through the API (implicitly at seed time for the base
connection of each type, explicitly via `POST /api/connectors/:typeId/instances`
for extra ones), and deletable (except the base connection, same rule as
today). Every `Connection` belongs to exactly one `ConnectorType`
(`connection.connectorTypeId`).

### Field ownership

| Concern | Owner | Today | After CORE-003 |
|---|---|---|---|
| Type id, capabilities, tier, lifecycle (package), license | `ConnectorType` (manifest) | `connectorMetadata(id)` reads the manifest by id | unchanged |
| Config shape, which fields are secret | `ConnectorType` (config.schema.json) | read by `resolveConnectorType(id)` first | unchanged |
| `blocks`, `modules` declarations | `ConnectorType` (manifest) | unchanged | unchanged |
| Connection id | `Connection` | derived (`typeId` or `${typeId}${n}`) | same values, now a first-class column (see below) |
| Visible name | `Connection` (defaults to `ConnectorType.displayName`) | `connectors.name` column, editable via `ConnectorNameEditor` | unchanged — already connection-scoped |
| `connectorTypeId` (which type this connection implements) | `Connection` | implicit via `resolveConnectorType(id)` (KV scan) | explicit column, backfilled once |
| Created-at, ordering | `Connection` | `connectors.created_at` | unchanged |
| Config values (incl. secrets) | `Connection` | `connector-config-<id>` KV | unchanged key, same shape |
| Synced data | `Connection` | `connector-data-<id>` KV | unchanged |
| Live status (configured/connected/error, counts, last sync) | `Connection` | `connector-status-<id>` KV | unchanged |
| Activity/audit log | `Connection` | `connector-log-<id>` KV | unchanged |
| Sync interval override | `Connection` | `connector-sync-intervals[id]` | unchanged |
| AI context (per-connector business rules) | **`ConnectorType`**, not `Connection` — see note | `connector-ai-context[id]` keyed by connection id today | recommend re-scoping to type id in a later, separate change (see Consequences); no change required for CORE-003 |

The AI-context row is flagged because it is the one place today's model is
arguably wrong in the *other* direction: the instructions a user writes
("how do I want Plane issues titled") almost always describe the *type*
(Plane in general), not one specific connection, yet it is keyed by
connection id and so has to be re-entered per extra connection. This ADR does
not change it — re-scoping AI context is CORE-003-adjacent cleanup, not a
blocker for it — but the table above records the distinction so a future
change doesn't have to re-derive it.

### Lifecycle

`ConnectorType.lifecycle` (`stable`/`beta`/`development`/`deprecated`)
describes the *package* — unchanged meaning, from the manifest.

`Connection` lifecycle is a separate, smaller state machine, already implicit
in the data and made explicit here only in name:

```
unconfigured → configured → connected
                    ↓            ↓
                  error ←────────┘
```

`configured` = `connector-config-<id>` is non-null (per-type `configured()`
predicate in `SIMPLE_CONNECTOR_SHAPE`, e.g. Outlook requires `clientId`).
`connected`/`error`/`offline` = `connector-status-<id>.status`, written by
each connector's own `test`/`sync` routes. No new states are introduced; this
section exists so CORE-003 has a name for what `effectiveConnectorStatus()`
(`server/routes/connectors.js:85`) already computes ad hoc.

### Identity and compatibility

**The wire format of a connection id does not change.** `gitlab` stays
`gitlab`, `gitlab2` stays `gitlab2`. `nextInstanceId()` keeps generating
`${typeId}${n}`. Every existing route —
`/api/connectors/gitlab`, `/api/connectors/gitlab2`, `/api/connectors/:id/*`,
`/api/connectors/:typeId/instances[/:instanceId]` — keeps the exact same
meaning and keeps working against installations that predate this ADR,
including ones with connections created before ADR-009 generalized instances
(the same bootstrap that already reconciles those, `bootstrapConnectorInstances()`
in `server/server.js:326`, needs no changes).

What changes is that "which type does this id implement" stops being
something every caller re-derives via `resolveConnectorType()` (a KV-map
scan) and becomes a stored fact, queried once. `resolveConnectorType(id)`
keeps existing as a function — its callers do not need to change — but its
implementation can become a lookup against the new column instead of a KV
scan, once the column exists.

New connections created after CORE-003 ships keep using the same
`${typeId}${n}` scheme. Introducing an independent id scheme (e.g. opaque
UUIDs) is explicitly deferred — see Out of scope.

### Secrets

This ADR does not implement a secret store (that is SEC-004, which depends on
this one). It defines the seam SEC-004 needs:

- Secret values keep living inside `connector-config-<id>` exactly as today.
  No data moves as part of CORE-003.
- `createConnectorStore()` (`server/core/services/connector-store.js`)
  becomes the single seam between a `Connection`'s config and its storage.
  Every read of a connection's raw config (including secrets) already goes
  through `store.getConfig()`/`store.setConfig()` in every connector package
  — `resolveConnectorType(id)` is called first only to find the right
  `config.schema.json`, never to bypass the store. This means SEC-004 can
  later swap what backs `getConfig`/`setConfig` for secret fields
  specifically (e.g. delegate to the Bitwarden vault service instead of
  plain KV) without touching any of the 13 connector packages, as long as the
  store's public shape (`getConfig`/`setConfig`/`getPublicConfig`) stays the
  same.
- What must stay behind that seam, never returned by a public endpoint or
  written to a log: any field a `ConnectorType`'s `config.schema.json` marks
  `x-lintaya-secret`/`writeOnly`. This is already enforced by
  `publicConnectorConfig()` and `redactText()` and does not change here.

## Alternatives considered (persistence)

**A. Keep the current model as-is** — `connector-instances` KV map +
`connectors` SQL table with an implicit id, `resolveConnectorType()` as a KV
scan.

- No migration, zero risk to existing installations.
- But: no place to add connection-only fields without another parallel KV
  map (this is exactly how `connector-instances`, `connector-sync-intervals`,
  and `connector-ai-context` each came to exist separately); `connectorTypeId`
  stays implicit, recomputed on every read instead of stored; deleting a
  connection today already leaves `connector-data-<id>` and
  `connector-log-<id>` behind (only `connector-config-<id>` is cleared by
  `DELETE /api/connectors/:typeId/instances/:instanceId`) — a real cleanup
  gap that a KV-only model does nothing to prevent recurring elsewhere.

**B. Introduce a new, separate `connections` SQL table.**

- Gets explicit columns and real `WHERE connector_type_id = ?` queries.
- But: the existing `connectors` table already *is* 90% of a connections
  table (`id`, `name`, `created_at`, plus card-display fields). A second
  table would duplicate that identity and force every reader to join, for no
  benefit over extending the table that already plays this role.

**Recommendation: extend the existing `connectors` table, not a new one.**
Add one nullable column, `connector_type_id TEXT`, via a new versioned
migration entry (`server/core/database.js` already has a transactional,
versioned migration runner — `MAIN_MIGRATIONS`, `db.pragma("user_version")` —
used exactly this way for `repo_settings.pinned`). Backfill it for every
existing row with today's `resolveConnectorType(id)` logic, once, inside the
migration. `parseConn()` starts returning `connectorTypeId` as a real column
instead of a value computed per-request in `server/routes/connectors.js`
(the `type: resolveConnectorType(c.id)` line becomes redundant, not wrong —
removing it is a mechanical CORE-003 cleanup, not required to ship the
column). The `connector-instances` KV map can be retired once every row has
`connector_type_id` populated and every reader has switched to the column —
CORE-003 should keep both in sync for one release before removing the KV map,
so a rollback mid-migration doesn't lose the mapping.

This is the smallest change that gives `Connection` an explicit, queryable
`connectorTypeId` without a parallel storage system, and it reuses migration
machinery that already exists and is already tested — no new infrastructure,
consistent with this project's single-user, small-core scope.

## Incremental migration strategy (for CORE-003)

1. Add the `connector_type_id` migration (new `MAIN_MIGRATIONS` entry,
   version bump, backfill query using the current `resolveConnectorType()`
   logic). Purely additive — no route, response shape, or KV key changes yet.
2. Make `resolveConnectorType(id)` read the column first, falling back to the
   existing KV-scan logic only for rows somehow missing it (defensive, should
   never trigger post-backfill). Existing callers need no changes.
3. Update `parseConn()` to surface `connectorTypeId` from the column; keep
   emitting the existing `type` field (computed in
   `server/routes/connectors.js`) as an alias for one release so any UI code
   still reading `type` keeps working, then drop the alias once
   `app/connectors.jsx` reads `connectorTypeId` directly.
4. Retire the `connector-instances` KV map only after step 3 has shipped and
   been verified live against a real installation (same verification bar
   ADR-009 used) — until then it stays as a secondary source, kept in sync by
   `addConnectorInstance`/`removeConnectorInstance` exactly as today, so a
   partial rollout can't desync `nextInstanceId()` from reality.
5. Leave `connector-config-<id>` / `connector-data-<id>` / `connector-status-<id>`
   / `connector-log-<id>` untouched. Nothing about this ADR requires moving
   config, data, status, or secrets out of KV.
6. Fix the known cleanup gap (`connector-data-<id>`/`connector-log-<id>` not
   cleared on instance removal) as part of the same change, now that
   `Connection` deletion has one obvious place to do it correctly
   (`connector-store.js` or the DELETE route) instead of three ad hoc keys to
   remember.

Each step ships and is tested independently; none requires a maintenance
window, and any step can be the last one shipped in a given release without
leaving the system inconsistent.

## Consequences

- `CORE-003` (per the internal project roadmap) has a concrete, minimal
  target: one migration, one function's internals, one field alias — not a
  rewrite.
- `SEC-004` (per-connection secret store) gets a named seam
  (`connector-store.js`) to build on instead of having to invent one.
- `AGENT-001`/`AGENT-002` (action registry, MCP adapter) get an explicit
  `connectorTypeId` to key actions by type while still addressing a specific
  `Connection` by id — today's biggest ambiguity for that work.
- Existing installations, URLs, bookmarks, and any external tooling that
  calls `/api/connectors/gitlab2` directly keep working through and after the
  migration, with no re-auth, re-configuration, or downtime.
- The AI-context re-scoping question (type-level vs. connection-level) is
  named but deliberately left open — not part of CORE-003's exit criteria.
- This does not introduce multi-tenancy, RBAC, or a services split — a
  `Connection` still has exactly one implicit owner (the single user), same
  as every other record in this database.

## Out of scope

- Implementing the secret store itself (SEC-004).
- A canonical action registry / REST-as-canonical-contract for MCP (ADR-011).
- Renaming existing connection ids or moving to an opaque id scheme for new
  connections — the `${typeId}${n}` convention stays.
- Multi-tenancy, organizations, roles, or per-connection permissions —
  Lintaya remains single-user; `Connection` has no owner/ACL field.
- Making vCenter, Anthropic, UCS Manager, or Bitwarden instantiable — ADR-009
  already scoped that out per type, and this ADR does not revisit it.
- Retiring `connector-config-<id>`/KV as the config/data/status backing store
  — only the identity/metadata layer moves toward SQL, not the payload.
