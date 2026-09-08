const { parseArgs } = require("node:util");
const path = require("node:path");
const { defaultConfigPath, normalizeUrl, validateProfileName, readConfig, writeConfig } = require("./config");
const { getJson } = require("./http-client");
const { sendJson } = require("./http-client");
const { printJson, printProfiles, printProfileResult, printBlockDetail, printConnectorDetail, printBoardDetail, printReadResult, printSearchResults, boardBlockIds } = require("./output");

const VERSION = require("../package.json").version;

const HELP = `⛯ Lintaya CLI ${VERSION}

Usage:
  lintaya profile add <name> --url <url> [--token-stdin]
  lintaya profile list
  lintaya profile use <name>
  lintaya profile remove <name>
  lintaya tui
  lintaya completion powershell
  lintaya health [--profile <name> | --url <url>]
  lintaya status [--profile <name> | --url <url>]
  lintaya context
  lintaya connector <number>
  lintaya connectors <list|catalog|modules>
  lintaya connectors <schema|context> <id>
  lintaya blocks <catalog|custom|show <id>>
  lintaya board <number>
  lintaya boards list
  lintaya pages list
  lintaya search <query> [--limit <n>]
  lintaya dashboards list
  lintaya approvals list
  lintaya api get </api/...> [--profile <name> | --url <url>]
  lintaya api <post|put|delete> </api/...> [--body <json> | --body-stdin]
  lintaya version

Options:
  -p, --profile <name>    Profile to use; defaults to the active profile.
  -u, --url <url>         One-off URL that is not stored in a profile.
      --token-stdin       Read the token from stdin when creating a profile.
      --actor <id>        Send X-Actor for a run initiated by an agent.
      --limit <n>         Max results for 'lintaya search' (default 20).
      --body <json>       JSON body for api post/put/delete.
      --body-stdin        Read that JSON body from stdin instead.
      --json              Return complete JSON for scripts and agents.
  -h, --help              Show this help.

Token handling:
  Tokens are never accepted as arguments. To create a profile, use LINTAYA_TOKEN
  or --token-stdin. LINTAYA_TOKEN temporarily overrides the stored token.
  LINTAYA_CONFIG_PATH selects an alternate configuration file.

Output:
  Commands use readable summaries by default. Add --json for complete JSON.
  'lintaya api get' deliberately always returns raw JSON for automation.

Current limitations:
  GET operations only. Write actions, MCP, and team tasks will arrive after
  the actions contract and Team server.`;

const ROOT_COMPLETIONS = ["profile", "tui", "health", "status", "context", "connector", "connectors", "block", "blocks", "board", "boards", "pages", "dashboards", "approvals", "search", "api", "completion", "version"];
const CONNECTOR_BLOCK_REFS = ["gitlab.recent-commits", "qportal.pending-requests", "outline.recent-docs"];

function completionCandidates(words) {
  const [group, command] = words.filter(word => !word.startsWith("-"));
  if (!group || !ROOT_COMPLETIONS.includes(group)) return ROOT_COMPLETIONS;
  if (group === "profile") {
    const commands = ["add", "list", "use", "remove"];
    return !command || !commands.includes(command) ? commands : [];
  }
  if (group === "connectors") {
    const commands = ["list", "catalog", "modules", "schema", "context"];
    return !command || !commands.includes(command) ? commands : [];
  }
  if (group === "connector") return [];
  if (group === "blocks" || group === "block") {
    const commands = ["catalog", "custom", "show"];
    if (!command || !commands.includes(command)) return commands;
    if (command === "show") return CONNECTOR_BLOCK_REFS;
  }
  if (group === "pages") return command === "list" ? [] : ["list"];
  if (group === "dashboards") return command === "list" ? [] : ["list"];
  if (group === "approvals") return command === "list" ? [] : ["list"];
  if (group === "board") return [];
  if (group === "boards") return command === "list" ? [] : ["list"];
  if (group === "search") return [];
  if (group === "api") { const verbs = ["get", "post", "put", "delete"]; return verbs.includes(command) ? [] : verbs; }
  if (group === "completion") return command === "powershell" ? [] : ["powershell"];
  return [];
}

