const { join } = require("node:path");

// Public, static orientation documents. They describe the repository and
// public contract only; operational data remains behind authenticated routes.
function registerAgentSurfaceRoutes({ app, rootDir }) {
  for (const [route, file] of [["/llms.txt", "llms.txt"], ["/llms.es.txt", "llms.es.txt"]]) {
    app.get(route, (req, res) => {
      res.type("text/plain");
      res.sendFile(join(rootDir, file));
    });
  }
}

module.exports = { registerAgentSurfaceRoutes };
