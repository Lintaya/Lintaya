// AI provider configuration + streaming /api/chat.
// ── Multi-provider ──────────────────────────────────────────────────────────
// The assistant no longer speaks only to Anthropic. A single kv entry
// ("ai-config") selects the provider and its credentials:
//
//   provider: "anthropic" | "openai" | "opencode" | "ollama" | "compatible" | "litellm"
//   apiKey / baseUrl / model / username / password (per-provider, see AI_PROVIDERS)
//
// Resolution order used by both /api/settings/ai and /api/chat:
//   1. kv "ai-config" (explicit user choice)
//   2. env LiteLLM (LITELLM_BASE_URL / AI_PROVIDER=litellm) — legacy
//   3. legacy Anthropic key (kv "claude-api-key" or env ANTHROPIC_API_KEY)
//   4. none → configured=false / error code claude-api-key-not-configured
//
// "opencode" talks to a local `opencode serve` instance through its native
// HTTP API (POST /session + POST /session/:id/message) — opencode does not
// expose /chat/completions today. lib/agent/README documents the contract.
// Secrets (apiKey/password/username) are never echoed back to the client.
const { Anthropic } = require("@anthropic-ai/sdk");
const {
  isWriteTool, runReadTool, describeToolCall,
  toAnthropicTools, toOpenAITools,
} = require("../core/assistant-tools");
const { ASSISTANT_CONNECTOR_TYPE_ID } = require("./approvals");

// A tool round-trip is: model asks to call a read tool -> server runs it ->
// result goes back to the model -> model answers or asks for another tool.
// Capped so a confused model can't loop forever burning tokens.
const MAX_TOOL_ROUNDS = 4;
const CHAT_MAX_TOKENS = 8192;

const ASSISTANT_TOOLS_PROMPT = `

HERRAMIENTAS: podés crear Boards, Dashboards y Blocks (de contenido o de conector) usando las tools disponibles. Si el pedido es ambiguo (falta el título, no está claro qué conector/blocks usar), preguntá primero en texto — no propongas una creación a ciegas. Las tools de lectura (list_boards, list_dashboards, list_connector_blocks) las podés usar libremente para investigar antes de proponer una escritura; las de escritura (create_board, create_content_block, add_connector_block, create_dashboard) el usuario las confirma o cancela desde la interfaz, vos solo las proponés.`;

const DASHBOARD_BUNDLE_PROMPT = `

FLUJOS COMPUESTOS: list_custom_blocks devuelve ids reales de Blocks personalizados ya creados. Cuando el usuario pida un Dashboard que también requiere crear sus Boards y Blocks de contenido, preferí create_dashboard_bundle: crea toda la jerarquía mediante una sola aprobación y evita encadenar ids entre varias propuestas. Antes usá list_boards, list_dashboards y list_custom_blocks para evitar duplicados. Si el Dashboard ya existe, pasá su id real como dashboardId para actualizarlo. En cada Board podés elegir layoutPreset y showInSidebar; los Boards contenidos en un Dashboard compuesto quedan ocultos del sidebar por defecto. Para imágenes, usá solamente referencias HTTPS con texto alternativo y atribución dentro del contenido.`;

