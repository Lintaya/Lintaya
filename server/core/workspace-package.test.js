const assert = require("node:assert/strict");
const test = require("node:test");
const { FORMAT, VERSION, applyWorkspaceImport, buildWorkspacePackage, previewWorkspaceImport, validateWorkspacePackage } = require("./workspace-package");

function sample() {
  return {
    format: FORMAT, version: VERSION, exportedAt: "2026-08-27T12:00:00.000Z",
    resources: {
      blocks: [{ key: "block:runbook", kind: "content", title: "Runbook", description: null, icon: null, format: "md", content: "# Safe" }],
      requirements: [{ key: "requirement:commits", connectorTypeId: "gitlab", blockId: "recent-commits", connectionAlias: "production" }],
      boards: [{ key: "board:operations", title: "Operations", icon: "grid", tree: { t: "z", key: "zone:1", blocks: ["block:runbook", "requirement:commits"] } }],
      dashboards: [{ key: "dashboard:daily", title: "Daily", icon: "grid", boards: ["board:operations"], selectedBoard: "board:operations" }],
    },
  };
}

test("accepts a portable Dashboard graph without local ids", () => {
  assert.deepEqual(validateWorkspacePackage(sample()), { valid: true, errors: [], unresolvedBoardKeys: [] });
});

test("rejects unknown versions, foreign fields, and local-id shaped trees", () => {
  const value = sample(); value.version = 2; value.resources.boards[0].tree.blocks = ["custom-1700000000000"]; value.localId = "page-1";
  const result = validateWorkspacePackage(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});

test("rejects secret-shaped fields anywhere in the package", () => {
  const value = sample(); value.resources.requirements[0].apiToken = "do-not-export";
  const result = validateWorkspacePackage(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("apiToken")));
});

test("rejects executable HTML while allowing ordinary authored HTML", () => {
  const safe = sample(); safe.resources.blocks[0] = { key: "block:html", kind: "content", title: "HTML", format: "html", content: "<p>Hello</p>" };
  safe.resources.boards[0].tree.blocks[0] = "block:html";
  assert.equal(validateWorkspacePackage(safe).valid, true);
  safe.resources.blocks[0].content = '<img src="x" onerror="alert(1)">';
  assert.equal(validateWorkspacePackage(safe).valid, false);
});

test("rejects dangling references, duplicate keys, and an invalid Dashboard selection", () => {
  const value = sample();
  value.resources.blocks.push({ ...value.resources.blocks[0] });
  value.resources.boards[0].tree.blocks.push("block:missing");
  value.resources.dashboards[0].boards.push("board:missing");
  value.resources.dashboards[0].selectedBoard = "board:missing-selection";
  const result = validateWorkspacePackage(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("unique")));
  assert.ok(result.errors.some(error => error.includes("block:missing")));
  assert.ok(result.errors.some(error => error.includes("selectedBoard")));
});

test("tolerateUnresolvedRefs downgrades dangling Board/Dashboard references to a soft report instead of rejecting the package", () => {
  const value = sample();
  value.resources.boards[0].tree.blocks.push("block:missing");
  value.resources.dashboards[0].boards.push("board:missing");
  const strict = validateWorkspacePackage(value);
  assert.equal(strict.valid, false);
  const tolerant = validateWorkspacePackage(value, { tolerateUnresolvedRefs: true });
  assert.equal(tolerant.valid, true);
  assert.deepEqual(tolerant.errors, []);
  assert.deepEqual(tolerant.unresolvedBoardKeys, ["board:operations"]);
  // Duplicate keys and an inconsistent selectedBoard stay hard errors even
  // when tolerant — those are package-internal bugs, not a missing ref.
  value.resources.blocks.push({ ...value.resources.blocks[0] });
  value.resources.dashboards[0].selectedBoard = "board:missing-selection";
  const stillInvalid = validateWorkspacePackage(value, { tolerateUnresolvedRefs: true });
  assert.equal(stillInvalid.valid, false);
});

