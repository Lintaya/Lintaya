// Standard way to make a write route show up in Logs → Conectores. Instead of
// every handler remembering to call connectorLog() at each res.json() call
// site (easy to forget — that's exactly how /prepare-env went unlogged),
// wrap the route with auditConnectorWrite() and logging happens automatically
// from the response actually sent, success or failure.
//
//   app.post(path, requireAuth, auditConnectorWrite(connectorLog, {
//     provider: (req) => req.params.provider,
//     action: "Preparar entorno",
//   }), async (req, res) => { ... });
//
// Default message is `${action}` on success / `${action} falló: <error>` on
// failure, built from the JSON body the handler already sends — no change to
// the handler required. For a richer message or extra structured detail
// (e.g. which endpoint(s) it called), the handler may set
// `res.locals.auditMessage` / `res.locals.auditMeta` before calling res.json;
// the wrapper uses those instead of the default when present.
//
// A caller (an AI agent driving the API instead of a human via the browser)
// may send an `X-Actor` header to identify itself, e.g. `X-Actor:
// claude-sonnet-5` — a free-form, self-reported value, not a fixed enum.
// When present it's recorded as `meta.actor` and shown in Logs → Conectores.
// Requests with no header are assumed to be a human via the UI and get no
// actor tag.
function defaultMessage(action, ok, body) {
  if (ok) return action;
  const err = body?.error;
  const detail = typeof err === "string" ? err : (err?.message || JSON.stringify(body));
  return `${action} falló: ${detail}`;
}

function auditConnectorWrite(connectorLog, options = {}) {
  const { provider, action } = options;
  if (typeof provider !== "function" && typeof provider !== "string") {
    throw new TypeError("auditConnectorWrite requires options.provider (string or req => string)");
  }
  if (!action) throw new TypeError("auditConnectorWrite requires options.action");

  return (req, res, next) => {
    const id = typeof provider === "function" ? provider(req) : provider;
    const endpoint = `${req.method} ${req.originalUrl}`;
    const originalJson = res.json.bind(res);
    const originalSend = typeof res.send === "function" ? res.send.bind(res) : null;
    let recorded = false;
    const record = (body) => {
      if (recorded) return;
      recorded = true;
      const ok = res.statusCode < 400;
      const message = res.locals.auditMessage || defaultMessage(action, ok, body);
      const actor = req.get("X-Actor");
      const meta = { endpoint, ...(actor ? { actor } : {}), ...(res.locals.auditMeta || {}) };
      try { connectorLog(id, ok ? "ok" : "err", message, meta); } catch { /* never break the response over a logging failure */ }
    };
    res.json = (body) => {
      record(body);
      return originalJson(body);
    };
    // Binary downloads use res.send(Buffer) rather than JSON. Audit them too;
    // the guard keeps Express's res.json() → res.send() implementation from
    // producing a duplicate entry.
    if (originalSend) {
      res.send = (body) => {
        record(body);
        return originalSend(body);
      };
    }
    next();
  };
}

module.exports = { auditConnectorWrite };