function powershellCompletionScript() {
  const cliPath = path.resolve(__dirname, "../bin/lintaya.js").replace(/'/g, "''");
  return [
    `$script:LintayaCliPath = '${cliPath}'`,
    "function global:lintaya {",
    "  & node $script:LintayaCliPath @args",
    "}",
    "Register-ArgumentCompleter -Native -CommandName lintaya -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    "  $prefix = ([string]$commandAst).Substring(0, $cursorPosition)",
    "  $words = @($prefix -split '\\s+' | Where-Object { $_ } | Select-Object -Skip 1)",
    "  & node $script:LintayaCliPath __complete @words 2>$null |",
    "    Where-Object { $_ -like \"$wordToComplete*\" } |",
    "    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }",
    "}",
  ].join("\n");
}

function parse(argv) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      profile: { type: "string", short: "p" },
      url: { type: "string", short: "u" },
      "token-stdin": { type: "boolean" },
      actor: { type: "string" },
      json: { type: "boolean" },
      limit: { type: "string" },
      body: { type: "string" },
      "body-stdin": { type: "boolean" }
    }
  });
}

const WRITE_VERBS = ["post", "put", "delete"];

async function bodyFromInput(values, stdin) {
  if (values.body && values["body-stdin"]) throw new Error("use --body or --body-stdin, not both");
  let raw = values.body;
  if (values["body-stdin"]) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf8").trim();
  }
  if (raw === undefined || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`body is not valid JSON: ${error.message}`);
  }
}

async function tokenFromInput(values, env, stdin) {
  if (values["token-stdin"] && env.LINTAYA_TOKEN) throw new Error("use LINTAYA_TOKEN or --token-stdin, not both");
  if (values["token-stdin"]) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return env.LINTAYA_TOKEN || "";
}

function profileForRequest(config, values, env) {
  if (values.url) return { name: null, url: normalizeUrl(values.url), token: env.LINTAYA_TOKEN || "" };
  const name = values.profile || config.activeProfile;
  if (!name) throw new Error("no active profile; create one with 'lintaya profile add'");
  const profile = config.profiles[name];
  if (!profile) throw new Error(`profile '${name}' does not exist`);
  return { name, url: profile.url, token: env.LINTAYA_TOKEN || profile.token };
}

function aliasGroup(profile, kind) {
  profile.aliases ||= {};
  profile.aliases[kind] ||= { next: 1, items: {} };
  return profile.aliases[kind];
}

function registerAliases(config, profileName, kind, ids) {
  if (!profileName) return { changed: false, numbers: new Map() };
  const group = aliasGroup(config.profiles[profileName], kind);
  let changed = false;
  const numbers = new Map();
  for (const id of [...new Set(ids.filter(Boolean).map(String))]) {
    if (!Object.hasOwn(group.items, id)) {
      group.items[id] = group.next++;
      changed = true;
    }
    numbers.set(id, group.items[id]);
  }
  return { changed, numbers };
}

function resolveAlias(config, profileName, kind, value) {
  if (!/^\d+$/.test(value || "")) return value;
  if (!profileName) throw new Error(`numeric ${kind} shortcuts require a saved profile; create one with 'lintaya profile add'`);
  const group = config.profiles[profileName].aliases?.[kind];
  const id = Object.entries(group?.items || {}).find(([, number]) => number === Number(value))?.[0];
  if (!id) throw new Error(`${kind.slice(0, -1)} number ${value} is not registered yet; list ${kind} first`);
  return id;
}

function withNumbers(items, numbers, idFor = item => item.id) {
  return items.map(item => ({ ...item, cliNumber: numbers.get(idFor(item)) }));
}

async function registerAndWrite(config, profile, kind, ids, configPath) {
  const aliases = registerAliases(config, profile.name, kind, ids);
  if (aliases.changed) await writeConfig(config, configPath);
  return aliases.numbers;
}

