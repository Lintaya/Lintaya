# Tutorial: adding an example provider

English | [Español](EXAMPLE_PROVIDER_GUIDE.es.md)

This tutorial adds a fourth, fictional SCM provider, `acme-scm`, without editing
`server/server.js`, `app/connectors.jsx` or `Lintaya.html`. The example starts
in `development`, uses the schema-generated form, and needs no real account to
be tried out.

Before starting, read the
[development guide](DEVELOPMENT_GUIDE.md) and complete the
[review checklist](REVIEW_CHECKLIST.md).

## 1. Create the package

Create this structure:

```text
server/connectors/development/acme-scm/
|-- manifest.json
|-- config.schema.json
|-- index.js
|-- client.js
|-- routes.js
|-- actions.js
|-- client.test.js
|-- routes.test.js
`-- README.md
```

The ID is stable and describes the provider, not a particular connection. An
installation called "Acme production" will be a `Connection` of type
`acme-scm`; no second ConnectorType such as `acme-prod` is created.

## 2. Declare the manifest

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "acme-scm",
  "displayName": "Acme SCM",
  "version": "0.1.0",
  "tier": "development",
  "lifecycle": "development",
  "license": "Apache-2.0",
  "capabilities": ["repositories.read", "commits.read"],
  "implementation": {
    "mode": "package",
    "source": "server/connectors/development/acme-scm/index.js"
  },
  "instantiable": true
}
```

The registry discovers the manifest at start-up, checks that `tier` matches the
folder, and exposes its metadata to the catalog. No manual list is added to the
frontend.

## 3. Define configuration and secrets

`config.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://lintaya.dev/schemas/connectors/acme-scm-config-v1.json",
  "title": "Acme SCM configuration",
  "type": "object",
  "additionalProperties": false,
  "required": ["baseUrl", "token"],
  "properties": {
    "baseUrl": { "type": "string", "format": "uri" },
    "token": {
      "type": "string",
      "minLength": 1,
      "writeOnly": true,
      "x-lintaya-secret": true
    }
  }
}
```

With this schema, **New connection** generates the form without editing
`app/connectors.jsx`. `GET /config` returns `hasToken`, never the token.

## 4. Implement the client and pagination

`client.js` uses only the SDK's public boundary, and it receives it: the host
hands it over in the connector context, so `routes.js` passes it down through
the options these functions already accept. A module-level
`require("../../sdk")` works inside the repository and breaks the moment someone
installs the connector outside it — see section 8 of the
[development guide](DEVELOPMENT_GUIDE.md).

```js
function acmeRequest(config, path, options = {}) {
  const { buildHttpUrl, collectPages, requestJson } =
    options.sdk || require("../../sdk");
  return requestJson({
    baseUrl: config.baseUrl,
    path,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      "User-Agent": "lintaya"
    }
  });
}

async function listRepositories(config, { request = acmeRequest } = {}) {
  const page = await collectPages({
    initialCursor: 1,
    maxPages: 10,
    fetchPage: cursor => request(config, `/repositories?page=${cursor}&limit=100`),
    getItems: response => Array.isArray(response?.items) ? response.items : [],
    getNext: response => response?.nextPage || null
  });
  return {
    projects: page.items.map(repository => ({
      id: String(repository.id),
      name: repository.name,
      path: repository.fullName,
      webUrl: repository.webUrl || null,
      cloneUrl: repository.cloneUrl || null,
      description: repository.description || "",
      defaultBranch: repository.defaultBranch || null,
      group: repository.namespace || null,
      topics: repository.topics || [],
      visibility: repository.private ? "private" : "public",
      language: repository.language || null,
      lastActivityAt: repository.updatedAt || null,
      pipelineStatus: null,
      openMRs: 0,
      lastCommit: null,
      deploymentCount: 0
    })),
    pagination: { projects: { pages: page.pageCount, truncated: page.truncated } }
  };
}

module.exports = { acmeRequest, listRepositories };
```

