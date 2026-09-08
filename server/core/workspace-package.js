const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");

const FORMAT = "lintaya-workspace-package";
const VERSION = 1;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../schemas/workspace-package.schema.json"), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const FORBIDDEN_KEYS = /(?:password|passwd|token|secret|api[-_]?key|vault|session|cookie|authorization|cache|synced(?:data|records)?)/i;
const UNSAFE_HTML = /<\s*(?:script|iframe|object|embed|link|meta)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*javascript:/i;

function findForbiddenKey(value, pathParts = []) {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) return [...pathParts, key].join(".");
    const nested = findForbiddenKey(child, [...pathParts, key]);
    if (nested) return nested;
  }
  return null;
}

// tolerateUnresolvedRefs is used only on the import path: a Board or
// Dashboard whose tree/refs point at a key missing from this particular
// package (e.g. the source pruned a Block, or the export was partial) no
// longer invalidates the whole package. Export (buildWorkspacePackage)
// never sets this — a package Lintaya itself generates must always be
// internally consistent, so a dangling ref there is a real bug.
function validateWorkspacePackage(value, { tolerateUnresolvedRefs = false } = {}) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { return { valid: false, errors: ["package must be JSON-serializable"], unresolvedBoardKeys: [] }; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PACKAGE_BYTES) {
    return { valid: false, errors: [`package exceeds ${MAX_PACKAGE_BYTES} bytes`], unresolvedBoardKeys: [] };
  }
  const valid = validateSchema(value);
  const errors = valid ? [] : (validateSchema.errors || []).map(error => `${error.instancePath || "(root)"} ${error.message}`);
  const forbidden = findForbiddenKey(value);
  if (forbidden) errors.push(`${forbidden} is not allowed in a portable package`);
  const resources = value?.resources;
  const unresolvedBoardKeys = new Set();
  if (resources && typeof resources === "object") {
    const all = [...(resources.blocks || []), ...(resources.requirements || []), ...(resources.boards || []), ...(resources.dashboards || [])];
    const keys = all.map(resource => resource?.key).filter(Boolean);
    const known = new Set(keys);
    if (known.size !== keys.length) errors.push("resource keys must be unique across the package");
    const reportDangling = (message, boardKey) => {
      if (!tolerateUnresolvedRefs) { errors.push(message); return; }
      if (boardKey) unresolvedBoardKeys.add(boardKey);
    };
    const checkTree = (node, boardKey) => {
      if (node?.t === "z") {
        for (const ref of node.blocks || []) if (!known.has(ref)) reportDangling(`${boardKey} references missing ${ref}`, boardKey);
      } else if (node?.t === "s") {
        checkTree(node.a, boardKey);
        checkTree(node.b, boardKey);
      }
    };
    for (const board of resources.boards || []) checkTree(board.tree, board.key);
    for (const dashboard of resources.dashboards || []) {
      for (const ref of dashboard.boards || []) if (!known.has(ref)) reportDangling(`${dashboard.key} references missing ${ref}`, null);
      if (dashboard.selectedBoard !== null && !(dashboard.boards || []).includes(dashboard.selectedBoard)) {
        errors.push(`${dashboard.key} selectedBoard must belong to boards`);
      }
    }
  }
  for (const block of value?.resources?.blocks || []) {
    if (block.format === "html" && UNSAFE_HTML.test(block.content)) errors.push(`resources.blocks[${block.key}] contains unsafe HTML`);
  }
  return { valid: errors.length === 0, errors, unresolvedBoardKeys: [...unresolvedBoardKeys] };
}

function portableTree(tree, blockKeyFor) {
  let zoneNumber = 0;
  const walk = node => {
    if (node?.t === "z") return { t: "z", key: `zone:${++zoneNumber}`, blocks: (node.blocks || []).map(blockKeyFor) };
    if (node?.t === "s") return { t: "s", key: `split:${++zoneNumber}`, dir: node.dir, ratio: node.ratio, a: walk(node.a), b: walk(node.b) };
    throw new Error("invalid-board-tree");
  };
  return walk(tree);
}

