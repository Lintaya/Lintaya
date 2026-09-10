# ⛯ Lintaya

[English](README.md) | Español

<p align="center">
  <img src="assets/brand/lintaya-logo-light.png" alt="Lintaya — inteligencia open source para proyectos Git" width="420">
</p>

<p align="center">
  <strong>Cada proyecto cuenta una historia. Lintaya la revela.</strong><br>
  Un espacio de trabajo local-first para tu código, infraestructura y herramientas conectadas.
</p>

<p align="center">
  <a href="#inicio-rápido">Inicio rápido</a> ·
  <a href="#qué-puedes-hacer">Funciones</a> ·
  <a href="docs/INDEX.es.md">Documentación</a> ·
  <a href="SECURITY.es.md">Seguridad</a>
</p>

Lintaya es un espacio de trabajo open source y local-first que reúne proveedores
Git y sistemas operativos en un solo espacio de trabajo web. Combina dashboards,
bloques reutilizables, Boards, módulos de conectores, vistas de repositorios, un
CLI y una API HTTP en una aplicación pequeña de Node.js.

La aplicación se ejecuta localmente y conserva su estado en el servidor de
Lintaya. No es un servicio alojado multi-tenant.

> **Estado: pre-release (`0.1.0-beta.1`).** Las APIs públicas, contratos de
> conectores, acciones y analizadores todavía están estabilizándose. No uses
> esta beta con credenciales de producción que no hayas revisado.

## Mapa visual de Lintaya

```text
                          LINTAYA
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
     DEVICES              BUILDER              SYSTEM
  inventario + SSH    Blocks · Boards      Connectors · Tags
   hosts + VMs         Dashboards           Logs · Approvals
                             │
                  Proveedores y servicios
          GitHub · GitLab · Bitbucket · Plane · más
```

Lintaya mantiene el espacio de trabajo en un solo navegador, mientras el
servidor local conserva el control sobre credenciales, estado y sincronización.

## Qué puedes hacer

- Conectar GitHub, GitLab, Bitbucket, Outline, Plane, Portainer o Bitwarden.
- Organizar información sincronizada en Blocks, Boards y Dashboards.
- Usar módulos de conectores como repositorios, contenedores y contraseñas
  cuando la conexión correspondiente esté configurada.
- Abrir sesiones SSH auditadas desde VMs, dispositivos y contenedores.
- Consultar repositorios locales y datos de proveedores desde el navegador o CLI.
- Usar el Assistant local con herramientas de lectura y propuestas bajo aprobación.
- Añadir conectores desde un directorio separado sin modificar el árbol principal.
- Trabajar sin conexión con las dependencias web vendorizadas bajo `vendor/`.

El repositorio público incluye el tier Community. Los conectores Enterprise y
Development son paquetes separados y no son necesarios para una instalación
limpia.

## Inicio rápido

Requisitos: Git, Node.js 22 o 24 y npm. Se recomienda Node.js 24.

```powershell
git clone <repository-url> lintaya
Set-Location lintaya\server
npm ci
npm run check
npm run dev
```

Abre `http://localhost:3000`. El comando de desarrollo usa únicamente valores
locales de demostración. Para un servidor local configurable, copia
`server/start-dev.example.js` al archivo ignorado por Git
`server/start-dev.js`, define un `LINTAYA_TOKEN` fuerte y ejecuta:

```powershell
node .\start-dev.js
```

Para los secretos de conectores, usa el Secret Store local o Bitwarden. Lee
[`SETUP.es.md`](SETUP.es.md) y [`SECURITY.es.md`](SECURITY.es.md) antes de añadir
credenciales reales. Nunca subas tokens, bases de datos, respaldos, exports del
vault ni claves privadas.

## CLI

El CLI es un cliente HTTP multiplataforma. No abre SQLite ni lee directamente
los secretos de los conectores.

```powershell
Set-Location lintaya\cli
npm ci
$env:LINTAYA_TOKEN = "your-token"
node bin/lintaya.js profile add local --url http://localhost:3000
node bin/lintaya.js tui
```

