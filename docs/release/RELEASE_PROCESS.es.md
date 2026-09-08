# Proceso de release y versiones

[English](RELEASE_PROCESS.md) | Español

Estado: política para el primer repositorio público de Lintaya y releases
posteriores. La versión candidata actual de producto es 0.1.0-beta.1.

## Fuentes de versión

| Artefacto | Fuente de verdad | Política |
|---|---|---|
| Producto y servidor Lintaya | VERSION raíz y server/package.json | Ambos valores deben coincidir y usar Semantic Versioning. |
| CLI Lintaya | cli/package.json | Paquete SemVer publicable independientemente; documentar rango servidor compatible en sus notas de release. |
| Caché Service Worker | Inyectado al servir /sw.js desde server/core/services/sw-version.js | Marcador de invalidación de caché, nunca versión pública de producto o release. El sw.js trackeado sólo lleva un marcador de posición. |
| Backups, schemas y datos | Constantes locales/versiones schema | Formatos de compatibilidad, no releases de producto. |

Antes del primer release estable, usar prereleases SemVer. Por ejemplo,
0.1.0-beta.1 pasa a 0.1.0-beta.2 para otra beta y luego 0.1.0 cuando se
cumplan los criterios de release.

## Clasificación de cambios

| Cambio | Siguiente versión durante 0.x | Sección changelog |
|---|---|---|
| Security fix, defect fix, corrección documentación | Patch | Fixed, Security o Changed |
| Capability backwards-compatible | Minor | Added o Changed |
| API pública, configuración o migración datos incompatible | Minor durante 0.x; anunciar migración | Changed y notas Migration |
| Refactor interno sin efecto usuario | No release por sí solo | Omitir salvo que cambie soporte o compatibilidad |

## Reglas de changelog

CHANGELOG.md sigue Keep a Changelog. Trabajo visible al usuario se agrega bajo
Unreleased en el mismo cambio que lo implementa. No agregar hashes de commits,
hostnames privados, credenciales ni detalles de incidentes internos.

Usar estas secciones solo cuando apliquen:

- Added
- Changed
- Deprecated
- Removed
- Fixed
- Security

Al hacer release, mover entradas Unreleased a heading de versión con fecha.
Mantener enlaces de comparación al final cuando existan URL de repositorio
público y tag previo.

## Procedimiento de release

1. Elegir versión producto y, si se libera CLI, versión CLI.
2. Actualizar VERSION y server/package.json juntos; actualizar metadata CLI
   solo cuando cambie su paquete publicado.
3. Mover entradas Unreleased user-facing completas al nuevo heading CHANGELOG.
4. Ejecutar puerta release de PUBLIC_SNAPSHOT.md, incluidos checks de clon limpio.
5. Ejecutar node scripts/check-release-version.mjs, validación documentación,
   checks servidor y checks CLI.
6. Revisar diff completo y confirmar que no incluye datos runtime, logs, settings
   locales ni secretos.
7. Hacer commit con mensaje release, crear tag Git anotado y push de rama por
   defecto más tag solo después de revisión.
8. Crear pre-release o release GitHub con notas copiadas del changelog.

## Ejemplo de cambio de versión

~~~text
VERSION                         0.1.0-beta.1 -> 0.1.0-beta.2
server/package.json             0.1.0-beta.1 -> 0.1.0-beta.2
cli/package.json                unchanged unless the CLI itself is released
CHANGELOG.md                    Unreleased -> [0.1.0-beta.2] - YYYY-MM-DD
Git tag                         v0.1.0-beta.2
~~~

## Límite de automatización

CI valida sintaxis de versión, alineación producto/servidor, suite servidor y
suite CLI. No crea tags, publica paquetes npm, rota credenciales ni crea release
GitHub. Esas acciones requieren decisión humana explícita de release.