test("builds a portable graph and deduplicates Blocks shared by two Boards", () => {
  const value = buildWorkspacePackage({
    dashboardIds: ["dashboard-local"],
    dashboards: [{ id: "dashboard-local", title: "Daily", boardIds: ["page-a", "page-b"], selectedBoardId: "page-b" }],
    boards: [
      { id: "page-a", title: "A", tree: { t: "z", k: "local-zone", blocks: ["custom-local", "gitlab2.recent-commits"] } },
      { id: "page-b", title: "B", tree: { t: "z", k: "another-zone", blocks: ["custom-local"] } },
    ],
    customBlocks: [{ id: "custom-local", kind: "content", title: "Notes", format: "md", content: "hello" }],
    resolveConnectorType: id => id === "gitlab2" ? "gitlab" : id,
    connectionAlias: id => id === "gitlab2" ? "Production GitLab" : id,
    now: () => new Date("2026-08-27T12:00:00.000Z"),
  });
  assert.equal(value.resources.blocks.length, 1);
  assert.equal(value.resources.requirements.length, 1);
  assert.equal(value.resources.requirements[0].connectorTypeId, "gitlab");
  assert.equal(value.resources.requirements[0].connectionAlias, "Production GitLab");
  assert.deepEqual(value.resources.dashboards[0].boards, ["board:item-1", "board:item-2"]);
  assert.equal(value.resources.dashboards[0].selectedBoard, "board:item-2");
  assert.equal(value.resources.boards[0].tree.blocks[0], value.resources.boards[1].tree.blocks[0]);
  assert.equal(JSON.stringify(value).includes("page-a"), false);
  assert.equal(validateWorkspacePackage(value).valid, true);
});

test("previews conflicts and connector mappings without performing writes", () => {
  const value = sample();
  const preview = previewWorkspaceImport(value, {
    existingBlocks: [{ id: "custom-existing", title: "Runbook" }],
    existingBoards: [{ id: "page-existing", title: "Operations" }],
    connectionCandidates: type => type === "gitlab" ? [{ id: "gitlab2", name: "production" }] : [],
  });
  assert.equal(preview.valid, true);
  assert.equal(preview.writesPerformed, false);
  assert.equal(preview.conflicts.length, 2);
  assert.equal(preview.resources.find(item => item.key === "block:runbook").suggestedTitle, "Runbook (importado)");
  assert.deepEqual(preview.resources.find(item => item.key === "block:runbook").existingOptions, [{ id: "custom-existing", title: "Runbook" }]);
  assert.equal(preview.resources.find(item => item.key === "dashboard:daily").suggestedTitle, "Daily");
  assert.equal(preview.requirements[0].status, "matched");
  assert.equal(preview.requirements[0].connectionId, "gitlab2");
  assert.equal(preview.readyToImport, true);
});

test("preview reports requirements that need an explicit connection mapping", () => {
  const preview = previewWorkspaceImport(sample(), {
    connectionCandidates: () => [{ id: "gitlab", name: "Development" }, { id: "gitlab2", name: "Secondary" }],
  });
  assert.equal(preview.requirements[0].status, "needs-mapping");
  assert.equal(preview.requirements[0].connectionId, null);
  assert.equal(preview.readyToImport, false);
  assert.equal(preview.writesPerformed, false);
});

test("applies a package with new local ids, renamed resources, and rebuilt references", () => {
  let sequence = 0;
  const imported = applyWorkspaceImport(sample(), {
    names: { "block:runbook": "Imported notes", "board:operations": "Imported ops", "dashboard:daily": "Imported daily" },
    connectionMappings: { "requirement:commits": "gitlab2" },
    existingBlocks: [{ id: "custom-existing", title: "Existing" }],
    existingBoards: [{ id: "page-existing", title: "Existing" }],
    existingDashboards: [],
    connectionCandidates: () => [{ id: "gitlab2", name: "Production" }],
    newId: () => `new-${++sequence}`,
    now: () => new Date("2026-08-27T12:00:00.000Z"),
  });
  assert.equal(imported.next.blocks.length, 3);
  assert.equal(imported.next.boards.length, 2);
  assert.equal(imported.next.dashboards.length, 1);
  const board = imported.next.boards.at(-1);
  const dashboard = imported.next.dashboards[0];
  assert.equal(board.title, "Imported ops");
  assert.ok(board.tree.blocks.every(id => id.startsWith("custom-new-")));
  assert.equal(dashboard.title, "Imported daily");
  assert.deepEqual(dashboard.boardIds, [board.id]);
  assert.equal(dashboard.selectedBoardId, board.id);
  assert.equal(imported.next.blocks.find(item => item.kind === "connector").connectorId, "gitlab2");
});

