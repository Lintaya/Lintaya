# Outline

English | [Español](outline.es.md)

`outline` — Community, `beta` lifecycle, instantiable. Reads collections and
documents from an Outline wiki, and can create or delete documents.

## Configuration

| Field | Required | Secret | Description |
|---|---|---|---|
| `baseUrl` | Yes | No | Root URL of the Outline installation. |
| `apiKey` | Yes | Yes | Outline API key with the required collection and document permissions. |

## Capabilities

`collections.read`, `documents.read`, `documents.write`, `documents.delete`

## Actions

Registered in the Action Registry (ADR-011): `list-documents` (read),
`create-document` (write), `delete-document` (**destructive** — creates a
`pending-approval` request and only performs Outline's recoverable trash after
a local human approves it in Approval Center).

## Dashboard integration

One Home block: **recent-docs**. No dedicated module.
