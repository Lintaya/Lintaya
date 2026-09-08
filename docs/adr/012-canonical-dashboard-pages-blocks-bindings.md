# ADR-012: canonical dashboard and the Pages, Blocks, and Bindings contract

English | [Español](012-canonical-dashboard-pages-blocks-bindings.es.md)

- Status: Accepted
- Date: 2026-08-23
- Depends on: ADR-010
- Enables: UX-005, UX-006, CONN-016 expansion

## Context

Lintaya has two dashboard experiences: original Home and Home 2. They maintain
different catalogs and persistence, while connector blocks coexist with
provider-specific JSX panels. A new block then has to join more than one
catalog, and the user has no unambiguous place to keep a layout.

A full page must also be distinct from an embedded block:

- A Block is a compact, read-only feed with a shared renderer.
- A Page is navigable surface with its own layout and state.
- A Binding connects declared inputs and outputs between blocks or page state;
  it does not use an implicit global event bus.

## Decision

Home is Lintaya's canonical dashboard. Home 2 remains a compatibility alias
during migration and receives no new capabilities. The canonical block catalog
and layout live behind one Page/Block/Binding model and one page persistence.

Migration is gradual:

1. Inventory layouts, widgets, and endpoints in Home, Home 2, and Blocks.
2. Define BlockDefinition, BlockInstance, PageInstance, and Binding with stable
   IDs, input/output schemas, and contract version.
3. Keep read/write adapters for old endpoints.
4. Migrate GitLab, Outline, Plane, Qportal, and vCenter blocks first, plus local
   notes and widgets.
5. Migrate remaining manual panels to the renderer or explicit modules.
6. Redirect Home 2 to the canonical dashboard after data migration completes.

A PageInstance may have layout density or variant, but it is not a second
functional dashboard definition. Full connector modules remain their own pages
and are not artificially converted into blocks.

## Minimum contract

~~~json
{
  "pageId": "home",
  "blocks": [{ "id": "vcenter-alerts", "definition": "vcenter.alerts" }],
  "bindings": [],
  "version": 1
}
~~~

Definitions declare capability, title, renderer, input schema, and output
schema. Instances hold only presentation configuration and safe references;
never secrets or executable code.

## Consequences

- There is one place to add, remove, order, and persist widgets.
- Home 2 stops growing as a parallel architecture.
- Connectors can publish blocks without editing several central catalogs.
- Temporary compatibility requires adapters and a layout migration.
- Table/dashboard density is a presentation variant, not another product.

## Out of scope

- A block marketplace.
- Loading executable code from manifests or the network.
- The Desktop HUD.
- Implicit communication through a global event bus.
