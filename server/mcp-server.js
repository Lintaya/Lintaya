#!/usr/bin/env node
// Lintaya — MCP server (AGENT-002, ADR-011: "REST is the canonical contract
// and execution point; MCP and CLI are thin adapters that discover and call
// those REST actions — they don't implement a second business logic layer or
// access SQLite, connectors, or secrets directly.")
// Transport: stdio (JSON-RPC 2.0)
//
// This process holds no database connection and no copy of the action
// registry — every tool is an HTTP call to the same running Lintaya server
// the dashboard talks to. Two kinds of tool:
//   - Hand-written (vCenter, Bitwarden): vcenter_sync and bitwarden_status
//     call the canonical action endpoint like everything else; the rest
//     (vcenter_summary, vcenter_list_vms, bitwarden_list_items, ...) are
//     read-only views with no registry equivalent, so they call the same
//     read endpoints the dashboard's own pages use (/api/vms-live,
//     /api/connectors/status, /api/vault/*).
//   - Generated (every other connector type): one MCP tool per action
//     returned by GET /api/actions, named "<connectorTypeId>_<actionId>"
//     (e.g. "gitlab_sync", "outline_delete-document") — built fresh on every
//     ListTools call (cached 60s) instead of hand-listing 25 more tool
//     definitions that would drift from the registry the moment a 14th
//     connector type or a new action shows up. See buildGeneratedTool()
//     below for the one thing added on top of the action's own schema — an
//     optional connectionId, since a ConnectorType can have more than one
//     Connection (CORE-003) and vcenter/bw's hand-written tools are the only
//     ones that get away with assuming there's just one.
// The one consequence worth knowing: unlike the pre-AGENT-002 version, these
// tools only work while the Lintaya server is actually running and reachable
// at LINTAYA_API_URL (or http://127.0.0.1:<PORT>, default 3000) — that's the
// trade this ADR makes deliberately, in exchange for MCP never being a
// second place permissions, validation, secret redaction or auditing can
// drift from what REST does.
//
// Usage (add to .mcp.json):
//   "lintaya": {
//     "command": "node",
//     "args": ["server/mcp-server.js"],
//     "env": { "LINTAYA_TOKEN": "dev-token" }
//   }

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const BASE_URL = (process.env.LINTAYA_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, "");
const TOKEN = process.env.LINTAYA_TOKEN || "";