const AI_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    needsKey: true,
    needsBaseUrl: false,
    keyLabel: "Clave de API de Anthropic",
    keyPlaceholder: "sk-ant-…",
    keyPrefix: "sk-ant-",
    defaultBaseUrl: "",
    defaultModel: "claude-haiku-4-5",
    models: [
      { id: "claude-haiku-4-5",  label: "Haiku",  desc: "Fast · cheap" },
      { id: "claude-sonnet-4-5", label: "Sonnet", desc: "Smart · capable" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    needsKey: true,
    needsBaseUrl: false,
    keyLabel: "Clave de API de OpenAI",
    keyPlaceholder: "sk-…",
    keyPrefix: "sk-",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", desc: "Fast · cheap" },
      { id: "gpt-4o",      label: "GPT-4o",      desc: "Smart" },
    ],
  },
  {
    id: "opencode",
    label: "opencode",
    kind: "opencode",
    needsKey: false,
    needsBaseUrl: true,
    serverAuth: true,
    keyLabel: "",
    keyPlaceholder: "",
    keyPrefix: "",
    defaultBaseUrl: "http://127.0.0.1:4096",
    defaultModel: "",
    models: [],
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "openai",
    needsKey: false,
    needsBaseUrl: true,
    keyLabel: "",
    keyPlaceholder: "",
    keyPrefix: "",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.2",
    models: [],
  },
  {
    id: "compatible",
    label: "OpenAI-compatible",
    kind: "openai",
    needsKey: false,
    needsBaseUrl: true,
    keyLabel: "",
    keyPlaceholder: "",
    keyPrefix: "",
    defaultBaseUrl: "",
    defaultModel: "",
    models: [],
  },
  {
    id: "litellm",
    label: "LiteLLM proxy",
    kind: "openai",
    needsKey: false,
    needsBaseUrl: true,
    keyLabel: "",
    keyPlaceholder: "",
    keyPrefix: "",
    defaultBaseUrl: "",
    defaultModel: "",
    models: [],
  },
];

const OPENCODE_TIMEOUT_MS = 5 * 60 * 1000;

function aiProviderById(id) {
  return AI_PROVIDERS.find(p => p.id === id) || null;
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function maskKey(key) {
  const clean = String(key || "").trim();
  if (clean.length <= 8) return "••••";
  const prefix = clean.startsWith("sk-")
    ? clean.split("-").slice(0, 2).join("-")
    : clean.slice(0, 5);
  return `${prefix}…${clean.slice(-4)}`;
}

function writeSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildOpenAIChatMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  for (const message of messages || []) {
    out.push({
      role: message.role,
      content: message.content || message.text || "",
    });
  }
  return out;
}

function extractOpenAIChunkText(chunk) {
  return chunk?.choices?.[0]?.delta?.content
    || chunk?.choices?.[0]?.message?.content
    || chunk?.choices?.[0]?.delta?.text
    || "";
}

// Tool-call deltas arrive fragmented across chunks — {index, id?, function:
// {name?, arguments}} where `arguments` is a partial JSON string that only
// parses once every fragment for that index has been concatenated. Standard
// OpenAI function-calling streaming shape; every provider that goes through
// this helper (OpenAI, Ollama, an OpenAI-compatible server, LiteLLM) speaks it
// the same way.
function accumulateToolCallDeltas(acc, deltas) {
  for (const delta of deltas || []) {
    const index = delta.index ?? 0;
    const entry = acc[index] || (acc[index] = { id: "", name: "", arguments: "" });
    if (delta.id) entry.id = delta.id;
    if (delta.function?.name) entry.name += delta.function.name;
    if (delta.function?.arguments) entry.arguments += delta.function.arguments;
  }
}

// Takes the FULL message list in native OpenAI shape (system/user/assistant/
// tool roles, including any prior tool_calls + tool results from earlier
// rounds of the same turn — the caller in /api/chat owns building that, this
// is just the transport). Streams text over SSE as it arrives but does NOT
// write the terminal `done` event itself — the caller decides that only
// after checking whether a tool was called, since a tool call means the turn
// isn't actually finished yet (see the loop in the /api/chat handler).
async function streamOpenAICompatibleChat({ baseUrl, apiKey, model, messages, tools, res }) {
  const endpoint = new URL("chat/completions", normalizeBaseUrl(baseUrl)).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools?.length ? { tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: CHAT_MAX_TOKENS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || parsed.message || parsed.error || text;
    } catch { /* keep raw text */ }
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  if (!response.body) {
    throw new Error("response did not include a stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  const toolCallAcc = [];

  const flushLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }

    const text = extractOpenAIChunkText(chunk);
    if (text) writeSSE(res, { text });
    const toolDeltas = chunk?.choices?.[0]?.delta?.tool_calls;
    if (toolDeltas) accumulateToolCallDeltas(toolCallAcc, toolDeltas);
    if (chunk?.usage) usage = chunk.usage;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        flushLine(line);
      }

      if (done) break;
    }

    if (buffer.trim()) flushLine(buffer);
  } finally {
    reader.releaseLock?.();
  }

  const toolCalls = toolCallAcc
    .filter(Boolean)
    .map(entry => {
      let args = {};
      try { args = entry.arguments ? JSON.parse(entry.arguments) : {}; } catch { args = {}; }
      return { id: entry.id, name: entry.name, args };
    })
    .filter(call => call.name);

  return { usage, toolCalls };
}

