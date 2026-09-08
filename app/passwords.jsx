const { useState, useMemo, useEffect } = React;
const pt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

function Spinner({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"
      style={{ animation: "spin 0.75s linear infinite", flexShrink: 0 }}
      xmlns="http://www.w3.org/2000/svg">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

function LoadingOverlay({ message = "Loading..." }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(255,255,255,0.7)", backdropFilter: "blur(3px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14,
    }}>
      <Spinner size={36} color="var(--accent)" />
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg)" }}>{message}</div>
    </div>
  );
}

function strengthColor(level) {
  return level === "strong" ? "var(--ok)" : level === "medium" ? "var(--warn)" : "var(--err)";
}

function maskSecret(secret, shown) {
  if (shown) return secret;
  return "*".repeat(Math.min(secret.length, 14));
}

function emitToast(msg, kind = "info") {
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, kind } }));
}

function formatVaultError(error) {
  // Vault routes now answer with RFC 9457 Problem Details (payload.type/title
  // present) — `error.message` is already the server-written, human-readable
  // `detail` sentence (see server/routes/vault.js), so it's shown as-is except
  // for the couple of cases below that need different copy or Docker-down
  // detection.
  const payload = error?.payload;
  const isProblemDetails = payload && typeof payload === "object" && typeof payload.type === "string" && typeof payload.title === "string";

  if (isProblemDetails) {
    if (payload.code === "UNAUTHORIZED" && error.message === "unauthorized") {
      return "The HQ access token is invalid.";
    }
    const detail = error.message || payload.title || "";
    if (detail.includes("ECONNREFUSED")) return "docker-down";
    if (detail.includes("Unable to fetch ServerConfig") || detail.includes("FetchError")) return "docker-down";
    return detail || "An unexpected vault error occurred. Check the server logs.";
  }

  // Legacy flat-string shape, kept for any endpoint not yet migrated to RFC 9457.
  const code = error?.payload?.error || error?.message || "unknown-error";

  if (code === "unauthorized") return "The HQ access token is invalid.";
  if (code === "offline") return "The vault endpoint is offline right now.";

  // Detect Docker / Vaultwarden server down
  if (code.includes("ECONNREFUSED") || code.includes("connect ECONNREFUSED")) {
    return "docker-down";
  }
  if (code.includes("Unable to fetch ServerConfig") || code.includes("FetchError")) {
    return "docker-down";
  }

  // Strip ANSI color codes and Node.js stack traces — show only first meaningful line
  const firstLine = code.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].trim();
  if (firstLine.length > 120) return "An unexpected vault error occurred. Check the server logs.";
  return `Vault error: ${firstLine}`;
}

function copyWithAutoClear(text, label) {
  navigator.clipboard?.writeText(text);
  emitToast(`${label} copied - clears in 20s`, "ok");

  setTimeout(() => {
    navigator.clipboard?.readText?.().then((value) => {
      if (value === text) navigator.clipboard.writeText("");
    }).catch(() => {});
  }, 20000);
}