The `truncated` metadata is part of the synchronized result: hitting the limit
cannot be presented as a complete read. Provider errors propagate to the common
wrapper for normalization and redaction.

## 5. Register lifecycle routes

`routes.js` implements the conventional configuration, test and synchronization
routes using `createConnectorStore`, `createConnectorLogger` and
`guardAsyncRoute`. Take `github/routes.js` as a template and keep:

- injectable dependencies (`request`, `sync`, clock);
- `requireAuth` on every route;
- URL/config validation before saving;
- `store.getPublicConfig(["token"])` for safe reads;
- redacted status and logs on both success and failure;
- `test` and `sync` with no remote writes.

The public entry point `index.js` enables auto-registration:

```js
const client = require("./client");
const routes = require("./routes");

module.exports = {
  ...client,
  ...routes,
  register: (context, instanceId) =>
    routes.registerAcmeRoutes({ ...context, id: instanceId })
};
```

When Lintaya restarts, `connectors/loader.js` loads `register()` from
`implementation.source`. `server.js` is not modified.

## 6. Declare Actions

Create `actions.js` with closed schemas, at minimum:

```js
const EMPTY_INPUT = { type: "object", additionalProperties: false };
const STATUS_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: { status: { type: "string" } }
};

function registerAcmeActions({ registry, request }) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "acme-scm",
    title: "Check Acme SCM connection",
    effect: "read",
    inputSchema: EMPTY_INPUT,
    outputSchema: STATUS_OUTPUT,
    handler: async ({ services }) => {
      await request(services.store.getConfig(), "/user");
      return { status: "ok" };
    }
  });
}

module.exports = { registerAcmeActions };
```

Routes currently auto-register by manifest, while the Action inventory is
deliberately explicit. Add `registerAcmeActions()` to
`server/core/actions/bootstrap.js` and update the expected inventory in
`bootstrap.test.js`. This touches neither `server.js` nor the central frontend,
and it makes a new Action visible during security review.

Every remote mutation needs an Action. If it can delete, revoke, overwrite, or
is not clearly reversible, use `effect: "destructive"` and prove with a test
that the first attempt stays `pending-approval` without calling the provider.

## 7. Test without network or SQLite

Client tests inject `request` and use fake responses. They must cover two or
more pages, ordering, absence of duplicates, and truncation at the limit. Route
tests use `createRouteHarness()`:

```js
const { createRouteHarness } = require("../../sdk/test-harness");
const { registerAcmeRoutes } = require("./routes");

const createHarness = createRouteHarness(registerAcmeRoutes);
```

Verify at least:

- manifest loading and validation;
- public configuration with no secrets;
- auth, rate limit, timeout, cancellation and network error;
- mapping to the normalized model;
- full pagination and `truncated: true` when the guard is reached;
- Test/Sync and KV compatibility;
- an Action with an effect and closed schemas;
- logs and errors with no token.

Run from `server/`:

```bash
npm run test:connectors
npm run check
```

And from the root:

```bash
node scripts/check-ai-readability.mjs
node scripts/check-json.mjs
node scripts/check-secrets.mjs
git diff --check
```

## 8. Manual verification

1. Restart Lintaya.
2. Open **Connectors → New connection**.
3. Confirm that **Acme SCM** appears with tier Development.
4. Open it and check that the form comes from the schema.
5. Save fake data, or data from a test account.
6. Run Test and Sync; review status and Logs → Connectors.
7. Create a second Connection if `instantiable` is `true`, and confirm that
   configuration, secrets, status and data stay isolated.
8. Verify keyboard navigation, visible focus and a width of 393 px.

## 9. Definition of done

The example is complete when the package appears and can be configured with no
changes to `server.js`, `app/connectors.jsx` or `Lintaya.html`; all of its reads
and Actions have tested contracts; it leaks no secrets; it documents
permissions, limits and compatibility; and every repository check is green.
