// Settings page — grouped navigation rail plus one pane per category.
const { useState, useEffect, useCallback, useRef } = React;
const st = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

// Read from the shared registry in app.jsx, which owns the sidebar's routes.
// It must be read at render time, not module scope: app.jsx loads after this
// file. Maintaining a second copy here is what left Settings five entries
// behind the sidebar.
const navRoutes = () => window.NAV_ROUTES || [];

const ACCENT_OPTIONS = [
  { value: "#2563eb", label: "Blue" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#e07b00", label: "Orange" },
  { value: "#16a34a", label: "Green" },
  { value: "#dc2626", label: "Red" },
];

const FONT_OPTIONS = [
  { value: "geist",    label: "Geist", preview: "Geist / Geist Mono" },
  { value: "ibm",      label: "IBM Plex", preview: "IBM Plex Sans / Mono" },
  { value: "systemui", label: "System UI", preview: "system-ui / ui-monospace" },
];

// ── Icons ─────────────────────────────────────────────────────────────────────
const svg = (d, extra) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}{extra}
  </svg>
);
const ICONS = {
  profile:   svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>),
  ai:        svg(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6M9 13h4" /></>),
  appearance: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 000 18z" /></>),
  language:   svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>),
  navigation: svg(<><rect x="3" y="4" width="7" height="16" rx="1.5" /><path d="M13 8h8M13 12h8M13 16h5" /></>),
  views:     svg(<><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></>),
  sync:      svg(<><path d="M4 12a8 8 0 0113.7-5.7L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 01-13.7 5.7L4 16" /><path d="M4 20v-4h4" /></>),
  backup:    svg(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14a2 2 0 0 0 2-2v-3" /><path d="M3 16v3a2 2 0 0 0 2 2" /></>),
  about:     svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7h.01" /></>),
};

// Mirrors the grouped rail of the desktop settings modal.
const NAV_GROUPS = [
  { id: "account", title: "Cuenta",     items: [
    { id: "profile",    label: "Perfil",       icon: "profile" },
    { id: "ai",         label: "Asistente IA",   icon: "ai" },
  ] },
  { id: "application", title: "Aplicación", items: [
    { id: "appearance", label: "Apariencia",   icon: "appearance" },
    { id: "language",   label: "Idioma / Language", icon: "language" },
    { id: "navigation", label: "Navegación",   icon: "navigation" },
    { id: "views",      label: "Vistas",       icon: "views" },
  ] },
  { id: "system", title: "Sistema",    items: [
    { id: "sync",       label: "Sincronización", icon: "sync" },
    { id: "backup",     label: "Respaldos",      icon: "backup" },
  ] },
];

// Keep version/build information separate from editable application settings.
NAV_GROUPS.push({ id: "info", title: "Info", items: [{ id: "about", label: "Acerca de", icon: "about" }] });
const ALL_PANES = NAV_GROUPS.flatMap(g => g.items);

// ── Primitives ────────────────────────────────────────────────────────────────
function Section({ title, desc, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      {title && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
          {desc && <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 2 }}>{desc}</div>}
        </div>
      )}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// El control no encoge y la etiqueta sí, así que en una pantalla estrecha el
// texto se partía en cuatro líneas contra un campo intacto. Con flexWrap el
// control baja de línea cuando ya no cabe y la etiqueta se queda con el ancho
// entero; donde hay sitio, se ve exactamente igual que antes.
function Row({ label, desc, children, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexWrap: "wrap", padding: "13px 16px", gap: 16,
      borderBottom: last ? 0 : "1px solid var(--border)",
    }}>
      <div style={{ minWidth: 0, flex: "1 1 190px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg)" }}>{label}</div>
        {desc && <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 1 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label = "Toggle option" }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 0, cursor: "pointer",
        background: checked ? "var(--accent)" : "#d1d5db",
        position: "relative", transition: "background .15s", padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 20 : 2,
        width: 18, height: 18, borderRadius: 9, background: "white",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
        transition: "left .15s",
        display: "block",
      }} />
    </button>
  );
}

const inputStyle = {
  height: 30, padding: "0 10px", fontSize: 12.5, border: "1px solid var(--border)",
  borderRadius: 6, outline: 0, background: "var(--surface)", color: "var(--fg)",
  fontFamily: "inherit", width: "100%",
};

function ChoiceRow({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: "4px 10px", borderRadius: 5, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
            border: `1px solid ${value === opt.value ? "var(--accent)" : "var(--border)"}`,
            background: value === opt.value ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "var(--muted)",
            color: value === opt.value ? "var(--accent)" : "var(--fg)",
            fontFamily: "inherit",
          }}
        >{opt.label}</button>
      ))}
    </div>
  );
}

