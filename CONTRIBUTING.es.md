# Contribuir a Lintaya

[English](CONTRIBUTING.md) | Español

Son bienvenidas las contribuciones de código, documentación, pruebas,
analizadores, conectores y reportes de errores reproducibles.

## Antes de comenzar

- Lee la [arquitectura](ARCHITECTURE.es.md), el
  [checklist del snapshot público](docs/release/PUBLIC_SNAPSHOT.es.md) y el
  [proceso de release](docs/release/RELEASE_PROCESS.es.md).
- Busca issues existentes antes de abrir uno nuevo.
- Nunca incluyas credenciales, datos de repositorios privados, logs de producción,
  archivos de base de datos o documentos personales en una contribución pública.
- Reporta vulnerabilidades mediante [SECURITY.es.md](SECURITY.es.md), nunca en
  un issue público.

## Preparación de desarrollo

Lintaya soporta Node.js 22 y 24, con Node 24 como preferido. El frontend usa
React/JSX cargado en el navegador; el servidor, package lock y pruebas viven en
`server/`.

```bash
git clone <your-fork-url> lintaya
cd lintaya/server
npm ci
npm run check
```

Inicia con valores locales cuando necesites una aplicación en ejecución:

```bash
npm run dev
```

Para configuración, respaldos e integración opcional con vault, lee
[SETUP.es.md](SETUP.es.md). No reutilices secretos de desarrollo en un entorno
compartido o de producción.

## Checklist de cambios

1. Crea una rama enfocada desde la rama predeterminada actual.
2. Mantén los cambios revisables; no mezcles formato o refactors ajenos.
3. Agrega o actualiza pruebas proporcionales.
4. Desde `server/`, ejecuta `npm run check` y la suite específica relacionada
   con el cambio.
5. Actualiza la documentación, el par español/inglés correspondiente y su
   registro `.i18n.yaml`. Ejecuta `node scripts/verify-translation-pairing.mjs --recorded`.
6. Actualiza `CHANGELOG.md`
   cuando cambie un contrato de usuario o extensión.
7. Abre un pull request usando la plantilla del repositorio.

## Analizadores y conectores

El código de analizadores vive en `server/analysis/analyzers/`; la recolección
de hechos reutilizable vive en `server/analysis/inventory/`. Sigue
[`server/analysis/README.md`](server/analysis/README.md), incluye IDs de
hallazgos estables, evidencia, recomendaciones, fixtures y pruebas sin
dependencia de servicios privados.

Antes de implementar un conector, lee la
[`Guía de desarrollo de conectores`](docs/connectors/DEVELOPMENT_GUIDE.es.md) y
usa la [`Checklist de revisión de conectores`](docs/connectors/REVIEW_CHECKLIST.es.md).
Una propuesta de conector sustancial debe identificar primero proveedor,
autenticación, paginación, límites de tasa y capacidades necesarias.

Comandos útiles para ejecutar pruebas específicas desde `server/`:

```bash
npm run test:connectors
npm run test:analysis
npm run test:http
npm run test:routes
npm run test:core
```

## Revisión y licencia

Un pull request está listo cuando CI pasa, no contiene secretos ni datos
personales, conserva compatibilidad o documenta una migración, sus errores son
accionables y explica permisos o dependencias nuevas.

El núcleo abierto de Lintaya usa Apache License 2.0. Salvo acuerdo explícito
antes del envío, las contribuciones intencionales aceptadas se proporcionan bajo
esa misma licencia. No envíes código propietario o que no puedas licenciar.
