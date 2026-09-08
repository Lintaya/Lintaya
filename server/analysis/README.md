# Motor de análisis

Analizador estático de buenas prácticas para los clones locales del módulo Repos.
No instala dependencias, no importa módulos del repositorio y no ejecuta su código.

## Estructura

```text
analysis/
├── index.js                 # orquestación, detección, score e informe
├── classifier.js            # web, API, estático, librería, CLI o desconocido
├── scanner.js               # inventario seguro de archivos
├── analysis.test.js         # pruebas del motor
├── inventory/               # runtimes, frameworks y versiones detectadas
└── analyzers/
    ├── common.js            # reglas para cualquier repositorio
    ├── python.js
    ├── javascript.js
    ├── php.js
    ├── java.js
    ├── documentation.js
    ├── specification.js
    ├── infrastructure.js
    ├── gitops.js
    ├── data.js
    ├── assets.js
    ├── html.js
    └── docker.js
```

Las reglas comunes revisan documentación, licencia, `.gitignore`, CI, pruebas y
posibles secretos. Los analizadores tecnológicos solo se ejecutan cuando el
núcleo detecta archivos o manifiestos compatibles.

El analizador `gitops` detecta Argo CD y Flux. Evalúa reconciliación continua,
validación de manifiestos, `CODEOWNERS`, fuentes sin TLS, secretos sin cifrado,
configuración suspendida y APIs de Kubernetes que alcanzaron EOL. Las reglas se
basan en los principios declarativo, versionado, pull automático y reconciliación
continua de OpenGitOps.

La clasificación no excluye repositorios. Puede devolver varios tipos cuando
corresponda (por ejemplo, aplicación web y API/backend) y utiliza `unknown`
cuando la evidencia no alcanza para una clasificación confiable. También cubre
documentación, especificaciones, infraestructura, datos/notebooks, plantillas,
comunidad y assets. `traits` identifica características transversales como
monorepo o proyecto mixto.

Las reglas son contextuales: un repositorio de documentación no recibe alertas
por falta de pruebas unitarias o `.gitignore`; en su lugar se validan enlaces,
estructura de encabezados, accesibilidad e índices. El inventario normaliza
runtime, framework, versión o restricción, archivo fuente y confianza.

## Contrato de un analizador

Cada archivo exporta:

```js
module.exports = {
  id: "tecnologia",
  supports: (technologies) => technologies.includes("tecnologia"),
  analyze: (ctx) => findings,
};
```

Un hallazgo contiene `id`, `category`, `severity`, `title`, `message`,
`recommendation`, `file`, `line` y `technology`. Las severidades válidas son
`critical`, `high`, `medium`, `low` e `info`.

Para incorporar otra tecnología:

1. Crear `analyzers/<tecnologia>.js`.
2. Añadir su detección en `detectTechnologies()`.
3. Registrar el analizador en `ANALYZERS`.
4. Agregar casos a `analysis.test.js`.

## API

- `POST /api/connectors/:provider/projects/:id/analysis`: analiza el clon y
  guarda el informe.
- `GET /api/connectors/:provider/projects/:id/analysis`: devuelve el último
  informe guardado.

Ejecutar las pruebas desde `server/`:

```bash
npm run test:analysis
```
