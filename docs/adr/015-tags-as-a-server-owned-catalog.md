# ADR-015: tags are a server-owned catalog

English | [Español](015-tags-as-a-server-owned-catalog.es.md)

- Status: Proposed
- Date: 2026-09-06
- Deciders: Lintaya project

## Context

Tags exist in Lintaya, but not as data. The catalog lives in
`window.APP_DATA.TAGS`, a constant shipped in `app/public-data.js`, and editing
a tag writes the whole list back to `localStorage["hq_tags"]` in that one
browser. There is no `/api/tags`. A tag never reaches the server, never enters a
backup, and does not exist for the same user on a second machine or after
clearing site data.

What can carry a tag is narrower still. Passwords pick from the catalog and
persist in the `tags` column of `vault_items`. Devices have a `tags` field in
their API, but the form is a free-text comma-separated input; the strings it
produces are rendered through `TagPill`, which resolves an id against the
catalog and falls back to `{ id, label: id, color: "#78716c" }` when it finds
nothing. Typing `production` therefore yields a grey pill that looks like a tag,
shares no colour or category with one, and counts as no usage of one. Blocks,
Boards and Dashboards have no tags field at all, in their routes or their UI.

The usage counter compounds this: it scans `APP_DATA.PASSWORDS` and
`APP_DATA.DEVICES`, which are empty sample arrays in a public build, so the Tags
view reports zero uses however many real devices exist.

The result is a feature that reads as finished and is not. This ADR covers the
part that blocks everything else — where the catalog lives.

## Decision

The tag catalog becomes server-owned data, stored in the `kv` table under the
key `tags` and served by `/api/tags`, in the same shape Dashboards and Boards
already use. The browser stops being the system of record.

`kv` is backed up in full by `server/core/services/backup.js`, so this alone
makes tags survive a reinstall, move with a backup, and be the same on every
browser pointed at one instance.

The five defaults — Connection, Environment, Criticality, Ownership and Device
Type — are seeded on first read when the key is absent, so an existing install
and a fresh
one converge on the same catalog rather than the defaults being a client-side
constant that silently differs from stored data.

`localStorage["hq_tags"]` stops being written. It is read once, on first load
against an instance with no stored catalog, and uploaded — a tag someone created
in a browser is not lost by this change.

The tag id stays a slug derived from the label, and a category's values keep
their own ids, because both are already referenced by stored `vault_items.tags`
rows. Changing the id scheme would orphan every existing assignment.

## Consequences

Tags become ordinary Lintaya data: audited, backed up, exportable, and readable
by the CLI and by an agent through the same API as everything else. The Tags
view gains the failure modes of every other view — it can now be stale, or fail
to save — where before it could only be wrong.

This does not, by itself, let a Block, Board, Dashboard or Device carry a tag.
Those need a `tags` field on each record and a picker in each editor, and
Devices needs its free-text input replaced by that picker. That work depends on
this decision and is deliberately not part of it.

What a tag is *for* — filtering and search only, or grouping in the sidebar as
well — is also left open. The catalog does not need that answer; the pickers
will.
