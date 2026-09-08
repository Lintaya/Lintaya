// CORE-003 (ADR-010): id (base or instance) -> the ConnectorType id it
// implements. Column-first — bootstrapConnectorInstances() backfills
// `connectors.connector_type_id` for every known row on each boot — falling
// back to the manifest (a base type's own id) and then a connector-instances
// KV scan (an instance row that predates the backfill).
//
// Factored out of server.js so AGENT-002's MCP adapter (mcp-server.js)
// resolves a connectionId to a ConnectorType the exact same way the HTTP
// server does, instead of a second hand-copied version of this order
// drifting from CORE-003's contract over time.
function createConnectorTypeResolver({ db, kvGet, getConnectorManifest }) {
  const stmtConnTypeGet = db.prepare("SELECT connector_type_id FROM connectors WHERE id = ?");
  return function resolveConnectorType(id) {
    const storedType = stmtConnTypeGet.get(id)?.connector_type_id;
    if (storedType) return storedType;
    if (getConnectorManifest(id)) return id;
    const all = kvGet("connector-instances")?.value || {};
    for (const [typeId, ids] of Object.entries(all)) {
      if (ids.includes(id)) return typeId;
    }
    return id;
  };
}

module.exports = { createConnectorTypeResolver };
