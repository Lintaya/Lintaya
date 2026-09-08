# Primeros pasos

[English](introduccion.md) | Español

Lintaya es una PWA local-first servida por el servidor Node.js de este
repositorio. El servidor posee el estado local y la configuración de
conectores; cualquier otro llamador — el navegador, la CLI y MCP — habla con
él solo a través de su API HTTP y nunca abre la base de datos local
directamente.

## Formas de conectarte

| | Para qué sirve | Configuración |
|---|---|---|
| **Web** | El dashboard en sí — Home, Boards, Connectors, Vault | Esta página, más abajo |
| **CLI** | Acceso por terminal o scripts: perfiles, salud, conectores, bloques, Boards, Dashboards y escritura mediante `api post/put/delete` | [Conectar por CLI](via-cli.es.md) |
| **MCP** | Dar a un agente de IA (como Claude Code) acceso de herramientas a tus conectores | [Conectar por MCP](via-mcp.es.md) |

Los tres son llamadores delgados sobre el mismo servidor: ven las mismas
conexiones, los mismos datos sincronizados y (para las acciones) el mismo
contrato read/write/destructive — ver
[ADR-011](../../adr/011-connector-actions-rest-mcp.md).

## Ejecutar localmente

Instala Node.js 22 o 24, luego ejecuta el servidor desde el repositorio:

```powershell
Set-Location server
npm ci
Copy-Item start-dev.example.js start-dev.js
node .\start-dev.js
```

Abre la URL Local que imprime el servidor, normalmente http://localhost:3000.
Define un HQ_TOKEN robusto en start-dev.js, que está ignorado por Git, antes de
usar un conector real.

## Primera sesión de navegador

Lintaya solicita el token API de servidor en Settings. El almacenamiento del
navegador es por origen, por lo que un puerto distinto solicita otra vez el
mismo token. GET /api/health y GET /api/ai-context están disponibles para
descubrimiento; las demás rutas API requieren el token Bearer.

## Primer conector

Abre Connectors, selecciona un tipo de conector registrado, crea una conexión,
guarda su configuración y luego usa Test y Sync. Los datos de un conector solo
están disponibles cuando existen proveedor, credenciales y acceso de red.

No pongas tokens, archivos de base de datos, respaldos, exportaciones de vault o
hostnames internos en un issue, screenshot o commit. Lee
[SETUP.es.md](../../../SETUP.es.md) para guía de Secret Store y respaldos.
