const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Writable, Readable } = require("node:stream");
const { completionCandidates, run } = require("../src");
const { getJson } = require("../src/http-client");

function output() {
  let text = "";
  return { stream: new Writable({ write(chunk, _encoding, callback) { text += chunk; callback(); } }), text: () => text };
}

async function temporaryConfig(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lintaya-cli-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "config.json");
}

test("profile add stores no token in its output", async (t) => {
  const configPath = await temporaryConfig(t);
  const out = output();
  await run(["profile", "add", "local", "--url", "http://localhost:3000", "--json"], { configPath, env: { LINTAYA_TOKEN: "secret" }, stdout: out.stream });
  assert.deepEqual(JSON.parse(out.text()), { ok: true, activeProfile: "local", profile: { name: "local", url: "http://localhost:3000" } });
  const persisted = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(persisted.profiles.local.token, "secret");
});

test("profile add accepts a token from stdin without placing it in arguments", async (t) => {
  const configPath = await temporaryConfig(t);
  await run(["profile", "add", "ci", "--url", "https://lintaya.example", "--token-stdin"], {
    configPath,
    env: {},
    stdin: Readable.from(["stdin-secret\n"]),
    stdout: output().stream
  });
  const persisted = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(persisted.profiles.ci.token, "stdin-secret");
});

test("status calls the authenticated public API and forwards an explicit agent actor", async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/api/connectors/status");
    assert.equal(req.headers.authorization, "Bearer saved-token");
    assert.equal(req.headers["x-actor"], "codex-test");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ id: "gitlab", status: "connected" }]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const configPath = await temporaryConfig(t);
  const out = output();
  await run(["profile", "add", "local", "--url", `http://127.0.0.1:${port}`], { configPath, env: { LINTAYA_TOKEN: "saved-token" }, stdout: output().stream });
  await run(["status", "--actor", "codex-test", "--json"], { configPath, env: {}, stdout: out.stream });
  assert.deepEqual(JSON.parse(out.text()), [{ id: "gitlab", status: "connected" }]);
});

