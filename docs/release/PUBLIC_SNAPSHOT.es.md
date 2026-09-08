# Snapshot del repositorio público

[English](PUBLIC_SNAPSHOT.md) | Español

Estado: borrador para el primer repositorio público de Lintaya. Este documento
define la allowlist de un repositorio nuevo; no copia, borra, reescribe historial
ni rota credenciales.

## Objetivo

Publicar un repositorio Lintaya limpio e inicializado independientemente, con
fuente de producto, instrucciones reproducibles de desarrollo, archivos de
comunidad y sin datos de usuarios ni material operativo privado. Crear un
repositorio GitHub nuevo en lugar de fork, porque un fork conserva historial
original.

## Estructura pública propuesta

~~~text
lintaya/
├── .github/                 CI, Dependabot, issue forms, PR template
├── app/                     browser PWA views and API client
├── assets/                  reviewed brand and social assets
├── bitwarden/               reviewed examples only; no deployment secrets
├── cli/                     cross-platform command-line client
├── docs/                    public product, architecture, and contributor docs
├── icons/                   reviewed application icons
├── scripts/                 validation and repository-maintenance scripts
├── server/                  Express API, connector packages, tests, examples
├── .gitignore
├── .nvmrc
├── LICENSE
├── NOTICE
├── Lintaya.html
├── manifest.webmanifest
├── README.md
└── sw.js
~~~

## Incluir

| Ruta | Razón | Condiciones antes del primer commit público |
|---|---|---|
| app/, server/, cli/ | Fuente de producto, pruebas y contratos runtime. | Ejecutar escaneo de secretos; mantener datos runtime excluidos por .gitignore. |
| docs/, README*, SETUP*, ARCHITECTURE* | Documentación de usuarios y contribuidores. | Eliminar contexto operativo privado; declarar limitaciones beta correctamente. |
| .github/, scripts/ | Validación reproducible y flujo comunitario. | CI debe probar servidor y CLI en versiones Node soportadas. |
| LICENSE, NOTICE, CONTRIBUTING*, SECURITY*, SUPPORT*, CODE_OF_CONDUCT*, CHANGELOG.md | Base legal y comunitaria. | Confirmar titular final de copyright en NOTICE. |
| assets/, icons/ | Identidad de producto. | Confirmar origen, derechos de redistribución y archivos fuente. |
| bitwarden/ | Configuración de ejemplo y soporte de integración. | Incluir solo ejemplos/templates; inspeccionar cada archivo por datos específicos de despliegue. |
| .vscode/launch.json | Configuración pública opcional de depuración. | Excluir todo otro estado local de editor. |

## Excluir

