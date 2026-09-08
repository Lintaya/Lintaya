const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");
const { createApp, requireAuth } = require("../app");
const { MAIN_MIGRATIONS, migrate } = require("../core/database");
const { AppError, sendAppError } = require("../core/errors");
const { registerAISettingsRoutes, buildConnectorLiveContext } = require("./ai-settings");
const { registerApprovalRoutes } = require("./approvals");
const { runWriteTool } = require("../core/assistant-tools");
const { createApprovalStore } = require("../core/services/approval-store");
const { request } = require("./test-http-harness");

function setup({ config = {}, kvSeed = {} } = {}) {
  const db = new Database(":memory:");
  migrate(db, MAIN_MIGRATIONS);
  const kv = new Map(Object.entries(kvSeed));
  const kvGet = (key) => (kv.has(key) ? { value: kv.get(key) } : null);
  const kvSet = (key, value) => kv.set(key, value);
  const env = {
    ai: { provider: "", litellmBaseUrl: "", litellmApiKey: "", anthropicApiKey: "", ...(config.ai || {}) },
  };
  const app = createApp({ token: "test-token" });
  const auditActivity = () => (req, res, next) => next();
  const approvalStore = createApprovalStore({ db });
  registerAISettingsRoutes({
    app, requireAuth,
    kvGet, kvSet,
    kvGetByPrefix: (prefix) => Object.fromEntries([...kv].filter(([key]) => key.startsWith(prefix))),
    deleteKv: (key) => kv.delete(key),
    db, auditActivity,
    log: { info() {}, error() {}, warn() {} },
    AppError, sendAppError,
    config: env,
    approvalStore,
  });
  // Assistant write-tool proposals resolve through the same /api/approvals
  // endpoints as connector destructive actions — mounted here so tests can
  // exercise the real propose → approve/reject round trip instead of a
  // now-removed /api/chat/tools/:name shortcut. executeAction is never
  // reached by the assistant path (connectorTypeId "assistant" branches off
  // before it), so a throwing stub is enough to prove that.
  registerApprovalRoutes({
    app, requireAuth, approvalStore,
    executeAction: async () => { throw new Error("executeAction must not be called for assistant tool proposals"); },
    runWriteTool, kvGet, kvSet, sendAppError,
  });
  const get = (key) => (kv.has(key) ? kv.get(key) : null);
  return {
    app,
    headers: { authorization: "Bearer test-token" },
    db, kv, get, approvalStore,
    close: () => db.close(),
  };
}

const NO_SECRETS = ["apiKey", "password", "username"];

test("nothing configured → /api/settings/ai reports unconfigured with provider presets", async () => {
  const env = setup();
  const res = await request(env.app, "GET", "/api/settings/ai", { headers: env.headers });
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.configured, false);
  assert.equal(body.source, "none");
  const ids = body.presets.map(p => p.id);
  for (const expected of ["anthropic", "openai", "opencode", "ollama", "compatible", "litellm"]) {
    assert.ok(ids.includes(expected), `missing preset ${expected}`);
  }
  for (const key of NO_SECRETS) assert.ok(!(key in body));
  assert.equal(JSON.stringify(body).includes("sk-ant"), false, "no key material leaks");
  env.close();
});

test("saving an anthropic provider stores the key but never returns it", async () => {
  const env = setup();
  const res = await request(env.app, "POST", "/api/settings/ai", {
    headers: env.headers,
    body: { provider: "anthropic", apiKey: "sk-ant-test123456", model: "claude-sonnet-4-5" },
  });
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.configured, true);
  assert.equal(body.provider, "anthropic");
  assert.equal(body.source, "config");
  assert.equal(body.apiKeyConfigured, true);
  assert.match(body.keyHint, /sk-ant…3456/);
  assert.ok(!("apiKey" in body));
  assert.equal(env.get("ai-config").provider, "anthropic");
  assert.equal(env.get("ai-config").apiKey, "sk-ant-test123456");
  assert.equal(env.get("ai-config").model, "claude-sonnet-4-5");
  env.close();
});