// ── Panes ─────────────────────────────────────────────────────────────────────
function ProfilePane({ tweaks, onSetTweak }) {
  const name = tweaks?.profileName ?? "Lintaya Demo";
  const role = tweaks?.profileRole ?? st("settings.profile.administrator", "Administrator");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "L";

  return (
    <>
      <Section title={st("settings.pane.profile", "Profile")} desc={st("settings.profile.description", "Shown at the bottom of the sidebar.")}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, borderBottom: "1px solid var(--border)" }}>
          <div style={{
            width: 46, height: 46, borderRadius: 999, flexShrink: 0,
            background: "var(--accent)", color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 600, letterSpacing: 0.3,
          }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{name || "—"}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{role || "—"}</div>
          </div>
        </div>
        <Row label={st("settings.profile.name", "Name")} desc={st("settings.profile.nameHelp", "How the application identifies you")}>
          <input
            style={{ ...inputStyle, width: 220 }}
            value={name}
            onChange={e => onSetTweak("profileName", e.target.value)}
            placeholder={st("settings.profile.namePlaceholder", "Your name")}
          />
        </Row>
        <Row label={st("settings.profile.role", "Role")} desc={st("settings.profile.roleHelp", "Custom text below your name")} last>
          <input
            style={{ ...inputStyle, width: 220 }}
            value={role}
            onChange={e => onSetTweak("profileRole", e.target.value)}
            placeholder={st("settings.profile.administrator", "Administrator")}
          />
        </Row>
      </Section>

      <Section title={st("settings.profile.session", "Session")} desc={st("settings.profile.sessionHelp", "The token is stored only in this browser; the server never returns it.")}>
        <Row label={st("settings.profile.token", "API token")} desc={st("settings.profile.tokenHelp", "Sent as Authorization: Bearer with each request")} last>
          <button
            onClick={() => {
              if (!confirm(st("settings.profile.signOutConfirm", "Sign out of this browser? You will need to enter the token again."))) return;
              window.HQ_API.setToken("");
              location.reload();
            }}
            style={{
              height: 28, padding: "0 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
              border: "1px solid color-mix(in srgb, var(--err) 35%, var(--border))",
              background: "var(--surface)", color: "var(--err)", fontSize: 12, fontWeight: 600,
            }}
          >{st("settings.profile.signOut", "Sign out")}</button>
        </Row>
      </Section>
    </>
  );
}

function AboutPane() {
  const [about, setAbout] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    window.HQ_API.request("/api/about").then(setAbout).catch(e => setError(e.message || st("settings.about.loadError", "Could not load the version")));
  }, []);
  if (error) return <div role="alert" style={{ fontSize: 12.5, color: "var(--err)" }}>{error}</div>;
  if (!about) return <div style={{ fontSize: 12.5, color: "var(--muted-fg)" }}>{st("settings.loading", "Loading…")}</div>;
  return (
    <>
      <Section title="Lintaya" desc={st("settings.about.description", "Information about this instance and its connection protocol.")}>
        <Row label={st("settings.about.version", "Version")} desc={st("settings.about.versionHelp", "Version of the code currently running")}>
          <code style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{about.version || st("settings.about.unknown", "unknown")}</code>
        </Row>
        <Row label={st("settings.about.protocol", "Remote protocol")} desc={st("settings.about.protocolHelp", "Communication capabilities between instances")} last>
          <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>{st("settings.about.readOnly", "A2A · initial read support")}</span>
        </Row>
      </Section>
      <Section title={st("settings.about.remote", "Remote connections")} desc={st("settings.about.remoteHelp", "Lintaya Remote shows the peer version when you run Test.")}>
        <div style={{ padding: "13px 16px", fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.55 }}>
          {st("settings.about.remoteAdvice", "If the remote version does not match the expected version, update that installation before sending changes.")}
        </div>
      </Section>
    </>
  );
}

