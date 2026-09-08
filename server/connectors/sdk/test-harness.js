const assert = require("node:assert/strict");

// Reutilizable entre los `routes.test.js` de los 12 conectores — todos repetían
// el mismo mock de `app`, `kvGet`/`kvSet` sobre un Map y el wrapper de `invoke()`
// contra el handler real, con solo pequeñas variaciones: qué verbos registra el
// conector, si `invoke()` recibe el body suelto o un sobre {body, params, query},
// y qué defaults/estado extra necesita cada uno (contadores de llamadas, arrays
// de "borrados", etc). Ver el roadmap interno, sección 6.
//
//   const createHarness = createRouteHarness(registerGithubRoutes);
//
//   const createHarness = createRouteHarness(registerPlaneRoutes, {
//     methods: ["get", "post", "patch"],
//     mode: "envelope", // invoke(method, path, { body, params, query })
//     setup: () => {
//       const calls = [];
//       return {
//         defaults: { request: async (...args) => { calls.push(args); return {}; } },
//         extra: { calls },
//       };
//     },
//   });
//
// `mode: "value"` (default) es invoke(method, path, body) → req { body, params: {}, query: {} }.
// `setup({ values, logs })` corre una vez por harness y puede devolver:
//   - `defaults`: overrides que se registran ANTES de los del propio test (para
//     que un test siga pudiendo sobreescribirlos con su tercer argumento).
//   - `extra`: estado (arrays, contadores) devuelto junto con `{ invoke, logs, values }`.
function createRouteHarness(registerFn, { methods = ["get", "post"], mode = "value", setup } = {}) {
  return function createHarness(overrides = {}) {
    const routes = new Map();
    const values = new Map();
    const logs = [];
    const app = {};
    for (const method of methods) {
      app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
    }
    const kvGet = (key) => (values.has(key) ? { value: values.get(key) } : null);
    const kvSet = (key, value) => values.set(key, value);
    const { defaults = {}, extra = {} } = setup ? setup({ values, logs }) : {};

    registerFn({
      app,
      requireAuth(req, res, next) { next(); },
      kvGet,
      kvSet,
      connectorLog(id, level, message) { logs.push({ id, level, message }); },
      ...defaults,
      ...overrides,
    });

    async function invoke(method, path, arg) {
      const handler = routes.get(`${method} ${path}`);
      assert.ok(handler, `Missing route ${method} ${path}`);
      const req = mode === "envelope"
        ? { body: arg?.body, params: arg?.params || {}, query: arg?.query || {} }
        : { body: arg, params: {}, query: {} };
      return new Promise((resolve, reject) => {
        const response = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
        };
        Promise.resolve(handler(req, response)).catch(reject);
      });
    }

    return { invoke, logs, values, ...extra };
  };
}

module.exports = { createRouteHarness };