// ── HTTP client ──────────────────────────────────────────────────────────────
async function apiRequest(method, urlPath, body) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        // Attributes MCP-originated writes in Logs → Conectores, same as the
        // UI tags its own requests (see routes/actions.js's `X-Actor`).
        ...(method === "POST" ? { "X-Actor": "mcp" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`Cannot reach Lintaya at ${BASE_URL} — is the server running? (${e.message})`);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    // RFC 9457 problem details (server/core/errors.js) — `detail` carries the
    // human-readable message, same field the UI reads.
    const message = (data && typeof data === "object" && (data.detail || data.title))
      || (typeof data === "string" && data)
      || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

// ── Tool helpers ─────────────────────────────────────────────────────────────
function ok(text) {
  return { content: [{ type: "text", text }] };
}
function json(obj) {
  return ok(JSON.stringify(obj, null, 2));
}
function err(msg) {
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

// The canonical execution path (ADR-011) — every read/write action tool below
// is just this, pointed at a different connectionId/actionId.
async function runAction(connectionId, actionId, input = {}) {
  const result = await apiRequest("POST", `/api/connectors/${connectionId}/actions/${actionId}`, input);
  if (result.pending) {
    return err(`${result.actionId} requires human approval. It is queued in Lintaya Approval Center as ${result.approval?.id || "a pending request"}.`);
  }
  return json(result.result);
}

// ── Search (Dashboards / Boards / Block content) ───────────────────────────────
// Same matching semantics as the in-app Ctrl+K palette (app/cmdk.jsx): board
// titles, Block Builder text, and already-synced connector items all match by
// a plain case-insensitive substring against a label+hint pair. Kept as a
// local copy rather than requiring app/zone-tree.js — same reasoning as
// cli/src/output.js's own tree walker: an adapter doesn't reach into app/
// internals (ADR-011 at the top of this file).
function collectBlockIds(tree, ids = []) {
  if (!tree || typeof tree !== "object") return ids;
  if (Array.isArray(tree.blocks)) ids.push(...tree.blocks);
  collectBlockIds(tree.a, ids);
  collectBlockIds(tree.b, ids);
  return ids;
}

function boardDashboardMap(dashboards) {
  const map = new Map();
  for (const dashboard of dashboards || []) {
    for (const boardId of dashboard.boardIds || []) {
      if (!map.has(boardId)) map.set(boardId, dashboard);
    }
  }
  return map;
}

function connectorBlockPairsFromBoards({ modulePages, blockCatalog }) {
  const catalogById = new Map((blockCatalog || []).map(block => [block.id, block]));
  const pairs = new Map();
  for (const board of modulePages || []) {
    if (board.active === false) continue;
    for (const blockId of collectBlockIds(board.tree)) {
      const block = catalogById.get(blockId);
      if (block?.kind === "connector" && block.connectorId && block.blockId) {
        pairs.set(`${block.connectorId}:${block.blockId}`, block);
      }
    }
  }
  return pairs;
}

function buildSearchEntries({ modulePages, dashboards, blockCatalog, itemsByKey }) {
  const dashboardByBoard = boardDashboardMap(dashboards);
  const catalogById = new Map((blockCatalog || []).map(block => [block.id, block]));
  const entries = [];
  for (const board of modulePages || []) {
    if (board.active === false) continue;
    const dashboard = dashboardByBoard.get(board.id);
    entries.push({
      type: "board", label: board.title,
      hint: dashboard ? `Dashboard: ${dashboard.title}` : "Board",
      boardId: board.id, boardTitle: board.title,
      dashboardId: dashboard?.id || null, dashboardTitle: dashboard?.title || null,
    });
    for (const blockId of collectBlockIds(board.tree)) {
      const block = catalogById.get(blockId);
      if (!block) continue;
      if (block.kind === "content") {
        entries.push({
          type: "block", label: block.title,
          hint: `${board.title} · ${(block.content || "").slice(0, 400)}`,
          boardId: board.id, boardTitle: board.title,
          dashboardId: dashboard?.id || null, dashboardTitle: dashboard?.title || null,
        });
        continue;
      }
      if (block.kind !== "connector") continue;
      entries.push({
        type: "block", label: block.title,
        hint: `${board.title} · ${block.category || "Block"}`,
        boardId: board.id, boardTitle: board.title,
        dashboardId: dashboard?.id || null, dashboardTitle: dashboard?.title || null,
      });
      const items = itemsByKey.get(`${block.connectorId}:${block.blockId}`) || [];
      for (const item of items) {
        entries.push({
          type: "item", label: item.title,
          hint: `${board.title} · ${block.title}${item.subtitle ? " · " + item.subtitle : ""}`,
          boardId: board.id, boardTitle: board.title,
          dashboardId: dashboard?.id || null, dashboardTitle: dashboard?.title || null,
          url: item.url || null,
        });
      }
    }
  }
  return entries;
}

function matchSearchEntries(entries, query, limit = 20) {
  const q = String(query || "").trim().toLowerCase();
  const pool = q ? entries.filter(entry => entry.label.toLowerCase().includes(q) || (entry.hint || "").toLowerCase().includes(q)) : entries;
  return pool.slice(0, limit);
}

// Static catalog (boards/dashboards/block metadata) and per-block connector
// items each get their own 60s cache — same TTL as fetchActionsCatalog below
// — since this MCP process stays alive across tool calls in a session.
let searchCatalogCache = { at: 0, modulePages: [], dashboards: [], blockCatalog: [] };
let searchItemsCache = new Map(); // "connectorId:blockId" -> { at, items }

async function fetchSearchCatalog() {
  const fresh = searchCatalogCache.modulePages.length && Date.now() - searchCatalogCache.at < 60_000;
  if (fresh) return searchCatalogCache;
  const [modulePages, dashboards, connectorBlocks, customBlocks] = await Promise.all([
    apiRequest("GET", "/api/module-pages"),
    apiRequest("GET", "/api/dashboards"),
    apiRequest("GET", "/api/home/blocks"),
    apiRequest("GET", "/api/home/custom-blocks"),
  ]);
  searchCatalogCache = {
    at: Date.now(),
    modulePages: Array.isArray(modulePages) ? modulePages : [],
    dashboards: Array.isArray(dashboards) ? dashboards : [],
    blockCatalog: [...(Array.isArray(connectorBlocks) ? connectorBlocks : []), ...(Array.isArray(customBlocks) ? customBlocks : [])],
  };
  return searchCatalogCache;
}

// ── Generated tools (every connector type except vCenter/Bitwarden) ───────────
// Those two keep hand-written tools above with real added value (derived
// summaries, filtering) beyond a raw action call; every other type's status/
// sync/etc. gets no such treatment, so it's generated straight from the
// registry instead of 25 more copy-pasted tool definitions.
const HAND_WRITTEN_TYPES = new Set(["vcenter", "bw"]);

let actionsCache = { at: 0, actions: [] };
async function fetchActionsCatalog() {
  const fresh = actionsCache.actions.length && Date.now() - actionsCache.at < 60_000;
  if (fresh) return actionsCache.actions;
  try {
    const list = await apiRequest("GET", "/api/actions");
    actionsCache = { at: Date.now(), actions: Array.isArray(list) ? list : [] };
  } catch {
    // Server unreachable — ListTools falls back to whatever was cached
    // (possibly nothing, on a cold start); the next tools/call attempt will
    // surface the same connection error through apiRequest either way.
  }
  return actionsCache.actions;
}

// A ConnectorType can have more than one Connection (CORE-003, e.g. GitLab's
// "gitlab2") — every generated tool accepts an optional connectionId on top
// of the action's own input fields, defaulting to the type id itself (the
// base connection every type has).
function buildGeneratedTool(action) {
  const base = action.inputSchema?.type === "object" ? action.inputSchema : { properties: {}, required: [] };
  const destructiveNote = action.effect === "destructive"
    ? " Destructive — creates a pending approval request; a human must approve it in Lintaya before it can run."
    : "";
  return {
    name: `${action.connectorTypeId}_${action.id}`,
    description: `[${action.connectorTypeId}] ${action.title}${destructiveNote}`,
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: `Connection id — defaults to "${action.connectorTypeId}" (the base connection) if omitted.` },
        ...(base.properties || {}),
      },
      required: base.required || [],
    },
  };
}