function buildWorkspacePackage({ dashboardIds = [], boardIds = [], dashboards = [], boards = [], customBlocks = [], resolveConnectorType = id => id, connectionAlias = id => id, now = () => new Date() }) {
  const dashboardById = new Map(dashboards.map(item => [item.id, item]));
  const boardById = new Map(boards.map(item => [item.id, item]));
  const customById = new Map(customBlocks.map(item => [item.id, item]));
  const selectedDashboards = dashboardIds.map(id => dashboardById.get(id));
  if (selectedDashboards.some(item => !item)) throw new Error("dashboard-not-found");
  const orderedBoardIds = [];
  const addBoard = id => { if (!orderedBoardIds.includes(id)) orderedBoardIds.push(id); };
  selectedDashboards.forEach(item => item.boardIds.forEach(addBoard));
  boardIds.forEach(addBoard);
  const selectedBoards = orderedBoardIds.map(id => boardById.get(id));
  if (selectedBoards.some(item => !item)) throw new Error("board-not-found");

  const blocks = [];
  const requirements = [];
  const blockKeys = new Map();
  function blockKeyFor(localId) {
    if (blockKeys.has(localId)) return blockKeys.get(localId);
    const custom = customById.get(localId);
    if (custom?.kind === "content") {
      const key = `block:content-${blocks.length + 1}`;
      blocks.push({
        key, kind: "content", title: custom.title, description: custom.description ?? null,
        icon: custom.icon ?? null, format: custom.format === "html" ? "html" : "md",
        content: custom.content, prompt: custom.prompt ?? null, rules: custom.rules ?? null,
      });
      blockKeys.set(localId, key);
      return key;
    }
    let connectorId;
    let blockId;
    let title;
    let scope;
    let limit;
    if (custom?.kind === "connector" || (custom && custom.connectorId && custom.blockId)) {
      ({ connectorId, blockId, title, scope, limit } = custom);
    } else {
      const separator = String(localId).lastIndexOf(".");
      if (separator <= 0) throw new Error(`block-not-portable:${localId}`);
      connectorId = localId.slice(0, separator);
      blockId = localId.slice(separator + 1);
    }
    const key = `requirement:connector-${requirements.length + 1}`;
    requirements.push({
      key, connectorTypeId: resolveConnectorType(connectorId), blockId,
      connectionAlias: connectionAlias(connectorId),
      ...(title ? { title } : {}), ...(scope !== undefined ? { scope } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    blockKeys.set(localId, key);
    return key;
  }

  const boardKeyById = new Map(selectedBoards.map((board, index) => [board.id, `board:item-${index + 1}`]));
  const portableBoards = selectedBoards.map(board => ({
    key: boardKeyById.get(board.id), title: board.title, icon: board.icon || "grid",
    tree: portableTree(board.tree, blockKeyFor),
  }));
  const portableDashboards = selectedDashboards.map((dashboard, index) => ({
    key: `dashboard:item-${index + 1}`, title: dashboard.title, icon: dashboard.icon || "grid",
    boards: dashboard.boardIds.map(id => boardKeyById.get(id)),
    selectedBoard: dashboard.selectedBoardId ? boardKeyById.get(dashboard.selectedBoardId) : null,
  }));
  const packageValue = { format: FORMAT, version: VERSION, exportedAt: now().toISOString(), resources: { blocks, requirements, boards: portableBoards, dashboards: portableDashboards } };
  const validation = validateWorkspacePackage(packageValue);
  if (!validation.valid) throw new Error(`invalid-generated-package:${validation.errors.join("|")}`);
  return packageValue;
}

function previewWorkspaceImport(value, { existingBlocks = [], existingBoards = [], existingDashboards = [], connectionCandidates = () => [] } = {}) {
  const validation = validateWorkspacePackage(value, { tolerateUnresolvedRefs: true });
  if (!validation.valid) return { valid: false, errors: validation.errors };
  const resources = value.resources;
  const sameTitle = (items, title) => items.filter(item => String(item.title || "").trim().toLowerCase() === String(title).trim().toLowerCase());
  const conflicts = [
    ...resources.blocks.flatMap(item => sameTitle(existingBlocks, item.title).length ? [{ resourceType: "block", key: item.key, title: item.title, existingIds: sameTitle(existingBlocks, item.title).map(match => match.id) }] : []),
    ...resources.boards.flatMap(item => sameTitle(existingBoards, item.title).length ? [{ resourceType: "board", key: item.key, title: item.title, existingIds: sameTitle(existingBoards, item.title).map(match => match.id) }] : []),
    ...resources.dashboards.flatMap(item => sameTitle(existingDashboards, item.title).length ? [{ resourceType: "dashboard", key: item.key, title: item.title, existingIds: sameTitle(existingDashboards, item.title).map(match => match.id) }] : []),
  ];
  const requirements = resources.requirements.map(requirement => {
    const candidates = connectionCandidates(requirement.connectorTypeId).map(candidate => ({ id: candidate.id, name: candidate.name || candidate.id }));
    const alias = requirement.connectionAlias.toLowerCase();
    const matches = candidates.filter(candidate => candidate.id.toLowerCase() === alias || candidate.name.toLowerCase() === alias);
    return {
      key: requirement.key, connectorTypeId: requirement.connectorTypeId,
      blockId: requirement.blockId, connectionAlias: requirement.connectionAlias,
      status: matches.length === 1 ? "matched" : "needs-mapping",
      connectionId: matches.length === 1 ? matches[0].id : null,
      candidates,
    };
  });
  const importResources = [
    ...resources.blocks.map(item => ({ resourceType: "block", key: item.key, title: item.title })),
    ...resources.boards.map(item => ({ resourceType: "board", key: item.key, title: item.title })),
    ...resources.dashboards.map(item => ({ resourceType: "dashboard", key: item.key, title: item.title })),
  ].map(item => ({
    ...item,
    reusable: item.resourceType === "block" || item.resourceType === "board",
    unresolved: item.resourceType === "board" && validation.unresolvedBoardKeys.includes(item.key),
    existingOptions: (conflicts.find(conflict => conflict.resourceType === item.resourceType && conflict.key === item.key)?.existingIds || [])
      .map(id => ({ id, title: item.title })),
    suggestedTitle: conflicts.some(conflict => conflict.resourceType === item.resourceType && conflict.key === item.key)
      ? `${item.title} (importado)`
      : item.title,
  }));
  return {
    valid: true,
    summary: {
      dashboards: resources.dashboards.length, boards: resources.boards.length,
      customBlocks: resources.blocks.length, connectorRequirements: resources.requirements.length,
      containsAuthoredContent: resources.blocks.length > 0,
    },
    conflicts,
    resources: importResources,
    requirements,
    unresolvedBoardKeys: validation.unresolvedBoardKeys,
    readyToImport: requirements.every(requirement => requirement.status === "matched"),
    writesPerformed: false,
  };
}

// Per-resource: never lets one bad entry (a stale reuse target, an invalid
// custom name, an unmapped connector) block the rest of the package. Each
// resource's own action is resolved independently up front; anything that
// fails is recorded in `failures` and simply left out of creation — any
// Board tree or Dashboard that referenced it falls back to the resource's
// portable key as an inert placeholder (the existing "Block unavailable" /
// unresolved-Board-reference rendering already handles that id not
// existing locally). A Board that ends up with any such placeholder is
// imported inactive so it reads as a draft needing attention, never as a
// silently broken "real" Board.
function applyWorkspaceImport(value, { names = {}, resourceActions = {}, connectionMappings = {}, existingBlocks = [], existingBoards = [], existingDashboards = [], connectionCandidates = () => [], newId, now = () => new Date() } = {}) {
  const preview = previewWorkspaceImport(value, { existingBlocks, existingBoards, existingDashboards, connectionCandidates });
  if (!preview.valid) throw new Error(`invalid-workspace-package:${preview.errors.join("|")}`);
  if (typeof newId !== "function") throw new Error("newId-required");

  const actions = new Map(); // key -> { mode: "reuse", existingId } | { mode: "create", title }
  const failures = new Map(); // key -> error code
  for (const resource of preview.resources) {
    const requested = resourceActions[resource.key];
    if (requested?.mode === "reuse") {
      const collection = resource.resourceType === "block" ? existingBlocks : resource.resourceType === "board" ? existingBoards : [];
      if (!resource.reusable || !collection.some(item => item.id === requested.existingId)) {
        failures.set(resource.key, "invalid-reuse-target");
      } else {
        actions.set(resource.key, { mode: "reuse", existingId: requested.existingId });
      }
      continue;
    }
    const title = String(names[resource.key] ?? resource.suggestedTitle).trim();
    if (!title || title.length > 200) {
      failures.set(resource.key, "invalid-resource-name");
      continue;
    }
    actions.set(resource.key, { mode: "create", title });
  }
  const failureResult = (key, title) => ({ key, title, ok: false, action: "failed", error: failures.get(key) });

  const localBlockIds = new Map();
  const createdAt = now().toISOString();
  const reusedBlocks = [];
  const failedBlocks = [];
  const boardsToCreate = value.resources.boards.filter(board => actions.get(board.key)?.mode === "create");
  const reuseBoards = value.resources.boards.filter(board => actions.get(board.key)?.mode === "reuse");
  const failedBoardKeys = value.resources.boards.filter(board => failures.has(board.key)).map(board => board.key);
  const boardRefs = new Set();
  const collectRefs = node => {
    if (node.t === "z") node.blocks.forEach(key => boardRefs.add(key));
    else { collectRefs(node.a); collectRefs(node.b); }
  };
  boardsToCreate.forEach(board => collectRefs(board.tree));
  if (!value.resources.boards.length) [...value.resources.blocks, ...value.resources.requirements].forEach(item => boardRefs.add(item.key));
  const createdBlocks = value.resources.blocks.filter(block => boardRefs.has(block.key)).flatMap(block => {
    if (failures.has(block.key)) { failedBlocks.push(failureResult(block.key, block.title)); return []; }
    const action = actions.get(block.key);
    if (action.mode === "reuse") {
      const existing = existingBlocks.find(item => item.id === action.existingId);
      localBlockIds.set(block.key, existing.id);
      reusedBlocks.push({ id: existing.id, title: existing.title, ok: true, action: "reused" });
      return [];
    }
    const id = `custom-${newId()}`;
    localBlockIds.set(block.key, id);
    return [{
      id, kind: "content", title: action.title, description: block.description ?? null,
      icon: block.icon ?? null, active: true, createdAt, format: block.format,
      content: block.content, prompt: block.prompt ?? null, rules: block.rules ?? null,
    }];
  });
  for (const requirement of value.resources.requirements.filter(item => boardRefs.has(item.key))) {
    const fallbackTitle = requirement.title || `${requirement.connectorTypeId} — ${requirement.blockId}`;
    const candidates = connectionCandidates(requirement.connectorTypeId);
    const previewRequirement = preview.requirements.find(item => item.key === requirement.key);
    const connectionId = connectionMappings[requirement.key] || previewRequirement?.connectionId;
    if (!connectionId || !candidates.some(candidate => candidate.id === connectionId)) {
      failedBlocks.push({ key: requirement.key, title: fallbackTitle, ok: false, action: "failed", error: "connection-mapping-required" });
      continue;
    }
    const id = `custom-${newId()}`;
    localBlockIds.set(requirement.key, id);
    createdBlocks.push({
      id, kind: "connector", connectorId: connectionId, blockId: requirement.blockId,
      title: fallbackTitle, description: null, icon: null, active: true, createdAt,
      scope: requirement.scope ?? null, limit: requirement.limit || 10,
    });
  }
  const restoreTree = node => node.t === "z"
    ? { t: "z", k: `z-${newId()}`, blocks: node.blocks.map(key => localBlockIds.get(key) ?? key) }
    : { t: "s", k: `s-${newId()}`, dir: node.dir, ratio: node.ratio, a: restoreTree(node.a), b: restoreTree(node.b) };
  const hasUnresolvedRef = node => node.t === "z"
    ? node.blocks.some(key => !localBlockIds.has(key))
    : hasUnresolvedRef(node.a) || hasUnresolvedRef(node.b);

  const localBoardIds = new Map();
  const reusedBoards = [];
  const failedBoards = failedBoardKeys.map(key => failureResult(key, value.resources.boards.find(board => board.key === key).title));
  for (const board of reuseBoards) {
    const action = actions.get(board.key);
    const existing = existingBoards.find(item => item.id === action.existingId);
    localBoardIds.set(board.key, existing.id);
    reusedBoards.push({ id: existing.id, title: existing.title, ok: true, action: "reused" });
  }
  const createdBoards = boardsToCreate.map(board => {
    const id = `page-${newId()}`;
    localBoardIds.set(board.key, id);
    const unresolved = hasUnresolvedRef(board.tree);
    return {
      id, title: actions.get(board.key).title, icon: board.icon || "grid",
      active: !unresolved, showInSidebar: true, tree: restoreTree(board.tree), createdAt, updatedAt: createdAt,
    };
  });
  const failedDashboards = [];
  const createdDashboards = value.resources.dashboards.flatMap(dashboard => {
    if (failures.has(dashboard.key)) { failedDashboards.push(failureResult(dashboard.key, dashboard.title)); return []; }
    return [{
      schemaVersion: 1, id: `dashboard-${newId()}`, title: actions.get(dashboard.key).title, icon: dashboard.icon || "grid",
      active: true, showInSidebar: true, boardIds: dashboard.boards.map(key => localBoardIds.get(key) ?? key),
      selectedBoardId: dashboard.selectedBoard ? (localBoardIds.get(dashboard.selectedBoard) ?? dashboard.selectedBoard) : null,
      createdAt, updatedAt: createdAt,
    }];
  });
  return {
    next: {
      blocks: [...existingBlocks, ...createdBlocks],
      boards: [...existingBoards, ...createdBoards],
      dashboards: [...existingDashboards, ...createdDashboards],
    },
    results: {
      blocks: [...reusedBlocks, ...failedBlocks, ...createdBlocks.map(item => ({ id: item.id, title: item.title, ok: true, action: "created" }))],
      boards: [...reusedBoards, ...failedBoards, ...createdBoards.map(item => ({ id: item.id, title: item.title, ok: true, action: "created", active: item.active }))],
      dashboards: [...failedDashboards, ...createdDashboards.map(item => ({ id: item.id, title: item.title, ok: true, action: "created" }))],
    },
  };
}

module.exports = { FORMAT, VERSION, MAX_PACKAGE_BYTES, applyWorkspaceImport, buildWorkspacePackage, previewWorkspaceImport, validateWorkspacePackage };
