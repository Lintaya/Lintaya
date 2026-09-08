# Tutorial: agregar un proveedor de ejemplo

[English](EXAMPLE_PROVIDER_GUIDE.md) | Español

Este tutorial agrega un cuarto proveedor SCM ficticio, `acme-scm`, sin editar
`server/server.js`, `app/connectors.jsx` ni `Lintaya.html`. El ejemplo empieza
en `development`, usa el formulario generado por schema y no necesita una
cuenta real para probarse.

Antes de comenzar, leer la
[guía de desarrollo](DEVELOPMENT_GUIDE.md) y completar el
[checklist de revisión](REVIEW_CHECKLIST.md).

## 1. Crear el paquete

Crear esta estructura:

```text
server/connectors/development/acme-scm/
|-- manifest.json
|-- config.schema.json
|-- index.js
|-- client.js
|-- routes.js
|-- actions.js
|-- client.test.js
|-- routes.test.js
`-- README.md
```

El ID es estable y describe al proveedor, no una conexión concreta. Una
instalación llamada “Acme producción” será una `Connection` de tipo
`acme-scm`; no se crea otro ConnectorType como `acme-prod`.

## 2. Declarar el manifiesto

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "acme-scm",
  "displayName": "Acme SCM",
  "version": "0.1.0",
  "tier": "development",
  "lifecycle": "development",
  "license": "Apache-2.0",
  "capabilities": ["repositories.read", "commits.read"],
  "implementation": {
    "mode": "package",
    "source": "server/connectors/development/acme-scm/index.js"
  },
  "instantiable": true
}
```

El registry descubre el manifiesto al iniciar, valida que `tier` coincida con
la carpeta y expone su metadata al catálogo. No se agrega una lista manual al
frontend.

## 3. Definir configuración y secretos

`config.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://lintaya.dev/schemas/connectors/acme-scm-config-v1.json",
  "title": "Acme SCM configuration",
  "type": "object",
  "additionalProperties": false,
  "required": ["baseUrl", "token"],
  "properties": {
    "baseUrl": { "type": "string", "format": "uri" },
    "token": {
      "type": "string",
      "minLength": 1,
      "writeOnly": true,
      "x-lintaya-secret": true
    }
  }
}
```

Con este schema, **New connection** genera el formulario sin editar
`app/connectors.jsx`. `GET /config` devuelve `hasToken`, nunca el token.

## 4. Implementar el cliente y la paginación

`client.js` usa únicamente la frontera pública del SDK, y la recibe: el host lo
entrega en el contexto del conector, así que `routes.js` se lo pasa hacia abajo
en las opciones que estas funciones ya aceptan. Un `require("../../sdk")` a
nivel de módulo funciona dentro del repositorio y se rompe en cuanto alguien
instala el conector fuera de él — ver la sección 8 de la
[guía de desarrollo](DEVELOPMENT_GUIDE.md).

```js
function acmeRequest(config, path, options = {}) {
  const { buildHttpUrl, collectPages, requestJson } =
    options.sdk || require("../../sdk");
  return requestJson({
    baseUrl: config.baseUrl,
    path,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      "User-Agent": "lintaya"
    }
  });
}

async function listRepositories(config, { request = acmeRequest } = {}) {
  const page = await collectPages({
    initialCursor: 1,
    maxPages: 10,
    fetchPage: cursor => request(config, `/repositories?page=${cursor}&limit=100`),
    getItems: response => Array.isArray(response?.items) ? response.items : [],
    getNext: response => response?.nextPage || null
  });
  return {
    projects: page.items.map(repository => ({
      id: String(repository.id),
      name: repository.name,
      path: repository.fullName,
      webUrl: repository.webUrl || null,
      cloneUrl: repository.cloneUrl || null,
      description: repository.description || "",
      defaultBranch: repository.defaultBranch || null,
      group: repository.namespace || null,
      topics: repository.topics || [],
      visibility: repository.private ? "private" : "public",
      language: repository.language || null,
      lastActivityAt: repository.updatedAt || null,
      pipelineStatus: null,
      openMRs: 0,
      lastCommit: null,
      deploymentCount: 0
    })),
    pagination: { projects: { pages: page.pageCount, truncated: page.truncated } }
  };
}

module.exports = { acmeRequest, listRepositories };
```