function AiPane() {
  const [state, setState] = useState(null);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fetchedModels, setFetchedModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsErr, setModelsErr] = useState("");

  const load = useCallback(() => {
    window.HQ_API.request("/api/settings/ai")
      .then(s => {
        setState(s);
        setProvider(s.provider || (s.presets?.[0]?.id ?? ""));
        setApiKey("");
        setBaseUrl(s.baseUrl || "");
        setModel(s.model || "");
        setUsername("");
        setPassword("");
        setFetchedModels([]);
        setModelsErr("");
      })
      .catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const preset = (state?.presets || []).find(p => p.id === provider);

  const pickProvider = (id) => {
    setProvider(id);
    const p = (state?.presets || []).find(x => x.id === id);
    setBaseUrl(p?.defaultBaseUrl ?? "");
    setModel(p?.defaultModel ?? "");
    setApiKey("");
    setUsername("");
    setPassword("");
    setErr("");
    setFetchedModels([]);
    setModelsErr("");
  };

  const fetchModels = async () => {
    setModelsLoading(true); setModelsErr("");
    try {
      const res = await window.HQ_API.request("/api/settings/ai/models", {
        method: "POST", body: { provider, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() },
      });
      const list = res.models || [];
      setFetchedModels(list);
      if (!list.length) setModelsErr(st("settings.ai.noModels", "The server returned no models"));
    } catch (e) {
      setModelsErr(e.message || st("settings.ai.modelsError", "Could not list models"));
    } finally {
      setModelsLoading(false);
    }
  };

  const save = async () => {
    setBusy(true); setErr("");
    const body = { provider };
    if (preset?.needsKey) body.apiKey = apiKey.trim();
    if (preset?.needsBaseUrl) body.baseUrl = baseUrl.trim();
    if (model.trim()) body.model = model.trim();
    if (preset?.serverAuth) {
      if (username.trim()) body.username = username.trim();
      if (password.trim()) body.password = password.trim();
    }
    try {
      const next = await window.HQ_API.request("/api/settings/ai", { method: "POST", body });
      setState(next);
      setApiKey(""); setPassword("");
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: st("settings.ai.saved", "Settings saved"), kind: "ok" } }));
    } catch (e) { setErr(e.message || st("settings.ai.saveError", "Could not save settings")); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(st("settings.ai.removeConfirm", "Remove the assistant settings (key and provider)?"))) return;
    setBusy(true); setErr("");
    try {
      const next = await window.HQ_API.request("/api/settings/ai", { method: "DELETE" });
      setState(next);
      setProvider(next.presets?.[0]?.id ?? "");
      setApiKey(""); setBaseUrl(""); setModel(""); setUsername(""); setPassword("");
      setFetchedModels([]); setModelsErr("");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (!state) return <div style={{ fontSize: 12.5, color: "var(--muted-fg)" }}>{st("settings.loading", "Loading…")}</div>;

  const legacyActive = state.source !== "config" && state.configured;
  const viaEnv = state.source === "env";

  return (
    <Section title={st("settings.pane.ai", "AI Assistant")} desc={st("settings.ai.description", "Provider used by the Assistant module. Supports Anthropic, OpenAI, opencode, Ollama, or another OpenAI-compatible provider.")}>
      <Row label={st("settings.ai.status", "Status")} desc={state.configured
        ? (viaEnv ? st("settings.ai.serverConfig", "Using the server configuration (LiteLLM)") : legacyActive ? st("settings.ai.legacyConfig", "Using the previously saved Anthropic key") : st("settings.ai.resolved", "Using the {provider} configuration", { provider: state.label }))
        : st("settings.ai.unavailable", "Not configured — the Assistant will not respond")}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
          padding: "3px 8px", borderRadius: 4, fontFamily: "var(--font-mono)",
          background: state.configured ? "color-mix(in srgb, var(--ok) 12%, transparent)" : "var(--muted)",
          color: state.configured ? "var(--ok)" : "var(--muted-fg)",
        }}>{state.configured ? (viaEnv ? st("settings.ai.server", "Server (LiteLLM)") : state.label || state.provider) : st("settings.ai.unconfigured", "Not configured")}</span>
      </Row>

      <Row label={st("settings.ai.provider", "Provider")} desc={st("settings.ai.providerHelp", "Service that generates Assistant responses")}>
        <select
          style={{ ...inputStyle, width: 220 }}
          value={provider}
          onChange={e => pickProvider(e.target.value)}
        >
          {(state.presets || []).map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </Row>

      {preset?.needsKey && (
        <Row label={st("settings.ai.key", "API key")} desc={state.apiKeyConfigured && state.source === "config" ? st("settings.ai.savedKey", "Saved: {hint}", { hint: state.keyHint }) : st("settings.ai.keyPrefix", "Must start with {prefix}", { prefix: preset.keyPrefix })}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="password" style={{ ...inputStyle, width: 200 }} placeholder={preset.keyPlaceholder}
              value={apiKey} onChange={e => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
        </Row>
      )}

      {preset?.needsBaseUrl && (
        <Row label={st("settings.ai.baseUrl", "Base URL")} desc={st("settings.ai.baseUrlHelp", "API server address")}>
          <input
            type="text" style={{ ...inputStyle, width: 220 }} placeholder="http://127.0.0.1:4096"
            value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
          />
        </Row>
      )}

      {(preset?.models?.length > 0 || preset?.needsBaseUrl) && (
        <Row label={st("settings.ai.model", "Model")} desc={
          preset.models.length ? st("settings.ai.modelHelp", "Model used by the Assistant")
          : preset.kind === "opencode" ? st("settings.ai.opencodeModelHelp", "Use provider/model (e.g. openai/gpt-4.1). Leave empty to use the server default")
          : st("settings.ai.customModelHelp", "Enter a model or find models available on the server")
        }>
          {preset.models.length > 0 ? (
            <select
              style={{ ...inputStyle, width: 220 }}
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              {preset.models.map(m => (
                <option key={m.id} value={m.id}>{m.label} — {m.desc}</option>
              ))}
            </select>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {fetchedModels.length > 0 ? (
                  <select style={{ ...inputStyle, width: 220 }} value={model} onChange={e => setModel(e.target.value)}>
                    <option value="">{st("settings.ai.chooseModel", "— choose a model —")}</option>
                    {fetchedModels.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                ) : (
                  <input
                    type="text" style={{ ...inputStyle, width: 220 }} placeholder=""
                    value={model} onChange={e => setModel(e.target.value)}
                  />
                )}
                {preset.kind === "openai" && (
                  <button type="button" onClick={fetchModels} disabled={modelsLoading || !baseUrl.trim()}
                    style={{
                      height: 30, padding: "0 10px", borderRadius: 6, fontFamily: "inherit", fontSize: 11.5, flexShrink: 0,
                      border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)",
                      cursor: modelsLoading || !baseUrl.trim() ? "not-allowed" : "pointer",
                      opacity: modelsLoading || !baseUrl.trim() ? 0.5 : 1,
                    }}>{modelsLoading ? st("settings.ai.searching", "Searching…") : st("settings.ai.findModels", "Find models")}</button>
                )}
              </div>
              {modelsErr && <span style={{ fontSize: 10.5, color: "var(--err)" }}>{modelsErr}</span>}
              {fetchedModels.length > 0 && (
                <button type="button" onClick={() => setFetchedModels([])}
                  style={{ alignSelf: "flex-start", fontSize: 10.5, color: "var(--muted-fg)", background: "none", border: 0, cursor: "pointer", padding: 0 }}>
                  {st("settings.ai.enterManually", "Enter manually")}
                </button>
              )}
            </div>
          )}
        </Row>
      )}

      {preset?.serverAuth && (
        <>
          <Row label={st("settings.ai.username", "Username")} desc={st("settings.ai.usernameHelp", "opencode server credentials (optional)")}>
            <input
              type="text" style={{ ...inputStyle, width: 220 }} placeholder="opencode"
              value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="off"
            />
          </Row>
          <Row label={st("settings.ai.password", "Password")} desc={state.hasServerAuth && state.source === "config" ? st("settings.ai.credentialsSaved", "Credentials saved") : st("settings.ai.passwordHelp", "opencode server password (optional)")}>
            <PasswordField
              value={password} onChange={setPassword}
              visible={showPassword} onToggle={() => setShowPassword(v => !v)}
              autoComplete="new-password" placeholder="••••••••"
            />
          </Row>
        </>
      )}

      <Row label={st("settings.ai.actions", "Actions")} desc={st("settings.ai.actionsHelp", "Saving applies changes immediately")} last>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={save} disabled={busy}
            style={{
              height: 30, padding: "0 14px", borderRadius: 6, border: 0, cursor: busy ? "not-allowed" : "pointer",
              background: "var(--accent)", color: "white", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
              opacity: busy ? 0.5 : 1,
            }}>{st("settings.ai.save", "Save")}</button>
          {state.configured && (
            <button onClick={remove} disabled={busy}
              style={{
                height: 30, padding: "0 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                border: "1px solid var(--border)", background: "var(--surface)", color: "var(--err)", fontSize: 12,
              }}>{st("settings.ai.remove", "Remove")}</button>
          )}
        </div>
      </Row>
      {err && (
        <div style={{ padding: "8px 16px", fontSize: 11.5, color: "var(--err)", borderTop: "1px solid var(--border)" }}>{err}</div>
      )}
    </Section>
  );
}