// GET {baseUrl}/models — every OpenAI-compatible server (OpenAI itself,
// Ollama's /v1 surface, LM Studio, vLLM, a LiteLLM proxy, ...) exposes this,
// so it works for ollama/compatible/litellm without per-provider code.
async function fetchOpenAICompatibleModels({ baseUrl, apiKey, timeoutMs = 8000 }) {
  const endpoint = new URL("models", normalizeBaseUrl(baseUrl)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${timeoutMs / 1000}s` : err.message;
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return [...new Set(list.map(m => String(m?.id || m?.name || "")).filter(Boolean))].sort();
}

// opencode serve — native session/message round trip (no OpenAI surface):
// POST /session → id, POST /session/:id/message with text parts → completed
// message whose "text" parts are streamed to the browser as a single chunk,
// then the session is disposed.
async function fetchJson(base, pathSegments, options = {}) {
  const url = new URL(pathSegments.join("/"), normalizeBaseUrl(base)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${(options.timeoutMs || 60000) / 1000}s` : err.message;
    throw new Error(`opencode: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      detail = parsed.error?.message || parsed.message || `${detail}`;
    } catch { /* keep status-only detail */ }
    throw new Error(`opencode: ${detail}`);
  }
  return response.json();
}

async function streamOpenCodeChat({ baseUrl, username, password, model, system, messages, res }) {
  const base = normalizeBaseUrl(baseUrl || "http://127.0.0.1:4096");
  const authHeaders = {};
  if (password) {
    const user = username || "opencode";
    authHeaders.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }
  const headers = { "Content-Type": "application/json", ...authHeaders };

  const session = await fetchJson(base, ["session"], {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const sessionId = session?.id;
  if (!sessionId) throw new Error("opencode: no session id returned");

  try {
    const body = {
      parts: (messages || []).map(m => ({ type: "text", text: m.content || m.text || "" })),
    };
    if (model) body.model = model;
    if (system) body.system = system;

    const answer = await fetchJson(base, ["session", sessionId, "message"], {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: OPENCODE_TIMEOUT_MS,
    });

    const text = String((answer.parts || []).map(p => (p?.type === "text" ? p.text || "" : "")).join(""));
    if (text) writeSSE(res, { text });
    writeSSE(res, { done: true });
  } finally {
    try {
      await fetch(new URL(`session/${encodeURIComponent(sessionId)}`, normalizeBaseUrl(base)).toString(), {
        method: "DELETE",
        headers: authHeaders,
      });
    } catch { /* best-effort session cleanup */ }
  }
}

// ── config resolution ────────────────────────────────────────────────────────

function readAiConfig(kvGet) {
  return kvGet("ai-config")?.value || null;
}

function legacyAnthropicKey(kvGet, env) {
  return (kvGet("claude-api-key")?.value || env.anthropicApiKey || "").trim();
}

// Returns the active provider for streaming, or null when nothing is configured.
function resolveChatProvider({ kvGet, env }) {
  const cfg = readAiConfig(kvGet);
  if (cfg?.provider && aiProviderById(cfg.provider)) {
    const preset = aiProviderById(cfg.provider);
    return {
      kind: preset.kind,
      label: preset.label,
      tag: preset.id,
      apiKey: cfg.apiKey || "",
      baseUrl: (cfg.baseUrl || preset.defaultBaseUrl || "").trim(),
      model: cfg.model || preset.defaultModel || "",
      username: cfg.username || "",
      password: cfg.password || "",
    };
  }
  if (env.useLitellm) {
    return {
      kind: "openai",
      label: "LiteLLM",
      tag: "litellm",
      apiKey: env.litellmApiKey || "",
      baseUrl: (env.litellmBaseUrl || "").trim(),
      model: "",
      username: "",
      password: "",
    };
  }
  const legacyKey = legacyAnthropicKey(kvGet, env);
  if (legacyKey) {
    return {
      kind: "anthropic",
      label: "Anthropic",
      tag: "anthropic",
      apiKey: legacyKey,
      baseUrl: "",
      model: "",
      username: "",
      password: "",
    };
  }
  return null;
}

// Public (safe) view of the provider state — never includes raw secrets.
function buildPublicProviderState({ kvGet, env }) {
  const presets = AI_PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    needsKey: p.needsKey,
    needsBaseUrl: p.needsBaseUrl,
    serverAuth: !!p.serverAuth,
    defaultBaseUrl: p.defaultBaseUrl,
    defaultModel: p.defaultModel,
    models: p.models,
  }));

  const cfg = readAiConfig(kvGet);
  if (cfg?.provider && aiProviderById(cfg.provider)) {
    const preset = aiProviderById(cfg.provider);
    return {
      configured: true,
      source: "config",
      provider: preset.id,
      label: preset.label,
      kind: preset.kind,
      needsKey: preset.needsKey,
      apiKeyConfigured: Boolean(cfg.apiKey),
      keyHint: cfg.apiKey ? maskKey(cfg.apiKey) : undefined,
      serverAuth: !!preset.serverAuth,
      hasServerAuth: Boolean(cfg.username || cfg.password),
      baseUrl: cfg.baseUrl || preset.defaultBaseUrl,
      model: cfg.model || preset.defaultModel,
      models: preset.models,
      presets,
      legacy: { litellm: env.useLitellm, anthropic: Boolean(legacyAnthropicKey(kvGet, env)) },
    };
  }

  if (env.useLitellm) {
    return {
      configured: true,
      source: "env",
      provider: "litellm",
      label: "LiteLLM",
      kind: "openai",
      needsKey: false,
      apiKeyConfigured: Boolean(env.litellmApiKey),
      serverAuth: false,
      hasServerAuth: false,
      baseUrl: env.litellmBaseUrl || "",
      model: "",
      models: [],
      presets,
      legacy: { litellm: true, anthropic: Boolean(legacyAnthropicKey(kvGet, env)) },
    };
  }

  const legacyKey = legacyAnthropicKey(kvGet, env);
  if (legacyKey) {
    return {
      configured: true,
      source: "legacy",
      provider: "anthropic",
      label: "Anthropic (Claude)",
      kind: "anthropic",
      needsKey: true,
      apiKeyConfigured: true,
      keyHint: maskKey(legacyKey),
      serverAuth: false,
      hasServerAuth: false,
      baseUrl: "",
      model: "claude-haiku-4-5",
      models: aiProviderById("anthropic").models,
      presets,
      legacy: { litellm: false, anthropic: true },
    };
  }

  return {
    configured: false,
    source: "none",
    provider: null,
    label: null,
    kind: null,
    needsKey: false,
    apiKeyConfigured: false,
    serverAuth: false,
    hasServerAuth: false,
    baseUrl: "",
    model: "",
    models: [],
    presets,
    legacy: { litellm: env.useLitellm, anthropic: false },
  };
}

// Builds the "LIVE ..." block appended to the chat system prompt. Generic
// over every CONFIGURED connector (kv "connector-config-<id>" existing is
// the signal — same convention connectors.js uses) instead of a hardcoded
// vCenter+Bitwarden pair, so GitLab/Plane/Qportal/Outline/etc. are visible
// to the assistant too. vCenter and Bitwarden keep their richer hand-picked
// summaries (VM power counts, vault item count) layered on top of the
// generic per-connector line, since that detail is worth the extra tokens;
// everything else gets itemsSynced + lastSync from its own
// "connector-status-<id>", which every connector already writes.
// Also folds in each connector's user-written AI context note (kv
// "connector-ai-context", edited from the connector detail panel's
// "🤖 AI context" button) — that existed before this feature but nothing
// ever read it back into the assistant's prompt until now.
function buildConnectorLiveContext({ kvGet, kvGetByPrefix, db }) {
  const configuredKv = kvGetByPrefix ? kvGetByPrefix("connector-config-") : {};
  const ids = Object.keys(configuredKv)
    .map(key => key.slice("connector-config-".length))
    .filter(Boolean);
  if (!ids.length) return "";

  let names = {};
  try {
    names = Object.fromEntries(db.prepare("SELECT id, name FROM connectors").all().map(row => [row.id, row.name]));
  } catch { /* best effort — a connector without a SQL row just shows its id */ }

  const aiNotes = kvGet("connector-ai-context")?.value || {};
  const lines = ["\n\nCONECTORES CONFIGURADOS:"];

  for (const id of ids) {
    const status = kvGet(`connector-status-${id}`)?.value;
    const label = names[id] || id;
    const bits = [];
    if (typeof status?.itemsSynced === "number") bits.push(`${status.itemsSynced} items sincronizados`);
    if (status?.lastSync) bits.push(`última sync ${new Date(status.lastSync).toLocaleString()}`);
    if (status?.status === "error") bits.push(`estado: error${status.lastError ? ` (${status.lastError})` : ""}`);
    lines.push(`- ${label}${bits.length ? " — " + bits.join(" · ") : ""}`);

    if (id === "vcenter") {
      const vcData = kvGet("vcenter-data-vcenter")?.value;
      if (vcData) {
        const poweredOn  = vcData.vms?.filter(v => v.power_state === "POWERED_ON").length ?? 0;
        const poweredOff = vcData.vms?.filter(v => v.power_state !== "POWERED_ON").length ?? 0;
        lines.push(`  VMs: ${vcData.vms?.length ?? 0} total (${poweredOn} on, ${poweredOff} off) · Hosts: ${vcData.hosts?.length ?? 0} · Clusters: ${vcData.clusters?.length ?? 0} · Datastores: ${vcData.datastores?.length ?? 0}`);
      }
    }
    if (id === "bw") {
      const bwStatus = kvGet("connector-status-bw")?.value;
      const vaultItems = kvGet("vault-items")?.value;
      if (bwStatus) lines.push(`  Vault: ${bwStatus.bwCliStatus || "?"}, ${vaultItems?.length ?? 0} items, servidor ${bwStatus.serverHealth ? "alcanzable" : "inalcanzable"}`);
    }

    const note = aiNotes[id];
    if (note && note.trim()) lines.push(`  Notas del usuario sobre este conector: ${note.trim().slice(0, 500)}`);
  }

  return lines.join("\n");
}

function registerAISettingsRoutes({ app, requireAuth, kvGet, kvSet, kvGetByPrefix, deleteKv, db, auditActivity, log, AppError, sendAppError, config, approvalStore }) {
  if (!approvalStore) throw new TypeError("registerAISettingsRoutes requires approvalStore");

  // A write tool never runs on its own — it's persisted as a pending request
  // in the same Approval Center connector actions use (SEC-003), tagged with
  // connectorTypeId "assistant" so server/routes/approvals.js routes its
  // approval to runWriteTool instead of executeAction. requester is
  // "agent:assistant" (never "human:local"): the human resolving it in the
  // Approvals UI is a *different* principal from the model that proposed it,
  // which is what satisfies approval-store's self-approval-forbidden check —
  // without that, the one local human could never approve their own chat.
  function proposeWriteTool(res, { name, args }) {
    const approval = approvalStore.request({
      connectionId: "assistant",
      connectorTypeId: ASSISTANT_CONNECTOR_TYPE_ID,
      actionId: name,
      actionTitle: describeToolCall(name, args),
      input: args,
      requester: "agent:assistant",
    });
    writeSSE(res, {
      toolProposal: {
        approvalId: approval.id, name, args,
        label: approval.actionTitle, expiresAt: approval.expiresAt,
      },
    });
  }

  const env = {
    useLitellm: config.ai.provider === "litellm" || Boolean(config.ai.litellmBaseUrl),
    litellmBaseUrl: config.ai.litellmBaseUrl,
    litellmApiKey: config.ai.litellmApiKey,
    anthropicApiKey: config.ai.anthropicApiKey,
  };

  const deleteKvKey = deleteKv || ((key) => {
    db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  });

  // ── Multi-provider AI settings ──────────────────────────────────────────────
  // GET /api/settings/ai — current provider state (safe subset, no secrets)
  app.get("/api/settings/ai", requireAuth, (req, res) => {
    res.json(buildPublicProviderState({ kvGet, env }));
  });

  // POST /api/settings/ai — save { provider, apiKey?, baseUrl?, model?, username?, password? }
  app.post("/api/settings/ai", requireAuth, auditActivity({ provider: "settings", action: "Guardar configuración del asistente IA" }), (req, res) => {
    const body = req.body || {};
    const provider = String(body.provider || "").trim();

    if (!provider) {
      deleteKvKey("ai-config");
      log.info("[ai] provider config cleared");
      return res.json(buildPublicProviderState({ kvGet, env }));
    }

    const preset = aiProviderById(provider);
    if (!preset) {
      return sendAppError(res, AppError.badRequest(`invalid-ai-provider — must be one of ${AI_PROVIDERS.map(p => p.id).join(", ")}`), req);
    }

    const prev = readAiConfig(kvGet) || {};
    const next = { ...prev, provider };

    if (preset.needsKey) {
      const apiKey = String(body.apiKey || "").trim();
      if (!apiKey) {
        return sendAppError(res, AppError.badRequest("ai-api-key-required"), req);
      }
      if (preset.keyPrefix && !apiKey.startsWith(preset.keyPrefix)) {
        return sendAppError(res, AppError.badRequest(`invalid-key — must start with ${preset.keyPrefix}`), req);
      }
      next.apiKey = apiKey;
    } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      next.apiKey = body.apiKey.trim();
    }

    if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
      let u;
      try {
        u = new URL(body.baseUrl.trim());
      } catch {
        u = null;
      }
      if (!u || !["http:", "https:"].includes(u.protocol)) {
        return sendAppError(res, AppError.badRequest("invalid-base-url — must be http(s)"), req);
      }
      next.baseUrl = u.toString().replace(/\/$/, "");
    }

    if (typeof body.model === "string" && body.model.trim()) {
      next.model = body.model.trim();
    } else if (body.model === "" || body.model == null) {
      next.model = preset.defaultModel || "";
    }

    if (preset.serverAuth) {
      if (typeof body.username === "string" && body.username.trim()) next.username = body.username.trim();
      if (typeof body.password === "string" && body.password.trim()) next.password = body.password.trim();
    }

    kvSet("ai-config", next);
    log.info(`[ai] provider config saved (${provider})`);
    res.json(buildPublicProviderState({ kvGet, env }));
  });

  // POST /api/settings/ai/models — probe a provider's server for the models it
  // actually has (Ollama, LM Studio, a LiteLLM proxy, ...) instead of making
  // the user guess a name. Takes baseUrl/apiKey ad-hoc so this works before
  // the config is saved, not just after.
  app.post("/api/settings/ai/models", requireAuth, async (req, res) => {
    const body = req.body || {};
    const preset = aiProviderById(String(body.provider || "").trim());
    if (!preset) {
      return sendAppError(res, AppError.badRequest(`invalid-ai-provider — must be one of ${AI_PROVIDERS.map(p => p.id).join(", ")}`), req);
    }
    if (preset.kind !== "openai") {
      return res.json({ models: preset.models.map(m => m.id) });
    }
    const baseUrl = String(body.baseUrl || preset.defaultBaseUrl || "").trim();
    let u;
    try { u = new URL(baseUrl); } catch { u = null; }
    if (!u || !["http:", "https:"].includes(u.protocol)) {
      return sendAppError(res, AppError.badRequest("invalid-base-url — must be http(s)"), req);
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    try {
      const models = await fetchOpenAICompatibleModels({ baseUrl, apiKey });
      res.json({ models });
    } catch (err) {
      return sendAppError(res, AppError.badGateway(`No se pudo listar modelos: ${err.message}`), req);
    }
  });

  // DELETE /api/settings/ai — remove saved provider config entirely
  app.delete("/api/settings/ai", requireAuth, auditActivity({ provider: "settings", action: "Eliminar configuración del asistente IA" }), (req, res) => {
    deleteKvKey("ai-config");
    deleteKvKey("claude-api-key");
    log.info("[ai] provider config removed");
    res.json(buildPublicProviderState({ kvGet, env }));
  });

  // ── Legacy Claude API key (compat) ──────────────────────────────────────────
  app.get("/api/settings/claude-key", requireAuth, (req, res) => {
    const cfg = readAiConfig(kvGet);
    const stored = kvGet("claude-api-key")?.value;
    const viaAi = cfg?.provider === "anthropic" && cfg.apiKey;
    const litellmReady = env.useLitellm;
    res.json({
      configured: Boolean(stored) || Boolean(viaAi) || litellmReady,
      provider: litellmReady ? "litellm" : (stored || viaAi) ? "anthropic" : "none",
      hint: stored ? `sk-ant-…${stored.slice(-4)}` : viaAi ? `sk-ant-…${cfg.apiKey.slice(-4)}` : undefined,
    });
  });

  app.post("/api/settings/claude-key", requireAuth, auditActivity({ provider: "settings", action: "Guardar Claude API key" }), (req, res) => {
    const { apiKey } = req.body || {};
    if (typeof apiKey !== "string" || !apiKey.startsWith("sk-ant-")) {
      return sendAppError(res, AppError.badRequest("invalid-key — must start with sk-ant-"), req);
    }
    kvSet("claude-api-key", apiKey);
    log.info("[ai] Anthropic API key saved");
    res.json({ ok: true, hint: `sk-ant-…${apiKey.slice(-4)}` }); // nunca la key completa
  });

  app.delete("/api/settings/claude-key", requireAuth, auditActivity({ provider: "settings", action: "Borrar Claude API key" }), (req, res) => {
    deleteKvKey("claude-api-key");
    res.json({ ok: true });
  });

  // ── Chat ────────────────────────────────────────────────────────────────────
  // POST /api/chat — streaming assistant via the configured provider (SSE).
  // Tool-aware for Anthropic and every OpenAI-compatible provider (openai,
  // ollama, compatible, litellm — all kind:"openai"); opencode's native
  // session API has no tool-calling surface today, so it stays plain chat.
  // Read tools execute immediately and loop back into the model (capped at
  // MAX_TOOL_ROUNDS); a write tool is never executed here — it's filed as a
  // pending request in the Approval Center instead (see proposeWriteTool
  // above) and the stream ends with a `toolProposal` event carrying its
  // approvalId. Execution happens only via POST /api/approvals/:id/approve,
  // same endpoint every other pending approval in the system uses.
  app.post("/api/chat", requireAuth, async (req, res) => {
    const provider = resolveChatProvider({ kvGet, env });
    if (!provider) {
      return sendAppError(res, AppError.badRequest("claude-api-key-not-configured"), req);
    }

    const { messages = [], system = "", model } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return sendAppError(res, AppError.badRequest("messages-required"), req);
    }
    const effectiveModel = model || provider.model || "claude-haiku-4-5";

    // Enrich system prompt with which connectors are configured, their sync
    // status, any AI context note the user wrote for them, and what the
    // assistant tools can do.
    const liveContext = buildConnectorLiveContext({ kvGet, kvGetByPrefix, db });
    const fullSystem = system + liveContext + ASSISTANT_TOOLS_PROMPT + DASHBOARD_BUNDLE_PROMPT;
    const toolCtx = { kvGet, kvSet, kvGetByPrefix };

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    try {
      if (provider.kind === "anthropic") {
        const client = new Anthropic({ apiKey: provider.apiKey });
        const tools = toAnthropicTools();
        const loopMessages = messages.map(m => ({ role: m.role, content: m.content || m.text || "" }));
        let finished = false;

        for (let round = 0; round < MAX_TOOL_ROUNDS && !finished; round++) {
          const stream = await client.messages.stream({
            model: effectiveModel, max_tokens: CHAT_MAX_TOKENS, system: fullSystem,
            messages: loopMessages, tools,
          });
          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
              writeSSE(res, { text: chunk.delta.text });
            }
          }
          const final = await stream.finalMessage();
          const toolUse = final.content.find(b => b.type === "tool_use");
          if (!toolUse) {
            writeSSE(res, { done: true, usage: final.usage });
            finished = true;
            break;
          }
          if (isWriteTool(toolUse.name)) {
            proposeWriteTool(res, { name: toolUse.name, args: toolUse.input });
            finished = true;
            break;
          }
          let result;
          try { result = runReadTool(toolUse.name, toolUse.input, toolCtx); }
          catch (err) { result = { error: err.message }; }
          loopMessages.push({ role: "assistant", content: final.content });
          loopMessages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) }] });
        }
        if (!finished) writeSSE(res, { done: true }); // MAX_TOOL_ROUNDS exhausted — end gracefully
      } else if (provider.kind === "opencode") {
        await streamOpenCodeChat({
          baseUrl: provider.baseUrl,
          username: provider.username,
          password: provider.password,
          model: effectiveModel,
          system: fullSystem,
          messages,
          res,
        });
      } else {
        const tools = toOpenAITools();
        const loopMessages = buildOpenAIChatMessages(fullSystem, messages);
        let finished = false;

        for (let round = 0; round < MAX_TOOL_ROUNDS && !finished; round++) {
          const { usage, toolCalls } = await streamOpenAICompatibleChat({
            baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: effectiveModel,
            messages: loopMessages, tools, res,
          });
          const call = toolCalls[0];
          if (!call) {
            writeSSE(res, { done: true, usage });
            finished = true;
            break;
          }
          if (isWriteTool(call.name)) {
            proposeWriteTool(res, { name: call.name, args: call.args });
            finished = true;
            break;
          }
          let result;
          try { result = runReadTool(call.name, call.args, toolCtx); }
          catch (err) { result = { error: err.message }; }
          loopMessages.push({ role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
          loopMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        if (!finished) writeSSE(res, { done: true }); // MAX_TOOL_ROUNDS exhausted — end gracefully
      }
    } catch (err) {
      log.error(`[ai/${provider.tag}] stream error`, { message: err.message });
      writeSSE(res, { error: err.message });
    } finally {
      res.end();
    }
  });

}

module.exports = {
  AI_PROVIDERS,
  registerAISettingsRoutes,
  buildConnectorLiveContext,
};