function UsagePopover({ label, items, onClose }) {
  if (!items.length) return null;
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
      background: "white", border: "1px solid var(--border)", borderRadius: 7,
      boxShadow: "0 6px 20px rgba(0,0,0,.12)", padding: "8px 0", minWidth: 200, maxWidth: 280,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)",
        textTransform: "uppercase", padding: "0 10px 6px" }}>{label}</div>
      {items.map((item, i) => (
        <div key={i} style={{
          padding: "4px 10px", fontSize: 11.5, display: "flex", alignItems: "center", gap: 7,
          borderTop: i === 0 ? "1px solid var(--border)" : "none",
          borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none",
        }}>
          {item.dot && <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0,
            background: item.dot === "ok" ? "var(--ok)" : item.dot === "warn" ? "var(--warn)" : "var(--muted-fg)" }} />}
          <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
          {item.sub && <span style={{ fontSize: 10, color: "var(--muted-fg)", flexShrink: 0 }}>{item.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function PassCard({
  item,
  vaultUnlocked,
  shown,
  secret,
  onCopyField,
  onCopyPassword,
  onToggleSecret,
  onEdit,
  onLaunch,
  vmLookup,
  deviceLookup,
  connectorLookup,
}) {
  const [activeDetail, setActiveDetail] = useState(null); // "vms" | "devices" | "connectors"
  const levelColor = strengthColor(item.strength);
  const passwordLabel = !vaultUnlocked
    ? "Unlock the vault to reveal or copy"
    : secret
      ? maskSecret(secret, shown)
      : "Click to load from the vault";

  function toggleDetail(type) {
    setActiveDetail(prev => prev === type ? null : type);
  }

  const vmItems = (item.vmIds || []).map(id => {
    const vm = vmLookup?.[id];
    return { name: vm?.name || id, dot: vm?.status === "online" ? "ok" : "off", sub: vm?.ip || "" };
  });
  const deviceItems = (item.deviceIds || []).map(id => {
    const d = deviceLookup?.[id];
    return { name: d?.name || d?.hostname || id, dot: "warn", sub: d?.ip || "" };
  });
  const connectorItems = (item.connectorIds || []).map(id => {
    const c = connectorLookup?.[id];
    return { name: c?.name || id, dot: c?.status === "ok" ? "ok" : "off", sub: c?.host || "" };
  });

  return (
    <div style={{
      border: "1px solid var(--border)",
      background: "white",
      borderRadius: 8,
      padding: 12,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}
    onClick={() => activeDetail && setActiveDetail(null)}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{item.service}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
            {item.folder && (
              <span style={{ fontSize: 10.5, color: "#6366f1", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 3, padding: "1px 6px", fontWeight: 500 }}>
                📁 {item.folder}
              </span>
            )}
            {(item.tags || []).map((tagId) => <TagPill key={tagId} id={tagId} />)}
            <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>last used {item.lastUsed || "n/a"}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>

          {/* VM usage badge */}
          {item.vmCount > 0 && (
            <div style={{ position: "relative" }}>
              <button onClick={e => { e.stopPropagation(); toggleDetail("vms"); }} style={{
                fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: "none",
                background: activeDetail === "vms" ? "color-mix(in srgb, #2563eb 20%, white)" : "color-mix(in srgb, #2563eb 10%, white)",
                color: "#2563eb", display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer",
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                {item.vmCount} VM{item.vmCount !== 1 ? "s" : ""}
              </button>
              {activeDetail === "vms" && <UsagePopover label="VMs using this credential" items={vmItems} onClose={() => setActiveDetail(null)} />}
            </div>
          )}

          {/* Device usage badge */}
          {item.deviceCount > 0 && (
            <div style={{ position: "relative" }}>
              <button onClick={e => { e.stopPropagation(); toggleDetail("devices"); }} style={{
                fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: "none",
                background: activeDetail === "devices" ? "color-mix(in srgb, #0891b2 20%, white)" : "color-mix(in srgb, #0891b2 10%, white)",
                color: "#0891b2", display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer",
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1"/></svg>
                {item.deviceCount} device{item.deviceCount !== 1 ? "s" : ""}
              </button>
              {activeDetail === "devices" && <UsagePopover label="Devices using this credential" items={deviceItems} onClose={() => setActiveDetail(null)} />}
            </div>
          )}

          {/* Connector usage badge */}
          {item.connectorCount > 0 && (
            <div style={{ position: "relative" }}>
              <button onClick={e => { e.stopPropagation(); toggleDetail("connectors"); }} style={{
                fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: "none",
                background: activeDetail === "connectors" ? "color-mix(in srgb, #7c3aed 20%, white)" : "color-mix(in srgb, #7c3aed 10%, white)",
                color: "#7c3aed", display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer",
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                {item.connectorCount} connector{item.connectorCount !== 1 ? "s" : ""}
              </button>
              {activeDetail === "connectors" && <UsagePopover label="Connectors using this credential" items={connectorItems} onClose={() => setActiveDetail(null)} />}
            </div>
          )}

          <span title={`Strength: ${item.strength}`} style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase",
            color: levelColor, background: `color-mix(in srgb, ${levelColor} 12%, white)`,
            padding: "2px 6px", borderRadius: 4,
          }}>{item.strength}</span>
          {vaultUnlocked && onEdit && (
            <button onClick={() => onEdit(item)} title="Edit" style={{
              ...iconGhost, cursor: "pointer", padding: 3, borderRadius: 4,
              color: "var(--muted-fg)",
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div style={fieldShell}>
        <button onClick={() => onCopyField(item.user, "Username")} style={fieldAction}>
          <div style={fieldLabel}>{pt("passwords.username", "USERNAME")}</div>
          <div style={fieldVal}>{item.user}</div>
        </button>
        <CopyIcon />
      </div>

      <div style={fieldShell}>
        <button onClick={() => onCopyPassword(item)} style={fieldAction}>
            <div style={fieldLabel}>{pt("passwords.passwordField", "PASSWORD")}</div>
          <div style={{ ...fieldVal, letterSpacing: shown ? 0.5 : 1.4 }}>{passwordLabel}</div>
        </button>
        <button
          onClick={() => onToggleSecret(item.id)}
          disabled={!vaultUnlocked}
          style={{
            ...iconGhost,
            opacity: vaultUnlocked ? 1 : 0.45,
            cursor: vaultUnlocked ? "pointer" : "not-allowed",
          }}
          title={vaultUnlocked ? (shown ? "Hide password" : "Reveal password") : "Unlock the vault first"}
        >
          {shown ? eyeOff : eye}
        </button>
        <CopyIcon />
      </div>

      {item.url && (
        <div style={fieldShell}>
          <button onClick={() => onCopyField(item.url, "URL")} style={fieldAction}>
            <div style={fieldLabel}>URL</div>
            <div style={fieldVal}>{item.url}</div>
          </button>
          <CopyIcon />
          {onLaunch && (
            <button
              onClick={() => onLaunch(item)}
              title={vaultUnlocked ? "Launch — copies credentials & opens URL" : "Launch — copies username & opens URL (unlock for password)"}
              style={{
                ...iconGhost,
                cursor: "pointer",
                color: vaultUnlocked ? "var(--accent)" : "var(--muted-fg)",
                padding: 4,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {item.notes && (
        <div style={{ fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.5, padding: "0 2px" }}>
          {item.notes}
        </div>
      )}
    </div>
  );
}

const fieldShell = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  border: "1px solid var(--border)",
  background: "var(--muted)",
  borderRadius: 6,
};

const fieldAction = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flex: 1,
  minWidth: 0,
  padding: 0,
  margin: 0,
  border: 0,
  background: "transparent",
  color: "var(--fg)",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const fieldLabel = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: 0.6,
  color: "var(--muted-fg)",
  width: 78,
  flexShrink: 0,
};

const fieldVal = {
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  color: "var(--fg)",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const iconGhost = {
  background: "none",
  border: 0,
  color: "var(--muted-fg)",
  padding: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const eye = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const eyeOff = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

function CopyIcon() {
  return (
    <span style={{ color: "var(--muted-fg)", display: "inline-flex" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>
    </span>
  );
}

function PasswordsView() {
  window.I18N?.useLocale();
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState([]);
  const [shown, setShown] = useState({});
  const [secrets, setSecrets] = useState({});
  const [items, setItems] = useState(() => window.APP_DATA.PASSWORDS || []);
  const [apiToken, setApiToken] = useState(() => window.HQ_API?.getToken?.() || "");
  const [masterPassword, setMasterPassword] = useState("");
  const [connected, setConnected] = useState(() => Boolean(window.HQ_API?.getToken?.()));
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultMode, setVaultMode] = useState("demo");
  const [showMasterPwd, setShowMasterPwd] = useState(false);
  const [folders, setFolders] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState({ service: "", username: "", password: "", url: "", notes: "", folderId: "", tags: [] });
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [editItem, setEditItem] = useState(null); // item being edited
  const [editPwd, setEditPwd] = useState("");
  const [showEditPwd, setShowEditPwd] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(window.HQ_API?.getToken?.()));
  const [vmLookup,        setVmLookup]        = useState({});
  const [deviceLookup,    setDeviceLookup]    = useState({});
  const [connectorLookup, setConnectorLookup] = useState({});
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    syncVaultState();
  }, []);

  function syncClientItems(nextItems) {
    const safeItems = Array.isArray(nextItems) ? nextItems : [];
    window.APP_DATA.PASSWORDS = safeItems;
    setItems(safeItems);
  }

  function clearSessionState() {
    setShown({});
    setSecrets({});
    setVaultUnlocked(false);
  }

  async function syncVaultState() {
    if (!window.HQ_API) {
      setError("The HQ API client is not available in this build.");
      return;
    }

    const token = window.HQ_API.getToken();
    setConnected(Boolean(token));
    setApiToken(token);

    if (!token) {
      clearSessionState();
      syncClientItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [status, nextItems, nextFolders, vmsData, devicesData, connectorsData] = await Promise.all([
        window.HQ_API.getVaultStatus(),
        window.HQ_API.listVaultItems().catch(() => null),
        window.HQ_API.listFolders().catch(() => null),
        window.HQ_API.request("/api/vms-live").catch(() => ({ vms: [] })),
        window.HQ_API.request("/api/devices").catch(() => []),
        window.HQ_API.request("/api/connectors").catch(() => []),
      ]);

      setVaultUnlocked(Boolean(status?.unlocked));
      setVaultMode(status?.mode || "demo");

      // Only update folders if we actually got a valid array back — never overwrite with empty on error
      if (Array.isArray(nextFolders)) setFolders(nextFolders);

      // Only update items if we got a valid array back
      if (Array.isArray(nextItems)) syncClientItems(nextItems);

      // Build id→object lookup maps for badge popovers
      const vms  = vmsData?.vms || [];
      setVmLookup(Object.fromEntries(vms.map(v => [v.id, v])));
      const devs = Array.isArray(devicesData) ? devicesData : [];
      setDeviceLookup(Object.fromEntries(devs.map(d => [d.id, d])));
      const cons = Array.isArray(connectorsData) ? connectorsData : [];
      setConnectorLookup(Object.fromEntries(cons.map(c => [c.id, c])));
    } catch (failure) {
      if ((failure?.payload?.error || failure?.message) === "unauthorized") {
        window.HQ_API.clearToken();
        setConnected(false);
        setApiToken("");
        clearSessionState();
        syncClientItems([]);
      }
      setError(formatVaultError(failure));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(event) {
    event?.preventDefault?.();

    const token = apiToken.trim();
    if (!token) {
      setError("Enter the HQ access token first.");
      return;
    }
    if (!masterPassword) {
      setError("Enter the vault master password.");
      return;
    }

    window.HQ_API.setToken(token);
    setBusy(true);
    setBusyMessage("Connecting and unlocking vault…");
    setError("");

    try {
      await window.HQ_API.unlockVault(masterPassword);
      setBusyMessage("Syncing vault items…");
      setConnected(true);
      setMasterPassword("");
      clearSessionState();
      setVaultUnlocked(true);
      await syncVaultState();
      emitToast("Vault unlocked", "ok");
    } catch (failure) {
      if ((failure?.payload?.error || failure?.message) === "unauthorized") {
        window.HQ_API.clearToken();
        setConnected(false);
      }
      setError(formatVaultError(failure));
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function handleUnlock() {
    if (!connected) return handleConnect();
    if (!masterPassword) {
      setError("Enter the vault master password.");
      return;
    }

    setBusy(true);
    setBusyMessage("Unlocking vault…");
    setError("");

    try {
      await window.HQ_API.unlockVault(masterPassword);
      setBusyMessage("Syncing vault items…");
      setMasterPassword("");
      setVaultUnlocked(true);
      clearSessionState();
      await syncVaultState();
      emitToast("Vault unlocked", "ok");
    } catch (failure) {
      setError(formatVaultError(failure));
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function handleLock() {
    if (!connected) return;
    setBusy(true);
    setError("");

    try {
      await window.HQ_API.lockVault();
      clearSessionState();
      emitToast("Vault locked", "ok");
    } catch (failure) {
      setError(formatVaultError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    try {
      if (connected) await window.HQ_API.lockVault();
    } catch (failure) {
      // Best effort only.
    }

    window.HQ_API.clearToken();
    setConnected(false);
    setApiToken("");
    setMasterPassword("");
    setError("");
    clearSessionState();
    syncClientItems([]);
    emitToast("Vault disconnected", "ok");
  }

  async function handleSync() {
    setSyncing(true);
    setBusyMessage("Syncing vault items from Bitwarden…");
    setError("");
    try {
      await window.HQ_API.syncVault();
      await syncVaultState();
      emitToast("Vault synced", "ok");
    } catch (failure) {
      setError(formatVaultError(failure));
    } finally {
      setSyncing(false);
      setBusyMessage("");
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newItem.service.trim()) { setError("Service name is required."); return; }
    setBusy(true);
    setBusyMessage(`Saving "${newItem.service}" to Bitwarden…`);
    setError("");
    try {
      await window.HQ_API.createVaultItem(newItem);
      setBusyMessage("Syncing vault items…");
      await syncVaultState();
      setShowCreate(false);
      setNewItem({ service: "", username: "", password: "", url: "", notes: "", folderId: "", tags: [] });
      setShowNewPwd(false);
      emitToast(`"${newItem.service}" saved to Bitwarden`, "ok");
    } catch (failure) {
      setError(formatVaultError(failure));
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function openEdit(item) {
    // Pre-load the current password so the edit form shows it
    setBusy(true);
    setBusyMessage(`Loading "${item.service}"…`);
    try {
      const secret = secrets[item.id] || (await fetchSecret(item.id));
      setEditItem({ ...item });
      setEditPwd(secret || "");
      setShowEditPwd(false);
    } catch {
      setEditItem({ ...item });
      setEditPwd("");
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editItem.service?.trim()) { setError("Service name is required."); return; }
    setBusy(true);
    setBusyMessage(`Saving "${editItem.service}"…`);
    setError("");
    try {
      await window.HQ_API.editVaultItem(editItem.id, { ...editItem, password: editPwd });
      setBusyMessage("Syncing vault items…");
      await syncVaultState();
      // Clear cached secret so it re-fetches fresh
      setSecrets(s => { const n = { ...s }; delete n[editItem.id]; return n; });
      setEditItem(null);
      emitToast(`"${editItem.service}" updated`, "ok");
    } catch (failure) {
      setError(formatVaultError(failure));
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function fetchSecret(itemId) {
    if (secrets[itemId]) return secrets[itemId];
    const payload = await window.HQ_API.getVaultPassword(itemId);
    const secret = payload?.password || "";
    setSecrets((current) => ({ ...current, [itemId]: secret }));
    return secret;
  }

  async function handleCopyPassword(item) {
    if (!vaultUnlocked) {
      setError("Unlock the vault before copying a password.");
      return;
    }

    try {
      const secret = await fetchSecret(item.id);
      copyWithAutoClear(secret, "Password");
    } catch (failure) {
      setError(formatVaultError(failure));
    }
  }

  async function handleLaunch(item) {
    if (!item.url) return;

    // Open URL immediately — don't block on clipboard
    window.open(item.url, "_blank", "noopener,noreferrer");

    if (vaultUnlocked) {
      try {
        const pwd = await fetchSecret(item.id);
        // Copy username first; after a short delay copy password so the user
        // can paste each field in sequence without returning to this tab
        navigator.clipboard?.writeText(item.user);
        emitToast(`Opened ${item.service} · username copied`, "ok");
        setTimeout(() => {
          navigator.clipboard?.writeText(pwd);
          emitToast(`Password copied — paste it in the password field`, "ok");
        }, 3500);
      } catch (failure) {
        // Still opened the tab — just warn about clipboard
        emitToast(`Opened ${item.service} — ${formatVaultError(failure)}`, "warn");
      }
    } else {
      // Vault locked: copy username only
      navigator.clipboard?.writeText(item.user);
      emitToast(`Opened ${item.service} · username copied (unlock vault for password)`, "info");
    }
  }

  async function handleToggleSecret(itemId) {
    if (!vaultUnlocked) {
      setError("Unlock the vault before revealing a password.");
      return;
    }

    try {
      if (!secrets[itemId]) await fetchSecret(itemId);
      setShown((current) => ({ ...current, [itemId]: !current[itemId] }));
    } catch (failure) {
      setError(formatVaultError(failure));
    }
  }

  const filteredItems = useMemo(() => items.filter((item) => {
    if (tagFilter.length && !tagFilter.every((tag) => (item.tags || []).includes(tag))) return false;
    if (!q) return true;

    const search = q.toLowerCase();
    return item.service.toLowerCase().includes(search)
      || item.user.toLowerCase().includes(search)
      || (item.tags || []).some((tag) => tag.toLowerCase().includes(search));
  }), [items, q, tagFilter]);

  const pagination = usePagination(filteredItems, { key: "passwords" });

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      {(busy || syncing) && busyMessage && <LoadingOverlay message={busyMessage} />}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{pt("passwords.title", "Passwords")}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
            {pt("passwords.description", "Secure vault: metadata loads from the server and secrets stay there until you unlock them.")}
          </p>
        </div>
        {connected && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {vaultMode === "bitwarden" && (
              <span style={{ fontSize: 11, color: "var(--muted-fg)", padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--muted)" }}>
                Bitwarden
              </span>
            )}
            {vaultMode === "bitwarden" && vaultUnlocked && (
              <button onClick={handleSync} disabled={syncing} style={chrome} title={pt("passwords.sync", "Sync")}>
                {syncing ? pt("passwords.syncing", "Syncing…") : `⟳ ${pt("passwords.sync", "Sync")}`}
              </button>
            )}
            {vaultUnlocked && (
              <button onClick={() => setShowCreate(true)} style={{ ...chrome, background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}>
                + {pt("passwords.add", "Add password")}
              </button>
            )}
            <button onClick={handleDisconnect} style={chrome}>{pt("passwords.disconnect", "Disconnect")}</button>
            <button onClick={handleLock} disabled={busy || !vaultUnlocked} style={{
              ...chrome,
              opacity: vaultUnlocked ? 1 : 0.55,
              cursor: vaultUnlocked ? "pointer" : "not-allowed",
            }}>
              {pt("passwords.lockVault", "Lock vault")}
            </button>
          </div>
        )}
      </div>

      {!connected && (
        <form onSubmit={handleConnect} style={{
          padding: 18,
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "white",
          marginBottom: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{pt("passwords.connect", "Connect to the vault")}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.5 }}>
              {pt("passwords.connectDescription", "Enter the HQ access token and the vault master password. The token stays only in this browser session.")}
            </div>
          </div>
          <label style={inputStack}>
            <span style={inputLabel}>{pt("passwords.token", "HQ access token")}</span>
            <input
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              placeholder="dev-token"
              style={inputStyle}
            />
          </label>
          <label style={inputStack}>
            <span style={inputLabel}>{pt("passwords.master", "Master password")}</span>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, background: "var(--muted)", overflow: "hidden" }}>
              <input
                type={showMasterPwd ? "text" : "password"}
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.target.value)}
                placeholder="Vault master password"
                style={{ flex: 1, height: 36, padding: "0 10px", border: 0, outline: 0, fontSize: 13, fontFamily: "inherit", background: "transparent" }}
              />
              <button
                type="button"
                onClick={() => setShowMasterPwd(v => !v)}
                title={showMasterPwd ? "Hide" : "Show"}
                style={{ height: 36, width: 34, border: 0, background: "none", cursor: "pointer", color: "var(--muted-fg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                {showMasterPwd ? eyeOff : eye}
              </button>
            </div>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" disabled={busy} style={{ ...chrome, width: "100%", justifyContent: "center", background: "var(--accent)", color: "white", borderColor: "var(--accent)", gap: 7 }}>
              {busy && <Spinner size={13} color="white" />}
              {busy ? "Connecting..." : "Connect and unlock"}
            </button>
          </div>
        </form>
      )}

      {connected && (
        <div style={{
          padding: 16,
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: vaultUnlocked
            ? "color-mix(in srgb, var(--ok) 7%, white)"
            : "color-mix(in srgb, var(--warn) 8%, white)",
          marginBottom: 18,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {vaultUnlocked ? "Vault unlocked" : "Vault locked"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-fg)", marginTop: 4 }}>
                {vaultUnlocked
                  ? "Passwords are fetched on demand and cached only in memory for this tab."
                  : "Metadata is visible, but password values stay unavailable until you unlock the vault."}
              </div>
            </div>
            {!vaultUnlocked && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, background: "white", overflow: "hidden", minWidth: 220 }}>
                  <input
                    type={showMasterPwd ? "text" : "password"}
                    value={masterPassword}
                    onChange={(event) => setMasterPassword(event.target.value)}
                    placeholder="Master password"
                    style={{ flex: 1, height: 36, padding: "0 10px", border: 0, outline: 0, fontSize: 13, fontFamily: "inherit", background: "transparent" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowMasterPwd(v => !v)}
                    title={showMasterPwd ? "Hide" : "Show"}
                    style={{ height: 36, width: 34, border: 0, background: "none", cursor: "pointer", color: "var(--muted-fg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >
                    {showMasterPwd ? eyeOff : eye}
                  </button>
                </div>
                <button onClick={handleUnlock} disabled={busy} style={{ ...chrome, background: "var(--accent)", color: "white", borderColor: "var(--accent)", gap: 7 }}>
                  {busy && <Spinner size={13} color="white" />}
                  {busy ? "Unlocking..." : "Unlock vault"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          marginBottom: 14, padding: "12px 14px",
          border: `1px solid ${error === "docker-down" ? "#fbbf24" : "color-mix(in srgb, var(--err) 25%, var(--border))"}`,
          background: error === "docker-down" ? "#fffbeb" : "color-mix(in srgb, var(--err) 8%, white)",
          borderRadius: 8,
          color: error === "docker-down" ? "#92400e" : "#991b1b",
          fontSize: 12.5, display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>
            {error === "docker-down" ? "🐳" : "⚠️"}
          </span>
          <div>
            {error === "docker-down" ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>{window.I18N.t("passwords.serverOff", "Bitwarden / Vaultwarden server is offline")}</div>
                <div style={{ fontSize: 11.5, opacity: 0.85 }}>{window.I18N.t("ui.passwords.startDocker", "The Docker container is not running. Start it with:")} <code style={{ display: "block", marginTop: 5, padding: "4px 8px", background: "#fef3c7", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    docker start vaultwarden
                  </code>{window.I18N.t("ui.passwords.unlockAgain", "then unlock the vault again.")} </div>
              </>
            ) : (
              error
            )}
          </div>
        </div>
      )}

      {connected && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "0 1 320px" }}>
            <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)" }}>Q</span>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={pt("passwords.search", "Search credential…")}
              style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "white", fontFamily: "inherit" }}
            />
          </div>
          <TagFilter value={tagFilter} onChange={setTagFilter} items={items} />
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-fg)" }}>
            {loading ? "Loading..." : `${filteredItems.length} results`}
          </div>
        </div>
      )}

      {!connected && (
        <div style={infoCard}>
          The old mock passwords are gone from the client runtime. Start here by connecting with an HQ token and master password.
        </div>
      )}

      {connected && loading && (
        <div style={infoCard}>{pt("passwords.loading", "Loading vault metadata…")}</div>
      )}

      {connected && !loading && filteredItems.length === 0 && (
        <div style={infoCard}>{pt("passwords.noResults", "No vault items matched your current filters.")}</div>
      )}

      {connected && !loading && filteredItems.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 10 }}>
          {pagination.pageItems.map((item) => (
            <PassCard
              key={item.id}
              item={item}
              vaultUnlocked={vaultUnlocked}
              shown={Boolean(shown[item.id])}
              secret={secrets[item.id]}
              onCopyField={copyWithAutoClear}
              onCopyPassword={handleCopyPassword}
              onToggleSecret={handleToggleSecret}
              onEdit={openEdit}
              onLaunch={handleLaunch}
              vmLookup={vmLookup}
              deviceLookup={deviceLookup}
              connectorLookup={connectorLookup}
            />
          ))}
        </div>
      )}

      {connected && !loading && filteredItems.length > 0 && <PaginationBar {...pagination} />}

      {/* ── Create password modal ── */}
      {showCreate && (
        <div onClick={() => setShowCreate(false)} style={{
          position: "fixed", inset: 0, background: "rgba(28,25,23,0.4)",
          backdropFilter: "blur(2px)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 100, padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: 480, background: "white",
            borderRadius: 12, boxShadow: "0 24px 50px -12px rgba(0,0,0,.25)",
            border: "1px solid var(--border)", overflow: "hidden",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{pt("passwords.addTitle", "Add new password")}</div>
              <button onClick={() => setShowCreate(false)} style={{ ...iconGhost, fontSize: 18, cursor: "pointer" }}>×</button>
            </div>
            <form onSubmit={handleCreate} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.serviceName", "Service name")} *</span>
                <input autoFocus value={newItem.service} onChange={e => setNewItem(v => ({ ...v, service: e.target.value }))}
                  placeholder="e.g. GitHub, vCenter..." style={inputStyle} />
              </label>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.username", "Username")}</span>
                <input value={newItem.username} onChange={e => setNewItem(v => ({ ...v, username: e.target.value }))}
                  placeholder="user@example.com" style={inputStyle} />
              </label>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.passwordField", "Password")}</span>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, background: "var(--muted)", overflow: "hidden" }}>
                  <input type={showNewPwd ? "text" : "password"} value={newItem.password}
                    onChange={e => setNewItem(v => ({ ...v, password: e.target.value }))}
                    placeholder="••••••••" style={{ flex: 1, height: 36, padding: "0 10px", border: 0, outline: 0, fontSize: 13, fontFamily: "inherit", background: "transparent" }} />
                  <button type="button" onClick={() => setShowNewPwd(v => !v)}
                    style={{ height: 36, width: 34, border: 0, background: "none", cursor: "pointer", color: "var(--muted-fg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {showNewPwd ? eyeOff : eye}
                  </button>
                </div>
              </label>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.url", "URL")}</span>
                <input value={newItem.url} onChange={e => setNewItem(v => ({ ...v, url: e.target.value }))}
                  placeholder="https://..." style={inputStyle} />
              </label>
              {folders.length > 0 && (
                <label style={inputStack}>
                  <span style={inputLabel}>{pt("passwords.folder", "Folder")}</span>
                  <select value={newItem.folderId} onChange={e => setNewItem(v => ({ ...v, folderId: e.target.value }))}
                    style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="">{pt("passwords.noFolder", "— No folder —")}</option>
                    {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
              )}
              {/* Tag picker */}
              <div style={inputStack}>
                <span style={inputLabel}>{pt("passwords.tags", "Tags")}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Simple tags */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {(window.APP_DATA?.TAGS || []).filter(t => !t.values).map(tag => {
                      const active = newItem.tags.includes(tag.id);
                      return (
                        <button key={tag.id} type="button"
                          onClick={() => setNewItem(v => ({
                            ...v,
                            tags: active ? v.tags.filter(t => t !== tag.id) : [...v.tags, tag.id],
                          }))}
                          style={{
                            padding: "3px 10px", borderRadius: 4, fontSize: 11.5, fontWeight: 500,
                            cursor: "pointer", border: `1px solid ${active ? tag.color : "var(--border)"}`,
                            background: active ? `color-mix(in srgb, ${tag.color} 15%, white)` : "var(--muted)",
                            color: active ? tag.color : "var(--muted-fg)",
                          }}>{tag.label}</button>
                      );
                    })}
                  </div>
                  {/* Category tags — show label + selectable values */}
                  {(window.APP_DATA?.TAGS || []).filter(t => t.values?.length).map(cat => (
                    <div key={cat.id} style={{
                      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5,
                      padding: "5px 8px", borderRadius: 5,
                      background: `color-mix(in srgb, ${cat.color} 7%, white)`,
                      border: `1px solid color-mix(in srgb, ${cat.color} 20%, var(--border))`,
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, textTransform: "uppercase", letterSpacing: 0.4, marginRight: 2 }}>
                        {cat.label}:
                      </span>
                      {cat.values.map(val => {
                        const active = newItem.tags.includes(val.id);
                        return (
                          <button key={val.id} type="button"
                            onClick={() => setNewItem(v => ({
                              ...v,
                              tags: active ? v.tags.filter(t => t !== val.id) : [...v.tags, val.id],
                            }))}
                            style={{
                              padding: "2px 9px", borderRadius: 4, fontSize: 11.5, fontWeight: 500,
                              cursor: "pointer", border: `1px solid ${active ? cat.color : "var(--border)"}`,
                              background: active ? `color-mix(in srgb, ${cat.color} 18%, white)` : "white",
                              color: active ? cat.color : "var(--muted-fg)",
                            }}>{val.label}</button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.notes", "Notes")}</span>
                <textarea value={newItem.notes} onChange={e => setNewItem(v => ({ ...v, notes: e.target.value }))}
                  placeholder="Optional notes..." rows={2}
                  style={{ ...inputStyle, height: "auto", padding: "8px 12px", resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" onClick={() => setShowCreate(false)} style={chrome}>{pt("passwords.cancel", "Cancel")}</button>
                <button type="submit" disabled={busy} style={{ ...chrome, background: "var(--accent)", color: "white", borderColor: "var(--accent)", gap: 7 }}>
                  {busy && <Spinner size={13} color="white" />}
                  {busy ? "Saving..." : "Save to Bitwarden"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── Edit password modal ── */}
      {editItem && (
        <div onClick={() => setEditItem(null)} style={{
          position: "fixed", inset: 0, background: "rgba(28,25,23,0.4)",
          backdropFilter: "blur(2px)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 100, padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: 480, background: "white",
            borderRadius: 12, boxShadow: "0 24px 50px -12px rgba(0,0,0,.25)",
            border: "1px solid var(--border)", overflow: "hidden",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Edit — {editItem.service}</div>
              <button onClick={() => setEditItem(null)} style={{ ...iconGhost, fontSize: 18, cursor: "pointer" }}>×</button>
            </div>
            <form onSubmit={handleEdit} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, maxHeight: "75vh", overflowY: "auto" }}>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.serviceName", "Service name")} *</span>
                <input autoFocus value={editItem.service}
                  onChange={e => setEditItem(v => ({ ...v, service: e.target.value }))}
                  style={inputStyle} />
              </label>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.username", "Username")}</span>
                <input value={editItem.user}
                  onChange={e => setEditItem(v => ({ ...v, user: e.target.value, username: e.target.value }))}
                  style={inputStyle} />
              </label>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.passwordField", "Password")}</span>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, background: "var(--muted)", overflow: "hidden" }}>
                  <input type={showEditPwd ? "text" : "password"} value={editPwd}
                    onChange={e => setEditPwd(e.target.value)}
                    placeholder="Leave blank to keep current"
                    style={{ flex: 1, height: 36, padding: "0 10px", border: 0, outline: 0, fontSize: 13, fontFamily: "inherit", background: "transparent" }} />
                  <button type="button" onClick={() => setShowEditPwd(v => !v)}
                    style={{ height: 36, width: 34, border: 0, background: "none", cursor: "pointer", color: "var(--muted-fg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {showEditPwd ? eyeOff : eye}
                  </button>
                </div>
              </label>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.url", "URL")}</span>
                <input value={editItem.url || ""}
                  onChange={e => setEditItem(v => ({ ...v, url: e.target.value }))}
                  placeholder="https://..." style={inputStyle} />
              </label>
              {folders.length > 0 && (
                <label style={inputStack}>
                  <span style={inputLabel}>{pt("passwords.folder", "Folder")}</span>
                  <select value={editItem.folderId || ""}
                    onChange={e => setEditItem(v => ({ ...v, folderId: e.target.value }))}
                    style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="">{pt("passwords.noFolder", "— No folder —")}</option>
                    {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
              )}
              {/* Tag picker */}
              <div style={inputStack}>
                <span style={inputLabel}>{pt("passwords.tags", "Tags")}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {(window.APP_DATA?.TAGS || []).filter(t => !t.values).map(tag => {
                      const active = (editItem.tags || []).includes(tag.id);
                      return (
                        <button key={tag.id} type="button"
                          onClick={() => setEditItem(v => ({
                            ...v,
                            tags: active ? v.tags.filter(t => t !== tag.id) : [...(v.tags || []), tag.id],
                          }))}
                          style={{
                            padding: "3px 10px", borderRadius: 4, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                            border: `1px solid ${active ? tag.color : "var(--border)"}`,
                            background: active ? `color-mix(in srgb, ${tag.color} 15%, white)` : "var(--muted)",
                            color: active ? tag.color : "var(--muted-fg)",
                          }}>{tag.label}</button>
                      );
                    })}
                  </div>
                  {(window.APP_DATA?.TAGS || []).filter(t => t.values?.length).map(cat => (
                    <div key={cat.id} style={{
                      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5,
                      padding: "5px 8px", borderRadius: 5,
                      background: `color-mix(in srgb, ${cat.color} 7%, white)`,
                      border: `1px solid color-mix(in srgb, ${cat.color} 20%, var(--border))`,
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, textTransform: "uppercase", letterSpacing: 0.4, marginRight: 2 }}>{cat.label}:</span>
                      {cat.values.map(val => {
                        const active = (editItem.tags || []).includes(val.id);
                        return (
                          <button key={val.id} type="button"
                            onClick={() => setEditItem(v => ({
                              ...v,
                              tags: active ? v.tags.filter(t => t !== val.id) : [...(v.tags || []), val.id],
                            }))}
                            style={{
                              padding: "2px 9px", borderRadius: 4, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                              border: `1px solid ${active ? cat.color : "var(--border)"}`,
                              background: active ? `color-mix(in srgb, ${cat.color} 18%, white)` : "white",
                              color: active ? cat.color : "var(--muted-fg)",
                            }}>{val.label}</button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <label style={inputStack}>
                <span style={inputLabel}>{pt("passwords.notes", "Notes")}</span>
                <textarea value={editItem.notes || ""}
                  onChange={e => setEditItem(v => ({ ...v, notes: e.target.value }))}
                  rows={2} style={{ ...inputStyle, height: "auto", padding: "8px 12px", resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" onClick={() => setEditItem(null)} style={chrome}>{pt("passwords.cancel", "Cancel")}</button>
                <button type="submit" disabled={busy} style={{ ...chrome, background: "var(--accent)", color: "white", borderColor: "var(--accent)", gap: 7 }}>
                  {busy && <Spinner size={13} color="white" />}
                  {busy ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const chrome = {
  height: 32,
  padding: "0 12px",
  border: "1px solid var(--border)",
  background: "white",
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
  cursor: "pointer",
  color: "var(--fg)",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const inputStack = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const inputLabel = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--muted-fg)",
};

const inputStyle = {
  width: "100%",
  height: 36,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontFamily: "inherit",
  fontSize: 13,
  background: "var(--muted)",
};

const infoCard = {
  padding: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "white",
  color: "var(--muted-fg)",
  fontSize: 12.5,
  lineHeight: 1.6,
};

window.PasswordsView = PasswordsView;
