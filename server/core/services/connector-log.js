// Append a timestamped entry to a connector's persistent activity log (max 30
// entries, key `connector-log-<id>`) — feeds Logs → Conectores in the UI.
// Factored out of server.js so AGENT-002's MCP adapter (mcp-server.js) writes
// to the exact same trail the HTTP server does for every other write path,
// instead of a second copy of this seven-line function.
function createConnectorLog({ kvGet, kvSet }) {
  return function connectorLog(id, level, msg, meta) {
    const key = `connector-log-${id}`;
    const existing = kvGet(key)?.value || [];
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const entry = { t, ts: Date.now(), level, msg };
    if (meta && Object.keys(meta).length) entry.meta = meta;
    kvSet(key, [entry, ...existing].slice(0, 30));
  };
}

module.exports = { createConnectorLog };
