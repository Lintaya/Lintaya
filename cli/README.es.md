# ⛯ CLI de Lintaya

[English](README.md) | Español

El CLI de Lintaya es un cliente HTTP Node.js multiplataforma para un servidor
Lintaya. Usa la API pública y un archivo local de perfil; nunca abre la base
SQLite del servidor, carga paquetes de conectores ni lee secretos de conectores.

## Primer uso

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

Ejecuta el comando de ayuda sin servidor:

```powershell
node bin/lintaya.js --help
```

Usa una URL plana como http://localhost:3000, no un enlace Markdown. En macOS o
Linux, define LINTAYA_TOKEN con export. Al publicarse en npm, instalar
@lintaya/cli globalmente expondrá lintaya en Windows, macOS y Linux.

### Autocompletado PowerShell

Carga el autocompletado una vez por sesión PowerShell desde la raíz del repo:

```powershell
Invoke-Expression ((& node .\cli\bin\lintaya.js completion powershell) -join "`n")
```

Agrega el shortcut lintaya y completado Tab para comandos, subcomandos y
referencias conocidas de conector o bloque.

## Perfiles y manejo de token

- profile add, profile list, profile use y profile remove administran servidores
  con nombre como local, team-dev y team-prod.
- Nunca se acepta un token como argumento de línea de comandos. Usa
  LINTAYA_TOKEN o --token-stdin al agregar un perfil.
- LINTAYA_TOKEN sobrescribe temporalmente un token guardado. LINTAYA_CONFIG_PATH
  selecciona otro archivo de configuración para pruebas o automatización.
- El archivo de configuración es por usuario: AppData en Windows, Application
  Support en macOS y XDG_CONFIG_HOME o .config en Linux.

Los permisos de archivo locales se restringen cuando el sistema operativo lo
permite. La integración nativa con administradores de credenciales es trabajo
futuro; no trates el archivo de perfil como reemplazo de un secret manager del
sistema operativo.

## Referencia de comandos

```text
# Profiles and shell integration
lintaya profile add <name> --url <url> [--token-stdin]
lintaya profile list
lintaya profile use <name>
lintaya profile remove <name>
lintaya completion powershell

# Discovery and dashboard data
lintaya tui
lintaya health [--profile <name> | --url <url>]
lintaya status [--profile <name> | --url <url>]
lintaya context
lintaya connector <number>
lintaya connectors <list|catalog|modules>
lintaya connectors <schema|context> <id>
lintaya blocks <catalog|custom|show <id>>
lintaya block <number>
lintaya boards list
lintaya board <number>
lintaya pages list
lintaya search <query> [--limit <n>]

# Diagnostics
lintaya api get </api/...> [--profile <name> | --url <url>]
lintaya version
lintaya --help
```

El CLI lee Connections configuradas, entradas de catálogo ConnectorType, módulos,
Blocks y páginas Module Builder llamadas Boards. Context devuelve el mapa público
de capacidades para agentes. El comando api get acepta solo una ruta /api/ y
siempre escribe JSON crudo, útil para scripts.

Todas las operaciones actuales de servidor usan GET. El CLI no crea ni borra
conexiones, Blocks, Boards, tareas ni registros remotos de proveedor.

### Salida y JSON

Los resúmenes y tablas legibles son el valor predeterminado. Agrega --json cuando
una persona, script o agente necesite la respuesta completa.

```powershell
lintaya connectors list --json
lintaya blocks show gitlab.recent-commits --json
```

La salida humana intencionalmente no es un contrato estable para máquinas. Para
automatización de bajo nivel, usa --json o api get y valida la respuesta API
documentada.

### Atajos numéricos estables

Cada perfil mantiene números estables separados para Connections, Blocks y
Boards. Primero lista un recurso para asignar y mostrar su número y luego usa
la forma corta.

```powershell
lintaya connectors list
lintaya connector 1
lintaya blocks catalog
lintaya block 1
lintaya boards list
lintaya board 1
```

Los números son aliases locales del CLI, no IDs del servidor. Nunca se envían al
servidor, son independientes por tipo de recurso y no se reciclan al eliminar
un item. pages list sigue siendo una forma compatible de boards list.

## TUI

En una terminal interactiva, lintaya sin comando y lintaya tui abren el
dashboard de teclado hecho con [Ink](https://github.com/vadimdemedes/ink). Usa
flechas o j/k para seleccionar, r para refrescar y q o Escape para salir.

Presiona dos puntos para abrir el prompt de solo lectura. Signo de interrogación
abre ayuda, Tab completa un comando o identificador conocido y el panel de
resultado trunca salida grande. Ejecuta el comando normal equivalente para salida
completa. Administración de perfiles y setup de completion siguen siendo comandos
de terminal normal porque cambian estado local del CLI.

## Límite de agente y equipo

Pasa --actor <model-id>, o define LINTAYA_ACTOR, solo cuando un agente
identificado inicia una petición. El CLI lo envía como X-Actor para atribución
futura de auditoría; no concede permiso ni inventa una identidad.

`api post`, `api put` y `api delete` escriben en cualquier endpoint
documentado, siempre con la ruta completa. MCP, la sincronización entre
computadoras y las tareas de equipo siguen fuera de esta versión. También
proponer un lote de escrituras como una sola aprobación: las aprobaciones
cubren actions destructivas de conector, no la creación de recursos locales.
Consulta
[ADR-013](../docs/adr/013-cli-local-and-team-boundary.es.md).
