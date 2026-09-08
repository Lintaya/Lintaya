// Tools the built-in Assistant (server/routes/ai-settings.js) can call to
// create real Boards/Dashboards/Blocks instead of only talking about them.
//
// Split the same way the Action Registry classifies `effect` (AGENT-001,
// ADR-011) — "read" vs "write", not connector-specific here since these are
// Lintaya's own objects, not connector actions:
//   - read tools run immediately, server-side, and their result goes back to
//     the model in the same turn (see the tool loop in ai-settings.js).
//   - write tools never execute on their own. /api/chat files a pending
//     request in the Approval Center (SEC-003) and returns a `toolProposal`
//     over SSE instead of running the handler; the client shows a
//     confirm/cancel card, and only POST /api/approvals/:id/approve (after
//     the human resolves it) actually calls the write handler below — see
//     server/routes/approvals.js's ASSISTANT_CONNECTOR_TYPE_ID branch.
//
// The create* handlers here are the SAME functions server/routes/*.js use
// for the equivalent REST route (createBoardRecord, createDashboardRecord,
// createCustomBlockRecord) — one shape/validation, reused, not reimplemented
// for the Assistant.
const { listConnectorBlocks } = require("../connectors/registry");
const { createBoardRecord } = require("../routes/module-pages");
const { createDashboardRecord } = require("../routes/dashboards");
const { createCustomBlockRecord } = require("../routes/custom-blocks");
const ZoneTree = require("../../app/zone-tree.js");

const TOOL_DEFS = [
  {
    name: "list_boards",
    kind: "read",
    description: "Lista los Boards existentes (id, título, cantidad de blocks). Usar antes de crear un Dashboard o para no crear un Board duplicado.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_dashboards",
    kind: "read",
    description: "Lista los Dashboards existentes (id, título, títulos de los Boards que contiene).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_connector_blocks",
    kind: "read",
    description: "Lista los blocks de conector disponibles (ej. gitlab.recent-commits) — solo de conectores ya configurados — para usar en add_connector_block.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_custom_blocks",
    kind: "read",
    description: "Lista los Blocks personalizados existentes (id, título, tipo y formato) para reutilizarlos en un Board sin inventar ids.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_board",
    kind: "write",
    description: "Crea un Board nuevo con uno o más Blocks ya existentes (ids de list_connector_blocks, o recién creados con create_content_block/add_connector_block). Todos los blocks quedan en una sola zona; el usuario puede reorganizarlos después en Board Builder.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del Board" },
        icon: { type: "string", description: "Nombre de ícono opcional" },
        blockIds: { type: "array", items: { type: "string" }, description: "Ids de Block a colocar, ej. [\"gitlab.recent-commits\", \"custom-1234\"]" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_content_block",
    kind: "write",
    description: "Crea un Block de contenido — texto redactado por el Asistente en Markdown o HTML — para notas, runbooks, resúmenes, etc. No involucra ningún conector.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        format: { type: "string", enum: ["md", "html"], description: "Por defecto md" },
        content: { type: "string", description: "El contenido en sí, ya redactado" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "add_connector_block",
    kind: "write",
    description: "Agrega un Block que muestra datos en vivo de un conector ya configurado. Usar list_connector_blocks primero para conseguir un connectorId/blockId válido.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        connectorId: { type: "string" },
        blockId: { type: "string" },
        limit: { type: "number", description: "Cantidad de items a mostrar; por defecto 10" },
      },
      required: ["title", "connectorId", "blockId"],
    },
  },
  {
    name: "create_dashboard",
    kind: "write",
    description: "Crea un Dashboard — un contenedor de Boards organizados como tabs. Usar list_boards primero para conseguir ids reales.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        icon: { type: "string" },
        boardIds: { type: "array", items: { type: "string" }, description: "Ids de Boards a incluir, en el orden en que deben aparecer" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_dashboard_bundle",
    kind: "write",
    description: "Crea o actualiza en una sola propuesta aprobable un Dashboard completo: redacta Blocks de contenido, crea cada Board con sus Blocks distribuidos en zonas y finalmente enlaza los Boards al Dashboard. Usar cuando el usuario pide la jerarquía completa; evita encadenar ids entre varias aprobaciones.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dashboardId: { type: "string", description: "ID real de un Dashboard existente que se debe actualizar; omitir para crear uno nuevo" },
        title: { type: "string", description: "Título del Dashboard" },
        icon: { type: "string", description: "Ícono opcional del Dashboard" },
        showInSidebar: { type: "boolean", description: "Visibilidad del Dashboard en el sidebar; por defecto true" },
        boards: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string", description: "Título del Board" },
              icon: { type: "string", description: "Ícono opcional del Board" },
              showInSidebar: { type: "boolean", description: "Visibilidad del Board en el sidebar; por defecto false dentro de un Dashboard compuesto" },
              layoutPreset: { type: "string", enum: ["single", "columns", "rows", "grid", "priority", "focus"], description: "Preset de zonas; el número de Blocks debe coincidir con sus zonas, salvo single" },
              blocks: {
                type: "array",
                minItems: 1,
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    format: { type: "string", enum: ["md", "html"] },
                    content: { type: "string", description: "Contenido completo ya redactado" },
                  },
                  required: ["title", "content"],
                },
              },
            },
            required: ["title", "blocks"],
          },
        },
      },
      required: ["title", "boards"],
    },
  },
];