test("human output explains profile, status, context, modules, schemas, and connector context", async (t) => {
  const configPath = await temporaryConfig(t);
  await run(["profile", "add", "local", "--url", "http://localhost:3001"], { configPath, env: { LINTAYA_TOKEN: "token" }, stdout: output().stream });

  const profiles = output();
  await run(["profile", "list"], { configPath, env: {}, stdout: profiles.stream });
  assert.match(profiles.text(), /Profiles \(1\)/);
  assert.match(profiles.text(), /local/);

  const responses = new Map([
    ["/api/connectors/status", { gitlab: { configured: true, status: "ok", lastSync: "2026-08-22T21:12:00.000Z", itemsSynced: 3, log: [{}] } }],
    ["/api/ai-context", { name: "Lintaya", version: "1.0", description: "Workspace", auth: { type: "Bearer token" }, endpoints: { connectors: ["GET /api/connectors"] }, connectors: [{ id: "gitlab" }], tips: ["Use the API"] }],
    ["/api/connectors/modules", [{ connectorId: "gitlab", moduleId: "repositories", label: "Repos", status: "ok", available: true, route: "module:gitlab:repositories" }]],
    ["/api/connectors/gitlab/config-schema", { title: "GitLab", description: "Connection fields", required: ["url"], properties: { url: { title: "URL", type: "string", description: "Server URL" }, token: { title: "Token", type: "string", "x-lintaya-secret": true } } }],
    ["/api/connectors/gitlab/ai-context", { content: "# Team rules\nCreate issues with labels." }],
  ]);
  const fetchImpl = async (url) => new Response(JSON.stringify(responses.get(new URL(url).pathname)), { headers: { "content-type": "application/json" } });
  const cases = [
    [["status"], /Connection status \(1\).*gitlab/s],
    [["context"], /Agent context.*Connector types: 1/s],
    [["connectors", "modules"], /Connector modules \(1\).*repositories/s],
    [["connectors", "schema", "gitlab"], /GitLab configuration schema.*SECRET/s],
    [["connectors", "context", "gitlab"], /AI context · gitlab.*Team rules/s],
  ];
  for (const [argv, expected] of cases) {
    const out = output();
    await run(argv, { configPath, env: {}, stdout: out.stream, fetchImpl });
    assert.match(out.text(), expected);
    assert.doesNotMatch(out.text(), /^\{\n/);
  }
});

test("blocks show prints a content block or a connector block feed", async (t) => {
  const configPath = await temporaryConfig(t);
  await run(["profile", "add", "local", "--url", "http://localhost:3001"], { configPath, env: { LINTAYA_TOKEN: "token" }, stdout: output().stream });
  const responses = new Map([
    ["/api/home/custom-blocks", [{ id: "runbook", kind: "content", title: "Deployment runbook", format: "md", content: "1. Check the release.\n2. Deploy." }]],
    ["/api/home/blocks", [{ id: "gitlab.recent-commits", connectorId: "gitlab", blockId: "recent-commits", title: "Recent commits" }]],
    ["/api/connectors/gitlab/blocks/recent-commits", { updatedAt: "2026-08-22T21:12:00.000Z", items: [{ id: "abc", title: "Improve CLI", subtitle: "main", timestamp: "2026-08-22T21:00:00.000Z", badge: { text: "Merged" } }] }],
  ]);
  const fetchImpl = async (url) => new Response(JSON.stringify(responses.get(new URL(url).pathname)), { headers: { "content-type": "application/json" } });
  const content = output();
  await run(["blocks", "show", "runbook"], { configPath, env: {}, stdout: content.stream, fetchImpl });
  assert.match(content.text(), /Content block.*Deployment runbook.*1\. Check the release/s);
  const connector = output();
  await run(["blocks", "show", "gitlab.recent-commits"], { configPath, env: {}, stdout: connector.stream, fetchImpl });
  assert.match(connector.text(), /Connector block.*Recent commits.*Improve CLI/s);
});

test("PowerShell completion exposes the short block alias and common block references", async () => {
  assert.deepEqual(completionCandidates([]), ["profile", "tui", "health", "status", "context", "connector", "connectors", "block", "blocks", "board", "boards", "pages", "dashboards", "approvals", "search", "api", "completion", "version"]);
  assert.deepEqual(completionCandidates(["block"]), ["catalog", "custom", "show"]);
  assert.ok(completionCandidates(["block", "show"]).includes("gitlab.recent-commits"));
});

test("stable per-profile numbers resolve connectors, blocks, and boards without changing server data", async (t) => {
  const configPath = await temporaryConfig(t);
  await run(["profile", "add", "local", "--url", "http://localhost:3001"], { configPath, env: { LINTAYA_TOKEN: "token" }, stdout: output().stream });
  const responses = new Map([
    ["/api/connectors", [{ id: "gitlab", name: "GitLab", type: "gitlab", configured: true, liveStatus: { status: "ok" }, modules: [], blocks: [] }]],
    ["/api/home/custom-blocks", []],
    ["/api/home/blocks", [{ id: "gitlab.recent-commits", connectorId: "gitlab", blockId: "recent-commits", title: "Recent commits" }]],
    ["/api/connectors/gitlab/blocks/recent-commits", { items: [{ id: "c1", title: "A commit" }], updatedAt: null }],
    ["/api/module-pages", [{ id: "page-ops", title: "Operations", active: true, updatedAt: "2026-08-22T21:00:00.000Z", tree: { blocks: ["gitlab.recent-commits"] } }]],
  ]);
  const fetchImpl = async (url) => new Response(JSON.stringify(responses.get(new URL(url).pathname)), { headers: { "content-type": "application/json" } });

  const connectorList = output();
  await run(["connectors", "list"], { configPath, env: {}, stdout: connectorList.stream, fetchImpl });
  assert.match(connectorList.text(), /#\s+ID[\s\S]*1\s+gitlab/);
  const connector = output();
  await run(["connector", "1"], { configPath, env: {}, stdout: connector.stream, fetchImpl });
  assert.match(connector.text(), /Connector 1.*GitLab/s);

  const block = output();
  await run(["block", "1"], { configPath, env: {}, stdout: block.stream, fetchImpl });
  assert.match(block.text(), /Connector block.*A commit/s);
  const boards = output();
  await run(["boards", "list"], { configPath, env: {}, stdout: boards.stream, fetchImpl });
  assert.match(boards.text(), /Boards \(1\).*Operations/s);
  const board = output();
  await run(["board", "1"], { configPath, env: {}, stdout: board.stream, fetchImpl });
  assert.match(board.text(), /Board 1.*Operations.*gitlab\.recent-commits/s);

  const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.deepEqual(saved.profiles.local.aliases, {
    connectors: { next: 2, items: { gitlab: 1 } },
    blocks: { next: 2, items: { "gitlab.recent-commits": 1 } },
    boards: { next: 2, items: { "page-ops": 1 } },
  });
});

test("discovery commands map connectors, blocks and pages to their public endpoints", async (t) => {
  const requested = [];
  const server = http.createServer((req, res) => {
    requested.push(req.url);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const configPath = await temporaryConfig(t);
  const { port } = server.address();
  await run(["profile", "add", "local", "--url", `http://127.0.0.1:${port}`], { configPath, env: { LINTAYA_TOKEN: "token" }, stdout: output().stream });
  for (const argv of [["connectors", "catalog"], ["connectors", "schema", "gitlab2"], ["blocks", "catalog"], ["blocks", "custom"], ["pages", "list"], ["context"]]) {
    await run(argv, { configPath, env: {}, stdout: output().stream });
  }
  assert.deepEqual(requested, [
    "/api/connectors/catalog",
    "/api/connectors/gitlab2/config-schema",
    "/api/home/blocks",
    "/api/home/custom-blocks",
    "/api/module-pages",
    "/api/ai-context"
  ]);
});

test("connectors list defaults to a readable table and preserves full JSON on demand", async (t) => {
  const configPath = await temporaryConfig(t);
  const fetchImpl = async () => new Response(JSON.stringify([{
    id: "gitlab", name: "GitLab", type: "gitlab", configured: true,
    liveStatus: { status: "ok", lastSync: "2026-08-22T21:12:00.000Z", itemsSynced: 6 }, modules: [], blocks: []
  }]), { headers: { "content-type": "application/json" } });
  await run(["profile", "add", "local", "--url", "http://localhost:3001"], { configPath, env: { LINTAYA_TOKEN: "token" }, stdout: output().stream });
  const human = output();
  await run(["connectors", "list"], { configPath, env: {}, stdout: human.stream, fetchImpl });
  assert.match(human.text(), /Connectors \(1\).*OK: 1/s);
  assert.match(human.text(), /GitLab/);
  const json = output();
  await run(["connectors", "list", "--json"], { configPath, env: {}, stdout: json.stream, fetchImpl });
  assert.deepEqual(JSON.parse(json.text())[0].id, "gitlab");
});

test("api get refuses any route outside the API namespace", async (t) => {
  const configPath = await temporaryConfig(t);
  await run(["profile", "add", "local", "--url", "http://localhost:3000"], { configPath, env: { LINTAYA_TOKEN: "token" }, stdout: output().stream });
  await assert.rejects(() => run(["api", "get", "/docs"], { configPath, stdout: output().stream, stdin: Readable.from([]) }), /must start with \/api\//);
});

test("connection errors name the target server and recovery step", async () => {
  const failure = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  await assert.rejects(
    () => getJson({ baseUrl: "http://localhost:3001", requestPath: "/api/health", fetchImpl: async () => { throw failure; } }),
    /could not connect to http:\/\/localhost:3001.*ECONNREFUSED/
  );
});