test("apply never throws for a bad resource — it records a per-resource failure and still imports everything else", () => {
  let sequence = 0;
  const options = { connectionCandidates: () => [{ id: "gitlab2", name: "Production" }], newId: () => `id-${++sequence}` };

  // An invalid custom name for the Board fails just that Board. Nothing
  // else in the package references it, so no Block/requirement is even
  // attempted for it, and the Dashboard is still created with a placeholder
  // reference to the failed Board (existing "unresolved Board" handling).
  const badBoardName = applyWorkspaceImport(sample(), { ...options, names: { "board:operations": "" } });
  assert.deepEqual(badBoardName.results.boards, [{ key: "board:operations", title: "Operations", ok: false, action: "failed", error: "invalid-resource-name" }]);
  assert.equal(badBoardName.next.boards.length, 0);
  assert.deepEqual(badBoardName.next.dashboards[0].boardIds, ["board:operations"]);

  // An unmappable connector requirement fails only that requirement — the
  // sibling content Block and the Board/Dashboard that reference it still
  // import, but the Board comes back inactive since one of its zones is
  // now an unresolved placeholder.
  const badMapping = applyWorkspaceImport(sample(), { ...options, connectionMappings: { "requirement:commits": "foreign" } });
  const mappingFailure = badMapping.results.blocks.find(item => item.ok === false);
  assert.equal(mappingFailure.error, "connection-mapping-required");
  assert.equal(badMapping.results.blocks.some(item => item.ok && item.title === "Runbook"), true);
  assert.equal(badMapping.next.boards[0].active, false);
  assert.equal(badMapping.next.dashboards.length, 1);

  // A stale reuse target fails only that Block; the requirement still
  // resolves normally (default connectionCandidates auto-match), and the
  // Board is created but inactive because of the one unresolved zone.
  const badReuse = applyWorkspaceImport(sample(), { ...options, resourceActions: { "block:runbook": { mode: "reuse", existingId: "missing" } } });
  assert.deepEqual(badReuse.results.blocks.find(item => item.ok === false), { key: "block:runbook", title: "Runbook", ok: false, action: "failed", error: "invalid-reuse-target" });
  assert.equal(badReuse.next.blocks.some(item => item.kind === "connector"), true);
  assert.equal(badReuse.next.boards[0].active, false);
  assert.ok(badReuse.next.boards[0].tree.blocks.includes("block:runbook"));
});

test("a Board tree referencing a key missing from the whole package imports inactive with the dangling key left as a placeholder", () => {
  const value = sample();
  value.resources.boards[0].tree.blocks.push("block:missing");
  let sequence = 0;
  const imported = applyWorkspaceImport(value, {
    connectionMappings: { "requirement:commits": "gitlab2" },
    connectionCandidates: () => [{ id: "gitlab2", name: "Production" }],
    newId: () => `id-${++sequence}`,
  });
  const board = imported.next.boards[0];
  assert.equal(board.active, false);
  assert.ok(board.tree.blocks.includes("block:missing"));
  assert.equal(imported.results.boards[0].ok, true);
});

test("reuses an existing Board without duplicating its packaged Blocks", () => {
  let sequence = 0;
  const existingBoard = { id: "page-existing", title: "Operations", tree: { t: "z", blocks: ["custom-existing"] } };
  const imported = applyWorkspaceImport(sample(), {
    resourceActions: { "board:operations": { mode: "reuse", existingId: "page-existing" } },
    existingBlocks: [{ id: "custom-existing", title: "Runbook" }],
    existingBoards: [existingBoard],
    connectionCandidates: () => [{ id: "gitlab2", name: "production" }],
    newId: () => `reuse-${++sequence}`,
  });
  assert.deepEqual(imported.next.blocks, [{ id: "custom-existing", title: "Runbook" }]);
  assert.deepEqual(imported.next.boards, [existingBoard]);
  assert.equal(imported.results.blocks.length, 0);
  assert.deepEqual(imported.results.boards, [{ id: "page-existing", title: "Operations", ok: true, action: "reused" }]);
  assert.deepEqual(imported.next.dashboards[0].boardIds, ["page-existing"]);
  assert.equal(imported.next.dashboards[0].selectedBoardId, "page-existing");
});

test("reuses a conflicting Block inside a newly created Board", () => {
  let sequence = 0;
  const imported = applyWorkspaceImport(sample(), {
    resourceActions: { "block:runbook": { mode: "reuse", existingId: "custom-existing" } },
    existingBlocks: [{ id: "custom-existing", title: "Runbook", content: "local source of truth" }],
    connectionMappings: { "requirement:commits": "gitlab2" },
    connectionCandidates: () => [{ id: "gitlab2", name: "production" }],
    newId: () => `reuse-block-${++sequence}`,
  });
  assert.equal(imported.next.blocks.filter(item => item.kind === "content").length, 0);
  assert.equal(imported.next.boards[0].tree.blocks[0], "custom-existing");
  assert.equal(imported.results.blocks.find(item => item.id === "custom-existing").action, "reused");
});
