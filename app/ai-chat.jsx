// AI Assistant — chat with Claude, context-aware of live infra
const { useState, useRef, useEffect, useCallback } = React;

// ── System prompt builder (client-side base context) ──────────────────────────
function buildSystemPrompt() {
  const d = window.APP_DATA;
  if (!d) return "You are a helpful infrastructure assistant.";
  const vmDown  = d.VMS.filter(v => v.status === "offline").map(v => v.name);
  const vmWarn  = d.VMS.filter(v => v.status === "warn").map(v => v.name);
  const hostWarn = d.HOSTS.filter(h => h.status === "warn").map(h => h.shortName);
  return `You are Lintaya's infrastructure assistant. You have access to the current user's dashboard.

INFRASTRUCTURE CONTEXT:
- vCenters: ${d.VCENTERS.map(v => v.name).join(", ")}
- Hosts: ${d.HOSTS.length}
- Total VMs: ${d.VMS.length} across ${d.VLANS.length} VLANs
- VMs down: ${vmDown.length ? vmDown.join(", ") : "none"}
- VMs warning: ${vmWarn.length ? vmWarn.join(", ") : "none"}
- Hosts warning: ${hostWarn.length ? hostWarn.join(", ") : "none"}
- Team: ${d.DEVS.map(x => `${x.name} (${x.role}, ${x.capacity}% load, working on "${x.currentTask}")`).join("; ")}
- Apps registered: ${d.APPS.length}
- Today's meetings: ${d.MEETINGS.filter(m => !m.done).map(m => `${m.time} ${m.title}`).join("; ") || "none"}

Note: The server automatically enriches this with the status of every configured connector (GitLab, Plane, Qportal, vCenter, Bitwarden, etc.), plus any AI context note the user wrote for it.

PERSONALITY: professional, direct, concise. Respond in ${window.I18N.getLocale() === "en" ? "English" : "Spanish"}. Use infrastructure data when relevant. For emails/standups be natural and brief. For technical questions about the infra, use the live data.`;
}

const getSuggestions = () => [
  window.I18N.t("ui.assistant.suggestion1", "Summarize the infrastructure status today"),
  window.I18N.t("ui.assistant.suggestion2", "Which connectors are configured and how are they doing?"),
  window.I18N.t("ui.assistant.suggestion3", "Which hosts have active alerts?"),
  window.I18N.t("ui.assistant.suggestion4", "Generate tomorrow's standup based on activity"),
  window.I18N.t("ui.assistant.suggestion5", "What is pending in my tasks?"),
  window.I18N.t("ui.assistant.suggestion6", "Draft an SLA update email")
];

// Modelos y proveedor vienen de /api/settings/ai (configurable por el usuario);
// este archivo ya no conoce una lista fija de Claude.

// ── Ancho del panel ──────────────────────────────────────────────────────────
const CHAT_WIDTH_KEY = "hq-ai-chat-width";
const CHAT_MIN_WIDTH = 360;
const CHAT_DEFAULT_WIDTH = 520;
const CHAT_EXPANDED_WIDTH = 900;
const chatMaxWidth = () => Math.round(window.innerWidth * 0.7);