// Rebuilt on every ListTools call alongside the generated tool list, so
// handleTool() never has to re-derive connectorTypeId/actionId by splitting
// a tool name string — both ids can themselves contain hyphens/underscores
// (e.g. "outlook-local", "list-documents"), which would make that ambiguous.
let generatedRoutes = new Map();

// ── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  // ── vCenter ──────────────────────────────────────────────────────────────
  {
    name: "vcenter_summary",
    description: "Get a quick summary of the VMware vCenter infrastructure: total VMs, hosts, clusters, datastores and last sync time.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "vcenter_list_vms",
    description: "List all virtual machines from VMware vCenter. Returns name, power state, CPU count, memory (GB), environment (dev/qa/prod) and site.",
    inputSchema: {
      type: "object",
      properties: {
        filter_power: { type: "string", enum: ["POWERED_ON", "POWERED_OFF", "SUSPENDED"], description: "Filter by power state (optional)" },
        filter_env:   { type: "string", enum: ["dev", "qa", "prod"],                      description: "Filter by environment (optional)" },
        search:       { type: "string", description: "Search substring in VM name (case-insensitive)" },
        limit:        { type: "number", description: "Max results to return (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "vcenter_find_vm",
    description: "Find a specific VM by exact name or partial match. Returns all available details.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "VM name (exact or partial)" },
      },
      required: ["name"],
    },
  },
  {
    name: "vcenter_list_hosts",
    description: "List all ESXi hosts from VMware vCenter. Returns name, connection state, power state.",
    inputSchema: {
      type: "object",
      properties: {
        filter_state: { type: "string", description: "Filter by connection_state (e.g. CONNECTED, DISCONNECTED)" },
      },
      required: [],
    },
  },
  {
    name: "vcenter_sync",
    description: "Trigger a fresh sync from VMware vCenter — pulls current VMs, hosts, clusters and datastores. Use this when data may be stale.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  // ── Bitwarden ─────────────────────────────────────────────────────────────
  {
    name: "bitwarden_status",
    description: "Check Bitwarden server health and CLI login status (unauthenticated / locked / unlocked).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "bitwarden_list_items",
    description: "List vault items (names, usernames, URLs, folders). Does NOT return passwords. Vault must be unlocked.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search substring in item name (optional)" },
      },
      required: [],
    },
  },
  {
    name: "bitwarden_get_password",
    description: "Retrieve the password for a specific vault item by its Bitwarden item ID. Vault must be unlocked (via the Passwords page — this reads the server's own unlock session, not a separate one).",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Bitwarden item UUID" },
      },
      required: ["item_id"],
    },
  },
  // ── Search ───────────────────────────────────────────────────────────────
  {
    name: "lintaya_search",
    description: "Search across Dashboards, Boards and Block content — titles, Block Builder text, and already-synced connector items (commits, deployments, tickets, etc.) — by a text query (case-insensitive substring). Each result names the Board (and Dashboard, if the Board belongs to one) it lives in, and carries a URL when the match is a connector item.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for" },
        limit: { type: "number", description: "Max results to return (default 20)" },
      },
      required: ["query"],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  // ── vcenter_summary ────────────────────────────────────────────────────────
  // Combines /api/connectors/status (cluster/datastore counts, syncedAt — not
  // present in the live VM feed) with /api/vms-live (the powered-on/off
  // breakdown) — the same two calls the dashboard's own pages make.
  if (name === "vcenter_summary") {
    const [statusMap, vmsData] = await Promise.all([
      apiRequest("GET", "/api/connectors/status"),
      apiRequest("GET", "/api/vms-live"),
    ]);
    const feeds = statusMap?.vcenter?.feeds;
    const vms = vmsData?.vms || [];
    if (!feeds && !vms.length) return err("No vCenter data synced yet — run vcenter_sync first.");
    return json({
      source: "VMware vCenter (vcenter)",
      syncedAt: feeds?.syncedAt ?? null,
      vms:        feeds?.vms        ?? vms.length,
      hosts:      feeds?.hosts      ?? 0,
      clusters:   feeds?.clusters   ?? 0,
      datastores: feeds?.datastores ?? 0,
      powered_on:  vms.filter(v => v.power_state === "POWERED_ON").length,
      powered_off: vms.filter(v => v.power_state === "POWERED_OFF").length,
    });
  }

  // ── vcenter_list_vms ───────────────────────────────────────────────────────
  if (name === "vcenter_list_vms") {
    const data = await apiRequest("GET", "/api/vms-live");
    const vms0 = data?.vms || [];
    if (!vms0.length) return err("No vCenter data synced yet — run vcenter_sync first.");
    const { filter_power, filter_env, search, limit = 50 } = args;
    let vms = vms0;
    if (filter_power) vms = vms.filter(v => v.power_state === filter_power);
    if (filter_env)   vms = vms.filter(v => v.env === filter_env);
    if (search)       vms = vms.filter(v => v.name.toLowerCase().includes(search.toLowerCase()));
    vms = vms.slice(0, limit).map(v => ({
      id: v.id, name: v.name, power_state: v.power_state,
      env: v.env, cpu: v.cpuCount, mem_gb: v.memGB,
    }));
    return json({ total: vms.length, vms });
  }

  // ── vcenter_find_vm ────────────────────────────────────────────────────────
  if (name === "vcenter_find_vm") {
    const data = await apiRequest("GET", "/api/vms-live");
    const all = data?.vms || [];
    if (!all.length) return err("No vCenter data synced yet — run vcenter_sync first.");
    const q = (args.name || "").toLowerCase();
    const found = all.filter(v => v.name.toLowerCase().includes(q));
    if (!found.length) return ok(`No VMs found matching "${args.name}".`);
    return json(found.map(v => ({
      id: v.id, name: v.name, power_state: v.power_state,
      cpu: v.cpuCount, mem_gb: v.memGB, env: v.env, site: v.site, cluster: v.cluster, ip: v.ip,
    })));
  }

  // ── vcenter_list_hosts ─────────────────────────────────────────────────────
  if (name === "vcenter_list_hosts") {
    const data = await apiRequest("GET", "/api/hosts-live");
    const all = data?.hosts || [];
    if (!all.length) return err("No vCenter data synced yet — run vcenter_sync first.");
    let hosts = all;
    if (args.filter_state) hosts = hosts.filter(h => h.connection_state === args.filter_state);
    return json({ total: hosts.length, hosts: hosts.map(h => ({
      id: h.id, name: h.name,
      connection_state: h.connection_state,
      power_state: h.power_state,
    })) });
  }

  // ── vcenter_sync ───────────────────────────────────────────────────────────
  if (name === "vcenter_sync") {
    return runAction("vcenter", "sync", {});
  }

  // ── bitwarden_status ───────────────────────────────────────────────────────
  if (name === "bitwarden_status") {
    return runAction("bw", "status", {});
  }

  // ── bitwarden_list_items ───────────────────────────────────────────────────
  if (name === "bitwarden_list_items") {
    const items = await apiRequest("GET", "/api/vault/items");
    if (!Array.isArray(items) || !items.length) return err("No vault items in cache — unlock the vault via the Passwords page first.");
    let result = items;
    if (args.search) {
      const q = args.search.toLowerCase();
      result = items.filter(i => i.service?.toLowerCase().includes(q) || i.user?.toLowerCase().includes(q));
    }
    return json({ total: result.length, items: result.map(i => ({
      id: i.id, service: i.service, user: i.user,
      folder: i.folder || null, url: i.url || null, tags: i.tags || [],
    })) });
  }

  // ── bitwarden_get_password ─────────────────────────────────────────────────
  if (name === "bitwarden_get_password") {
    const { item_id } = args;
    if (!item_id) return err("item_id is required.");
    const data = await apiRequest("POST", "/api/vault/get", { itemId: item_id });
    return ok(data.password);
  }

  // ── lintaya_search ─────────────────────────────────────────────────────────
  if (name === "lintaya_search") {
    const query = args.query || "";
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;
    const { modulePages, dashboards, blockCatalog } = await fetchSearchCatalog();
    const pairs = connectorBlockPairsFromBoards({ modulePages, blockCatalog });
    const itemsByKey = new Map();
    await Promise.all([...pairs.entries()].map(async ([key, block]) => {
      const cached = searchItemsCache.get(key);
      if (cached && Date.now() - cached.at < 60_000) { itemsByKey.set(key, cached.items); return; }
      try {
        const data = await apiRequest("GET", `/api/connectors/${block.connectorId}/blocks/${block.blockId}`);
        const items = data?.items || [];
        searchItemsCache.set(key, { at: Date.now(), items });
        itemsByKey.set(key, items);
      } catch {
        itemsByKey.set(key, cached?.items || []);
      }
    }));
    const entries = buildSearchEntries({ modulePages, dashboards, blockCatalog, itemsByKey });
    const results = matchSearchEntries(entries, query, limit);
    return json({ total: results.length, results });
  }

  // ── generated (every other connector type) ────────────────────────────────
  if (generatedRoutes.has(name)) {
    const { connectorTypeId, actionId } = generatedRoutes.get(name);
    const { connectionId, ...input } = args;
    return runAction(connectionId || connectorTypeId, actionId, input);
  }

  return err(`Unknown tool: ${name}`);
}

// ── MCP Server setup ─────────────────────────────────────────────────────────
const server = new Server(
  { name: "lintaya", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const actions = await fetchActionsCatalog();
  const routes = new Map();
  const generated = [];
  for (const action of actions) {
    if (HAND_WRITTEN_TYPES.has(action.connectorTypeId)) continue;
    const tool = buildGeneratedTool(action);
    routes.set(tool.name, { connectorTypeId: action.connectorTypeId, actionId: action.id });
    generated.push(tool);
  }
  generatedRoutes = routes;
  return { tools: [...TOOLS, ...generated] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleTool(name, args || {});
  } catch (e) {
    return err(e.message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is reserved for MCP protocol
  process.stderr.write(`[lintaya MCP] server started, calling ${BASE_URL}\n`);
}

main().catch(e => {
  process.stderr.write(`[lintaya MCP] fatal: ${e.message}\n`);
  process.exit(1);
});
