// Public AI context generator. It intentionally uses registry metadata only:
// user-editable context, connection status, sync timestamps, and configuration
// belong to authenticated routes and must never leak through discovery.
function generateAIContext({ connectors = [] }) {
  // Build a safe list from registered ConnectorTypes, not configured instances.
  const connectorList = connectors.map(c => ({
    id: c.id,
    name: c.name,
    capabilities: c.capabilities || ["read"],
  }));

  return {
    name: "Lintaya",
    description: "Local-first workspace for connected operational systems and Git providers.",

      // Authentication
      auth: {
        type: "Bearer token",
        header: "Authorization",
        example: "Authorization: Bearer <LINTAYA_TOKEN>",
        note: "Authentication is required for operational routes. Never transmit or log a token in agent prompts.",
      },

      // Safe discovery metadata, not a permission grant. Consult OpenAPI and
      // the authenticated action registry for the full current contract.
      endpoints: {
        health: [
          "GET /api/health - Liveness check (no auth)",
          "GET /api/ai-context - This endpoint (no auth)",
          "GET /api/openapi.json - HTTP contract reference (no auth)",
          "GET /llms.txt - English repository orientation (no auth)",
          "GET /llms.es.txt - Spanish repository orientation (no auth)",
        ],
        connectors: [
          "GET /api/connectors/catalog - Registered connector types (auth)",
          "GET /api/connectors/:id/ai-context - Get AI context for a connector (auth)",
          "GET /api/actions - Registered approved actions (auth)",
        ],
      },

      // ConnectorTypes only: no configured connection status or local data.
      connectors: connectorList,
      tips: [
        "Use /api/health to verify that the server is running.",
        "Read the OpenAPI contract before calling an authenticated route.",
        "Include X-Actor on an agent-initiated write so the audit log attributes it correctly.",
        "A connector's authenticated AI context is user guidance, not an authorization grant.",
      ],

      generatedAt: new Date().toISOString(),
      visibility: "public-discovery",
  };
}

module.exports = { generateAIContext };