const READ_TOOL_NAMES = new Set(TOOL_DEFS.filter(t => t.kind === "read").map(t => t.name));
const WRITE_TOOL_NAMES = new Set(TOOL_DEFS.filter(t => t.kind === "write").map(t => t.name));

function isReadTool(name) { return READ_TOOL_NAMES.has(name); }
function isWriteTool(name) { return WRITE_TOOL_NAMES.has(name); }
function isKnownTool(name) { return isReadTool(name) || isWriteTool(name); }

function toAnthropicTools(defs = TOOL_DEFS) {
  return defs.map(d => ({ name: d.name, description: d.description, input_schema: d.inputSchema }));
}

function toOpenAITools(defs = TOOL_DEFS) {
  return defs.map(d => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.inputSchema } }));
}

// ── Read handlers — safe to run without confirmation, result goes back to the model ──
function listBoardsSummary({ kvGet }) {
  const pages = kvGet("module-pages")?.value || [];
  return pages
    .filter(p => p.active !== false)
    .map(p => ({ id: p.id, title: p.title, blockCount: ZoneTree.countBlocks(p.tree) }));
}

function listDashboardsSummary({ kvGet }) {
  const dashboards = kvGet("dashboards")?.value || [];
  const pages = kvGet("module-pages")?.value || [];
  const titleById = new Map(pages.map(p => [p.id, p.title]));
  return dashboards
    .filter(d => d.active !== false)
    .map(d => ({ id: d.id, title: d.title, boards: (d.boardIds || []).map(id => titleById.get(id) || id) }));
}

function listConnectorBlockTemplates({ kvGet, kvGetByPrefix }) {
  const configuredKv = kvGetByPrefix ? kvGetByPrefix("connector-config-") : {};
  const configuredIds = new Set(Object.keys(configuredKv).map(key => key.slice("connector-config-".length)));
  return listConnectorBlocks()
    .filter(b => configuredIds.has(b.connectorId))
    .map(b => ({ id: b.id, connectorId: b.connectorId, blockId: b.blockId, title: b.title }));
}

function listCustomBlocksSummary({ kvGet }) {
  return (kvGet("custom-blocks")?.value || [])
    .filter(block => block.active !== false)
    .map(block => ({
      id: block.id,
      title: block.title,
      kind: block.kind || "connector",
      ...(block.kind === "content" ? { format: block.format || "md" } : {}),
    }));
}

const READ_HANDLERS = {
  list_boards: listBoardsSummary,
  list_dashboards: listDashboardsSummary,
  list_connector_blocks: listConnectorBlockTemplates,
  list_custom_blocks: listCustomBlocksSummary,
};

function runReadTool(name, args, ctx) {
  const handler = READ_HANDLERS[name];
  if (!handler) throw new Error(`unknown read tool: ${name}`);
  return handler(ctx, args || {});
}

// ── Write handlers — never called automatically, only after a human approves the proposal in the Approval Center ──
function runCreateBoard(ctx, args) {
  const blockIds = Array.isArray(args?.blockIds) ? args.blockIds.filter(Boolean).map(String) : [];
  const tree = ZoneTree.leaf(blockIds);
  return createBoardRecord(ctx, { title: args?.title, icon: args?.icon, tree });
}

