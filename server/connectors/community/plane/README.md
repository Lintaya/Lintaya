# Plane.so connector

Projects, issues, modules and workspace members from a Plane instance (cloud or
self-hosted CE). Unlike the read-only connectors, this one **writes**: it creates
projects, issues, modules and comments, and moves issues between states.

## Base URL and the `/api/v1` prefix

Every path this connector builds already starts with `/api/v1`, so the stored
base URL must not include it. `normalizePlaneBaseUrl()` strips a trailing `/api`
or `/api/v1` on save.

This matters because of a behavior change on migration. The legacy code built
requests with `new URL(path, baseUrl + "/")`; since `path` starts with a slash,
that **replaced** the base URL's path. The SDK **concatenates** instead, so a
base of `https://host/api/v1` would now produce `/api/v1/api/v1/...`. Normalizing
on save makes both spellings work, and a reverse-proxied subpath
(`https://host/plane`) now survives instead of being silently dropped.

## Plane API quirks this handles

- **List responses come in two shapes.** Some endpoints return a bare array,
  others a paginated `{ results: [] }` envelope, varying by version. `planeList()`
  accepts either.
- **Issue lists carry a state id but no `state_detail`.** The state group
  (`completed`, `cancelled`, …) has to be resolved from a separate
  `/states/` call per project, which is why sync fetches states first.
- **There is no fixed "done" state id — nor a fixed "in progress" one.** Closing
  an issue means finding whichever state belongs to the `completed` group and
  patching to it (`no-completed-state-found` if none exists); starting one is the
  same lookup against the `started` group (`no-started-state-found`). Both hit
  `/states/` live rather than trusting anything cached, since state ids are
  per-project and not part of the synced issue/module shape.
- **Assignees who are not project members are silently dropped.** Add the member
  to the project first (`POST /projects/:id/members`), then assign.
- **A project identifier prefixes every issue key** (`ESID-1`) and must be
  uppercase; the create route upper-cases it for you.

## Pagination

`fetchAllIssues()` follows Plane's cursor until it reports no more pages.

This was **not** the original behavior, and the gap was silent: the connector
asked for `?per_page=100` and kept only that page, while the response still
looked like a complete list. It showed up in the live data as three projects
sitting at *exactly* 100 issues — the page size. Their issue lists were
incomplete and their `issueCount` was wrong.

Two safeguards:

- A deployment that omits `next_page_results` / `next_cursor` — older Plane
  versions do — exits after one page, exactly matching the previous behavior.
- `MAX_ISSUE_PAGES` caps the loop so a server that always claims another page
  cannot spin forever. Hitting the cap sets `truncated`, and `syncPlane()`
  returns `truncatedProjects` so a partial sync is visible rather than passing
  for a complete one.

## Ordering

`filterPlaneIssues()` sorts by priority, then by `updatedAt` descending.

An issue with a missing or unparseable `updatedAt` used to make the comparator
return `NaN`. That does not merely misplace the undated row — **it corrupts the
entire ordering**, because a comparator returning NaN gives the sort no
consistent relation to work with. `updatedAtValue()` now maps such issues to
`-Infinity`, keeping them last within their priority band while leaving the
comparator total.

No issue in the current data lacks the field, so this was latent rather than
active — but `normalizePlaneIssue()` copies `updated_at` straight through, so a
single Plane response omitting it would have been enough.

## Resilience

`syncPlane()` degrades rather than failing:

- `/users/me/` failing keeps whatever `userId` was already stored, so "my issues"
  survives a permissions blip.
- Members failing yields an empty picker, not a failed sync.
- A project the token cannot read reports `issueCount: 0` and the rest still sync.

Only the workspace `projects/` call is load-bearing; if that fails the sync fails.

## Cached reads

The `my-issues` block is available in the Board catalog when the connection is
configured and enabled. Home and Boards share the same task panel: assignee
selection, five-row pagination, priority/state labels, issue details, sync and
the completed-this-week list. Reads and sync target the selected connection,
including additional Plane instances. A disabled connection is excluded from
the catalog even if an already-open Home still displays its earlier data.

`GET /members`, `GET /issues` and `GET /modules` answer from the last sync with
no network call. `GET /modules` accepts an optional `?project=` to scope to one
project — there is no live "list modules" round trip anywhere in this connector,
only what the last sync cached, so an answer here is only as fresh as
`syncedAt`. `filterPlaneIssues()` holds the issues-side filtering logic and is
pure, so the branching is tested directly:

- Completed and cancelled issues are hidden unless `active=false`.
- An explicit `assignee` overrides `mine`.
- `mine` without a known viewer filters nothing.
- Sort is urgent → high → medium → low → none, then `updatedAt` descending; an
  unrecognized priority sorts last.
- `total` reports the full match count, not the page size.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /config` · `POST /config` | Configuration; the API key is never returned |
| `GET /probe?path=` | Debug: hits a raw path, reporting failure as data |
| `POST /test` | Lists projects, falling back to `/users/me/` on 401/403 |
| `POST /sync` | Projects, issues, members, modules; caches the viewer id |
| `GET /issues/:projectId/:issueId` | Live single-issue detail |
| `POST /issues/:projectId` | Create an issue |
| `PATCH /issues/:projectId/:issueId` | Update issue fields |
| `POST /issues/:projectId/:issueId/comment` | Add an HTML comment |
| `POST /issues/:projectId/:issueId/close` | Move to a `completed` state |
| `POST /issues/:projectId/:issueId/start` | Move to a `started` state |
| `DELETE /issues/:projectId/:issueId` | Creates a pending approval to delete an issue permanently |
| `POST /projects` | Create a project |
| `PATCH /projects/:projectId` | Update project fields (e.g. `description`, to record a cross-connector reference such as its GitLab repo) |
| `POST /projects/:projectId/members` | Add a workspace member to a project |
| `POST /projects/:projectId/modules` | Create a module |
| `PATCH /projects/:projectId/modules/:moduleId` | Update a module |
| `POST /projects/:projectId/modules/:moduleId/issues` | Bulk-add issues to a module |
| `GET /members` · `GET /issues` · `GET /modules` | Cached reads (`GET /modules` takes `?project=`) |

## Destructive-operation approval

`delete-issue` is the connector's only registered destructive action. Its
canonical route is `POST /api/connectors/:connectionId/actions/delete-issue`;
the historic `DELETE /issues/:projectId/:issueId` route delegates to that same
action for compatibility. Both return `202` with `pending-approval` and make no
Plane request until a local human approves the exact request in Approval Center.

The manifest continues to describe provider capabilities as strings. Effects
belong to the versioned Action Registry, where they are validated, audited and
covered by the approval gate. Closing or patching an issue remains a `write`
operation because it is reversible in Plane; a future organisational policy may
require review for selected write actions as well.