| Ruta o clase | Razón |
|---|---|
| .git/ e historial del repositorio original | El repositorio nuevo comienza con un commit inicial revisado. |
| node_modules/, tmp/, *.log, *.err | Salida generada o runtime local. |
| server/*.db, archivos WAL/SHM, server/backups/, server/docs-files/, server/gitlab-clones/ | Datos de usuario, respaldos, uploads y repositorios de terceros clonados. |
| server/start-dev.js, server/vault-seed.js, bitwarden/settings.env, .env* | Credenciales locales y settings de despliegue. |
| .claude/, .mcp.json, estado/configuración personal de agentes | Estado local de herramientas y posibles credenciales. |

## Revisar antes de incluir

| Ruta | Decisión inicial | Revisión requerida |
|---|---|---|
| AGENTS.md y CLAUDE.md | Revisar | Conservar solo guía genérica de contribuidores; quitar supuestos locales y credenciales. |
| .cursor/ y .codex/ | Excluir por defecto | Publicar solo reglas, skills o ejemplos reutilizables sin estado de usuario; de lo contrario omitir carpetas. |
| Notas internas de handoff y herramientas privadas de evidencia | Excluir | Mantener fuera del snapshot público salvo que se reescriban deliberadamente como documentación pública. |
| assets/ e icons/ | Revisar | Registrar licencia, fuente y derechos de redistribución de cada asset no original. |
| bitwarden/ | Revisar | Confirmar que cada archivo trackeado es ejemplo y no contiene valores específicos de servidor. |
| docs/ | Incluir tras revisión | Quitar referencias personales, de cliente, VPN, hostname, IP y procesos internos. |

## Plan pendiente de preparación

Este es el plan priorizado acordado antes de crear el snapshot público. Se
registra aquí para dar continuidad; ninguno de estos pasos autoriza por sí solo
la publicación.

1. **Clasificar el grupo de revisión.** Inspeccionar `bitwarden/`, `assets/`,
   `icons/`, `AGENTS.md`, `CLAUDE.md`, `.cursor/` y `.codex/`. Registrar una
   decisión de incluir, excluir o redactar con
   evidencia para cada elemento.
2. **Rotar credenciales locales de desarrollo.** El responsable del proyecto
   debe revocar, reemplazar o clasificar explícitamente cada credencial usada
   mientras el workspace privado estuvo activo. Nunca copiar configuración
   runtime ignorada al nuevo repositorio.
3. **Separar la invalidación de caché de desarrollo de los cambios de fuente.**
   Hecho. El `sw.js` trackeado ahora lleva un marcador de posición y el servidor
   inyecta la llave real al servir `/sw.js`: la versión de release en producción
   y una huella de las fuentes del cliente en desarrollo, de modo que editar una
   vista retira la caché anterior sin reiniciar el servidor. Ver
   `server/core/services/sw-version.js`. Ningún flujo de desarrollo reescribe ya
   un archivo trackeado.
4. **Hacer localizable la documentación de release.** Enlazar esta política de
   snapshot y el proceso de release/versionado desde el índice público de
   documentación, preservando el par inglés/español.
5. **Conciliar el roadmap open source.** Actualizar su texto de decisiones
   obsoleto, conteos de conectores/blocks y estados de completitud para que
   distinga trabajo entregado de la puerta de release público pendiente.

## Puerta de release

El snapshot está listo para inicializarse solo cuando todos estos puntos sean
verdaderos:

- [ ] La allowlist tiene decisión para cada archivo y carpeta de primer nivel.
- [ ] Un escaneo del snapshot seleccionado no encuentra credenciales, bases,
  respaldos, hostnames privados, IPs internas ni datos personales.
- [ ] Toda credencial usada durante desarrollo fue rotada, revocada o confirmada
  como no productiva por el responsable del proyecto.
- [ ] El snapshot seleccionado pasa checks JSON, secretos, documentación
  bilingüe, servidor y CLI desde clon limpio en Node 22 y Node 24.
- [ ] La [política de cadena de suministro](SUPPLY_CHAIN.es.md) tiene escaneo
  de historial de secretos aprobado, SBOM SPDX conservado y ninguna
  vulnerabilidad runtime alta o crítica sin resolver.
- [ ] README e instrucciones setup funcionan solo con información pública.
- [ ] Licencia, titular de copyright NOTICE, derechos de assets y nombre de
  paquete/repositorio están confirmados.
- [ ] VERSION, server/package.json, notas de release CLI y CHANGELOG.md
  describen consistentemente la versión beta prevista.
- [ ] Limitaciones beta son explícitas: Approval Center/acciones destructivas,
  Team y ejecución sandbox de repositorios no son funcionalidades liberadas.
- [ ] Archivos seleccionados se revisan en worktree limpio antes del commit
  inicial.

## Procedimiento de publicación inicial

1. Crear un repositorio GitHub nuevo y vacío con el nombre público aprobado.
2. Copiar solo allowlist revisada a un directorio limpio separado.
3. Inicializar Git allí y ejecutar todos los checks de puerta de release.
4. Revisar el diff inicial resultante; no debe contener historial ajeno.
5. Hacer commit del snapshot revisado, push de rama por defecto y crear tag de
   pre-release claro como v0.1.0-beta.1.

No publicar hasta completar puerta de release. El proyecto privado original
sigue siendo workspace fuente hasta verificar el repositorio nuevo.
