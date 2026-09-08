# Outline

[English](outline.md) | Español

`outline` — Community, ciclo de vida `beta`, instantiable. Lee colecciones y
documentos desde un wiki de Outline, y puede crear o borrar documentos.

## Configuración

| Campo | Requerido | Secreto | Descripción |
|---|---|---|---|
| `baseUrl` | Sí | No | URL raíz de la instalación de Outline. |
| `apiKey` | Sí | Sí | API key de Outline con los permisos de colección y documento requeridos. |

## Capacidades

`collections.read`, `documents.read`, `documents.write`, `documents.delete`

## Acciones

Registradas en el Registro de acciones (ADR-011): `list-documents` (read),
`create-document` (write), `delete-document` (**destructive** — crea una
solicitud `pending-approval` y solo mueve el documento de Outline a la papelera
recuperable cuando una persona local la aprueba en Approval Center).

## Integración con el dashboard

Un block de Home: **recent-docs**. Sin módulo propio.