function AppearancePane({ tweaks, onSetTweak }) {
  return (
    <Section title={st("settings.pane.appearance", "Appearance")} desc={st("settings.appearance.description", "Applied immediately and remembered in this browser.")}>
      <Row label={st("settings.appearance.dark", "Dark mode")} desc={st("settings.appearance.darkHelp", "Light up the Lintaya lighthouse and enable the dark interface")}>
        <Toggle checked={!!tweaks?.dark} label={st("settings.appearance.dark", "Dark mode")} onChange={dark => onSetTweak("dark", dark)} />
      </Row>
      <Row label={st("settings.appearance.accent", "Accent color")} desc={st("settings.appearance.accentHelp", "Active states, buttons, and highlights")}>
        <div style={{ display: "flex", gap: 6 }}>
          {ACCENT_OPTIONS.map(opt => (
            <button
              key={opt.value} title={st(`settings.appearance.color.${opt.label.toLowerCase()}`, opt.label)} aria-label={st(`settings.appearance.color.${opt.label.toLowerCase()}`, opt.label)}
              onClick={() => onSetTweak("accent", opt.value)}
              style={{
                width: 22, height: 22, borderRadius: 999, border: "2px solid",
                borderColor: tweaks?.accent === opt.value ? "var(--fg)" : "transparent",
                background: opt.value, cursor: "pointer", padding: 0,
                boxShadow: tweaks?.accent === opt.value ? "0 0 0 1px white inset" : "none",
              }}
            />
          ))}
        </div>
      </Row>
      <Row label={st("settings.appearance.font", "Typography")} desc={st("settings.appearance.fontHelp", "Font family used throughout the application")}>
        <ChoiceRow options={FONT_OPTIONS} value={tweaks?.fontPair} onChange={v => onSetTweak("fontPair", v)} />
      </Row>
      <Row label={st("settings.appearance.sidebar", "Sidebar")} desc={st("settings.appearance.sidebarHelp", "Compact hides labels; spacious shows the full menu")} last>
        <ChoiceRow
          options={[{ value: "spacious", label: st("settings.appearance.spacious", "Spacious") }, { value: "compact", label: st("settings.appearance.compact", "Compact") }]}
          value={tweaks?.sidebarStyle}
          onChange={v => onSetTweak("sidebarStyle", v)}
        />
      </Row>
    </Section>
  );
}

