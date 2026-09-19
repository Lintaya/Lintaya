const client = require("./client");
const routes = require("./routes");

module.exports = {
  ...client,
  ...routes,
  // Varias conexiones: una por app de LinkedIn (ej. la del perfil personal y
  // otra, aparte, con la Community Management API para una Página). El loader
  // llama register(context) para la base y register(context, instanceId) por
  // cada instancia extra (ver connectors/loader.js y ADR-008/CONN-017).
  register: (context, instanceId) => routes.registerLinkedinRoutes({ ...context, ...(instanceId ? { id: instanceId } : {}) }),
};
