# Índice de documentación de Lintaya

[English](INDEX.md) | Español

Usa esta página como punto de inicio para la documentación del repositorio. El
visor Documentation dentro de la app actualmente sirve las guías enfocadas bajo
docs/app; este índice también enlaza material operativo y de contribución del
repositorio.

## Usar Lintaya

| Guía | Úsala para |
|---|---|
| [Primeros pasos](app/get-started/introduccion.es.md) | Ejecutar un servidor local, ingresar el token y configurar una primera conexión. |
| [Bloques](app/block/introduccion.es.md) | Crear bloques Markdown y agregar bloques de conector. |
| [Tableros](app/module/introduccion.es.md) | Construir layouts persistentes desde zonas y bloques. |
| [Dashboards](app/dashboard/introduccion.es.md) | Agrupar Boards como tabs, reordenarlos y presentarlos a pantalla completa. |
| [SSH](app/ssh/introduccion.es.md) | Abrir terminales desde VMs, Dispositivos y Contenedores; entender sesiones concurrentes, credenciales, hosts de salto y transcripciones. |
| [Conectores](app/connectors/introduccion.es.md) | Configurar Connections y entender manifiestos ConnectorType. |
| [Contratos de conectores](connectors/CONTRACTS.es.md) | Comparar cada ConnectorType incluido: manifiestos, configuración, caché, sync y límites. |
| [CLI](../cli/README.es.md) | Leer Lintaya mediante perfiles, TUI, JSON y atajos numéricos estables. |

## Operar de forma segura

| Guía | Úsala para |
|---|---|
| [README](../README.es.md) | Alcance de producto, estado, puntos de entrada y licencia. |
| [Instalación](../SETUP.es.md) | Configuración local, Secret Store, Bitwarden, respaldo y recuperación. |
| [Arquitectura](../ARCHITECTURE.es.md) | Límites de ejecución, persistencia, conectores, Tableros y agentes. |
| [Seguridad](../SECURITY.es.md) | Reportar vulnerabilidades y proteger credenciales. |
| [Soporte](../SUPPORT.es.md) | Pedir ayuda sin exponer datos privados. |

## Extender Lintaya

El siguiente conjunto de referencia está migrando a documentación bilingüe:

- Guía de desarrollo y checklist de revisión de conectores.
- README de paquetes de conectores y vista previa del Connector SDK.
- Contratos de analizadores y guía de pruebas.
- OpenAPI y estándar de errores API.
- Decisiones de arquitectura Action Registry, MCP, CLI y Team.

Hasta completar esos pares, usa los documentos fuente en inglés bajo docs/,
server/ y server/connectors/.

## Decisiones y planificación del proyecto

| Guía | Úsala para |
|---|---|
| [ADRs](adr/) | Decisiones arquitectónicas aceptadas y propuestas. |
| [Política i18n](i18n/README.es.md) | Cómo se empareja y verifica documentación bilingüe. |

Un documento es autoritativo solo cuando describe código actual o está marcado
explícitamente como histórico. Actualiza ambos archivos de idioma y su registro
i18n en el mismo cambio.
