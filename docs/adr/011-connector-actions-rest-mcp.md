# ADR-011: Action Registry and REST as the canonical contract

English | [Español](011-connector-actions-rest-mcp.es.md)

- Status: Accepted
- Date: 2026-08-23
- Precedes: AGENT-001/002 — completed 2026-08-25 with 13 ConnectorTypes
  piloted; server/mcp-server.js is now a pure HTTP client for
  /api/connectors/:id/actions/:actionId and existing GET routes, with no
  private SQLite connection.
- Depends on: ADR-010, SEC-004
- Enables: AGENT-001, AGENT-002, CLI write actions

## Context

Lintaya exposes connector capabilities through REST routes and also has an MCP
server. Those paths previously did not share a single catalog: MCP retained
vCenter and Bitwarden-specific logic, while REST held each operation's actual
semantics. That can produce differences in permissions, validation, auditing,
and secret handling.

Agents, the UI, and the CLI need to invoke the same operation against one
specific Connection, with the same contract and risk classification. An action
must be describable without exposing a connector's implementation or allowing
direct SQLite/Vault access.

## Decision

Lintaya has one Connector Action Registry. REST is the canonical execution
contract. MCP and CLI are thin adapters that discover and call REST actions;
they do not duplicate business logic or access SQLite, connector packages, or
secrets directly.

Each action belongs to a ConnectorType and executes against a concrete
Connection under ADR-010. At minimum it declares:

~~~json
{
  "id": "repositories.list",
  "connectorTypeId": "github",
  "effect": "read",
  "inputSchema": {},
  "outputSchema": {},
  "supportsCancellation": true
}
~~~

Effect is read, write, or destructive. Destructive actions must pass through
the Approval Center and fail closed unless valid approval exists for exact
parameters. DELETE is destructive regardless of a manifest declaration.

Every invocation validates input, resolves the Connection, applies
authentication and secrets server-side, normalizes errors, records safe actor
and result data, and returns output that matches its schema. Secret values never
appear in responses, events, or logs.

Authenticated discovery publishes available actions without exposing internal
routes, configuration values, or secrets. The registry can gradually adapt
existing routes; it does not require endpoint renames or breaking compatibility.

## Compatibility and migration

1. Define the registry and schemas without deleting current routes.
2. Migrate GitHub, GitLab, and Bitbucket read actions first.
3. Add write actions with auditing and human approval.
4. Adapt MCP to the REST registry and retire duplicated implementations.
5. Enable CLI writes only after the previous steps are complete.

Legacy routes remain adapters for at least one release.

## Consequences

- One operation has one permission and audit semantic.
- MCP and CLI stop duplicating sensitive logic.
- The UI can discover capabilities without provider-specific lists.
- Migration needs temporary adapters for current routes.
- The action contract must be versioned and tested as SDK behavior.

## Out of scope

- Implementing the Team server.
- Running repository code without a sandbox.
- Converting every existing route into an action in one change.
- Exposing secrets or letting MCP read the local database.
