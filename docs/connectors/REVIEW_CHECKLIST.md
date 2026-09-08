# Connector review checklist

English | [Español](REVIEW_CHECKLIST.es.md)

Copy this list into the pull request and mark only items that were verified.

## Product and classification

- [ ] The ID is generic and contains no customer, region, site, or environment.
- [ ] The folder is community, enterprise, or development.
- [ ] Tier, lifecycle, and license were decided separately.
- [ ] The manifest declares only implemented capabilities.
- [ ] The version follows SemVer.

## Package

- [ ] Contains manifest, schema, entry point, client, routes, tests, and README.
- [ ] Uses package implementation mode.
- [ ] Imports shared services from connectors/sdk.
- [ ] Performs no network, write, timers, or processes on import.
- [ ] Provider logic does not live in server.js.

## Security

- [ ] Secrets are marked writeOnly and x-lintaya-secret.
- [ ] Config, responses, status, and logs never expose credentials.
- [ ] URLs and protocols are validated.
- [ ] Insecure TLS is not enabled by default.
- [ ] Timeout, cancellation, rate limits, and errors are normalized.
- [ ] Pagination, concurrency, and size have limits.
- [ ] Test and sync do not write remotely.
- [ ] Every remote mutation has an Action Registry action with schemas and an explicit effect.
- [ ] Each destructive action creates `pending-approval` before any provider call.
- [ ] No destructive route calls the provider directly; a legacy alias only delegates to the action and fails closed.

## Contracts

- [ ] Config/test/sync preserve the lifecycle contract.
- [ ] Data maps to the normalized model.
- [ ] Dates, IDs, nulls, and states use common formats.
- [ ] Cloud and self-hosted preserve their base path.
- [ ] Breaking changes include migration and appropriate versioning.

## Design and accessibility

- [ ] Logo, tier, lifecycle, and status are separate indicators.
- [ ] Each Connection is an article/card inside a labelled list; opening detail
  uses a native button rather than a clickable div.
- [ ] The form has labels, help, and actionable errors.
- [ ] Icon-only controls have accessible names and selected controls expose
  their state.
- [ ] Secrets are not shown again after they are saved.
- [ ] Loading, empty, success, and error are designed.
- [ ] It works with keyboard, visible focus, and screen reader.
- [ ] Each dialog has an accessible name, Escape, focus trap, and focus return.
- [ ] `data-lintaya-*` values are stable metadata only; they contain no
  secrets, prompts, private IDs, or serialized state.
- [ ] There is no overflow at 393 px and defined viewports were verified.
- [ ] Light/dark and reduced motion work correctly.

## Agent contract

- [ ] ConnectorType is owned by the manifest/registry and Connection owns its
  configuration, secret references, status, synchronized data, and name.
- [ ] The implementation does not treat HTML, CSS, visible text, or `data-*`
  attributes as an agent API.
- [ ] Agent-facing reads/writes use authenticated endpoints and documented
  schemas; writes use the Action Registry when applicable.
- [ ] An agent checks the Connection AI context before creating or editing data.
- [ ] Agent-initiated writes carry `X-Actor`, are audited, and respect action
  risk/approval policy.
- [ ] The agent recorded the connector's remote-operation inventory and read the mandatory Approval Center rule.
- [ ] Public discovery surfaces are tested to exclude private configuration,
  internal hostnames, user data, editable prompts, and secrets.

## Tests and documentation

- [ ] Manifest and JSON pass validation.
- [ ] Client and mapper have fictitious fixtures.
- [ ] Routes have tests without port, SQLite, or external network.
- [ ] There is an explicit secret-redaction test.
- [ ] npm run test:connectors passes.
- [ ] npm run check passes.
- [ ] Secret detection passes.
- [ ] README documents permissions, limits, TLS, and compatibility.
- [ ] Changelog and roadmap are current.
- [ ] The diff contains no changes unrelated to the connector.