test("rejects an unknown provider and a bad-prefix anthropic key", async () => {
  const env = setup();
  const unknown = await request(env.app, "POST", "/api/settings/ai", {
    headers: env.headers, body: { provider: "nope", apiKey: "x" },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json().detail, /invalid-ai-provider/);

  const badKey = await request(env.app, "POST", "/api/settings/ai", {
    headers: env.headers, body: { provider: "anthropic", apiKey: "gpt-9-not-anthropic" },
  });
  assert.equal(badKey.status, 400);
  assert.match(badKey.json().detail, /invalid-key/);

  const missingKey = await request(env.app, "POST", "/api/settings/ai", {
    headers: env.headers, body: { provider: "openai" },
  });
  assert.equal(missingKey.status, 400);
  assert.match(missingKey.json().detail, /ai-api-key-required/);
  env.close();
});

test("opencode provider saves base URL + optional server auth, secrets stay hidden", async () => {
  const env = setup();
  const res = await request(env.app, "POST", "/api/settings/ai", {
    headers: env.headers,
    body: { provider: "opencode", baseUrl: "http://127.0.0.1:4096", username: "opencode", password: "hunter2" },
  });
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.provider, "opencode");
  assert.equal(body.configured, true);
  assert.equal(body.hasServerAuth, true);
  assert.ok(!("password" in body) && !("apiKey" in body));
  const saved = env.get("ai-config");
  assert.equal(saved.baseUrl, "http://127.0.0.1:4096");
  assert.equal(saved.password, "hunter2");
  assert.equal(saved.username, "opencode");
  env.close();
});

test("rejects a non-http base URL", async () => {
  const env = setup();
  const res = await request(env.app, "POST", "/api/settings/ai", {
    headers: env.headers, body: { provider: "opencode", baseUrl: "ftp://nope" },
  });
  assert.equal(res.status, 400);
  assert.match(res.json().detail, /invalid-base-url/);
  env.close();
});

test("DELETE /api/settings/ai clears provider config and legacy key", async () => {
  const env = setup({
    kvSeed: {
      "ai-config": { provider: "anthropic", apiKey: "sk-ant-test123456" },
      "claude-api-key": "sk-ant-legacy7890",
    },
  });
  const before = await request(env.app, "GET", "/api/settings/ai", { headers: env.headers });
  assert.equal(before.json().configured, true);
  const res = await request(env.app, "DELETE", "/api/settings/ai", { headers: env.headers });
  assert.equal(res.status, 200);
  assert.equal(res.json().configured, false);
  assert.equal(env.get("ai-config"), null);
  assert.equal(env.get("claude-api-key"), null);
  env.close();
});

test("legacy claude-key endpoints still work (compat shim)", async () => {
  const env = setup();
  const empty = await request(env.app, "GET", "/api/settings/claude-key", { headers: env.headers });
  assert.equal(empty.status, 200);
  assert.equal(empty.json().configured, false);

  const bad = await request(env.app, "POST", "/api/settings/claude-key", {
    headers: env.headers, body: { apiKey: "nope" },
  });
  assert.equal(bad.status, 400);

  const saved = await request(env.app, "POST", "/api/settings/claude-key", {
    headers: env.headers, body: { apiKey: "sk-ant-legacy1234" },
  });
  assert.equal(saved.status, 200);
  assert.match(saved.json().hint, /sk-ant-…1234/);
  assert.ok(!("apiKey" in saved.json()));

  const check = await request(env.app, "GET", "/api/settings/claude-key", { headers: env.headers });
  assert.equal(check.json().configured, true);
  assert.equal(check.json().provider, "anthropic");
  assert.ok(!("key" in check.json()));

  const removed = await request(env.app, "DELETE", "/api/settings/claude-key", { headers: env.headers });
  assert.equal(removed.status, 200);
  assert.equal(env.get("claude-api-key"), null);
  env.close();
});

test("POST /api/chat without any provider → claude-api-key-not-configured", async () => {
  const env = setup();
  const res = await request(env.app, "POST", "/api/chat", {
    headers: env.headers, body: { messages: [{ role: "user", content: "hola" }] },
  });
  assert.equal(res.status, 400);
  assert.match(res.json().detail, /claude-api-key-not-configured/);
  env.close();
});

