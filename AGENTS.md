# AGENTS.md — guidance for AI agents

**Lintaya**: a PWA that unifies management and analysis of Git projects with operational modules,
Docker containers, a Bitwarden vault, apps, Plane, Outlook and an SSH console. Mini-server on LAN/VPN.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first (full system context). For installing/deploying,
see [`SETUP.md`](SETUP.md).

## Getting started

This file (`AGENTS.md`) **is not executed**. It's instructions for the agent.

In Cursor/VSCode: **Run and Debug** → *Express server (full app + API)* (F5). Once it's up, open the
integrated browser at http://localhost:3001. In Claude Code, start with that same preview config
(`node server/start-dev.js`), which defaults to port **3000**. Or from the terminal, from `server/`:

```bash
node start-dev.js
```

> **Different port on purpose** (`.vscode/launch.json` forces `PORT=3001` for Cursor, Claude Code
> uses the default `3000`): this lets you run both at the same time without a port clash. The
> tradeoff is that `http://localhost:3001` is a **new origin for the browser** → the `HQ_TOKEN`
> saved in `localStorage` on `:3000` doesn't apply there. The first time you open `:3001` the UI
> will look "empty" (401 on every `/api/*`) until you paste the `HQ_TOKEN` again in that tab — it's
> a one-time re-login, not missing data on the server (the SQLite file is the same for both ports).

`package.json` lives in `server/`, not at the repo root. Don't run `npm run dev` from the root (and
avoid `npm` when the path contains special characters — some npm commands choke on them).

## For AI agents

When connecting to a running Lintaya instance, start with:

```bash
# 1. Check server is alive (no auth needed)
curl http://localhost:3000/api/health

# 2. Get full context (no auth needed)
curl http://localhost:3000/api/ai-context
```

The `/api/ai-context` endpoint returns:
- Available endpoints grouped by category
- 11 connectors with their capabilities (read/write/sync)
- Authentication method (Bearer token)
- Usage examples
- Tips for working with the API

**Token location:** `server/start-dev.js` (look for `TOKEN = "..."`) or `server/personal-hq.db`.

## Rules for working here

- **No build step.** The frontend is `app/*.jsx` loaded via `<script type="text/babel">` from
  `Lintaya.html` (React + Babel in the browser). You edit and **reload** — there's no bundler.
- **Each `<script>` runs in its own scope.** Modules are exposed as `window.XxxView` and `app.jsx`
  (loaded last) consumes them. A new module: create `app/x.jsx` that does `window.XView = …`, add its
  `<script>` tag in `Lintaya.html` **before** `app/app.jsx`, and wire the route/sidebar entry in
  `app.jsx`. There's no `import` between modules: re-implement helpers or read them off `window`.
- **Backend = `server/server.js`** (an Express monolith, with the app factory + auth in
  `server/app.js`). State lives in a SQLite `kv` table (`kvGet`/`kvSet`). **The `app.get("*")`
  catch-all must stay last**, after every `/api/*` route — registering it earlier shadows them and
  they'll 404.
- **Auth:** every `/api/*` route requires `Authorization: Bearer ${HQ_TOKEN}` (except `/api/health` and `/api/ai-context`).
  Client: `window.HQ_API` (`app/api.js`).
- **API calls made by an AI agent** (rather than by the user from the browser) should include the
  header `X-Actor: <your model id>` (e.g. `claude-sonnet-5`, `claude-opus-5`, `gpt-5-codex` — the
  same id you identify yourself with, not a hardcoded value). Write routes wrapped in
  `auditWrite`/`auditActivity` store it as `meta.actor` and it shows up flagged in Logs →
  Connectors/Activity, to distinguish "an agent did this" from "the user did this". This applies
  especially to git actions (`stage`/`commit`/`fetch`/`pull`/`push`/`checkout`) done through the
  API instead of Bash — always prefer that API over `git` via Bash so the change gets audited just
  like any other write.