function ReorderButton({ dir, disabled, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: 20, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--border)", background: disabled ? "var(--muted)" : "var(--surface)",
        borderRadius: 4, cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--muted-fg)" : "var(--fg)", opacity: disabled ? 0.45 : 1,
        padding: 0, lineHeight: 1, fontSize: 9,
      }}
    >{dir === "up" ? "▲" : "▼"}</button>
  );
}

function NavigationPane({ hiddenRoutes, navOrderIds, onMoveRoute, onToggleRoute }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const all = navRoutes();
  const orderIds = navOrderIds && navOrderIds.length ? navOrderIds : all.map(r => r.id);
  // Reorder `all` to match the saved order; anything not yet in that order
  // (e.g. a route added after the user last reordered) is appended so it
  // keeps showing up instead of silently disappearing from the list.
  const byId = Object.fromEntries(all.map(r => [r.id, r]));
  const routes = [...orderIds.map(id => byId[id]).filter(Boolean), ...all.filter(r => !orderIds.includes(r.id))];
  const hiddenCount = routes.filter(i => hiddenRoutes.includes(i.id)).length;
  return (
    <Section
      title={t("settings.sidebarLinks")}
      desc={hiddenCount ? t("settings.hidden", "", { count: hiddenCount, plural: hiddenCount === 1 ? "" : "s", total: routes.length }) : t("settings.visible", "", { count: routes.length })}
    >
      {routes.map((item, i) => (
        <Row key={item.id} label={t(`nav.${item.id}.label`, item.id)} desc={t(`nav.${item.id}.desc`, "")} last={i === routes.length - 1}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <ReorderButton dir="up" disabled={i === 0} onClick={() => onMoveRoute(item.id, -1)} label={t("settings.moveUp", "", { label: t(`nav.${item.id}.label`, item.id) })} />
              <ReorderButton dir="down" disabled={i === routes.length - 1} onClick={() => onMoveRoute(item.id, 1)} label={t("settings.moveDown", "", { label: t(`nav.${item.id}.label`, item.id) })} />
            </div>
            <Toggle
              checked={!hiddenRoutes.includes(item.id)}
              label={t("settings.show", "", { label: t(`nav.${item.id}.label`, item.id) })}
              onChange={visible => onToggleRoute(item.id, visible)}
            />
          </div>
        </Row>
      ))}
    </Section>
  );
}

function ViewsPane({ tweaks, onSetTweak }) {
  return (
    <Section title={st("settings.views.title", "VM view")} desc={st("settings.views.description", "How the list is displayed when opened.")}>
      <Row label={st("settings.views.layout", "Default layout")} desc={st("settings.views.layoutHelp", "Table, cards, or compact grid")} last>
        <ChoiceRow
          options={[{ value: "table", label: st("settings.views.table", "Table") }, { value: "cards", label: st("settings.views.cards", "Cards") }, { value: "mini", label: st("settings.views.grid", "Grid") }]}
          value={tweaks?.vmDensity}
          onChange={v => onSetTweak("vmDensity", v)}
        />
      </Row>
    </Section>
  );
}

