# System

La sección **System** contiene las herramientas de configuración operativa y
auditoría que apoyan al resto de Lintaya. Está separada de áreas de producto
como Devices, Blocks, Boards y Dashboards.

## Connectors

**Connectors** administra las integraciones que Lintaya puede utilizar. Un tipo
de conector describe a un proveedor; una conexión configurada aporta su URL,
credenciales y ajustes específicos.

Desde esta página puedes:

- consultar el catálogo de conectores y sus capacidades;
- configurar, probar, activar o desactivar una conexión;
- revisar la actividad y el estado de sincronización;
- abrir los bloques y módulos que exponga el conector.

Los secretos se guardan mediante la configuración protegida del servidor y no
se muestran en las listas de conectores. Un conector debe estar configurado
antes de que sus bloques o acciones asociadas al proveedor aparezcan en la
aplicación.

## Tags

**Tags** es el catálogo compartido para clasificar Devices, Blocks, Boards y
Dashboards. Crea una etiqueta una sola vez y selecciónala al editar el recurso
compatible. Eliminar una etiqueta la quita del catálogo; no elimina los
recursos que la usaban.

## Logs

**Logs** muestra el historial operativo. La vista SSH lista las transcripciones
de terminal registradas y permite inspeccionar la actividad de una sesión. La
actividad de conectores registra la operación, el resultado, el contexto de la
solicitud y, cuando existe, el actor. Los logs sirven para revisar y solucionar
problemas; no sustituyen la retención de auditoría del proveedor.

## Approvals

**Approvals** es la cola de revisión para acciones que requieren confirmación
antes de llamar a una operación destructiva del proveedor. Una aprobación
pendiente no ejecuta la solicitud externa. Revisa la acción y sus parámetros,
y después apruébala o recházala según tu proceso operativo.

La beta actual está pensada para un único administrador local. Los flujos de
equipo, la aprobación delegada y la ejecución de repositorios en sandbox aún no
son funciones liberadas.

## Configuración relacionada

System también incluye el perfil local, apariencia, idioma y otras preferencias
de la aplicación. Estas preferencias son locales a la instancia de Lintaya y
no sustituyen la configuración del conector ni los permisos del proveedor.

Para consultar toda la referencia de Ajustes, revisa [Ajustes](ajustes.es.md).
