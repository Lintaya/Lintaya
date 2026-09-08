# Política de cadena de suministro

[English](SUPPLY_CHAIN.md) | Español

Estado: preparación requerida para el primer repositorio público de Lintaya.
Esta política inventaría riesgos; no trata un reporte de auditoría como una
remediación.

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

El baseline se midió el 2026-08-25 mediante auditorías runtime solo de lockfile:

| Componente | Resultado | Estado de release |
|---|---|---|
| CLI | 0 vulnerabilidades | Limpio en este baseline. |
| Servidor | 14 vulnerabilidades: 10 altas, 1 moderada, 3 bajas | Bloqueado. Varios hallazgos altos son transitivos a la dependencia directa `@bitwarden/cli`. |

No suprimir estos hallazgos con excepciones amplias de audit ni un umbral menor.
Crear un issue de remediación que registre ruta de dependencia, versión corregida,
prueba de compatibilidad y cualquier excepción humana aprobada con vigencia
limitada. Reejecutar audit tras cada cambio de lockfile.

## Procedimiento de snapshot público

1. Ejecutar el escaneo de historial completo contra el repositorio fuente privado
   y rotar toda credencial que encuentre.
2. Crear el repositorio público nuevo desde el snapshot revisado; nunca hacer
   fork del privado ni copiar su directorio Git.
3. Confirmar que el escaneo de historial pasa contra el repositorio público nuevo.
4. Descargar los artefactos de audit de servidor y CLI y el SBOM SPDX de la misma
   ejecución; conservarlos con la decisión de release.
5. Resolver todo hallazgo runtime alto o crítico antes de taggear una beta pública.
6. Configurar branch protection para que el workflow Supply chain sea requerido
   cuando el repositorio sea público.

El job `npm-audit` publica intencionalmente un reporte baseline aunque haya
hallazgos conocidos. Dependency Review evita nuevos cambios riesgosos de
dependencias runtime en pull requests públicos; la puerta de release impide
publicar con los hallazgos actuales del servidor sin resolver.