function LanguagePane() {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  return (
    <Section title={t("settings.languageTitle")} desc={t("settings.languageDesc")}>
      <Row label={t("settings.languageChoice")} desc="Español / English" last>
        <ChoiceRow
          options={[{ value: "es", label: "Español" }, { value: "en", label: "English" }]}
          value={locale}
          onChange={window.I18N.setLocale}
        />
      </Row>
    </Section>
  );
}

function SyncPane() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    window.HQ_API.request("/api/settings/auto-sync").then(setCfg).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setBusy(true); setErr("");
    try {
      await window.HQ_API.request("/api/settings/auto-sync", {
        method: "POST",
        body: { enabled: next.enabled, fastMinutes: next.fastMinutes, slowMinutes: next.slowMinutes },
      });
    } catch (e) { setErr(e.message); load(); }
    finally { setBusy(false); }
  };

  if (!cfg) return <div style={{ fontSize: 12.5, color: "var(--muted-fg)" }}>{st("settings.loading", "Loading…")}</div>;

  const targets = cfg.targets || [];
  return (
    <>
      <Section title={st("settings.sync.title", "Automatic synchronization")} desc={st("settings.sync.description", "Runs on the server, not in this browser.")}>
        <Row label={st("settings.sync.enabled", "Enabled")} desc={st("settings.sync.enabledHelp", "When disabled, connectors only synchronize manually")}>
          <Toggle checked={!!cfg.enabled} label={st("settings.sync.title", "Automatic synchronization")} onChange={v => save({ enabled: v })} />
        </Row>
        <Row label={st("settings.sync.fast", "Fast interval")} desc={st("settings.sync.fastHelp", "Most connectors (1–180 min)")}>
          <input
            type="number" min="1" max="180" disabled={busy}
            style={{ ...inputStyle, width: 90, fontFamily: "var(--font-mono)" }}
            value={cfg.fastMinutes}
            onChange={e => setCfg({ ...cfg, fastMinutes: Number(e.target.value) })}
            onBlur={e => save({ fastMinutes: Math.min(180, Math.max(1, Number(e.target.value) || 5)) })}
          />
        </Row>
        <Row label={st("settings.sync.slow", "Slow interval")} desc={st("settings.sync.slowHelp", "vCenter, the heavier synchronization (1–360 min)")} last>
          <input
            type="number" min="1" max="360" disabled={busy}
            style={{ ...inputStyle, width: 90, fontFamily: "var(--font-mono)" }}
            value={cfg.slowMinutes}
            onChange={e => setCfg({ ...cfg, slowMinutes: Number(e.target.value) })}
            onBlur={e => save({ slowMinutes: Math.min(360, Math.max(1, Number(e.target.value) || 20)) })}
          />
        </Row>
      </Section>

      {targets.length > 0 && (
        <Section title={st("settings.sync.effective", "Effective interval per connector")} desc={st("settings.sync.effectiveHelp", "A connector can override its interval in its detail panel.")}>
          {targets.map((t, i) => (
            <Row key={t.id} label={t.id} desc={t.group === "slow" ? st("settings.sync.slowGroup", "Slow group") : st("settings.sync.fastGroup", "Fast group")} last={i === targets.length - 1}>
              <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--muted-fg)" }}>
                {st("settings.sync.every", "every {minutes} min", { minutes: t.effectiveMinutes })}
                {cfg.overrides?.[t.id] != null && <b style={{ color: "var(--accent)", marginLeft: 6 }}>{st("settings.sync.custom", "custom")}</b>}
              </span>
            </Row>
          ))}
        </Section>
      )}
      {err && <div style={{ fontSize: 11.5, color: "var(--err)" }}>{err}</div>}
    </>
  );
}

