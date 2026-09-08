const client = require("./client");
const routes = require("./routes");

module.exports = {
  ...client,
  ...routes,
  // Convention the connector loader looks for; the named export stays for
  // callers that import this connector directly.
  register: routes.registerBitwardenRoutes,
};
