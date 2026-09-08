# Conectar por CLI

[English](via-cli.md) | Español

Lintaya CLI es un cliente HTTP de Node.js multiplataforma para un servidor
Lintaya. Usa la API pública y un archivo de perfil local; nunca abre la base de
datos SQLite del servidor, carga paquetes de conector ni lee secretos de
conector.

## Configuración

Usa Node.js 22 o 24. Inicia Lintaya en una terminal:

```powershell
Set-Location server
node .\start-dev.js
```

Abre una segunda terminal en el repositorio:

```powershell
Set-Location cli
$env:LINTAYA_TOKEN = "your-token"
node bin/lintaya.js profile add local --url http://localhost:3000
node bin/lintaya.js health
node bin/lintaya.js status
```

`profile add` guarda la URL y el token bajo un nombre (`local`, `team-dev`, …)
para que los comandos siguientes no necesiten `--url`/`--token` de nuevo. Un
token nunca se acepta como argumento de línea de comandos plano — usa
`LINTAYA_TOKEN` o `--token-stdin`.

## Qué puede hacer hoy

```text
lintaya health
lintaya status
lintaya context
lintaya connectors <list|catalog|modules>
lintaya blocks <list|catalog|custom|show <id>>
lintaya boards list
lintaya api get </api/...>
lintaya tui
```

Los comandos con nombre son de lectura: conexiones, el catálogo de
ConnectorType, Bloques, Boards, Dashboards y aprobaciones pendientes. Para
escribir están `api post`, `api put` y `api delete` con la ruta completa, por
ejemplo `lintaya api post /api/home/custom-blocks --body-stdin`. Sincronizar no
se expone, y un lote de escrituras todavía no puede proponerse como una sola
aprobación. Agrega `--json` a cualquier
comando para obtener la respuesta completa en vez del resumen legible.

## Referencia completa

La lista completa de comandos, la gestión de perfiles, el autocompletado de
PowerShell y la TUI interactiva están documentados en
[`cli/README.es.md`](../../../cli/README.es.md).

## Qué sigue

Los comandos de escritura (`lintaya action run <tipo>.<acción> --connection
<id>`) estaban bloqueados esperando que existiera el Registro de acciones —
ahora existe (ver [Conectar por MCP](via-mcp.es.md) y
[ADR-011](../../adr/011-connector-actions-rest-mcp.md)), así que el soporte de
escritura en la CLI es lo siguiente, siempre bajo el mismo contrato
read/write/destructive que usa cualquier otro llamador.