function readRequestFor(group, command, rest) {
  if (group === "health" && !command) return "/api/health";
  if (group === "status" && !command) return "/api/connectors/status";
  if (group === "context" && !command) return "/api/ai-context";
  if (group === "connectors") {
    if (command === "list" && rest.length === 0) return "/api/connectors";
    if (command === "catalog" && rest.length === 0) return "/api/connectors/catalog";
    if (command === "modules" && rest.length === 0) return "/api/connectors/modules";
    if (command === "schema" && rest.length === 1) return `/api/connectors/${encodeURIComponent(rest[0])}/config-schema`;
    if (command === "context" && rest.length === 1) return `/api/connectors/${encodeURIComponent(rest[0])}/ai-context`;
    throw new Error("usage: lintaya connectors <list|catalog|modules|schema <id>|context <id>>");
  }
  if (group === "blocks") {
    if (command === "catalog" && rest.length === 0) return "/api/home/blocks";
    if (command === "custom" && rest.length === 0) return "/api/home/custom-blocks";
    throw new Error("usage: lintaya blocks <catalog|custom|show <id>>");
  }
  if (group === "pages") {
    if (command === "list" && rest.length === 0) return "/api/module-pages";
    throw new Error("usage: lintaya pages list");
  }
  if (group === "dashboards") {
    if (command === "list" && rest.length === 0) return "/api/dashboards";
    throw new Error("usage: lintaya dashboards list");
  }
  if (group === "approvals") {
    if (command === "list" && rest.length === 0) return "/api/approvals";
    throw new Error("usage: lintaya approvals list");
  }
  if (group === "boards") {
    if (command === "list" && rest.length === 0) return "/api/module-pages";
    throw new Error("usage: lintaya boards list");
  }
  if (group === "api") {
    if (command === "get" && rest.length === 1) return rest[0];
    throw new Error("usage: lintaya api get </api/...>");
  }
  return null;
}

function connectorBlockPath(block) {
  const query = new URLSearchParams();
  if (block.scope) query.set("scope", block.scope);
  if (block.limit) query.set("limit", String(block.limit));
  const suffix = query.size ? `?${query}` : "";
  return `/api/connectors/${encodeURIComponent(block.connectorId)}/blocks/${encodeURIComponent(block.blockId)}${suffix}`;
}

function connectorBlockReference(block) {
  if (block.connectorId && block.blockId) return block;
  if (block.kind === "connector" && block.refId) {
    const [connectorId, ...blockId] = String(block.refId).split(".");
    if (connectorId && blockId.length) return { ...block, connectorId, blockId: blockId.join(".") };
  }
  return block;
}

