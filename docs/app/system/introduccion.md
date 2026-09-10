# System

English | [Español](introduccion.es.md)

The **System** section contains the operational configuration and audit tools
that support the rest of Lintaya. It is separate from product areas such as
Devices, Blocks, Boards, and Dashboards.

## Connectors

**Connectors** stores the integrations that Lintaya can use. A connector type
describes a provider; a configured connection supplies its URL, credentials,
and provider-specific settings.

From this page you can:

- inspect the connector catalog and its capabilities;
- configure, test, enable, or disable a connection;
- review connector activity and synchronization state;
- open the connector's blocks and modules when it exposes them.

Secrets are stored through the server's protected configuration path and are
not displayed in connector lists. A connector must be configured before its
provider-backed blocks or actions appear in the application.

## Tags

**Tags** is the shared catalog used to classify Devices, Blocks, Boards, and
Dashboards. Create a tag once, then select it while editing the supported
resource. Deleting a tag removes it from the catalog; it does not delete the
resources that used it.

## Logs

**Logs** provides operational history. The SSH view lists recorded terminal
transcripts and lets you inspect a session's activity. Connector activity is
recorded with the operation, result, request context, and actor where
available. Logs are for review and troubleshooting; they are not a replacement
for provider-side audit retention.

## Approvals

**Approvals** is the review queue for actions that require confirmation before
they can call a destructive provider operation. A pending approval does not
execute the provider request. Review the action and its parameters, then
approve or reject it according to your operating process.

The current beta is intended for a single local administrator. Team workflows,
delegated approval, and sandboxed repository execution are not release
features yet.

## Related configuration

System settings also include the local profile, appearance, language, and
other application preferences. These preferences are local to the Lintaya
instance and do not replace connector configuration or provider permissions.

For the complete Settings reference, see [Settings](ajustes.md).
