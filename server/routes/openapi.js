// OpenAPI/Swagger routes - serves spec and UI
const { generateOpenAPISpec } = require("../core/openapi");

function registerOpenAPIRoutes({ app, connectors = [] }) {
  // Serve OpenAPI spec as JSON
  app.get("/api/openapi.json", (req, res) => {
    const spec = generateOpenAPISpec({ connectors });
    res.json(spec);
  });

  // Serve Swagger UI
  app.get("/docs", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lintaya API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.10.5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
    .info { margin: 20px 0; }
    .info .title { font-size: 24px; font-weight: bold; }
    .info .description { color: #666; margin-top: 10px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: "BaseLayout",
      deepLinking: true,
      defaultModelsExpandDepth: -1,
      defaultModelExpandDepth: 1,
      docExpansion: 'list',
      filter: true,
      showRequestHeaders: true
    });
  </script>
</body>
</html>`);
  });

  // Alternative: Redoc UI
  app.get("/docs/redoc", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lintaya API Docs (Redoc)</title>
  <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.3/bundles/redoc.standalone.js"></script>
</head>
<body>
  <div id="redoc"></div>
  <script>
    Redoc.init('/api/openapi.json', {
      scrollYOffset: 50,
      hideDownloadButton: false,
      expandResponses: '200',
      pathInMiddlePanel: true
    }, document.getElementById('redoc'));
  </script>
</body>
</html>`);
  });
}

module.exports = { registerOpenAPIRoutes };