function runCreateContentBlock(ctx, args) {
  return createCustomBlockRecord(ctx, {
    kind: "content",
    title: args?.title,
    format: args?.format === "html" ? "html" : "md",
    content: args?.content,
  });
}

function runAddConnectorBlock(ctx, args) {
  return createCustomBlockRecord(ctx, {
    kind: "connector",
    title: args?.title,
    connectorId: args?.connectorId,
    blockId: args?.blockId,
    limit: args?.limit,
  });
}

function runCreateDashboard(ctx, args) {
  const boardIds = Array.isArray(args?.boardIds) ? args.boardIds.filter(Boolean).map(String) : [];
  return createDashboardRecord(ctx, { title: args?.title, icon: args?.icon, boardIds });
}

function requiredText(value, error) {
  if (typeof value !== "string" || !value.trim()) throw new Error(error);
  return value.trim();
}

function assertUniqueTitles(values, error) {
  const normalized = values.map(value => value.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error(error);
}

const PRESET_ZONE_COUNTS = { single: 1, columns: 2, rows: 2, grid: 4, priority: 3, focus: 3 };

function treeWithBlocksInZones(blockIds, preset = "single") {
  const factory = ZoneTree.PRESETS[preset];
  if (!factory) throw new Error("invalid-board-layout-preset");
  if (preset !== "single" && blockIds.length !== PRESET_ZONE_COUNTS[preset]) {
    throw new Error(`layout-${preset}-requires-${PRESET_ZONE_COUNTS[preset]}-blocks`);
  }
  if (preset === "single") return ZoneTree.leaf(blockIds);
  let index = 0;
  const fill = node => node.t === "z"
    ? { ...node, blocks: [blockIds[index++]] }
    : { ...node, a: fill(node.a), b: fill(node.b) };
  return fill(factory());
}

function assertSecureMediaReferences(content) {
  const urls = [];
  const markdownImage = /!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
  const htmlMedia = /<(?:img|video|audio|source)\b[^>]*\b(?:src|poster)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = markdownImage.exec(content))) urls.push(match[1]);
  while ((match = htmlMedia.exec(content))) urls.push(match[1]);
  if (urls.some(url => !/^https:\/\//i.test(url))) throw new Error("bundle-media-urls-must-use-https");
}

function runCreateDashboardBundle(ctx, args) {
  const title = requiredText(args?.title, "dashboard-title-required");
  const dashboardId = typeof args?.dashboardId === "string" && args.dashboardId.trim() ? args.dashboardId.trim() : null;
  const boardsInput = args?.boards;
  if (!Array.isArray(boardsInput) || boardsInput.length < 1 || boardsInput.length > 12) {
    throw new Error("boards-must-contain-between-1-and-12-items");
  }

  const boards = boardsInput.map((board, boardIndex) => {
    const boardTitle = requiredText(board?.title, `board-title-required-at-${boardIndex}`);
    if (!Array.isArray(board?.blocks) || board.blocks.length < 1 || board.blocks.length > 20) {
      throw new Error(`board-blocks-must-contain-between-1-and-20-items-at-${boardIndex}`);
    }
    return {
      title: boardTitle,
      icon: board.icon,
      showInSidebar: board.showInSidebar === true,
      layoutPreset: board.layoutPreset || "single",
      blocks: board.blocks.map((block, blockIndex) => {
        const content = requiredText(block?.content, `block-content-required-at-${boardIndex}-${blockIndex}`);
        assertSecureMediaReferences(content);
        return {
          title: requiredText(block?.title, `block-title-required-at-${boardIndex}-${blockIndex}`),
          format: block?.format === "html" ? "html" : "md",
          content,
        };
      }),
    };
  });

  for (const board of boards) treeWithBlocksInZones(board.blocks.map((_, index) => String(index)), board.layoutPreset);

  const allBlockTitles = boards.flatMap(board => board.blocks.map(block => block.title));
  if (allBlockTitles.length > 40) throw new Error("dashboard-bundle-block-limit-exceeded");
  assertUniqueTitles(boards.map(board => board.title), "duplicate-board-title-in-bundle");
  assertUniqueTitles(allBlockTitles, "duplicate-block-title-in-bundle");

  const existingDashboards = ctx.kvGet("dashboards")?.value || [];
  const existingBoards = ctx.kvGet("module-pages")?.value || [];
  const existingBlocks = ctx.kvGet("custom-blocks")?.value || [];
  const sameTitle = (left, right) => String(left || "").trim().toLocaleLowerCase() === right.toLocaleLowerCase();
  const existingDashboard = dashboardId ? existingDashboards.find(item => item.id === dashboardId) : null;
  if (dashboardId && !existingDashboard) throw new Error("dashboard-not-found");
  if (existingDashboards.some(item => item.id !== dashboardId && sameTitle(item.title, title))) throw new Error("dashboard-title-already-exists");
  if (boards.some(board => existingBoards.some(item => sameTitle(item.title, board.title)))) throw new Error("board-title-already-exists");
  if (allBlockTitles.some(blockTitle => existingBlocks.some(item => sameTitle(item.title, blockTitle)))) throw new Error("block-title-already-exists");

  const createdBlocks = [];
  const createdBoards = [];
  try {
    for (const board of boards) {
      const boardBlocks = board.blocks.map(block => {
        const created = createCustomBlockRecord(ctx, { kind: "content", ...block });
        createdBlocks.push(created);
        return created;
      });
      createdBoards.push(createBoardRecord(ctx, {
        title: board.title,
        icon: board.icon,
        showInSidebar: board.showInSidebar,
        tree: treeWithBlocksInZones(boardBlocks.map(block => block.id), board.layoutPreset),
      }));
    }
    const boardIds = createdBoards.map(board => board.id);
    let dashboard;
    if (existingDashboard) {
      dashboard = {
        ...existingDashboard,
        title,
        ...(args?.icon !== undefined ? { icon: String(args.icon) } : {}),
        showInSidebar: args?.showInSidebar !== false,
        active: true,
        boardIds,
        selectedBoardId: boardIds[0] || null,
        updatedAt: new Date().toISOString(),
      };
      ctx.kvSet("dashboards", existingDashboards.map(item => item.id === dashboardId ? dashboard : item));
    } else {
      dashboard = createDashboardRecord(ctx, {
        title,
        icon: args?.icon,
        showInSidebar: args?.showInSidebar !== false,
        boardIds,
      });
    }
    return { title: dashboard.title, dashboard, boards: createdBoards, blocks: createdBlocks };
  } catch (error) {
    ctx.kvSet("custom-blocks", existingBlocks);
    ctx.kvSet("module-pages", existingBoards);
    ctx.kvSet("dashboards", existingDashboards);
    throw error;
  }
}

const WRITE_HANDLERS = {
  create_board: runCreateBoard,
  create_content_block: runCreateContentBlock,
  add_connector_block: runAddConnectorBlock,
  create_dashboard: runCreateDashboard,
  create_dashboard_bundle: runCreateDashboardBundle,
};

function runWriteTool(name, args, ctx) {
  const handler = WRITE_HANDLERS[name];
  if (!handler) throw new Error(`unknown write tool: ${name}`);
  return handler(ctx, args || {});
}

// Human-readable summary for the confirm/cancel card in the chat UI.
function describeToolCall(name, args = {}) {
  switch (name) {
    case "create_board":
      return `Crear Board "${args.title}"${args.blockIds?.length ? ` con ${args.blockIds.length} block(s)` : ""}`;
    case "create_content_block":
      return `Crear Block de contenido "${args.title}"`;
    case "add_connector_block":
      return `Agregar Block "${args.title}" (${args.connectorId}.${args.blockId})`;
    case "create_dashboard":
      return `Crear Dashboard "${args.title}"${args.boardIds?.length ? ` con ${args.boardIds.length} Board(s)` : ""}`;
    case "create_dashboard_bundle": {
      const boards = Array.isArray(args.boards) ? args.boards : [];
      const blocks = boards.reduce((total, board) => total + (Array.isArray(board.blocks) ? board.blocks.length : 0), 0);
      return `${args.dashboardId ? "Actualizar" : "Crear"} Dashboard completo "${args.title}" con ${boards.length} Board(s) y ${blocks} Block(s)`;
    }
    default:
      return name;
  }
}

module.exports = {
  TOOL_DEFS,
  isReadTool,
  isWriteTool,
  isKnownTool,
  toAnthropicTools,
  toOpenAITools,
  runReadTool,
  runWriteTool,
  describeToolCall,
};