test("POST /api/chat via opencode streams text parts and deletes the session", async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET" });
    if (opts.method === "DELETE") return { ok: true, status: 200, json: async () => ({}) };
    if (String(url).endsWith("/session")) return { ok: true, status: 200, json: async () => ({ id: "sess-1" }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ parts: [{ type: "text", text: "hola " }, { type: "text", text: "mundo" }, { type: "tool", id: "t1" }] }),
    };
  };
  try {
    const env = setup({
      kvSeed: { "ai-config": { provider: "opencode", baseUrl: "http://127.0.0.1:4199" } },
    });
    const res = await request(env.app, "POST", "/api/chat", {
      headers: env.headers,
      body: { messages: [{ role: "user", content: "resumen" }], system: "sistema" },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    // text parts are joined into one SSE chunk and the done marker streamed
    const events = res.text.trim().split("\n\n").map(e => JSON.parse(e.replace(/^data: /, "")));
    assert.equal(events[0].text, "hola mundo");
    assert.deepEqual(events[1], { done: true });
    // session created, messaged, then disposed
    assert.ok(calls.some(c => c.method === "POST" && c.url.endsWith("/session")));
    assert.ok(calls.some(c => c.method === "POST" && c.url.endsWith("/session/sess-1/message")));
    assert.ok(calls.some(c => c.method === "DELETE" && c.url.endsWith("/session/sess-1")));
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("POST /api/chat via LiteLLM proxies an OpenAI-style SSE stream", async () => {
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    assert.ok(String(url).endsWith("/chat/completions"));
    const body = JSON.parse(opts.body);
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hola"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  try {
    const env = setup({
      kvSeed: { "ai-config": { provider: "litellm", baseUrl: "http://proxy:4000" } },
    });
    const res = await request(env.app, "POST", "/api/chat", {
      headers: env.headers,
      body: { messages: [{ role: "user", content: "hola" }], system: "sys", model: "gpt-4o-mini" },
    });
    assert.equal(res.status, 200);
    const events = res.text.trim().split("\n\n").map(e => JSON.parse(e.replace(/^data: /, "")));
    assert.equal(events[0].text, "hola");
    assert.equal(events[1].text, " mundo");
    assert.equal(events[2].done, true);
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("POST /api/settings/ai/models lists an OpenAI-compatible server's models (Ollama, LiteLLM, ...)", async () => {
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    assert.ok(String(url).endsWith("/models"));
    assert.equal(opts.headers.Authorization, undefined);
    return new Response(JSON.stringify({ data: [{ id: "llama3.2" }, { id: "mistral" }, { id: "llama3.2" }] }), { status: 200 });
  };
  try {
    const env = setup();
    const res = await request(env.app, "POST", "/api/settings/ai/models", {
      headers: env.headers,
      body: { provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().models, ["llama3.2", "mistral"]);
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("POST /api/settings/ai/models rejects a bad base URL and reports an upstream failure as 502", async () => {
  const env = setup();
  const badUrl = await request(env.app, "POST", "/api/settings/ai/models", {
    headers: env.headers, body: { provider: "ollama", baseUrl: "not-a-url" },
  });
  assert.equal(badUrl.status, 400);

  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error("connection refused"); };
  try {
    const res = await request(env.app, "POST", "/api/settings/ai/models", {
      headers: env.headers, body: { provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1" },
    });
    assert.equal(res.status, 502);
    assert.match(res.json().detail, /connection refused/);
  } finally {
    global.fetch = realFetch;
  }
  env.close();
});

test("POST /api/settings/ai/models returns the curated list without a network call for non-openai providers", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error("should not be called"); };
  try {
    const env = setup();
    const res = await request(env.app, "POST", "/api/settings/ai/models", {
      headers: env.headers, body: { provider: "anthropic" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().models, ["claude-haiku-4-5", "claude-sonnet-4-5"]);
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("buildConnectorLiveContext lists every configured connector, not just vCenter/Bitwarden", () => {
  const env = setup({
    kvSeed: {
      "connector-config-gitlab": { baseUrl: "https://gitlab.local" },
      "connector-status-gitlab": { itemsSynced: 42, lastSync: "2026-08-28T10:00:00.000Z" },
      "connector-ai-context": { gitlab: "Solo mirar la rama main; ignorar forks." },
    },
  });
  env.db.prepare("INSERT INTO connectors (id, name, connector_type_id, created_at) VALUES (?, ?, ?, ?)").run("gitlab", "GitLab", "gitlab", Date.now());
  const kvGet = (key) => (env.kv.has(key) ? { value: env.kv.get(key) } : null);
  const kvGetByPrefix = (prefix) => Object.fromEntries([...env.kv].filter(([key]) => key.startsWith(prefix)));
  const context = buildConnectorLiveContext({ kvGet, kvGetByPrefix, db: env.db });
  assert.match(context, /GitLab/);
  assert.match(context, /42 items sincronizados/);
  assert.match(context, /Solo mirar la rama main/);
  env.close();
});

test("buildConnectorLiveContext returns an empty string when nothing is configured", () => {
  const env = setup();
  const context = buildConnectorLiveContext({ kvGet: () => null, kvGetByPrefix: () => ({}), db: env.db });
  assert.equal(context, "");
  env.close();
});

test("POST /api/chat includes the connector-aware live context, including AI context notes, in the system prompt", async () => {
  const realFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, opts = {}) => {
    capturedBody = JSON.parse(opts.body);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  try {
    const env = setup({
      kvSeed: {
        "ai-config": { provider: "openai", apiKey: "sk-test" },
        "connector-config-plane": { baseUrl: "https://plane.local" },
        "connector-status-plane": { itemsSynced: 7 },
        "connector-ai-context": { plane: "Los tickets HIGH van primero." },
      },
    });
    env.db.prepare("INSERT INTO connectors (id, name, connector_type_id, created_at) VALUES (?, ?, ?, ?)").run("plane", "Plane", "plane", Date.now());
    const res = await request(env.app, "POST", "/api/chat", {
      headers: env.headers,
      body: { messages: [{ role: "user", content: "hola" }], system: "base" },
    });
    assert.equal(res.status, 200);
    assert.match(capturedBody.messages[0].content, /CONECTORES CONFIGURADOS/);
    assert.match(capturedBody.messages[0].content, /Plane/);
    assert.match(capturedBody.messages[0].content, /7 items sincronizados/);
    assert.match(capturedBody.messages[0].content, /Los tickets HIGH van primero/);
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("/api/chat streams a provider error to the client instead of crashing", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("connection refused");
  };
  try {
    const env = setup({
      kvSeed: { "ai-config": { provider: "opencode", baseUrl: "http://127.0.0.1:4199" } },
    });
    const res = await request(env.app, "POST", "/api/chat", {
      headers: env.headers,
      body: { messages: [{ role: "user", content: "hola" }] },
    });
    assert.equal(res.status, 200);
    const events = res.text.trim().split("\n\n").map(e => JSON.parse(e.replace(/^data: /, "")));
    assert.match(events[events.length - 1].error, /connection refused/);
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

function sseStream(lines) {
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
      controller.close();
    },
  });
}

test("/api/chat: a read tool call executes and loops back into the model instead of ending the turn", async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (calls.length === 1) {
      return new Response(sseStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_boards","arguments":"{}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ]), { status: 200 });
    }
    return new Response(sseStream([
      'data: {"choices":[{"delta":{"content":"Tenés 1 Board."}}]}\n\n',
      "data: [DONE]\n\n",
    ]), { status: 200 });
  };
  try {
    const env = setup({
      kvSeed: {
        "ai-config": { provider: "litellm", baseUrl: "http://proxy:4000" },
        "module-pages": [{ id: "page-1", title: "Infra", active: true, tree: { t: "z", k: "z1", blocks: [] } }],
      },
    });
    const res = await request(env.app, "POST", "/api/chat", {
      headers: env.headers, body: { messages: [{ role: "user", content: "¿qué boards tengo?" }], system: "base" },
    });
    assert.equal(res.status, 200);
    const events = res.text.trim().split("\n\n").map(e => JSON.parse(e.replace(/^data: /, "")));
    assert.ok(events.some(e => e.text === "Tenés 1 Board."));
    assert.ok(events.some(e => e.done === true));
    assert.ok(!events.some(e => e.toolProposal), "a read tool must never surface as a proposal");
    assert.equal(calls.length, 2, "expected one call to run the tool and a second to continue the conversation");
    const toolResultMessage = calls[1].messages.find(m => m.role === "tool");
    assert.ok(toolResultMessage, "the read tool's result must be sent back to the model");
    assert.match(toolResultMessage.content, /Infra/);
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("/api/chat: a write tool call never executes on its own — it files a pending Approval Center request", async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async (url, opts = {}) => {
    fetchCalls += 1;
    return new Response(sseStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"create_board","arguments":"{\\"title\\":\\"Infra\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]), { status: 200 });
  };
  try {
    const env = setup({ kvSeed: { "ai-config": { provider: "litellm", baseUrl: "http://proxy:4000" } } });
    const res = await request(env.app, "POST", "/api/chat", {
      headers: env.headers, body: { messages: [{ role: "user", content: "creame un board de Infra" }], system: "base" },
    });
    assert.equal(res.status, 200);
    const events = res.text.trim().split("\n\n").map(e => JSON.parse(e.replace(/^data: /, "")));
    const proposal = events.find(e => e.toolProposal)?.toolProposal;
    assert.ok(proposal, "expected a toolProposal event");
    assert.equal(proposal.name, "create_board");
    assert.deepEqual(proposal.args, { title: "Infra" });
    assert.match(proposal.label, /Crear Board "Infra"/);
    assert.ok(proposal.approvalId, "expected the proposal to carry a real approvalId");
    assert.equal(env.get("module-pages"), null, "the board must not exist until a human approves it");
    assert.equal(fetchCalls, 1, "a write proposal ends the turn — no follow-up call to the model");

    const pending = env.approvalStore.get(proposal.approvalId);
    assert.equal(pending.status, "pending");
    assert.equal(pending.connectorTypeId, "assistant");
    assert.equal(pending.requester, "agent:assistant");
    assert.deepEqual(pending.input, { title: "Infra" });
    env.close();
  } finally {
    global.fetch = realFetch;
  }
});

test("approving an assistant write-tool proposal runs it for real, through the same endpoint as connector approvals", async () => {
  const env = setup();
  const approval = env.approvalStore.request({
    connectionId: "assistant", connectorTypeId: "assistant", actionId: "create_board",
    actionTitle: 'Crear Board "Infra"', input: { title: "Infra", blockIds: ["gitlab.recent-commits"] },
    requester: "agent:assistant",
  });
  const res = await request(env.app, "POST", `/api/approvals/${approval.id}/approve`, { headers: env.headers, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.json().approval.status, "succeeded");
  assert.equal(res.json().result.result.title, "Infra");
  const saved = env.get("module-pages");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].tree.blocks, ["gitlab.recent-commits"]);
  env.close();
});

test("rejecting an assistant write-tool proposal never creates anything", async () => {
  const env = setup();
  const approval = env.approvalStore.request({
    connectionId: "assistant", connectorTypeId: "assistant", actionId: "create_board",
    actionTitle: 'Crear Board "Infra"', input: { title: "Infra" }, requester: "agent:assistant",
  });
  const res = await request(env.app, "POST", `/api/approvals/${approval.id}/reject`, { headers: env.headers, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.json().approval.status, "rejected");
  assert.equal(env.get("module-pages"), null);
  env.close();
});

test("an invalid write-tool proposal is marked failed instead of silently vanishing", async () => {
  const env = setup();
  const approval = env.approvalStore.request({
    connectionId: "assistant", connectorTypeId: "assistant", actionId: "create_board",
    actionTitle: "Crear Board", input: {}, requester: "agent:assistant", // missing required title
  });
  const res = await request(env.app, "POST", `/api/approvals/${approval.id}/approve`, { headers: env.headers, body: {} });
  assert.equal(res.status, 400);
  const failed = env.approvalStore.get(approval.id);
  assert.equal(failed.status, "failed");
  env.close();
});

test("one approved dashboard bundle creates the complete hierarchy", async () => {
  const env = setup();
  const input = {
    title: "Atlas de animales",
    boards: [
      { title: "Mascotas", blocks: [{ title: "Perro y gato", content: "# Perro\n\n# Gato" }] },
      { title: "Aves", blocks: [{ title: "Aguila y colibri", content: "# Aguila\n\n# Colibri" }] },
    ],
  };
  const approval = env.approvalStore.request({
    connectionId: "assistant", connectorTypeId: "assistant", actionId: "create_dashboard_bundle",
    actionTitle: 'Crear Dashboard completo "Atlas de animales"', input, requester: "agent:assistant",
  });
  assert.equal(env.get("custom-blocks"), null, "a pending proposal must not create Blocks");
  assert.equal(env.get("module-pages"), null, "a pending proposal must not create Boards");
  assert.equal(env.get("dashboards"), null, "a pending proposal must not create the Dashboard");

  const res = await request(env.app, "POST", `/api/approvals/${approval.id}/approve`, { headers: env.headers, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.json().approval.status, "succeeded");
  assert.equal(env.get("custom-blocks").length, 2);
  assert.equal(env.get("module-pages").length, 2);
  assert.equal(env.get("dashboards").length, 1);
  assert.deepEqual(env.get("dashboards")[0].boardIds, env.get("module-pages").map(board => board.id));
  env.close();
});
