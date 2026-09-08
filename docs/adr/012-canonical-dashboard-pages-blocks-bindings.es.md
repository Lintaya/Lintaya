# ADR-012: dashboard canónico y contrato de Pages, Blocks y Bindings

[English](012-canonical-dashboard-pages-blocks-bindings.md) | Español

- Estado: Aceptado
- Fecha: 2026-08-23
- Depende de: ADR-010
- Habilita: expansión UX-005, UX-006, CONN-016

## Contexto

Lintaya tiene dos experiencias de dashboard: Home original y Home 2. Mantienen
catálogos y persistencia diferentes, mientras blocks de conectores conviven con
paneles JSX específicos. Así un nuevo block debe entrar a más de un catálogo y
el usuario no tiene un lugar inequívoco para mantener su layout.

También debe distinguirse una página completa de un block embebido:

- Un Block es un feed compacto, de solo lectura y renderer compartido.
- Una Page es una superficie navegable con layout y estado propios.
- Un Binding conecta inputs y outputs declarados entre blocks o estado Page;
  no usa un event bus global implícito.

## Decisión

Home es el dashboard canónico de Lintaya. Home 2 permanece alias de
compatibilidad durante migración y no recibe capacidades nuevas. El catálogo
canónico de blocks y layout vive detrás de un modelo Page/Block/Binding y una
persistencia única de página.

La migración es gradual:

1. Inventariar layouts, widgets y endpoints de Home, Home 2 y Blocks.
2. Definir BlockDefinition, BlockInstance, PageInstance y Binding con IDs
   estables, schemas input/output y versión de contrato.
3. Mantener adaptadores read/write para endpoints antiguos.
4. Migrar primero blocks GitLab, Outline, Plane, Qportal y vCenter, más notas y
   widgets locales.
5. Migrar paneles manuales restantes al renderer o módulos explícitos.
6. Redirigir Home 2 al dashboard canónico al terminar la migración de datos.

Una PageInstance puede tener densidad o variante de layout, pero no es una
segunda definición funcional de dashboard. Módulos completos de conectores
siguen siendo Pages propias y no se convierten artificialmente en blocks.

## Contrato mínimo

~~~json
{
  "pageId": "home",
  "blocks": [{ "id": "vcenter-alerts", "definition": "vcenter.alerts" }],
  "bindings": [],
  "version": 1
}
~~~

Las definiciones declaran capability, título, renderer, schema input y schema
output. Las instancias contienen solo configuración de presentación y
referencias seguras; nunca secretos ni código ejecutable.

## Consecuencias

- Hay un lugar para agregar, quitar, ordenar y persistir widgets.
- Home 2 deja de crecer como arquitectura paralela.
- Conectores pueden publicar blocks sin editar varios catálogos centrales.
- Compatibilidad temporal requiere adaptadores y migración de layouts.
- Densidad table/dashboard es variante de presentación, no otro producto.

## Fuera de alcance

- Un marketplace de blocks.
- Cargar código ejecutable desde manifiestos o red.
- El Desktop HUD.
- Comunicación implícita mediante event bus global.
