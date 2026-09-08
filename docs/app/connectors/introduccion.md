# Connectors

English | [Español](introduccion.es.md)

A ConnectorType is a product integration registered from a manifest. A
Connection is one configured instance of that type, with its own name, public
configuration, secret references, status, synchronized data, and activity.

## Create and operate a connection

1. Open Connectors and choose a registered connector type from the catalog.
2. Create or select its connection, enter the requested configuration, and save.
3. Use Test to verify credentials and provider reachability.
4. Use Sync to retrieve current provider data and inspect status or logs.

The configuration form is generated from the connector schema when possible.
Secret fields are handled by the configured Secret Store and are never returned
in ordinary configuration responses.

## Connector types and instances

The catalog currently classifies types by tier and lifecycle.

| Field | Meaning |
|---|---|
| Community | A general-purpose community integration. Shipped with Lintaya. |
| Enterprise | An integration intended for enterprise or internal systems. Installed separately. |
| Development | An integration still under active development. Installed separately. |
| Stable, beta, development, deprecated | Lifecycle signal for compatibility expectations. |
| Instantiable | The type allows additional configured connections. |

GitLab, GitHub, Bitbucket, Outline, Portainer, Qportal, Outlook, Outlook
Local, and Plane are instantiable. vCenter, Bitwarden, Anthropic, and UCS
Manager are intentionally single-instance types today.

Lintaya ships the community tier: see [Community
connectors](community/introduccion.md) for the full list.

The enterprise and development types are distributed in a separate connector
pack and installed into a directory outside the application. Their pages are not
here — they come with the connectors, and appear under **Installed connectors**
once the pack is installed. An installation without it simply does not list
them, and nothing is missing or broken.

That is deliberate. A page describing a connector that this repository does not
ship would be a copy: it would go stale the first time the connector changed,
and nobody reading it would know.

## What a manifest declares

Every type has a manifest.json owned by its connector package. The required
identity fields are manifestVersion, id, displayName, version, tier, lifecycle,
license, capabilities, and implementation.

Optional upstreamApi describes the provider and its supported-until date. Optional
blocks declare list feeds that can be added to dashboards. Optional modules
declare a connector-owned navigation view using id, label, icon, component, and
optional navOrder. A nearby config.schema.json describes configuration fields,
which ones are required, and which are secret.

A manifest describes metadata and safe declarative capabilities; it never sends
executable UI code to the browser.

## Context and safety

Each Connection can store AI context: user-maintained Markdown instructions for
agents working through that connection. It is business guidance, not a secret
store or authorization grant.

Deleting an extra Connection removes its connection-scoped local state and secret
entry. It must not be used to delete remote records unless a future approved
action explicitly asks for that operation.
