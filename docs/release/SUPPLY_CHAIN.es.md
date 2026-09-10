# Política de cadena de suministro

[English](SUPPLY_CHAIN.md) | Español

Estado: preparación de release para el primer repositorio público de Lintaya.
La auditoría runtime local más reciente está limpia; aún faltan las revisiones
de historial, licencias, assets y snapshot.

## Controles

| Control | Alcance | Automatización | Expectativa de release |
|---|---|---|---|
| Baseline de secretos en archivos actuales | Archivos versionables del workspace | `scripts/check-secrets.mjs` en CI | Pasa sin rutas sensibles ni credenciales detectadas. |
| Escaneo de historial de secretos | Cada commit Git alcanzable | `gitleaks/gitleaks-action` con checkout completo | Pasa en el nuevo repositorio público. Rotar toda credencial expuesta incluso si su commit se elimina. |
| Revisión de dependencias y licencias | Cambios nuevos de dependencias runtime en pull requests públicos | GitHub Dependency Review | No hay vulnerabilidad alta/crítica nueva ni licencia denegada. Licencias desconocidas requieren revisión humana. |
| Auditoría runtime | Lockfiles de servidor y CLI | Reportes `npm audit` semanales, en push, pull request y manuales | No hay vulnerabilidad alta o crítica de producción sin resolver al liberar. |
| SBOM | Inventario completo de dependencias del repositorio | Artefacto SPDX Syft de `anchore/sbom-action` | Adjuntar el artefacto generado al registro del release candidato. |

El repositorio usa Apache-2.0. Dependencias nuevas bajo licencias copyleft fuerte
listadas en `.github/dependency-review-config.yml` quedan denegadas. Una licencia
desconocida o no cubierta por esa regla es tema de revisión legal, no aprobación
automática. Si el repositorio público pertenece a una organización GitHub en
vez de una cuenta personal, configurar su secreto `GITLEAKS_LICENSE` antes de
habilitar el escaneo de historial.

## Baseline actual

El baseline más reciente se midió el 2026-09-10 mediante auditorías runtime
solo de lockfile (`npm audit --omit=dev --audit-level=high`):

| Componente | Resultado | Estado de release |
|---|---|---|
| CLI | 0 vulnerabilidades | Limpio en este baseline. |
| Servidor | 0 vulnerabilidades | Limpio. |

El CLI y el servidor están limpios en este baseline. Mantener el umbral de
auditoría en severidad alta o más estricto y reejecutar audit tras cada cambio
de lockfile. Este resultado no sustituye el escaneo completo de secretos,
la generación del SBOM ni la revisión manual de licencias y assets requerida
para el snapshot público.

## Procedimiento de snapshot público

1. Ejecutar el escaneo de historial completo contra el repositorio fuente privado
   y rotar toda credencial que encuentre.
2. Crear el repositorio público nuevo desde el snapshot revisado; nunca hacer
   fork del privado ni copiar su directorio Git.
3. Confirmar que el escaneo de historial pasa contra el repositorio público nuevo.
4. Descargar los artefactos de audit de servidor y CLI y el SBOM SPDX de la misma
   ejecución; conservarlos con la decisión de release.
5. Completar la revisión manual de licencias, `NOTICE`, assets y documentación.
6. Crear el snapshot limpio sin `.git/` ni historial privado y verificarlo de
   forma independiente antes de publicarlo.
7. Crear el tag `v0.1.0-beta.1` en el repositorio público verificado.
8. Configurar branch protection para que el workflow Supply chain sea requerido
   cuando el repositorio sea público.

El job `npm-audit` publica el baseline limpio actual. Dependency Review evita
nuevos cambios riesgosos de dependencias runtime en pull requests públicos; la
puerta de release todavía exige que pasen el snapshot independiente, el escaneo
de historial, el SBOM y la revisión manual antes de publicar.
