# Arquitectura

[English](architecture.md) | Español

[English](introduccion.md) | Español

Lintaya es un espacio de trabajo local-first. El navegador es la interfaz de
usuario y el servidor Node.js es el límite que administra autenticación, estado
local, configuración de conectores, sincronización y la API HTTP.

## Flujo del runtime

```text
Browser PWA (React + JSX)
          │ HTTP + Bearer token
          ▼
Node.js / Express (auth, API, jobs)
          │
   ┌──────┼────────┬─────────────┐
   ▼      ▼        ▼             ▼
 SQLite  Secret   Connectors   CLI / MCP
 state   Store    sync/actions  HTTP callers
 cache   secrets      │
                      ▼
              External providers
```

La CLI y MCP son llamadores HTTP adicionales del mismo servidor. No abren
SQLite ni leen secretos de conectores directamente, por lo que todos comparten
las mismas reglas de autenticación, auditoría y acciones.

## Estructura del repositorio

| Ruta | Responsabilidad |
|---|---|
| `Lintaya.html` | Punto de entrada del navegador y orden de scripts. |
| `app/` | Vistas PWA, navegación, ajustes y helpers de API. |
| `server/app.js` | Fábrica de Express y autenticación. |
| `server/server.js` | Composición del runtime y registro de rutas. |
| `server/core/` | Base de datos, migraciones, acciones, logs y servicios compartidos. |
| `server/routes/` | Rutas HTTP por dominio. |
| `server/connectors/community/` | Paquetes públicos de conectores incluidos. |
| `server/connectors/sdk/` | Contratos y helpers de pruebas de conectores. |
| `cli/` | Cliente HTTP multiplataforma. |
| `docs/` | Documentación de usuario, contribución, arquitectura y release. |
| `scripts/` | Revisiones del repositorio y validación de releases. |
| `vendor/` | Dependencias del navegador vendorizadas para uso offline. |

## Límites de datos y seguridad

El servidor abre las bases SQLite y el Secret Store. SQLite contiene estado
local, datos cacheados de conectores, auditoría y ajustes de repositorios; las
bases activas, archivos WAL, respaldos y vault son datos de runtime y no deben
copiarse al repositorio. Los secretos de conectores están separados de la
configuración pública y nunca se devuelven en respuestas API ni logs.

Las rutas API protegidas requieren `Authorization: Bearer <LINTAYA_TOKEN>`.
`/api/health` y `/api/ai-context` son las excepciones de descubrimiento. Las
respuestas de proveedores, archivos importados, repositorios y logs se tratan
como entradas no confiables.

## Carga del frontend

No hay un build del frontend. `Lintaya.html` carga los archivos JSX como scripts
de Babel en el navegador. Cada script tiene su propio scope y expone su vista
mediante `window`; `app/app.jsx` se carga al final y monta el shell. Normalmente
los cambios de frontend solo requieren editar el archivo correspondiente y
recargar el navegador.

## Modelo de conectores

Un **ConnectorType** es la definición de una integración, como GitHub o GitLab.
Una **Connection** es una instancia configurada de ese tipo. Las conexiones
poseen configuración, estado, datos sincronizados, actividad y referencias a
secretos.

Los datos de conectores pueden convertirse en **Blocks** reutilizables. Los
**Boards** organizan Blocks en un layout y los **Dashboards** referencian Boards
ordenados sin copiar sus árboles. Las acciones destructivas pasan por el flujo
de aprobaciones cuando están registradas como destructivas.

Los layouts de Boards usan un árbol de zonas redimensionables en lugar de
posicionamiento absoluto. Al agregar un Block a una zona ocupada se crea un panel
hermano con su propio separador. Arrastra el separador o enfócalo con `Tab` y
usa las flechas izquierda/derecha o arriba/abajo para cambiar la proporción. La
proporción pertenece al árbol de ese Board y se guarda con él; redimensionar un
Board no cambia otro. Consulta [Boards](../module/introduccion.es.md) para los
pasos de edición.

Para el diseño del repositorio y las decisiones de migración, consulta
[`ARCHITECTURE.md`](../../../ARCHITECTURE.es.md) y los ADR en
[`docs/adr/`](../../adr/README.es.md).
