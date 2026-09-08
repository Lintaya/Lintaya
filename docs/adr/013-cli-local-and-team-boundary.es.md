# ADR-013: CLI multiplataforma y frontera Local / Team

[English](013-cli-local-and-team-boundary.md) | Español

- Estado: Propuesta
- Fecha: 2026-08-22
- Decisores: Proyecto Lintaya

## Contexto

Lintaya hoy es una instalación local de un solo usuario. El proyecto necesita
un CLI para personas y agentes como Codex o Claude Code, y posteriormente
colaboración entre instalaciones locales mediante un servidor Team: tareas
ofrecidas/aceptadas, comentarios y revisiones sobre un artefacto Git. No debe
confundirse con sincronizar bases SQLite locales entre computadoras.

## Decisión

Crear un paquete cli/ independiente, distribuible por npm, con Node.js 22/24 y
sin dependencias de terceros en la primera versión. Su binario solo usa la API
HTTP documentada de una instancia remota.

~~~text
cli/
  bin/                 npm entry point (lintaya)
  src/                 parser, profiles, HTTP client, presentation
  test/                tests without a real Lintaya server
  README.md            installation and user contract

server/                local Lintaya: connectors, vault, SQLite, API
team/                  reserved until its auth, data, and API are designed
docs/adr/              compatibility and public-boundary decisions
~~~

El CLI nunca importa módulos server, abre personal-hq.db ni llama SDKs de
proveedores. Un perfil contiene URL y token API. Esto permite coexistir local,
team-dev y team-prod, y usar un solo binario en Windows, macOS y Linux.

La primera versión fue solo lectura: perfiles, health, status, contexto de
agente, descubrimiento de conectores, lectura blocks/pages y api get para
endpoints públicos documentados. Retuvo POST, PUT y DELETE genéricos hasta
ADR-011 y AGENT-001. Ambos llegaron, así que el CLI ahora también lee
Dashboards y aprobaciones, y escribe mediante api post, api put y api delete.
Cada escritura exige la ruta completa: el CLI no compone endpoints por ti, de
modo que el historial del shell registra exactamente contra qué se escribió.
Crear un Block, Board o Dashboard sigue yendo directo a su ruta REST — las
aprobaciones cubren actions destructivas de conector, no la creación de
recursos locales, así que un lote de creaciones todavía no puede proponerse
como una sola aprobación. Un actor se indica explícitamente mediante --actor o
LINTAYA_ACTOR; CLI nunca suplanta ni inventa identidad de agente.

Los tokens no son argumentos de línea de comando. Llegan mediante LINTAYA_TOKEN
o --token-stdin; archivo de perfil se guarda en configuración de usuario de
cada SO y restringe permisos cuando se soporta. Almacén nativo de credenciales
es la siguiente mejora antes de distribución pública amplia.

## Alias numéricos locales

Atajos numéricos (connector 1, block 1, board 1) son ergonomía local de perfil.
Se asignan establemente por tipo de recurso y se guardan solo en configuración
CLI; no son IDs API, no se mandan al servidor y no cambian datos Connector,
Block o Module Page. No se reciclan tras borrado ni se comparten entre perfiles
o instalaciones.

## Consecuencias

- **Fuente de verdad de código:** Git. Cambios Markdown/código viajan por
  commit, rama, PR o remoto Git, no sincronización Lintaya.
- **Fuente de verdad futura de coordinación:** servidor Team. Será dueño de
  espacios, miembros, roles, tareas, aceptación/rechazo, comentarios,
  notificaciones y auditoría. Un Lintaya local recibe oferta para que usuario
  acepte o rechace.
- **Agentes:** CLI y MCP futuro son clientes del mismo action registry
  (ADR-011). Agente local trabaja solo con autorización de usuario local;
  trabajo entrante nunca inicia automáticamente un agente remoto.
- **Conectores Enterprise:** ejecutan en servidor que los posee. CLI consume
  capabilities expuestas por API y nunca descarga paquetes/secretos desde otra
  computadora.
- **Licencia:** CLI puede seguir Apache-2.0 con core. Team alojado, soporte y
  conectores comerciales pueden distribuirse aparte sin cambiar licencia CLI.

## Alternativas descartadas

1. Poner CLI dentro de server/: acopla instalación, dependencias y ciclos de
   versión, y estimula acceso SQLite directo.
2. Sincronización P2P SQLite: crea conflictos, réplicas de secretos y auditoría
   ambigua. Git y servicio central resuelven cada frontera propia.
3. Permitir todo método HTTP desde inicio: un agente podría escribir sin
   clasificación de riesgo, confirmación ni auditoría canónica AGENT-001.

## Fuera de alcance

- Implementar servidor Team o tabla de tareas.
- Sincronizar configuración o AI context entre instalaciones.
- Worker que active Codex/Claude Code remotamente.
- Integración Keychain, Credential Manager o Secret Service.
- Implementación Action Registry y adaptador MCP (ADR-011, AGENT-001/002).
