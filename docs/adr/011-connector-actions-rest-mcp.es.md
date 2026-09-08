# ADR-011: registro de acciones y REST como contrato canónico

[English](011-connector-actions-rest-mcp.md) | Español

- Estado: Aceptado
- Fecha: 2026-08-23
- Precede: AGENT-001/002 — completados 2026-08-25 con 13 ConnectorTypes
  piloteados; server/mcp-server.js es ahora cliente HTTP puro de
  /api/connectors/:id/actions/:actionId y rutas GET existentes, sin conexión
  privada a SQLite.
- Depende de: ADR-010, SEC-004
- Habilita: AGENT-001, AGENT-002, acciones de escritura CLI

## Contexto

Lintaya expone capacidades de conectores mediante rutas REST y también tiene
un servidor MCP. Antes esos caminos no compartían un catálogo único: MCP
conservaba lógica específica de vCenter y Bitwarden, mientras REST contenía la
semántica real de cada operación. Eso puede producir diferencias en permisos,
validación, auditoría y manejo de secretos.

Agentes, UI y CLI necesitan invocar la misma operación sobre una Connection
concreta, con el mismo contrato y clasificación de riesgo. Una acción debe poder
describirse sin exponer la implementación de un conector ni permitir acceso
directo a SQLite/Vault.

## Decisión

Lintaya tiene un único Connector Action Registry. REST es el contrato canónico
de ejecución. MCP y CLI son adaptadores delgados que descubren y llaman acciones
REST; no duplican lógica de negocio ni acceden directamente a SQLite, paquetes
de conectores o secretos.

Cada acción pertenece a un ConnectorType y se ejecuta contra una Connection
concreta según ADR-010. Como mínimo declara:

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

Effect es read, write o destructive. Las acciones destructivas deben pasar por
Approval Center y fallar cerrado si no existe aprobación válida para parámetros
exactos. DELETE es destructivo sin importar la declaración del manifiesto.

Cada invocación valida input, resuelve la Connection, aplica autenticación y
secretos server-side, normaliza errores, registra actor y resultado seguros, y
devuelve output acorde a su schema. Valores secretos nunca aparecen en
responses, eventos o logs.

El descubrimiento autenticado publica acciones disponibles sin exponer rutas
internas, valores de configuración ni secretos. El registro puede adaptar rutas
existentes gradualmente; no exige renombres de endpoints ni rompe compatibilidad.

## Compatibilidad y migración

1. Definir registro y schemas sin eliminar rutas actuales.
2. Migrar primero acciones de lectura GitHub, GitLab y Bitbucket.
3. Agregar acciones de escritura con auditoría y aprobación humana.
4. Adaptar MCP al registro REST y retirar implementaciones duplicadas.
5. Habilitar escrituras CLI solo después de completar los pasos previos.

Las rutas legacy permanecen como adaptadores durante al menos una versión.

## Consecuencias

- Una operación tiene una semántica de permisos y auditoría.
- MCP y CLI dejan de duplicar lógica sensible.
- UI puede descubrir capacidades sin listas por proveedor.
- La migración requiere adaptadores temporales para rutas actuales.
- El contrato de acciones debe versionarse y probarse como comportamiento SDK.

## Fuera de alcance

- Implementar el servidor Team.
- Ejecutar código de repositorios sin sandbox.
- Convertir cada ruta existente en acción en un cambio.
- Exponer secretos o permitir a MCP leer la base local.