function loadChatWidth() {
  const stored = Number(localStorage.getItem(CHAT_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? Math.min(stored, chatMaxWidth()) : CHAT_DEFAULT_WIDTH;
}

// ── Historial de la conversación ────────────────────────────────────────────
// Por navegador, igual que el ancho del panel — no por cuenta: es la misma
// filosofía que ya usa /api/chat (conversacional, deliberadamente sin
// auditar), solo que ahora también sobrevive a un F5 en vez de perderse.
const CHAT_HISTORY_KEY = "hq-ai-chat-history";
const CHAT_HISTORY_LIMIT = 60; // acota el tamaño en localStorage en conversaciones largas

function loadChatHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Mismo patrón que BoardResizeSeparator (custom-page-view.jsx): arrastre por
// pointer, con flechas para accesibilidad de teclado. Acá el eje es horizontal
// y el borde que se arrastra es el izquierdo del panel (crece hacia la
// izquierda), así que un delta hacia la izquierda del mouse agranda el panel.
function ChatResizeHandle({ width, onResize, onCommit }) {
  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    // preventDefault() above also suppresses the browser's default
    // focus-on-click for this div — focus it explicitly so the arrow-key
    // path (onKeyDown) keeps working right after a drag.
    event.currentTarget.focus();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (moveEvent) => {
      latest = Math.min(chatMaxWidth(), Math.max(CHAT_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)));
      onResize(latest);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(latest);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 24 : -24;
    const next = Math.min(chatMaxWidth(), Math.max(CHAT_MIN_WIDTH, width + delta));
    onResize(next);
    onCommit(next);
  };
  return (
    <div
      role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={window.I18N.t("ui.assistant.resize", "Resize the Assistant panel")} aria-valuemin={CHAT_MIN_WIDTH} aria-valuemax={chatMaxWidth()} aria-valuenow={width}
      onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      title={window.I18N.t("ui.resize", "Drag to resize · arrow keys also work")}
      style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 8, zIndex: 5,
        cursor: "col-resize", touchAction: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <span aria-hidden="true" style={{ width: 3, height: 42, borderRadius: 99, background: "var(--border)" }} />
    </div>
  );
}

// ── "No provider configured" card ────────────────────────────────────────────
function SetupCard({ onOpenSettings }) {
  return (
    <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{window.I18N.t("ui.assistant.setup", "Configure your AI provider")}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.55 }}>{window.I18N.t("ui.assistant.setupIntro", "The Assistant needs a configured provider: Anthropic, OpenAI, Ollama, LiteLLM, a server running")} <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>opencode</span>{" "}{window.I18N.t("ui.assistant.setupEnd", "or another OpenAI-compatible provider.")} </div>
      </div>
      <button onClick={() => {
          onOpenSettings?.();
          window.dispatchEvent(new CustomEvent("hq:open-settings-pane", { detail: { pane: "ai" } }));
        }}
        style={{ height: 34, padding: "0 16px", background: "var(--accent)", color: "white", border: 0, borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}>{window.I18N.t("ui.assistant.openSettings", "Open Settings → AI Assistant")} </button>
    </div>
  );
}

