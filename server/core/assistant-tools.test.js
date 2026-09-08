const assert = require("node:assert/strict");
const test = require("node:test");
const ZoneTree = require("../../app/zone-tree.js");
const {
  TOOL_DEFS, isReadTool, isWriteTool, isKnownTool,
  toAnthropicTools, toOpenAITools,
  runReadTool, runWriteTool, describeToolCall,
} = require("./assistant-tools");

function memoryCtx(seed = {}) {
  const kv = new Map(Object.entries(seed));
  return {
    kv,
    kvGet: (key) => (kv.has(key) ? { value: kv.get(key) } : null),
    kvSet: (key, value) => kv.set(key, value),
    kvGetByPrefix: (prefix) => Object.fromEntries([...kv].filter(([key]) => key.startsWith(prefix))),
  };
}

test("every tool is classified as exactly read or write, never both or neither", () => {
  for (const def of TOOL_DEFS) {
    assert.ok(def.kind === "read" || def.kind === "write", `${def.name} has an invalid kind`);
    assert.equal(isReadTool(def.name), def.kind === "read");
    assert.equal(isWriteTool(def.name), def.kind === "write");
    assert.ok(isKnownTool(def.name));
  }
  assert.equal(isKnownTool("not_a_real_tool"), false);
});

test("toAnthropicTools and toOpenAITools translate the same schema into each provider's shape", () => {
  const anthropic = toAnthropicTools();
  const openai = toOpenAITools();
  assert.equal(anthropic.length, TOOL_DEFS.length);
  assert.equal(openai.length, TOOL_DEFS.length);
  const board = anthropic.find(t => t.name === "create_board");
  assert.ok(board.input_schema.properties.title);
  const boardFn = openai.find(t => t.function.name === "create_board");
  assert.equal(boardFn.type, "function");
  assert.ok(boardFn.function.parameters.properties.title);
});

test("list_boards reports title and block count without leaking the full tree", () => {
  const ctx = memoryCtx({
    "module-pages": [
      { id: "page-1", title: "Infra", active: true, tree: { t: "z", k: "z1", blocks: ["gitlab.recent-commits", "custom-1"] } },
      { id: "page-2", title: "Archivado", active: false, tree: { t: "z", k: "z1", blocks: [] } },
    ],
  });
  const result = runReadTool("list_boards", {}, ctx);
  assert.deepEqual(result, [{ id: "page-1", title: "Infra", blockCount: 2 }]);
});

test("list_dashboards resolves board ids to their titles", () => {
  const ctx = memoryCtx({
    "module-pages": [{ id: "page-1", title: "Infra", active: true, tree: { t: "z", k: "z1", blocks: [] } }],
    "dashboards": [{ id: "dash-1", title: "Semanal", active: true, boardIds: ["page-1", "page-missing"] }],
  });
  const result = runReadTool("list_dashboards", {}, ctx);
  assert.deepEqual(result, [{ id: "dash-1", title: "Semanal", boards: ["Infra", "page-missing"] }]);
});

test("list_connector_blocks only returns templates for connectors that are actually configured", () => {
  const ctx = memoryCtx({ "connector-config-gitlab": { baseUrl: "https://gitlab.local" } });
  const result = runReadTool("list_connector_blocks", {}, ctx);
  assert.ok(result.every(b => b.connectorId === "gitlab"), "leaked a block from an unconfigured connector");
  assert.ok(result.some(b => b.id === "gitlab.recent-commits"));
});

test("list_custom_blocks exposes reusable ids without returning block content", () => {
  const ctx = memoryCtx({
    "custom-blocks": [
      { id: "custom-1", title: "Perro", kind: "content", format: "md", content: "contenido privado" },
      { id: "custom-2", title: "Inactivo", kind: "content", active: false, content: "oculto" },
    ],
  });
  assert.deepEqual(runReadTool("list_custom_blocks", {}, ctx), [
    { id: "custom-1", title: "Perro", kind: "content", format: "md" },
  ]);
});

test("runReadTool rejects an unknown tool name", () => {
  assert.throws(() => runReadTool("delete_everything", {}, memoryCtx()), /unknown read tool/);
});

test("create_board builds a single-zone tree from the given block ids", () => {
  const ctx = memoryCtx();
  const board = runWriteTool("create_board", { title: "Infra", blockIds: ["gitlab.recent-commits", "custom-1"] }, ctx);
  assert.equal(board.title, "Infra");
  assert.deepEqual(board.tree.blocks, ["gitlab.recent-commits", "custom-1"]);
  assert.equal(ctx.kv.get("module-pages").length, 1);
});

test("create_content_block writes a kind:content block with the model's own text", () => {
  const ctx = memoryCtx();
  const block = runWriteTool("create_content_block", { title: "Runbook", content: "# Pasos\n1. Uno" }, ctx);
  assert.equal(block.kind, "content");
  assert.equal(block.format, "md");
  assert.match(block.content, /Pasos/);
});

test("add_connector_block requires connectorId and blockId (reuses custom-blocks validation)", () => {
  const ctx = memoryCtx();
  assert.throws(() => runWriteTool("add_connector_block", { title: "Commits" }, ctx), /connectorId-and-blockId-required/);
  const block = runWriteTool("add_connector_block", { title: "Commits", connectorId: "gitlab", blockId: "recent-commits" }, ctx);
  assert.equal(block.kind, "connector");
  assert.equal(block.connectorId, "gitlab");
});