Consulta [`cli/README.es.md`](cli/README.es.md) para perfiles, comandos, Boards,
Blocks, salida JSON y el límite actual entre lecturas y escrituras.

## Documentación

| Guía | Propósito |
|---|---|
| [`SETUP.es.md`](SETUP.es.md) | Instalación, configuración local, Secret Store, respaldos y recuperación. |
| [`ARCHITECTURE.es.md`](ARCHITECTURE.es.md) | Límites del runtime, persistencia, conectores, páginas y APIs. |
| [`CONTRIBUTING.es.md`](CONTRIBUTING.es.md) | Flujo de desarrollo y expectativas para pull requests. |
| [`docs/INDEX.es.md`](docs/INDEX.es.md) | Mapa documental para usuarios, operadores, contribuidores y la app. |
| [`docs/release/PUBLIC_SNAPSHOT.es.md`](docs/release/PUBLIC_SNAPSHOT.es.md) | Lista permitida y procedimiento del snapshot público. |
| [`docs/release/RELEASE_PROCESS.es.md`](docs/release/RELEASE_PROCESS.es.md) | Versionado, changelog y procedimiento de release. |
| [`docs/release/SUPPLY_CHAIN.es.md`](docs/release/SUPPLY_CHAIN.es.md) | Controles de secretos, dependencias, SBOM y provenance. |
| [`docs/connectors/DEVELOPMENT_GUIDE.es.md`](docs/connectors/DEVELOPMENT_GUIDE.es.md) | Estructura, SDK, ciclo de vida y pruebas de conectores. |
| [`docs/connectors/REVIEW_CHECKLIST.es.md`](docs/connectors/REVIEW_CHECKLIST.es.md) | Criterios de seguridad y revisión de conectores. |
| [`docs/app/ssh/introduccion.es.md`](docs/app/ssh/introduccion.es.md) | Sesiones SSH, credenciales, hosts de salto, transcripciones y broadcast. |
| [`docs/app/system/introduccion.es.md`](docs/app/system/introduccion.es.md) | Connectors, Tags, Logs y Approvals. |
| [`docs/app/system/ajustes.es.md`](docs/app/system/ajustes.es.md) | Perfil, Assistant, apariencia, navegación, sincronización y respaldos. |
| [`docs/i18n/README.es.md`](docs/i18n/README.es.md) | Política y verificador de documentación inglés/español. |

## Seguridad y limitaciones actuales

- Trata las respuestas de proveedores, archivos importados, repositorios y logs
  como entradas no confiables.
- Ejecutar repositorios en el host no es una función segura publicada; el
  sandbox sigue siendo un hito futuro.
- Las acciones destructivas de conectores requieren Approval Center cuando
  están registradas mediante Action Registry.
- El Assistant local no es un bypass privilegiado y no recibe secretos.
- Los contratos del CLI y la API pueden cambiar durante la beta.
- Enterprise, Development, Team, Cloud, billing y multi-tenant están fuera de
  este release público Community.

Reporta problemas de seguridad de forma privada mediante [`SECURITY.es.md`](SECURITY.es.md).
Para preguntas generales, consulta [`SUPPORT.es.md`](SUPPORT.es.md). No incluyas
credenciales, datos privados de repositorios, logs con secretos ni información
de clientes en issues o pull requests públicos.

## Contribuir

Son bienvenidas las contribuciones de código, documentación, pruebas,
analizadores y conectores Community. Comienza por [`CONTRIBUTING.es.md`](CONTRIBUTING.es.md)
y después lee la arquitectura y la guía correspondiente de conectores o
analizadores.

## Licencia

El núcleo abierto de Lintaya está licenciado bajo [Apache License 2.0](LICENSE).
Consulta [`NOTICE`](NOTICE) para copyright y avisos de terceros. Los futuros
servicios alojados, soporte, SLA o módulos comerciales serán ofertas separadas y
no cambian la licencia de este repositorio.