La metadata `truncated` es parte del resultado sincronizado: alcanzar el límite
no puede presentarse como una lectura completa. Los errores del proveedor se
propagan al wrapper común para normalización y redacción.

## 5. Registrar rutas lifecycle

`routes.js` implementa las rutas convencionales de configuración, prueba y
sincronización usando `createConnectorStore`, `createConnectorLogger` y
`guardAsyncRoute`. Tomar `github/routes.js` como plantilla y conservar:

- dependencias inyectables (`request`, `sync`, reloj);
- `requireAuth` en todas las rutas;
- validación de URL/config antes de guardar;
- `store.getPublicConfig(["token"])` para lectura segura;
- status y logs redactados en éxito y error;
- `test` y `sync` sin escrituras remotas.

La entrada pública `index.js` permite el auto-registro:

```js
const client = require("./client");
const routes = require("./routes");

module.exports = {
  ...client,
  ...routes,
  register: (context, instanceId) =>
    routes.registerAcmeRoutes({ ...context, id: instanceId })
};
```

Al reiniciar Lintaya, `connectors/loader.js` carga `register()` desde
`implementation.source`. No se modifica `server.js`.

## 6. Declarar Actions

Crear `actions.js` con, como mínimo, schemas cerrados:

```js
const EMPTY_INPUT = { type: "object", additionalProperties: false };
const STATUS_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: { status: { type: "string" } }
};

function registerAcmeActions({ registry, request }) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "acme-scm",
    title: "Check Acme SCM connection",
    effect: "read",
    inputSchema: EMPTY_INPUT,
    outputSchema: STATUS_OUTPUT,
    handler: async ({ services }) => {
      await request(services.store.getConfig(), "/user");
      return { status: "ok" };
    }
  });
}

module.exports = { registerAcmeActions };
```

Actualmente las rutas se auto-registran por manifiesto, mientras el inventario
de Actions es deliberadamente explícito. Agregar `registerAcmeActions()` a
`server/core/actions/bootstrap.js` y actualizar el inventario esperado en
`bootstrap.test.js`. Esto no toca `server.js` ni el frontend central y hace que
una Action nueva sea visible durante revisión de seguridad.

Toda mutación remota necesita una Action. Si puede borrar, revocar, sobrescribir
o no es claramente reversible, usar `effect: "destructive"` y demostrar con
una prueba que el primer intento queda `pending-approval` sin llamar al
proveedor.

## 7. Probar sin red ni SQLite

Las pruebas del cliente inyectan `request` y usan respuestas ficticias. Deben
cubrir dos o más páginas, orden, ausencia de duplicados y truncación al límite.
Las pruebas de rutas usan `createRouteHarness()`:

```js
const { createRouteHarness } = require("../../sdk/test-harness");
const { registerAcmeRoutes } = require("./routes");

const createHarness = createRouteHarness(registerAcmeRoutes);
```

Verificar como mínimo:

- carga y validación del manifiesto;
- configuración pública sin secretos;
- auth, rate limit, timeout, cancelación y error de red;
- mapeo al modelo normalizado;
- paginación completa y `truncated: true` al alcanzar el guard;
- Test/Sync y KV compatibles;
- Action con efecto y schemas cerrados;
- logs y errores sin token.

Ejecutar desde `server/`:

```bash
npm run test:connectors
npm run check
```

Y desde la raíz:

```bash
node scripts/check-ai-readability.mjs
node scripts/check-json.mjs
node scripts/check-secrets.mjs
git diff --check
```

## 8. Verificación manual

1. Reiniciar Lintaya.
2. Abrir **Connectors → New connection**.
3. Confirmar que aparece **Acme SCM** con tier Development.
4. Abrirlo y comprobar que el formulario proviene del schema.
5. Guardar datos ficticios o de una cuenta de prueba.
6. Ejecutar Test y Sync; revisar status y Logs → Connectors.
7. Crear una segunda Connection si `instantiable` es `true` y confirmar que
   configuración, secretos, status y datos permanecen aislados.
8. Verificar navegación por teclado, foco visible y ancho de 393 px.

## 9. Definition of done

El ejemplo está completo cuando el paquete aparece y se configura sin cambios
en `server.js`, `app/connectors.jsx` o `Lintaya.html`; todas sus lecturas y
Actions tienen contratos probados; no filtra secretos; documenta permisos,
límites y compatibilidad; y todos los checks del repositorio quedan verdes.