test("create_dashboard accepts an empty boardIds list (an empty shell is valid)", () => {
  const ctx = memoryCtx();
  const dashboard = runWriteTool("create_dashboard", { title: "Nuevo" }, ctx);
  assert.deepEqual(dashboard.boardIds, []);
});

test("create_dashboard_bundle creates Blocks, Boards and their Dashboard with real unique ids", () => {
  const ctx = memoryCtx();
  const result = runWriteTool("create_dashboard_bundle", {
    title: "Atlas de animales",
    icon: "paw",
    boards: [
      { title: "Mascotas", blocks: [
        { title: "Perro", content: "# Perro" },
        { title: "Gato", content: "# Gato" },
      ] },
      { title: "Fauna marina", blocks: [
        { title: "Ballena", content: "# Ballena" },
      ] },
    ],
  }, ctx);

  assert.equal(result.title, "Atlas de animales");
  assert.equal(result.blocks.length, 3);
  assert.equal(new Set(result.blocks.map(block => block.id)).size, 3);
  assert.equal(result.boards.length, 2);
  assert.ok(result.boards.every(board => board.showInSidebar === false));
  assert.deepEqual(result.boards[0].tree.blocks, result.blocks.slice(0, 2).map(block => block.id));
  assert.deepEqual(result.dashboard.boardIds, result.boards.map(board => board.id));
  assert.equal(result.dashboard.selectedBoardId, result.boards[0].id);
  assert.equal(ctx.kv.get("custom-blocks").length, 3);
  assert.equal(ctx.kv.get("module-pages").length, 2);
  assert.equal(ctx.kv.get("dashboards").length, 1);
});

test("create_dashboard_bundle distributes three Blocks across priority zones and can update an existing Dashboard", () => {
  const ctx = memoryCtx({
    dashboards: [{ id: "dashboard-atlas", title: "Atlas de animales", active: true, showInSidebar: true, boardIds: ["old-board"], selectedBoardId: "old-board" }],
  });
  const result = runWriteTool("create_dashboard_bundle", {
    dashboardId: "dashboard-atlas",
    title: "Atlas de animales",
    boards: [{
      title: "Perro",
      layoutPreset: "priority",
      blocks: [
        { title: "Perro - presentación", content: "![Perro](https://commons.wikimedia.org/wiki/Special:FilePath/Golden_Retriever.jpg)" },
        { title: "Perro - ficha", content: "# Ficha" },
        { title: "Perro - datos", content: "# Datos" },
      ],
    }],
  }, ctx);

  const zones = ZoneTree.flatten(result.boards[0].tree).zones;
  assert.equal(zones.length, 3);
  assert.deepEqual(zones.map(zone => zone.blocks.length), [1, 1, 1]);
  assert.equal(result.boards[0].showInSidebar, false);
  assert.equal(result.dashboard.id, "dashboard-atlas");
  assert.deepEqual(result.dashboard.boardIds, [result.boards[0].id]);
  assert.equal(ctx.kv.get("dashboards").length, 1, "updating must not duplicate the Dashboard");
});

test("create_dashboard_bundle rejects insecure media and a zone/block mismatch before writing", () => {
  const ctx = memoryCtx();
  assert.throws(() => runWriteTool("create_dashboard_bundle", {
    title: "Atlas",
    boards: [{ title: "Perro", blocks: [{ title: "Imagen", content: "![Perro](http://example.com/dog.jpg)" }] }],
  }, ctx), /bundle-media-urls-must-use-https/);
  assert.throws(() => runWriteTool("create_dashboard_bundle", {
    title: "Atlas",
    boards: [{
      title: "Perro", layoutPreset: "priority",
      blocks: [{ title: "Uno", content: "uno" }, { title: "Dos", content: "dos" }],
    }],
  }, ctx), /layout-priority-requires-3-blocks/);
  assert.equal(ctx.kv.has("custom-blocks"), false);
  assert.equal(ctx.kv.has("module-pages"), false);
  assert.equal(ctx.kv.has("dashboards"), false);
});

test("create_dashboard_bundle rejects duplicate existing titles before creating anything", () => {
  const existingBoard = { id: "page-1", title: "Mascotas", tree: { t: "z", k: "z1", blocks: [] } };
  const ctx = memoryCtx({ "module-pages": [existingBoard] });
  assert.throws(() => runWriteTool("create_dashboard_bundle", {
    title: "Atlas de animales",
    boards: [{ title: "Mascotas", blocks: [{ title: "Perro", content: "# Perro" }] }],
  }, ctx), /board-title-already-exists/);
  assert.deepEqual(ctx.kv.get("module-pages"), [existingBoard]);
  assert.equal(ctx.kv.has("custom-blocks"), false);
  assert.equal(ctx.kv.has("dashboards"), false);
});

test("runWriteTool rejects an unknown tool name", () => {
  assert.throws(() => runWriteTool("delete_everything", {}, memoryCtx()), /unknown write tool/);
});

test("describeToolCall renders a short human summary for the confirm card", () => {
  assert.match(describeToolCall("create_board", { title: "Infra", blockIds: ["a", "b"] }), /Crear Board "Infra".*2 block/);
  assert.match(describeToolCall("create_dashboard", { title: "Semanal" }), /Crear Dashboard "Semanal"/);
  assert.match(describeToolCall("add_connector_block", { title: "Commits", connectorId: "gitlab", blockId: "recent-commits" }), /gitlab\.recent-commits/);
  assert.match(describeToolCall("create_dashboard_bundle", {
    title: "Atlas", boards: [{ title: "Mascotas", blocks: [{ title: "Perro", content: "x" }] }],
  }), /Dashboard completo "Atlas".*1 Board.*1 Block/);
});