- **Connectors** follow the `config`/`test`/`sync` pattern + an entry in `/api/connectors/status`
  and UI in `connectors.jsx` (mirror an existing one, e.g. `portainer`/`outlook`). Every connector
  package also owns a `README.md` next to its `manifest.json` documenting that provider's API
  quirks, route table, and sync/caching behavior (see `server/connectors/community/plane/README.md`
  for a thorough example) — update it in the same change when you touch a connector's routes or
  sync logic, don't let it drift. **New connector definition of done:** read and complete
  [`docs/connectors/DEVELOPMENT_GUIDE.md`](docs/connectors/DEVELOPMENT_GUIDE.md) and
  [`docs/connectors/REVIEW_CHECKLIST.md`](docs/connectors/REVIEW_CHECKLIST.md). Preserve the
  ConnectorType/Connection boundary; never expose secrets; use native, labelled and keyboard-
  operable UI; do not make DOM or `data-*` attributes an agent contract; and use authenticated
  schemas/actions with `X-Actor` for agent-initiated operations. **Every remote mutation must be
  an Action Registry action with input/output schemas and an explicit `read`, `write`, or
  `destructive` effect.** A destructive action is the only place allowed to call the destructive
  provider API after an Approval Center approval; it must have a test proving the initial request
  is pending and makes no provider call. A compatibility route may only delegate to that action
  and return `202` — never issue a direct provider `DELETE` or bypass approval.
- **Committer identity**: commits made through the Repos git routes are signed with
  the per-connection identity stored in kv `connector-commit-identity` (edited from the
  connector's detail panel, "Commit identity"; env `GIT_COMMIT_IDENTITY` is the headless
  fallback). The server applies it with `git -c user.name/-c user.email`, so don't pass an
  author yourself and don't treat a connector's AI context as the place to state one —
  it's a structured setting precisely so an agent can't redefine who a commit came from.
- **Per-connector AI context**: before creating/editing data through a connector on the user's
  behalf (e.g. a Plane issue, a QPortal request), check
  `GET /api/connectors/:id/ai-context` (`{ content: "<markdown>" }`, empty string if none set) —
  it holds the user's own business rules for that connector (required fields, title/description
  format, state conventions, etc.), edited live from the connector's detail panel in
  `connectors.jsx` ("🤖 AI context" button), backed by kv `connector-ai-context = { [id]: markdown }`
  (`server/routes/connectors.js`, next to `sync-interval` — both moved out of the `server.js`
  monolith in the routers-by-domain migration). Treat it as **higher priority than the
  connector's own `README.md`** when the two conflict — the README documents the API, this documents
  what the user specifically wants done with it. It is empty by default; nothing changes for a
  connector that has none set.
- **Verification:** run/view the app through the harness's preview tooling instead of launching the
  server by hand via Bash.
- **Tests:** `cd server && npm test` (full suite). `npm run test:connectors` (connectors only).

## Gotchas (important)

- **VPN:** without it, some private-network connectors (`10.x`: vCenter, Plane, Portainer, Qportal,
  Bitwarden) time out.
- **Bitwarden vault:** reading passwords / SSH-with-credential requires the vault to be
  **unlocked** (master password, in-memory session). **Every server restart locks it again** →
  you'll need to unlock it again to test live.
- **OneDrive:** the repo lives under OneDrive → risk of corruption from concurrent writes. No
  development workflow rewrites a tracked file any more: the service worker's cache key is injected
  when the server serves `/sw.js` (`server/core/services/sw-version.js`), so `sw.js` showing up as a
  local modification means something is wrong, not a normal dev start.
- **Secrets:** `server/personal-hq.db`, `server/start-dev.js`, `server/vault-seed.js`,
  `bitwarden/settings.env` are gitignored. Don't commit them. There are `.example` files to
  recreate them.

## Cursor

This repo is also wired up for Cursor — an agent running there (or any other agent that wants to
know what auxiliary config exists) additionally has:

| What | Where | When it applies |
|---|---|---|
| Rules | `.cursor/rules/*.mdc` | always, or by glob |
| Agent | `.cursor/agents/lintaya.md` | when delegating Lintaya work |
| Skills | `.cursor/skills/` | when adding a module or connector |

## Common tasks

- **New module:** skill `add-frontend-module` — `app/x.jsx` → script tag in the HTML → `NAV_ROUTES` in `app.jsx`
- **New connector:** skill `add-connector` — package under `server/connectors/<tier>/<id>/` + UI in `connectors.jsx`
- **API route:** in `server/server.js` (or the connector's `routes.js`), always before the catch-all

## Key files

- `Lintaya.html` — load order of the `.jsx` files
- `app/*.jsx` — frontend modules (`window.XxxView`)
- `server/server.js` / `server/app.js` — API
- `server/connectors/` — integration packages
- `ARCHITECTURE.md` / `SETUP.md` — context and installation

## Commit conventions

- Project work goes to `main` (a single-dev personal repo).
- Messages end with: `Co-Authored-By: <Model name> <noreply@anthropic.com>` (or the matching
  credit if the agent is from another provider) — the same id you identify yourself with in
  `X-Actor`.
