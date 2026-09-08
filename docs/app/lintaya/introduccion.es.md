# Lintaya

[English](introduccion.md) | Español

El core de Lintaya funciona localmente sin configurar conectores. Los conectores
añaden datos y operaciones de proveedores a ese espacio de trabajo.

## Capacidades sin conectores

| Capacidad | Qué funciona localmente |
|---|---|
| Devices | Crear, editar y eliminar inventario de red con dirección de gestión, fabricante, modelo, usuario/puerto SSH, etiquetas y notas. |
| Blocks | Escribir y editar contenido Markdown. Los bloques de proveedores requieren su conexión. |
| Boards | Distribuir bloques reutilizables en zonas, redimensionarlas y administrar boards guardados. |
| Dashboards | Agrupar boards en pestañas y presentarlos. |
| Espacio de trabajo | Home, navegación, ajustes de apariencia e idioma, documentación y API local autenticada. |

Devices pertenece al core. El estado guardado de un dispositivo es un dato de
inventario, no una comprobación de monitoreo automático. SSH necesita un equipo
accesible y credenciales válidas; recuperar contraseñas del vault requiere además
su integración desbloqueada. El inventario VMware, los contenedores y las tareas
de proveedores requieren sus respectivos conectores.

## Código y estructura de carpetas

| Carpeta o archivo | Responsabilidad |
|---|---|
| `Lintaya.html` | Carga los scripts del frontend; no requiere bundler. |
| `app/` | Interfaz: `devices.jsx`, `home.jsx`, `block-catalog.jsx`, `block-builder.jsx`, `module-builder.jsx`, `custom-page-view.jsx`, `dashboard.jsx` y `documentation.jsx`. |
| `server/app.js`, `server/server.js` | Autenticación, aplicación Express y registro de rutas y servicios. |
| `server/routes/` | APIs del core, entre ellas `devices.js`, `home.js`, `custom-blocks.js`, `dashboards.js`, `ssh.js` y `documentation.js`. |
| `server/core/` | Servicios compartidos, almacenamiento, migraciones e infraestructura. Esta carpeta por sí sola no contiene todo el core del producto. |
| `server/connectors/sdk/` | Contratos y utilidades compartidas de conectores. |
| `server/connectors/community/` | Paquetes de conectores distribuidos con el repositorio. |
| `~/.lintaya/connectors/` | Paquetes instalados por separado, cada uno en su propia carpeta. |
| `docs/app/` | Documentación que muestra la aplicación. |

La pestaña Lintaya agrupa las páginas existentes de `block/`, `module/` (Boards)
y `dashboard/`. Esta introducción vive en `docs/app/lintaya/`; las rutas anteriores
siguen siendo válidas. Aquí se describe Devices y el core; cada conector documenta
sus propias capacidades por separado.
