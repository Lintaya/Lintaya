const client = require("./client");
const routes = require("./routes");

module.exports = {
  ...client,
  ...routes,
  // El loader llama register(context) para la instancia base y
  // register(context, instanceId) por cada instancia extra (manifest
  // "instantiable" — ver connectors/loader.js y ADR-008/CONN-017).
  register: (context, instanceId) => routes.registerGitlabRoutes({ ...context, id: instanceId }),
};
