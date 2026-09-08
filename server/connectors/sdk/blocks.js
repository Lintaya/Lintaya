// Standard Home-block route: GET /api/connectors/<id>/blocks/<blockId>.
//
// A connector declares its blocks in manifest.json and registers each handler
// here; the Home dashboard renders every block with one generic component, so
// the handler's whole job is mapping whatever the connector stores into the
// normalized shape below. Home never sees the provider's original payload.
//
//   { items: [{ id, title, subtitle?, timestamp?, url?, badge? }], updatedAt }

function normalizeBlockItem(item) {
  if (!item || typeof item !== "object") return null;
  if (item.id === undefined || item.id === null || !item.title) return null;
  const normalized = { id: String(item.id), title: String(item.title) };
  if (item.subtitle) normalized.subtitle = String(item.subtitle);
  if (item.timestamp) normalized.timestamp = String(item.timestamp);
  if (item.url) normalized.url = String(item.url);
  if (item.badge && typeof item.badge === "object" && item.badge.text) {
    normalized.badge = { text: String(item.badge.text) };
    if (item.badge.color) normalized.badge.color = String(item.badge.color);
  }
  return normalized;
}

/**
 * Mounts the standard block route for one declared block. `getBlock(req)` may
 * be sync or async and returns `{ items, updatedAt }`; items that lack the
 * required id/title are dropped rather than failing the whole block.
 *
 * `req` is passed through so a connector can read `req.query.scope` /
 * `req.query.limit` to serve a scoped/limited slice of its already-synced
 * data — the route shape doesn't change, existing callers that ignore the
 * argument keep working exactly as before.
 */
function registerBlockRoute(options) {
  const { app, requireAuth, id, blockId, getBlock } = options || {};
  for (const [name, dependency] of Object.entries({ app, requireAuth, id, blockId, getBlock })) {
    if (!dependency) throw new TypeError(`registerBlockRoute requires ${name}`);
  }

  app.get(`/api/connectors/${id}/blocks/${blockId}`, requireAuth, async (req, res) => {
    try {
      const block = await getBlock(req);
      if (!block) return res.status(400).json({ error: "connector-not-configured" });
      const items = (block.items || []).map(normalizeBlockItem).filter(Boolean);
      return res.json({ items, updatedAt: block.updatedAt || null });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  });
}

module.exports = { normalizeBlockItem, registerBlockRoute };