// Same matching semantics as the in-app Ctrl+K palette (app/cmdk.jsx): board
// titles, Block Builder text, and already-synced connector items all match by
// a plain case-insensitive substring against a label+hint pair.
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
    for (const blockId of boardBlockIds(board.tree)) {
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
    for (const blockId of boardBlockIds(board.tree)) {
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

async function getBlockInventory({ baseUrl, token, actor, fetchImpl }) {
  const [customBlocks, connectorBlocks] = await Promise.all([
    getJson({ baseUrl, token, requestPath: "/api/home/custom-blocks", actor, fetchImpl }),
    getJson({ baseUrl, token, requestPath: "/api/home/blocks", actor, fetchImpl }),
  ]);
  return { customBlocks, connectorBlocks };
}

function blockAliasIds(inventory) {
  return [
    ...(inventory.customBlocks || []).map(block => block.id),
    ...(inventory.connectorBlocks || []).map(block => block.id),
  ];
}

async function getBlockDetail({ baseUrl, token, actor, id, fetchImpl, inventory }) {
  const source = inventory || await getBlockInventory({ baseUrl, token, actor, fetchImpl });
  const match = (blocks) => {
    const exact = blocks.find(block => block.id === id || block.refId === id);
    if (exact) return exact;
    const partial = blocks.filter(block => [block.id, block.refId].filter(Boolean).some(value => String(value).startsWith(id)));
    return partial.length === 1 ? partial[0] : null;
  };
  const custom = match(source.customBlocks || []);
  if (custom && custom.kind === "content") return { kind: "content", block: custom };

  const declared = match(source.connectorBlocks || []);
  const resolved = custom || declared;
  if (!resolved) throw new Error(`block '${id}' does not exist; run 'lintaya blocks custom' or 'lintaya blocks catalog' first`);
  const connector = connectorBlockReference(resolved);
  if (!connector.connectorId || !connector.blockId) throw new Error(`block '${id}' cannot provide a connector feed`);
  const feed = await getJson({ baseUrl, token, requestPath: connectorBlockPath(connector), actor, fetchImpl });
  return { kind: "connector", block: connector, feed };
}

async function run(argv, { env = process.env, stdin = process.stdin, stdout = process.stdout, configPath = defaultConfigPath(env), fetchImpl = fetch } = {}) {
  const { values, positionals } = parse(argv);
  if (values.help) {
    stdout.write(`${HELP}\n`);
    return;
  }
  if (positionals.length === 0) {
    if (stdin.isTTY && stdout.isTTY) return (await import("./tui.mjs")).startTui({env, configPath});
    stdout.write(`${HELP}\n`);
    return;
  }
  const [group, command, ...rest] = positionals;
  if (group === "__complete") {
    const candidates = completionCandidates([command, ...rest].filter(Boolean));
    stdout.write(candidates.join("\n"));
    if (candidates.length) stdout.write("\n");
    return;
  }
  if (group === "completion") {
    if (command !== "powershell" || rest.length) throw new Error("usage: lintaya completion powershell");
    stdout.write(`${powershellCompletionScript()}\n`);
    return;
  }
  if (group === "tui" && !command) return (await import("./tui.mjs")).startTui({env, configPath});
  if (group === "version") {
    stdout.write(`${VERSION}\n`);
    return;
  }

  if (group === "profile") {
    const config = await readConfig(configPath);
    if (command === "list") {
      if (values.json) return printJson(stdout, { activeProfile: config.activeProfile, profiles: Object.entries(config.profiles).map(([name, profile]) => ({ name, url: profile.url, active: name === config.activeProfile })) });
      return printProfiles(stdout, config);
    }
    if (command === "add") {
      const name = validateProfileName(rest[0]);
      if (!values.url) throw new Error("profile add requires --url");
      if (rest.length !== 1) throw new Error("profile add accepts exactly one name");
      const token = await tokenFromInput(values, env, stdin);
      if (!token) throw new Error("set LINTAYA_TOKEN or provide the token through --token-stdin");
      config.profiles[name] = { url: normalizeUrl(values.url), token };
      if (!config.activeProfile) config.activeProfile = name;
      await writeConfig(config, configPath);
      const result = { ok: true, activeProfile: config.activeProfile, profile: { name, url: config.profiles[name].url } };
      if (values.json) return printJson(stdout, result);
      return printProfileResult(stdout, "add", { name, url: result.profile.url, activeProfile: result.activeProfile });
    }
    if (command === "use") {
      const name = validateProfileName(rest[0]);
      if (rest.length !== 1) throw new Error("profile use accepts exactly one name");
      if (!config.profiles[name]) throw new Error(`profile '${name}' does not exist`);
      config.activeProfile = name;
      await writeConfig(config, configPath);
      const result = { ok: true, activeProfile: name };
      if (values.json) return printJson(stdout, result);
      return printProfileResult(stdout, "use", { name, activeProfile: name });
    }
    if (command === "remove") {
      const name = validateProfileName(rest[0]);
      if (rest.length !== 1) throw new Error("profile remove accepts exactly one name");
      if (!config.profiles[name]) throw new Error(`profile '${name}' does not exist`);
      delete config.profiles[name];
      if (config.activeProfile === name) config.activeProfile = Object.keys(config.profiles)[0] || null;
      await writeConfig(config, configPath);
      const result = { ok: true, activeProfile: config.activeProfile };
      if (values.json) return printJson(stdout, result);
      return printProfileResult(stdout, "remove", { name, activeProfile: result.activeProfile });
    }
    throw new Error("unknown profile subcommand; use add, list, use, or remove");
  }

  const normalizedGroup = group === "block" ? "blocks" : group;
  if (["health", "status", "context", "connector", "connectors", "blocks", "board", "boards", "pages", "dashboards", "approvals", "search", "api"].includes(normalizedGroup)) {
    const config = await readConfig(configPath);
    const profile = profileForRequest(config, values, env);
    if (normalizedGroup === "search") {
      const query = [command, ...rest].filter(Boolean).join(" ");
      if (!query) throw new Error("usage: lintaya search <query> [--limit <n>]");
      const actor = values.actor || env.LINTAYA_ACTOR;
      const [modulePages, dashboards, connectorBlocks, customBlocks] = await Promise.all([
        getJson({ baseUrl: profile.url, token: profile.token, requestPath: "/api/module-pages", actor, fetchImpl }),
        getJson({ baseUrl: profile.url, token: profile.token, requestPath: "/api/dashboards", actor, fetchImpl }),
        getJson({ baseUrl: profile.url, token: profile.token, requestPath: "/api/home/blocks", actor, fetchImpl }),
        getJson({ baseUrl: profile.url, token: profile.token, requestPath: "/api/home/custom-blocks", actor, fetchImpl }),
      ]);
      const blockCatalog = [...(connectorBlocks || []), ...(customBlocks || [])];
      const pairs = connectorBlockPairsFromBoards({ modulePages: modulePages || [], blockCatalog });
      const itemsByKey = new Map();
      await Promise.all([...pairs.entries()].map(async ([key, block]) => {
        try {
          const data = await getJson({ baseUrl: profile.url, token: profile.token, requestPath: connectorBlockPath(block), actor, fetchImpl });
          itemsByKey.set(key, data?.items || []);
        } catch {
          itemsByKey.set(key, []);
        }
      }));
      const entries = buildSearchEntries({ modulePages: modulePages || [], dashboards: dashboards || [], blockCatalog, itemsByKey });
      const limit = values.limit ? Number(values.limit) : 20;
      const results = matchSearchEntries(entries, query, limit);
      if (values.json) return printJson(stdout, { total: results.length, results });
      return printSearchResults(stdout, { query, results });
    }
    if (normalizedGroup === "connector") {
      if (!command || rest.length) throw new Error("usage: lintaya connector <number>");
      const connectors = await getJson({ baseUrl: profile.url, token: profile.token, requestPath: "/api/connectors", actor: values.actor || env.LINTAYA_ACTOR, fetchImpl });
      const numbers = await registerAndWrite(config, profile, "connectors", connectors.map(connector => connector.id), configPath);
      const id = resolveAlias(config, profile.name, "connectors", command);
      const connector = connectors.find(item => item.id === id);
      if (!connector) throw new Error(`connector ${command} (${id}) is no longer available on this server`);
      const result = { ...connector, cliNumber: numbers.get(id) };
      if (values.json) return printJson(stdout, result);
      return printConnectorDetail(stdout, result);
    }
    if (normalizedGroup === "board") {
      if (!command || rest.length) throw new Error("usage: lintaya board <number>");
      const boards = await getJson({ baseUrl: profile.url, token: profile.token, requestPath: "/api/module-pages", actor: values.actor || env.LINTAYA_ACTOR, fetchImpl });
      const numbers = await registerAndWrite(config, profile, "boards", boards.map(board => board.id), configPath);
      const id = resolveAlias(config, profile.name, "boards", command);
      const board = boards.find(item => item.id === id);
      if (!board) throw new Error(`board ${command} (${id}) is no longer available on this server`);
      const result = { ...board, cliNumber: numbers.get(id) };
      if (values.json) return printJson(stdout, result);
      return printBoardDetail(stdout, result);
    }
    if (normalizedGroup === "blocks" && command === "show") {
      if (rest.length !== 1) throw new Error("usage: lintaya blocks show <id>");
      const inventory = await getBlockInventory({ baseUrl: profile.url, token: profile.token, actor: values.actor || env.LINTAYA_ACTOR, fetchImpl });
      await registerAndWrite(config, profile, "blocks", blockAliasIds(inventory), configPath);
      const id = resolveAlias(config, profile.name, "blocks", rest[0]);
      const detail = await getBlockDetail({ baseUrl: profile.url, token: profile.token, actor: values.actor || env.LINTAYA_ACTOR, id, fetchImpl, inventory });
      if (values.json) return printJson(stdout, detail);
      return printBlockDetail(stdout, detail);
    }
    if (normalizedGroup === "blocks" && /^\d+$/.test(command || "") && rest.length === 0) {
      const inventory = await getBlockInventory({ baseUrl: profile.url, token: profile.token, actor: values.actor || env.LINTAYA_ACTOR, fetchImpl });
      await registerAndWrite(config, profile, "blocks", blockAliasIds(inventory), configPath);
      const id = resolveAlias(config, profile.name, "blocks", command);
      const detail = await getBlockDetail({ baseUrl: profile.url, token: profile.token, actor: values.actor || env.LINTAYA_ACTOR, id, fetchImpl, inventory });
      if (values.json) return printJson(stdout, detail);
      return printBlockDetail(stdout, detail);
    }
    // Escritura. Va aparte de readRequestFor, que devuelve ruta y no verbo, y
    // exige la ruta entera: el CLI no compone endpoints por ti para que quede
    // en el historial del shell exactamente contra qué se escribió.
    if (normalizedGroup === "api" && WRITE_VERBS.includes(command)) {
      if (rest.length !== 1) throw new Error(`usage: lintaya api ${command} </api/...> [--body <json> | --body-stdin]`);
      const body = await bodyFromInput(values, stdin);
      if (body === undefined && command !== "delete") throw new Error(`lintaya api ${command} needs --body <json> or --body-stdin`);
      const result = await sendJson({
        baseUrl: profile.url, token: profile.token, requestPath: rest[0],
        method: command.toUpperCase(), body,
        actor: values.actor || env.LINTAYA_ACTOR, fetchImpl,
      });
      return printJson(stdout, result);
    }
    const requestPath = readRequestFor(normalizedGroup, command, rest);
    if (!requestPath) throw new Error(`unknown command '${group}'; use --help`);
    const data = await getJson({ baseUrl: profile.url, token: profile.token, requestPath, actor: values.actor || env.LINTAYA_ACTOR, fetchImpl });
    let viewData = data;
    if (normalizedGroup === "connectors" && command === "list" && Array.isArray(data)) {
      const numbers = await registerAndWrite(config, profile, "connectors", data.map(connector => connector.id), configPath);
      viewData = withNumbers(data, numbers);
    }
    if (normalizedGroup === "blocks" && command === "catalog" && Array.isArray(data)) {
      const numbers = await registerAndWrite(config, profile, "blocks", data.map(block => block.id), configPath);
      viewData = withNumbers(data, numbers);
    }
    if (normalizedGroup === "blocks" && command === "custom" && Array.isArray(data)) {
      const numbers = await registerAndWrite(config, profile, "blocks", data.map(block => block.id), configPath);
      viewData = withNumbers(data, numbers);
    }
    if ((normalizedGroup === "pages" || normalizedGroup === "boards") && command === "list" && Array.isArray(data)) {
      const numbers = await registerAndWrite(config, profile, "boards", data.map(board => board.id), configPath);
      viewData = withNumbers(data, numbers);
    }
    if (values.json) return printJson(stdout, data);
    return printReadResult(stdout, { group: normalizedGroup === "boards" ? "pages" : normalizedGroup, command, subject: rest[0], data: viewData });
  }
  throw new Error(`unknown command '${group}'; use --help`);
}

async function main(argv) {
  return run(argv);
}

module.exports = { VERSION, HELP, completionCandidates, powershellCompletionScript, parse, profileForRequest, readRequestFor, getBlockDetail, run, main };