const actionButton = (danger = false) => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${danger ? "color-mix(in srgb, var(--err) 45%, var(--border))" : "var(--accent)"}`,
  background: danger ? "var(--surface)" : "var(--accent)", color: danger ? "var(--err)" : "white",
  fontSize: 12, fontWeight: 600,
});

function PasswordField({ value, onChange, visible, onToggle, autoComplete, placeholder }) {
  const label = visible ? st("settings.password.hide", "Hide password") : st("settings.password.show", "Show password");
  return (
    <div style={{ display: "flex", width: 220 }}>
      <input
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 0 }}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        title={label}
        style={{
          width: 34, padding: 0, border: "1px solid var(--border)", borderLeft: 0,
          borderTopRightRadius: 6, borderBottomRightRadius: 6, background: "var(--surface)",
          color: "var(--muted-fg)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.8" />
          {visible && <path d="M4 4 20 20" />}
        </svg>
      </button>
    </div>
  );
}

function BackupPane() {
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [file, setFile] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const fileInput = useRef(null);

  const exportData = async () => {
    if (exportPassword.length < 12) return setErr(st("settings.backup.passwordError", "Use a backup password of at least 12 characters."));
    setBusy("export"); setErr("");
    try {
      const { blob, filename } = await window.HQ_API.downloadBackup(exportPassword);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.style.display = "none";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPassword("");
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: st("settings.backup.downloaded", "Encrypted backup downloaded"), kind: "ok" } }));
    } catch (e) { setErr(e.message || st("settings.backup.exportError", "Could not export the backup.")); }
    finally { setBusy(""); }
  };

  const importData = async () => {
    if (!file) return setErr(st("settings.backup.fileError", "Select a .lhq file."));
    if (importPassword.length < 12) return setErr(st("settings.backup.importPasswordError", "Enter the backup password (at least 12 characters)."));
    if (confirmation !== st("settings.backup.confirmWord", "RESTORE")) return setErr(st("settings.backup.confirmError", "Type RESTORE to confirm replacement."));
    if (!confirm(st("settings.backup.confirmPrompt", "Current data will be replaced and an encrypted recovery point will be created. The vault will be locked. Continue?"))) return;
    setBusy("import"); setErr("");
    try {
      const result = await window.HQ_API.importBackup(file, importPassword);
      setFile(null); setImportPassword(""); setConfirmation("");
      if (fileInput.current) fileInput.current.value = "";
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: st("settings.backup.restored", "Backup restored. Recovery point: {point}. Restart Lintaya.", { point: result.recoveryPoint }), kind: "ok" } }));
    } catch (e) { setErr(e.message || st("settings.backup.importError", "Could not restore the backup.")); }
    finally { setBusy(""); }
  };

  return (
    <>
      <Section title={st("settings.backup.title", "Encrypted backup")} desc={st("settings.backup.description", "Includes core data, connector configuration, and repository settings in a password-protected .lhq file.")}>
        <div style={{ padding: "14px 16px", fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.5, borderBottom: "1px solid var(--border)" }}>
          {st("settings.backup.security", "Your backup password is not stored. Neither the master password nor the Bitwarden session is exported; the vault will be locked after restoring.")}
        </div>
        <Row label={st("settings.backup.password", "Backup password")} desc={st("settings.backup.passwordHelp", "At least 12 characters; store it separately from the file.")}>
          <PasswordField value={exportPassword} onChange={setExportPassword} visible={showExportPassword} onToggle={() => setShowExportPassword(v => !v)} autoComplete="new-password" placeholder={st("settings.backup.newPassword", "New password")} />
        </Row>
        <Row label={st("settings.backup.export", "Export")} desc={st("settings.backup.exportHelp", "Download an encrypted copy you can transfer to another computer.")} last>
          <button type="button" disabled={busy !== ""} onClick={exportData} style={{ ...actionButton(), opacity: busy ? .65 : 1 }}>
            {busy === "export" ? st("settings.backup.exporting", "Exporting…") : st("settings.backup.download", "Download .lhq")}
          </button>
        </Row>
      </Section>

      <Section title={st("settings.backup.restore", "Restore backup")} desc={st("settings.backup.restoreHelp", "Replaces current data. An encrypted recovery point is automatically created on this server first.")}>
        <Row label={st("settings.backup.file", ".lhq file")} desc={file ? file.name : st("settings.backup.fileHelp", "Select the encrypted backup you want to import.")}>
          <button type="button" disabled={busy !== ""} onClick={() => fileInput.current?.click()} style={actionButton()}>
            {st("settings.backup.selectFile", "Select file")}
          </button>
          <input ref={fileInput} type="file" accept=".lhq,application/vnd.lintaya.backup+json,application/octet-stream" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] || null)} />
        </Row>
        <Row label={st("settings.backup.importPassword", "Backup password")} desc={st("settings.backup.importPasswordHelp", "The password used when exporting it.")}>
          <PasswordField value={importPassword} onChange={setImportPassword} visible={showImportPassword} onToggle={() => setShowImportPassword(v => !v)} autoComplete="current-password" placeholder={st("settings.backup.filePassword", "File password")} />
        </Row>
        <Row label={st("settings.backup.confirmation", "Confirmation")} desc={st("settings.backup.confirmationHelp", "Type RESTORE to enable this irreversible action.")} last>
          <input value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ ...inputStyle, width: 130, textTransform: "uppercase" }} placeholder={st("settings.backup.confirmWord", "RESTORE")} />
        </Row>
        <div style={{ paddingTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" disabled={busy !== ""} onClick={importData} style={{ ...actionButton(true), opacity: busy ? .65 : 1 }}>
            {busy === "import" ? st("settings.backup.restoring", "Restoring…") : st("settings.backup.restoreData", "Restore data")}
          </button>
        </div>
      </Section>
      {err && <div role="alert" style={{ fontSize: 11.5, color: "var(--err)" }}>{err}</div>}
    </>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function SettingsView({ hiddenRoutes, onToggleRoute, navOrderIds, onMoveRoute, tweaks, onSetTweak }) {
  const [pane, setPane] = useState("profile");
  const [query, setQuery] = useState("");
  // El rail medía 216 px fijos sin punto de corte, así que a 393 px se comía
  // casi todo el ancho y dejaba unos 110 px para los ajustes: cada etiqueta
  // partida en tres líneas y los campos pisándose. Debajo de 700 px se apila,
  // con el rail arriba y su propio scroll para no empujar el contenido fuera
  // de la pantalla. Mismo umbral que usan los editores de Board y Dashboard.
  const [mobile, setMobile] = useState(() => window.innerWidth < 700);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;

  // Permite que otros módulos te lleven directo a un panel (p.ej. el Asistente
  // abre "ai" con el payload { pane: "ai" }).
  useEffect(() => {
    const openPane = e => {
      if (e.detail?.pane) setPane(e.detail.pane);
      setQuery("");
    };
    window.addEventListener("hq:open-settings-pane", openPane);
    return () => window.removeEventListener("hq:open-settings-pane", openPane);
  }, []);

  const q = query.trim().toLowerCase();
  const groups = NAV_GROUPS
    .map(g => ({ ...g, title: t(`settings.group.${g.id}`, g.title), items: g.items.map(i => ({ ...i, label: t(`settings.pane.${i.id}`, i.label) })).filter(i => !q || i.label.toLowerCase().includes(q) || t(`settings.group.${g.id}`, g.title).toLowerCase().includes(q)) }))
    .filter(g => g.items.length);

  // A search that filters the active pane out of view would otherwise leave the
  // right side showing something the rail no longer offers.
  const visible = groups.flatMap(g => g.items);
  const active = visible.some(i => i.id === pane) ? pane : (visible[0]?.id || pane);

  const paneProps = { hiddenRoutes, onToggleRoute, navOrderIds, onMoveRoute, tweaks, onSetTweak };
  const PANES = {
    profile:    <ProfilePane {...paneProps} />,
    ai:         <AiPane />,
    appearance: <AppearancePane {...paneProps} />,
    language:   <LanguagePane />,
    navigation: <NavigationPane {...paneProps} />,
    views:      <ViewsPane {...paneProps} />,
    sync:       <SyncPane />,
    backup:     <BackupPane />,
    about:      <AboutPane />,
  };
  const activeItem = visible.find(i => i.id === active) || ALL_PANES.find(i => i.id === active);

  return (
    <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", height: "100%", minHeight: 0, alignItems: "stretch" }}>
      {/* Rail */}
      <div style={{
        ...(mobile
          ? { width: "100%", maxHeight: 190, borderBottom: "1px solid var(--border)" }
          : { width: 216, flexShrink: 0, borderRight: "1px solid var(--border)" }),
        padding: "16px 10px", overflow: "auto",
      }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={st("settings.search", "Search")}
          aria-label={st("settings.searchLabel", "Search settings")}
          style={{ ...inputStyle, height: 30, marginBottom: 14 }}
        />
        {groups.map(group => (
          <div key={group.title} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 10.5, fontWeight: 600, color: "var(--muted-fg)",
              padding: "0 8px", marginBottom: 4,
            }}>{group.title}</div>
            {group.items.map(item => {
              const on = item.id === active;
              return (
                <button
                  key={item.id}
                  onClick={() => setPane(item.id)}
                  aria-current={on ? "page" : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, width: "100%",
                    padding: "7px 8px", marginBottom: 1, borderRadius: 6, border: 0,
                    background: on ? "var(--muted)" : "transparent",
                    color: on ? "var(--fg)" : "var(--muted-fg)",
                    fontWeight: on ? 600 : 500, fontSize: 12.5,
                    cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "inline-flex", flexShrink: 0 }}>{ICONS[item.icon]}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!groups.length && (
          <div style={{ fontSize: 11.5, color: "var(--muted-fg)", padding: "6px 8px" }}>{st("settings.noMatches", "No matches")}</div>
        )}
      </div>

      {/* Pane */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", minWidth: 0 }}>
        <div style={{ maxWidth: 640 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 20px", letterSpacing: -0.2 }}>
            {activeItem?.label || t("nav.settings.label")}
          </h1>
          {PANES[active]}
        </div>
      </div>
    </div>
  );
}

window.SettingsView = SettingsView;
