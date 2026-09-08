const BRAND = "⛯ Lintaya";

function printJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function text(value, max = 26) {
  const result = value === undefined || value === null || value === "" ? "—" : String(value);
  return result.length > max ? `${result.slice(0, Math.max(1, max - 1))}…` : result;
}

function timestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
}

function printTable(stream, columns, rows) {
  const normalized = rows.map(row => columns.map(column => text(typeof column.value === "function" ? column.value(row) : row[column.value], column.max)));
  const widths = columns.map((column, index) => Math.max(column.label.length, ...normalized.map(row => row[index].length)));
  const line = (values) => values.map((value, index) => value.padEnd(widths[index])).join("  ");
  stream.write(`${line(columns.map(column => column.label))}\n`);
  stream.write(`${widths.map(width => "-".repeat(width)).join("  ")}\n`);
  for (const row of normalized) stream.write(`${line(row)}\n`);
}

function connectorStatus(connector) {
  if (connector.liveStatus?.status) return connector.liveStatus.status.toUpperCase();
  return connector.configured ? "UNTESTED" : "NOT CONFIGURED";
}

function printConnectors(stream, connectors) {
  const statusCounts = connectors.reduce((counts, connector) => {
    const status = connectorStatus(connector);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const summary = Object.entries(statusCounts).map(([status, count]) => `${status}: ${count}`).join(" · ");
  stream.write(`${BRAND} · Connectors (${connectors.length}) · ${summary}\n\n`);
  printTable(stream, [
    { label: "#", value: "cliNumber", max: 4 },
    { label: "ID", value: "id", max: 15 },
    { label: "NAME", value: "name", max: 24 },
    { label: "TYPE", value: row => row.type || row.kind, max: 14 },
    { label: "STATUS", value: connectorStatus, max: 14 },
    { label: "LAST SYNC", value: row => timestamp(row.liveStatus?.lastSync), max: 16 },
    { label: "ITEMS", value: row => row.liveStatus?.itemsSynced, max: 7 },
    { label: "MODULES", value: row => (row.modules || []).map(module => module.label || module.id).join(", "), max: 20 },
    { label: "BLOCKS", value: row => (row.blocks || []).map(block => block.title || block.id).join(", "), max: 20 },
  ], connectors);
  stream.write("\nFull details: lintaya connectors list --json\n");
}

function printCatalog(stream, catalog) {
  stream.write(`${BRAND} · Connector type catalog (${catalog.length})\n\n`);
  printTable(stream, [
    { label: "ID", value: "id", max: 16 },
    { label: "NAME", value: row => row.displayName || row.name, max: 24 },
    { label: "TIER", value: "tier", max: 12 },
    { label: "LIFECYCLE", value: "lifecycle", max: 12 },
    { label: "INSTANCES", value: row => row.instantiable ? "YES" : "NO", max: 10 },
    { label: "CAPABILITIES", value: row => (row.capabilities || []).length, max: 12 },
  ], catalog);
}

function printCustomBlocks(stream, blocks) {
  stream.write(`${BRAND} · Custom blocks (${blocks.length})\n\n`);
  printTable(stream, [
    { label: "#", value: "cliNumber", max: 4 },
    { label: "ID", value: "id", max: 22 },
    { label: "TITLE", value: "title", max: 28 },
    { label: "CONNECTOR", value: "connectorId", max: 15 },
    { label: "BLOCK", value: "blockId", max: 20 },
    { label: "SCOPE", value: "scope", max: 18 },
    { label: "LIMIT", value: "limit", max: 8 },
  ], blocks);
}

function printConnectorBlocks(stream, blocks) {
  stream.write(`${BRAND} · Connector blocks (${blocks.length})\n\n`);
  printTable(stream, [
    { label: "#", value: "cliNumber", max: 4 },
    { label: "ID", value: "id", max: 32 },
    { label: "TITLE", value: "title", max: 34 },
    { label: "CONNECTOR", value: "connectorId", max: 16 },
    { label: "BLOCK", value: "blockId", max: 22 },
    { label: "TYPE", value: "type", max: 12 },
  ], blocks);
  stream.write("\nInspect one: lintaya blocks show <id>\n");
}

function printBlockDetail(stream, detail) {
  if (detail.kind === "content") {
    const block = detail.block;
    stream.write(`${BRAND} · Content block · ${block.title || block.id}\n\n`);
    printTable(stream, [
      { label: "ID", value: "id", max: 28 },
      { label: "FORMAT", value: row => row.format || "md", max: 8 },
      { label: "DESCRIPTION", value: "description", max: 40 },
      { label: "ACTIVE", value: row => row.active === false ? "NO" : "YES", max: 8 },
    ], [block]);
    stream.write(`\n${block.content ? `${block.content}\n` : "This content block has no body yet.\n"}`);
    return;
  }

  const { block, feed } = detail;
  stream.write(`${BRAND} · Connector block · ${block.title || block.id}\n\n`);
  stream.write(`Source: ${block.connectorId}.${block.blockId}`);
  if (block.scope) stream.write(` · Scope: ${block.scope}`);
  if (block.limit) stream.write(` · Limit: ${block.limit}`);
  if (feed?.updatedAt) stream.write(`\nUpdated: ${timestamp(feed.updatedAt)}`);
  stream.write("\n\n");
  const items = Array.isArray(feed?.items) ? feed.items : [];
  if (!items.length) return stream.write("No items are currently available from this connector block.\n");
  printTable(stream, [
    { label: "TITLE", value: "title", max: 42 },
    { label: "DETAIL", value: "subtitle", max: 32 },
    { label: "TIME", value: row => timestamp(row.timestamp), max: 16 },
    { label: "BADGE", value: row => row.badge?.text, max: 16 },
    { label: "URL", value: "url", max: 44 },
  ], items);
}

function printPages(stream, pages) {
  stream.write(`${BRAND} · Boards (${pages.length})\n\n`);
  printTable(stream, [
    { label: "#", value: "cliNumber", max: 4 },
    { label: "ID", value: "id", max: 22 },
    { label: "TITLE", value: "title", max: 30 },
    { label: "ACTIVE", value: row => row.active ? "YES" : "NO", max: 8 },
    { label: "ICON", value: "icon", max: 12 },
    { label: "UPDATED", value: row => timestamp(row.updatedAt), max: 16 },
  ], pages);
}

function printDashboards(stream, dashboards) {
  stream.write(`${BRAND} · Dashboards (${dashboards.length})\n\n`);
  printTable(stream, [
    { label: "#", value: "cliNumber", max: 4 },
    { label: "ID", value: "id", max: 24 },
    { label: "TITLE", value: "title", max: 28 },
    { label: "ACTIVE", value: row => row.active ? "YES" : "NO", max: 8 },
    { label: "SIDEBAR", value: row => row.showInSidebar ? "YES" : "NO", max: 8 },
    { label: "BOARDS", value: row => String((row.boardIds || []).length), max: 7 },
    { label: "ICON", value: "icon", max: 10 },
  ], dashboards);
}

function printApprovals(stream, approvals) {
  stream.write(`${BRAND} · Approvals (${approvals.length})\n\n`);
  if (!approvals.length) return stream.write("Nothing waiting. Destructive connector actions queue here before they run.\n");
  printTable(stream, [
    { label: "ID", value: "id", max: 24 },
    { label: "STATUS", value: "status", max: 10 },
    { label: "CONNECTION", value: "connectionId", max: 16 },
    { label: "ACTION", value: "actionId", max: 26 },
    { label: "CREATED", value: row => timestamp(row.createdAt), max: 16 },
  ], approvals);
}

function printConnectorDetail(stream, connector) {
  stream.write(`${BRAND} · Connector ${connector.cliNumber || "—"} · ${connector.name || connector.id}\n\n`);
  stream.write(`ID: ${connector.id}\nType: ${connector.type || connector.kind || "—"}\nStatus: ${connectorStatus(connector)}\n`);
  const capabilities = connector.capabilities || [];
  if (capabilities.length) stream.write(`Capabilities: ${capabilities.join(", ")}\n`);
  if (connector.modules?.length) stream.write(`Modules: ${connector.modules.map(module => module.label || module.id).join(", ")}\n`);
  if (connector.blocks?.length) stream.write(`Blocks: ${connector.blocks.map(block => block.title || block.id).join(", ")}\n`);
}

function boardBlockIds(tree, ids = []) {
  if (!tree || typeof tree !== "object") return ids;
  if (Array.isArray(tree.blocks)) ids.push(...tree.blocks);
  boardBlockIds(tree.a, ids);
  boardBlockIds(tree.b, ids);
  return ids;
}

function printBoardDetail(stream, board) {
  const blocks = boardBlockIds(board.tree);
  stream.write(`${BRAND} · Board ${board.cliNumber || "—"} · ${board.title || board.id}\n\n`);
  stream.write(`ID: ${board.id}\nActive: ${board.active ? "YES" : "NO"}\nUpdated: ${timestamp(board.updatedAt)}\n`);
  if (blocks.length) stream.write(`Blocks (${blocks.length}): ${blocks.join(", ")}\n`);
  else stream.write("This board has no blocks yet.\n");
}

function statusRows(statuses) {
  if (Array.isArray(statuses)) return statuses;
  return Object.entries(statuses || {}).map(([id, state]) => ({ id, ...(state || {}) }));
}

function statusLabel(state) {
  if (state.status) return String(state.status).toUpperCase();
  return state.configured ? "UNTESTED" : "NOT CONFIGURED";
}

function printStatus(stream, statuses) {
  const rows = statusRows(statuses);
  const counts = rows.reduce((result, state) => {
    const label = statusLabel(state);
    result[label] = (result[label] || 0) + 1;
    return result;
  }, {});
  const summary = Object.entries(counts).map(([label, count]) => `${label}: ${count}`).join(" · ");
  stream.write(`${BRAND} · Connection status (${rows.length})${summary ? ` · ${summary}` : ""}\n\n`);
  printTable(stream, [
    { label: "ID", value: "id", max: 18 },
    { label: "CONFIGURED", value: row => row.configured ? "YES" : "NO", max: 10 },
    { label: "STATUS", value: statusLabel, max: 16 },
    { label: "LAST SYNC", value: row => timestamp(row.lastSync || row.syncedAt), max: 16 },
    { label: "LATENCY", value: row => row.latencyMs ?? row.latency, max: 10 },
    { label: "ITEMS", value: row => row.itemsSynced ?? row.itemCount, max: 8 },
    { label: "ACTIVITY", value: row => Array.isArray(row.log) ? row.log.length : 0, max: 8 },
  ], rows);
  stream.write("\nFull details: lintaya status --json\n");
}

function printAgentContext(stream, context) {
  const endpoints = Object.entries(context?.endpoints || {});
  const connectors = Array.isArray(context?.connectors) ? context.connectors : [];
  stream.write(`${BRAND} · Agent context\n\n`);
  stream.write(`${context?.name || "Lintaya"} ${context?.version ? `v${context.version}` : ""}\n`);
  if (context?.description) stream.write(`${context.description}\n`);
  stream.write(`Authentication: ${context?.auth?.type || "—"}\n`);
  stream.write(`Connector types: ${connectors.length} · Endpoint groups: ${endpoints.length}\n`);
  if (endpoints.length) stream.write(`Available groups: ${endpoints.map(([name, routes]) => `${name} (${Array.isArray(routes) ? routes.length : 0})`).join(", ")}\n`);
  if (Array.isArray(context?.tips) && context.tips.length) {
    stream.write("\nOperational notes:\n");
    for (const tip of context.tips.slice(0, 4)) stream.write(`  - ${tip}\n`);
  }
  stream.write("\nFull agent contract: lintaya context --json\n");
}

function printModules(stream, modules) {
  stream.write(`${BRAND} · Connector modules (${modules.length})\n\n`);
  printTable(stream, [
    { label: "CONNECTOR", value: "connectorId", max: 16 },
    { label: "MODULE", value: "moduleId", max: 18 },
    { label: "LABEL", value: "label", max: 28 },
    { label: "STATUS", value: "status", max: 12 },
    { label: "AVAILABLE", value: row => row.available ? "YES" : "NO", max: 10 },
    { label: "ROUTE", value: "route", max: 30 },
  ], modules);
}

function schemaFields(schema) {
  if (Array.isArray(schema?.fields)) return schema.fields;
  return Object.entries(schema?.properties || {}).map(([id, definition]) => ({
    id,
    label: definition.title || id,
    type: definition.type,
    description: definition.description,
    required: (schema.required || []).includes(id),
    secret: definition["x-lintaya-secret"] || definition.writeOnly,
  }));
}

function printSchema(stream, schema) {
  const fields = schemaFields(schema);
  stream.write(`${BRAND} · ${schema?.title || "Connector"} configuration schema\n`);
  if (schema?.description) stream.write(`${schema.description}\n`);
  if (!fields.length) return stream.write("\nNo top-level configuration fields are declared.\n");
  stream.write("\n");
  printTable(stream, [
    { label: "FIELD", value: row => row.id || row.name || row.key, max: 22 },
    { label: "LABEL", value: row => row.label || row.title, max: 28 },
    { label: "TYPE", value: "type", max: 14 },
    { label: "REQUIRED", value: row => row.required ? "YES" : "NO", max: 10 },
    { label: "SECRET", value: row => row.secret || row["x-lintaya-secret"] || row.writeOnly ? "YES" : "NO", max: 8 },
    { label: "DESCRIPTION", value: "description", max: 42 },
  ], fields);
  stream.write("\nField values and secrets are never returned by this command.\n");
}

function printConnectorContext(stream, data, id) {
  const content = String(data?.content || "").trim();
  stream.write(`${BRAND} · AI context · ${id}\n\n`);
  if (!content) return stream.write("No custom AI context is configured for this connection.\n");
  stream.write(`${content}\n`);
}

function printProfileResult(stream, action, { name, url, activeProfile }) {
  const profileName = name || activeProfile || "none";
  const actionText = { add: "Profile saved", use: "Active profile changed", remove: "Profile removed" }[action] || "Profile updated";
  stream.write(`${BRAND} · ${actionText}: ${profileName}\n`);
  if (url) stream.write(`URL: ${url}\n`);
  stream.write(`Active profile: ${activeProfile || "none"}\n`);
}

function printReadResult(stream, { group, command, subject, data }) {
  if (group === "health") {
    stream.write(`${BRAND} is available · ${timestamp(data?.ts)}\n`);
    return;
  }
  if (group === "status") return printStatus(stream, data);
  if (group === "context") return printAgentContext(stream, data);
  if (group === "connectors" && command === "list" && Array.isArray(data)) return printConnectors(stream, data);
  if (group === "connectors" && command === "catalog" && Array.isArray(data)) return printCatalog(stream, data);
  if (group === "connectors" && command === "modules" && Array.isArray(data)) return printModules(stream, data);
  if (group === "connectors" && command === "schema") return printSchema(stream, data);
  if (group === "connectors" && command === "context") return printConnectorContext(stream, data, subject || "connection");
  if (group === "blocks" && command === "custom" && Array.isArray(data)) return printCustomBlocks(stream, data);
  if (group === "blocks" && command === "catalog" && Array.isArray(data)) return printConnectorBlocks(stream, data);
  if (group === "pages" && command === "list" && Array.isArray(data)) return printPages(stream, data);
  if (group === "dashboards" && Array.isArray(data)) return printDashboards(stream, data);
  if (group === "approvals" && Array.isArray(data)) return printApprovals(stream, data);
  printJson(stream, data);
}

function printSearchResults(stream, { query, results }) {
  stream.write(`${BRAND} · Search "${query}" (${results.length} result${results.length === 1 ? "" : "s"})\n\n`);
  if (!results.length) return stream.write("No matches. Try a different term, or use --json for raw data.\n");
  printTable(stream, [
    { label: "TYPE", value: row => row.type.toUpperCase(), max: 5 },
    { label: "LABEL", value: "label", max: 32 },
    { label: "DASHBOARD", value: row => row.dashboardTitle, max: 20 },
    { label: "BOARD", value: "boardTitle", max: 20 },
    { label: "DETAIL", value: "hint", max: 40 },
    { label: "URL", value: "url", max: 34 },
  ], results);
}

function printProfiles(stream, config) {
  const rows = Object.entries(config.profiles).map(([name, profile]) => ({ name, url: profile.url, active: name === config.activeProfile }));
  stream.write(`${BRAND} · Profiles (${rows.length})\n\n`);
  if (!rows.length) return stream.write("No profiles yet. Create one with: lintaya profile add <name> --url <url>\n");
  printTable(stream, [
    { label: "ACTIVE", value: row => row.active ? "*" : "", max: 6 },
    { label: "NAME", value: "name", max: 20 },
    { label: "URL", value: "url", max: 50 },
  ], rows);
}

module.exports = { printJson, printProfiles, printProfileResult, printBlockDetail, printConnectorDetail, printBoardDetail, printReadResult, printSearchResults, boardBlockIds };
