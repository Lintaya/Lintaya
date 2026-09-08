# Outline connector

This Community connector integrates a hosted or self-hosted Outline knowledge
base. The package owns configuration, connection testing, synchronization, and
the existing document read/write routes.

## Lifecycle and license

- Product tier: `community`
- Lifecycle: `beta`
- License: `Apache-2.0`

The configured URL is the root of the Outline installation. API calls are POST
requests under `/api` and authenticate with a bearer API key. Self-hosted base
paths are preserved.

The client temporarily preserves legacy support for private or self-signed TLS
certificates. This compatibility behavior must become explicit and opt-in
before the connector can move from beta to stable.

## Files

- `manifest.json`: product metadata, lifecycle, and capabilities.
- `config.schema.json`: public configuration contract; `apiKey` is write-only.
- `client.js`: HTTP client, bounded pagination, and normalized data mapping.
- `routes.js`: lifecycle and document route registration.
- `index.js`: package entry point used by the server composition root.
- `*.test.js`: client and route tests without network or SQLite.

## Public routes

- `GET|POST /api/connectors/outline/config`
- `POST /api/connectors/outline/test`
- `POST /api/connectors/outline/sync`
- `GET /api/connectors/outline/documents/:id`
- `POST /api/connectors/outline/documents`
- `PATCH /api/connectors/outline/documents/:id`
- `POST /api/connectors/outline/documents/:id/delete` (legacy compatibility
  alias; returns `202 pending-approval`)

Document deletion is an Outline recoverable trash operation rather than a
permanent provider delete. Both the canonical action
`POST /api/connectors/outline/actions/delete-document` and the legacy route
create the same Approval Center request. Neither makes a provider call until a
local human approves that exact request through `POST /api/approvals/:id/approve`.
