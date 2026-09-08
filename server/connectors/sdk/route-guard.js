// Express 4 does not forward a rejected promise from an `async (req, res) =>
// {...}` handler to the error middleware — if something throws synchronously
// before the handler's own try/catch (most commonly `store.getConfig()` /
// `store.setConfig()`, which throw `vault-locked` when
// LINTAYA_SECRET_STORE=bitwarden and the vault isn't unlocked — see
// server/core/services/secret-store.js), the promise rejection has nowhere
// to go and the request hangs until the client times out instead of getting
// a clear error.
//
// Wrap every async connector route handler with guardAsyncRoute() so that
// failure mode always produces a response. This is a pure safety net: when a
// handler already handles its own errors and responds normally (the
// overwhelming majority of requests), the wrapper's try succeeds and does
// nothing extra.
function guardAsyncRoute(handler) {
  return async function guardedConnectorRoute(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (res.headersSent) return; // handler already responded; nothing else to do
      if (error?.code === "vault-locked") {
        res.status(401).json({ error: "vault-locked" });
        return;
      }
      // Same posture as AppError.internal()'s `expose: false` — never surface
      // a raw error message here, this is a last-resort path, not the
      // primary error contract of the route.
      res.status(500).json({ error: "unexpected-error" });
    }
  };
}

module.exports = { guardAsyncRoute };