// ── Main chat component ───────────────────────────────────────────────────────
function AIChat({ open, onClose, isMobile, onOpenSettings }) {
  window.I18N.useLocale();
  const [messages, setMessages]   = useState(() => loadChatHistory());
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [model, setModel]         = useState("");
  const [width, setWidth]         = useState(() => loadChatWidth());
  const [ai, setAi]               = useState(null); // null=checking, object=provider state
  const [streamText, setStreamText] = useState(""); // text being streamed
  const [toolProposal, setToolProposal] = useState(null); // { approvalId, name, args, label, expiresAt } — write tool awaiting confirm/cancel, filed in the Approval Center
  const [toolBusy, setToolBusy]   = useState(false);
  const scrollRef  = useRef(null);
  const inputRef   = useRef(null);
  const abortRef   = useRef(null);

  // Load provider state on open
  useEffect(() => {
    if (!open) return;
    window.HQ_API.request("/api/settings/ai")
      .then(d => setAi(d))
      .catch(() => setAi({ configured: false }));
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const keyOk = ai ? ai.configured : null;
  const providerModels = ai?.models || [];
  const effectiveModel = model || ai?.model || "";

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, streamText]);

  // Persist history across reloads (per-browser, same spirit as CHAT_WIDTH_KEY).
  useEffect(() => {
    try {
      if (messages.length) {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-CHAT_HISTORY_LIMIT)));
      } else {
        localStorage.removeItem(CHAT_HISTORY_KEY);
      }
    } catch { /* private mode etc. — just skip persisting */ }
  }, [messages]);

  const newConversation = () => {
    setMessages([]);
    setToolProposal(null);
    setStreamText("");
  };

  const send = useCallback(async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");

    const userMsg = { role: "user", content: q };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    setStreamText("");
    setToolProposal(null); // enviar otro mensaje descarta cualquier propuesta sin confirmar

    try {
      const system = buildSystemPrompt();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${window.HQ_API.getToken()}`,
        },
        body: JSON.stringify({ messages: history, system, model }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error === "claude-api-key-not-configured" || err.detail === "claude-api-key-not-configured") {
          setAi({ configured: false });
          setMessages(m => m.slice(0, -1)); // remove user msg
          return;
        }
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";
      let proposal = null;

      abortRef.current = reader;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") break;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.text) {
              assembled += chunk.text;
              setStreamText(assembled);
            }
            // A write tool (create_board/create_content_block/add_connector_block/
            // create_dashboard/create_dashboard_bundle) never runs on the server on its own — it proposes,
            // and this card is what lets the human confirm or cancel it.
            if (chunk.toolProposal) proposal = chunk.toolProposal;
          } catch (e) {
            if (e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }

      if (assembled.trim()) setMessages(m => [...m, { role: "assistant", content: assembled }]);
      setStreamText("");
      if (proposal) setToolProposal(proposal);
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: `⚠️ ${e.message || e}` }]);
      setStreamText("");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, messages, loading, model]);

  const HQ_CHANGE_EVENTS = {
    create_board: ["hq:module-pages-changed"],
    create_content_block: ["hq:custom-blocks-changed"],
    add_connector_block: ["hq:custom-blocks-changed"],
    create_dashboard: ["hq:dashboards-changed"],
    create_dashboard_bundle: ["hq:custom-blocks-changed", "hq:module-pages-changed", "hq:dashboards-changed"],
  };

  const confirmToolProposal = async () => {
    if (!toolProposal) return;
    setToolBusy(true);
    try {
      const resp = await window.HQ_API.request(`/api/approvals/${encodeURIComponent(toolProposal.approvalId)}/approve`, {
        method: "POST",
      });
      const created = resp?.result?.result;
      const title = created?.title ? ` "${created.title}"` : "";
      setMessages(m => [...m, { role: "assistant", content: `✅ Creado${title}.` }]);
      const changeEvents = HQ_CHANGE_EVENTS[toolProposal.name] || [];
      changeEvents.forEach(changeEvent => window.dispatchEvent(new CustomEvent(changeEvent)));
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: window.I18N.t("ui.assistant.createFailed", "⚠️ Could not create: {0}", { 0: e.message || e }) }]);
    } finally {
      setToolBusy(false);
      setToolProposal(null);
    }
  };

  const cancelToolProposal = async () => {
    if (!toolProposal) return;
    const { approvalId } = toolProposal;
    setToolProposal(null);
    try {
      await window.HQ_API.request(`/api/approvals/${encodeURIComponent(approvalId)}/reject`, { method: "POST" });
    } catch (e) {
      // Best-effort — the proposal expires on its own (SEC-003 TTL) even if
      // this call fails, so there's no dangling pending approval either way.
    }
  };

  const stopStream = () => {
    if (abortRef.current) {
      abortRef.current.cancel();
      abortRef.current = null;
      setLoading(false);
      if (streamText) {
        setMessages(m => [...m, { role: "assistant", content: streamText + " ▌" }]);
        setStreamText("");
      }
    }
  };

  if (!open) return null;

  const commitWidth = (w) => {
    setWidth(w);
    try { localStorage.setItem(CHAT_WIDTH_KEY, String(w)); } catch { /* private mode etc. — just skip persisting */ }
  };
  const isExpanded = width >= (CHAT_DEFAULT_WIDTH + CHAT_EXPANDED_WIDTH) / 2;
  const panelWidth = isMobile ? "100%" : `${Math.min(width, chatMaxWidth())}px`;

  const panel = (
    <aside style={{
      width: panelWidth, height: "100%", position: "relative",
      background: "white", display: "flex", flexDirection: "column",
      borderLeft: isMobile ? "none" : "1px solid var(--border)",
      boxShadow: isMobile ? "none" : "-6px 0 20px -14px rgba(0,0,0,.15)",
      overflow: "hidden", flexShrink: 0,
    }}>
      {!isMobile && <ChatResizeHandle width={width} onResize={setWidth} onCommit={commitWidth} />}
      {/* Header */}
      <div style={{ minHeight: "var(--header-h)", padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, black))",
          color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13,
        }}>✦</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{window.I18N.t("ui.assistant.title", "Assistant")} {keyOk && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 10, background: "color-mix(in srgb,var(--ok) 12%,white)", color: "var(--ok)", border: "1px solid color-mix(in srgb,var(--ok) 25%,var(--border))", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>● Live</span>}
          </div>
          {ai?.label && <div style={{ fontSize: 10.5, color: "var(--muted-fg)" }}>{ai.label}</div>}
        </div>

        {/* Model selector */}
        {keyOk && providerModels.length > 0 && (
          <div style={{ display: "flex", gap: 1, padding: 2, background: "var(--muted)", borderRadius: 6 }}>
            {providerModels.map(m => (
              <button key={m.id} onClick={() => setModel(m.id)} title={m.desc}
                style={{
                  padding: "3px 9px", height: 22, fontSize: 10.5, fontWeight: 600,
                  background: (model || ai?.model) === m.id ? "white" : "transparent",
                  border: (model || ai?.model) === m.id ? "1px solid var(--border)" : "1px solid transparent",
                  borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                  color: (model || ai?.model) === m.id ? "var(--accent)" : "var(--muted-fg)", letterSpacing: 0.3,
                }}>{m.label}</button>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <button onClick={newConversation} title={window.I18N.t("ui.assistant.newChat", "New conversation")}
            style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", padding: 4, display: "inline-flex" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        )}
        {!isMobile && (
          <button onClick={() => commitWidth(isExpanded ? CHAT_DEFAULT_WIDTH : Math.min(CHAT_EXPANDED_WIDTH, chatMaxWidth()))}
            title={isExpanded ? window.I18N.t("ui.collapse", "Collapse") : window.I18N.t("ui.expand", "Expand")}
            style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", padding: 4, display: "inline-flex" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isExpanded
                ? <><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>
                : <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>}
            </svg>
          </button>
        )}
        <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 18, padding: 4 }}>×</button>
      </div>

      {/* Key setup if not configured */}
      {keyOk === false && (
        <SetupCard onOpenSettings={onOpenSettings} />
      )}

      {/* Messages area */}
      {keyOk !== false && (
        <>
          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "14px 14px 6px" }}>
            {messages.length === 0 && !loading && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{window.I18N.t("ui.assistant.hello", "Hello 👋")}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 14 }}>{window.I18N.t("ui.assistant.welcome", "I have live access to your configured connectors, hosts, alerts, and team. How can I help?")} </div>
                {keyOk === null && (
                  <div style={{ fontSize: 11.5, color: "var(--muted-fg)", fontStyle: "italic" }}>{window.I18N.t("ui.assistant.checking", "Checking connection…")}</div>
                )}
                {keyOk && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {getSuggestions().map((s, i) => (
                      <button key={i} onClick={() => send(s)} style={{
                        textAlign: "left", padding: "8px 10px",
                        background: "white", border: "1px solid var(--border)", borderRadius: 6,
                        fontSize: 12, fontFamily: "inherit", cursor: "pointer", color: "var(--fg)",
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                        <span style={{ color: "var(--accent)" }}>›</span>{s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} text={m.content} />
            ))}

            {/* Streaming bubble */}
            {loading && streamText && (
              <MessageBubble role="assistant" text={streamText} streaming />
            )}

            {/* Propuesta de tool de escritura — el server nunca la ejecuta solo */}
            {toolProposal && (
              <ToolProposalCard proposal={toolProposal} busy={toolBusy} onConfirm={confirmToolProposal} onCancel={cancelToolProposal} />
            )}

            {/* Typing dots (before first token) */}
            {loading && !streamText && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 11px", background: "var(--muted)", borderRadius: 10, width: "fit-content", marginBottom: 10 }}>
                <Dot delay={0} /><Dot delay={150} /><Dot delay={300} />
              </div>
            )}
          </div>

          {/* Input row */}
          <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder={window.I18N.t("ui.assistant.input", "Ask a question or request something… (Enter to send)")}
              style={{
                flex: 1, resize: "none", padding: "9px 11px",
                border: "1px solid var(--border)", borderRadius: 8,
                fontFamily: "inherit", fontSize: 13, lineHeight: 1.4,
                outline: 0, background: "white", color: "var(--fg)",
                minHeight: 38, maxHeight: 120, overflowY: "auto",
              }}
            />
            {loading ? (
              <button onClick={stopStream} title="Stop" style={{ width: 38, height: 38, background: "var(--err)", color: "white", border: 0, borderRadius: 8, cursor: "pointer", fontSize: 14, flexShrink: 0 }}>■</button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim()} style={{ width: 38, height: 38, background: "var(--accent)", color: "white", border: 0, borderRadius: 8, cursor: !input.trim() ? "not-allowed" : "pointer", opacity: !input.trim() ? .45 : 1, fontSize: 16, flexShrink: 0 }}>↑</button>
            )}
          </div>

          {/* Footer: model + provider management */}
          <div style={{ padding: "4px 12px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, color: "var(--muted-fg)", borderTop: "1px solid color-mix(in srgb, var(--border) 50%, transparent)" }}>
            <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
              {effectiveModel ? effectiveModel : (ai?.label || "IA")}
            </span>
            {keyOk !== null && (
              <button onClick={() => {
                onOpenSettings?.();
                window.dispatchEvent(new CustomEvent("hq:open-settings-pane", { detail: { pane: "ai" } }));
              }} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 10, padding: 0, fontFamily: "inherit", flexShrink: 0 }}>{window.I18N.t("ui.assistant.changeProvider", "Change provider")} </button>
            )}
          </div>
        </>
      )}
    </aside>
  );

  if (isMobile) {
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,.4)", zIndex: 110, display: "flex", justifyContent: "flex-end" }}>
        <div onClick={e => e.stopPropagation()} style={{ width: "100%", height: "100%", display: "flex" }}>
          {panel}
        </div>
      </div>
    );
  }
  return panel;
}

// ── Tarjeta de confirmación para una write tool propuesta ──────────────────────
// El server nunca crea el Board/Dashboard/Block por su cuenta — la propuesta
// queda como pendiente en el Approval Center (SEC-003), y esta tarjeta es lo
// que deja al humano aprobarla o rechazarla (POST /api/approvals/:id/approve
// o /reject — ver server/routes/approvals.js).
function ToolProposalCard({ proposal, busy, onConfirm, onCancel }) {
  return (
    <div style={{
      marginBottom: 10, padding: "10px 12px", borderRadius: 10,
      border: "1px solid var(--accent)", background: "color-mix(in srgb, var(--accent) 6%, white)",
    }}>
      <div style={{ fontSize: 12.5, color: "var(--fg)", marginBottom: 8 }}>{proposal.label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onConfirm} disabled={busy}
          style={{
            height: 28, padding: "0 12px", borderRadius: 6, border: 0, cursor: busy ? "not-allowed" : "pointer",
            background: "var(--accent)", color: "white", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            opacity: busy ? 0.6 : 1,
          }}>{busy ? window.I18N.t("connectors.addInstance.creating", "Creating…") : window.I18N.t("ui.confirm", "Confirm")}</button>
        <button onClick={onCancel} disabled={busy}
          style={{
            height: 28, padding: "0 12px", borderRadius: 6, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
            border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", fontSize: 12,
          }}>{window.I18N.t("connectors.cancel", "Cancel")}</button>
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ role, text, streaming }) {
  const isUser = role === "user";
  return (
    <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "88%", padding: "8px 11px", borderRadius: isUser ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
        background: isUser ? "var(--accent)" : "var(--muted)",
        color: isUser ? "white" : "var(--fg)",
        fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {text}
        {streaming && <span style={{ opacity: .5, animation: "cursorBlink .7s steps(1) infinite" }}>▌</span>}
      </div>
    </div>
  );
}

function Dot({ delay }) {
  return <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--muted-fg)", display: "inline-block", animation: `dotPulse 1.2s ${delay}ms infinite` }} />;
}

if (!document.getElementById("ai-chat-styles")) {
  const s = document.createElement("style");
  s.id = "ai-chat-styles";
  s.textContent = `
    @keyframes dotPulse { 0%,80%,100% { opacity:.3; transform:scale(.85); } 40% { opacity:1; transform:scale(1); } }
    @keyframes cursorBlink { 0%,100% { opacity:1; } 50% { opacity:0; } }
  `;
  document.head.appendChild(s);
}

// ── Launcher button ───────────────────────────────────────────────────────────
function AILauncher({ onClick, isMobile }) {
  window.I18N.useLocale();
  return (
    <button onClick={onClick} aria-label={window.I18N.t("ui.assistant.title", "Assistant")} title="AI Assistant"
      style={{
        position: "fixed", right: 16, bottom: isMobile ? 72 : 16, zIndex: 60,
        width: 52, height: 52, borderRadius: 999,
        background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, black))",
        color: "white", border: 0, cursor: "pointer",
        boxShadow: "0 8px 24px -6px color-mix(in srgb, var(--accent) 50%, transparent), 0 2px 6px rgba(0,0,0,.1)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 22, transition: "transform .12s",
      }}
      onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
      onMouseUp={e => e.currentTarget.style.transform = ""}
      onMouseLeave={e => e.currentTarget.style.transform = ""}>
      ✦
    </button>
  );
}

window.AIChat     = AIChat;
window.AILauncher = AILauncher;
