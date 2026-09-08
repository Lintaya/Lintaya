# Create a connector

English | [Español](crear-un-conector.es.md)


A connector is a folder. Lintaya finds it, reads its manifest, and calls one
function; there is no registration list to edit and no core file to touch.

## Decide where it lives

If the integration is generally useful and can be maintained in the open, it
belongs in `server/connectors/community/` of the Lintaya repository, and ships
with the product.

Anything else — bound to one organization's systems, or still changing shape —
belongs in the connector pack, a separate repository installed into
`~/.lintaya/connectors/`. That directory is flat: one folder per connector, no
tier folders, because a tier describes how the Lintaya repository organises what
*it* ships and there is nothing out there for a folder to agree with.

Nothing about the second case is second-class. The same manifest, the same
lifecycle, the same tests.

## What the folder holds

```text
acme/
├── manifest.json
├── config.schema.json
├── index.js
├── client.js
├── routes.js
├── actions.js
├── README.md
├── README.es.md
├── docs/
└── *.test.js
```

`manifest.json` is identity, tier, capabilities and whatever pages or Home
blocks the connector publishes. `config.schema.json` describes the credentials
form. `index.js` exports `register(context)`, the one convention the loader
looks for. `client.js` talks to the provider, `routes.js` mounts
`/api/connectors/acme/…`, and `actions.js` registers whatever the Action
Registry should expose.

The configuration form is generated from `config.schema.json`, so a connector
with ordinary credentials writes no UI at all.

## Write it down twice, for two readers

`README.md` and `README.es.md` are the connector's page. Lintaya renders them
under Connectors, and GitHub shows the English one when someone opens the
folder. Both show it first, so it holds what someone needs first: what the
connector does, what to configure, what it publishes, what it cannot do.

`docs/` is everything further — implementation notes, the reasoning behind a
non-obvious key, the bugs a migration fixed. Useful, and not what a reader needs
before anything else. Lintaya renders those too, nested under the connector.

A connector that ships with Lintaya puts its user-facing page in
`docs/app/connectors/community/` instead, because there is no installed folder
to read it from.

Both READMEs, always. A connector documented in one language is documented for
half the people who will run it, and the half left out is not the half writing
the code.

## The one rule that catches people

Everything shared arrives in the context Lintaya hands to `register()` — the
Connector SDK, `express`, the storage and logging helpers. Do not reach for them
with a relative `require`:

```js
function registerAcmeRoutes(options) {
  const { createConnectorStore, requestJson } = options.sdk;
  const { app, requireAuth, kvGet, kvSet } = options;
}
```

A connector installed outside the repository cannot resolve `../../sdk`, and
carrying a copy of the SDK would be worse than the broken path: it fronts the
process-wide secret store, so a second copy builds a second store and the
connector reads secrets the host never wrote — quietly.

## If it only runs on one system

Say so, and Lintaya will not offer it where it cannot work:

```json
{
  "os": ["win32"],
  "requires": "Outlook desktop installed and signed in on this machine"
}
```

The connector is not mounted on another platform, not scheduled for sync, and
its card explains what the machine would need instead of looking merely
disconnected. Omit `os` unless the connector is genuinely bound — almost none
are.

## Install and check

Copy or clone the folder into `~/.lintaya/connectors/` and restart. It appears
in Connectors, unconfigured; enter its credentials there. Removing the folder
removes the connector. An id that collides with one Lintaya already ships is
refused at startup, naming both manifests, so a folder in a home directory can
never quietly stand in for `github`.

## The full guide

This page is the shape of the work. The contracts, the naming rules, the
capability vocabulary, the pagination and error conventions, and the review
checklist live with the source, in `docs/connectors/` — start with
`DEVELOPMENT_GUIDE.md` and complete `REVIEW_CHECKLIST.md` before proposing one.
