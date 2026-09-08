// Devices module — inventory of network devices (Cisco, Fortinet, etc.) with SSH access + vault credential linking
const { useState, useMemo, useEffect, useCallback, useRef } = React;
const dt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

// Device type lives as values on the "device-type" category tag (Tags page)
// instead of a hardcoded list, so adding a new kind is a Tags edit, not a
// code change. All values in one category tag share that tag's color —
// same rule tags.jsx's own getTag() uses — so every device kind badge is
// styled the same "Device Type" color rather than each having its own.
function deviceTypeValues() {
  return window.APP_DATA.TAGS.find(t => t.id === "device-type")?.values || [];
}
function getDeviceKind(id) {
  const tag = window.APP_DATA.TAGS.find(t => t.id === "device-type");
  const value = tag?.values.find(v => v.id === id);
  return value ? { id, label: value.label, color: tag.color } : { id, label: id || "Unknown", color: "#64748b" };
}

function DeviceStatusDot({ status, size = 8 }) {
  const colors = { online: "var(--ok)", warn: "var(--warn)", offline: "var(--err)", maint: "var(--muted-fg)" };
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size, borderRadius: 999,
      background: colors[status] || "var(--muted-fg)",
      boxShadow: status === "online" ? `0 0 0 3px color-mix(in srgb, ${colors.online} 18%, transparent)` : "none",
      flexShrink: 0,
    }} />
  );
}

function copyTo(text, label) {
  navigator.clipboard?.writeText(text);
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `${label} copied`, kind: "ok" } }));
}

// ── SSH Console Modal ────────────────────────────────────────────────────────
function SSHConsoleModal({ dev, vaultItem, onClose }) {
  const [revealPass, setRevealPass] = useState(false);
  const [password, setPassword]     = useState(null);
  const [loadingPass, setLoadingPass] = useState(false);
  const [passErr, setPassErr]       = useState(null);
  const sshCmd = `ssh ${dev.sshUser}@${dev.mgmtIp}${dev.sshPort !== 22 ? ` -p ${dev.sshPort}` : ""}`;

  async function fetchPassword() {
    if (password) { setRevealPass(true); return; }
    setLoadingPass(true); setPassErr(null);
    try {
      const r = await window.HQ_API.request("/api/vault/get", { method: "POST", body: { itemId: vaultItem.id } });
      setPassword(r.password);
      setRevealPass(true);
    } catch (e) {
      setPassErr(e.message || "Could not fetch password — vault may be locked.");
    } finally {
      setLoadingPass(false);
    }
  }

  async function copyPassword() {
    if (!password) { await fetchPassword(); if (!password) return; }
    copyTo(password, `Password for ${vaultItem.service}`);
    setRevealPass(false);
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lineStyle = { fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#e2e8f0", lineHeight: "1.7" };
  const promptColor = "#4ade80";

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, background: "#0f172a", borderRadius: 10, overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,.6)", display: "flex", flexDirection: "column",
      }}>
        {/* Title bar */}
        <div style={{ background: "#1e293b", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #334155" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: "#ef4444", display: "block" }} onClick={onClose} />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: "#f59e0b", display: "block" }} />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: "#22c55e", display: "block" }} />
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#94a3b8", marginLeft: 6 }}>
            SSH — {dev.name} ({dev.mgmtIp})
          </span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", color: "#64748b", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Terminal body */}
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Session info */}
          <div style={{ ...lineStyle, color: "#94a3b8", fontSize: 11.5, marginBottom: 2 }}>
            # {dev.vendor} {dev.model} · {dev.os} · {dev.location}
          </div>

          {/* ssh command line */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...lineStyle, color: promptColor }}>$</span>
            <span style={{ ...lineStyle, flex: 1, wordBreak: "break-all" }}>{sshCmd}</span>
            <button onClick={() => copyTo(sshCmd, "SSH command")} style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: 4,
              color: "#94a3b8", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            }}>{dt("devices.copy", "Copy")}</button>
          </div>

          {/* Password hint line */}
          {vaultItem ? (
            <div style={{ background: "#1e293b", borderRadius: 6, padding: "10px 12px", border: "1px solid #334155" }}>
            <div style={{ fontSize: 10, color: "#64748b", fontFamily: "var(--font-mono)", marginBottom: 6, letterSpacing: 0.4, textTransform: "uppercase" }}>{dt("devices.vaultCredential", "Vault credential")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 10px", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "#64748b" }}>{dt("devices.service", "Service")}</span><span style={{ color: "#e2e8f0" }}>{vaultItem.service}</span>
                <span style={{ color: "#64748b" }}>{dt("devices.sshUser", "SSH user")}</span><span style={{ color: "#4ade80" }}>{vaultItem.user || vaultItem.username || dev.sshUser}</span>
                <span style={{ color: "#64748b" }}>{dt("devices.password", "Password")}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {revealPass && password
                    ? <span style={{ color: "#fbbf24", letterSpacing: 1 }}>{password}</span>
                    : <span style={{ color: "#64748b" }}>••••••••••</span>
                  }
                </span>
              </div>
              {passErr && <div style={{ fontSize: 11, color: "#f87171", marginTop: 6, fontFamily: "var(--font-mono)" }}>{passErr}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button onClick={fetchPassword} disabled={loadingPass} style={{
                  flex: 1, height: 28, border: "1px solid #334155", borderRadius: 5,
                  background: "#334155", color: "#e2e8f0", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
                }}>
                  {loadingPass ? "Loading…" : revealPass ? "Hide" : "Reveal password"}
                </button>
                <button onClick={copyPassword} disabled={loadingPass} style={{
                  flex: 1, height: 28, border: "1px solid #2563eb", borderRadius: 5,
                  background: "#1e40af", color: "#eff6ff", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
                }}>
                  Copy password
                </button>
              </div>
            </div>
          ) : (
            <div style={{ background: "#1e293b", borderRadius: 6, padding: "10px 12px", border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, color: "#64748b", fontFamily: "var(--font-mono)" }}>
                No vault credential linked — use the Devices panel to associate a password.
              </div>
            </div>
          )}

          {/* Open in SSH app */}
          <a href={`ssh://${dev.sshUser}@${dev.mgmtIp}${dev.sshPort !== 22 ? `:${dev.sshPort}` : ""}`}
            style={{
              display: "block", textAlign: "center", padding: "8px 0",
              background: "#16a34a1a", border: "1px solid #16a34a44", borderRadius: 6,
              color: "#4ade80", fontSize: 12, fontFamily: "var(--font-mono)",
              textDecoration: "none", marginTop: 2,
            }}>
            ↗ Open in SSH client ({sshCmd})
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Vault Picker Modal ───────────────────────────────────────────────────────
function VaultPickerModal({ dev, currentVaultItemId, vaultItems, onPick, onClose }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!q) return vaultItems;
    const s = q.toLowerCase();
    return vaultItems.filter(v =>
      v.service.toLowerCase().includes(s) ||
      v.username.toLowerCase().includes(s) ||
      (v.url || "").toLowerCase().includes(s)
    );
  }, [vaultItems, q]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 210,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 440, maxHeight: 500, background: "white", borderRadius: 10,
        boxShadow: "0 16px 48px rgba(0,0,0,.22)", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{dt("devices.linkCredential", "Link vault credential")}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted-fg)", flex: 1 }}>for {dev.name}</span>
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {/* Search */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search credentials…"
            style={{ width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
        {/* List */}
        <div style={{ overflow: "auto", flex: 1 }}>
          {/* Remove link option */}
          {currentVaultItemId && (
            <div onClick={() => onPick(null)} style={{
              padding: "8px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
              borderBottom: "1px solid var(--border)",
              background: "var(--muted)",
            }}>
              <span style={{ fontSize: 12, color: "var(--err)" }}>✕ Remove credential link</span>
            </div>
          )}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>{dt("devices.credentialsEmpty", "No credentials found")}</div>
          )}
          {filtered.map(item => (
            <div key={item.id} onClick={() => onPick(item.id)} style={{
              padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              borderBottom: "1px solid var(--border)",
              background: item.id === currentVaultItemId ? "color-mix(in srgb, var(--accent) 8%, white)" : "white",
            }}
            onMouseEnter={e => { if (item.id !== currentVaultItemId) e.currentTarget.style.background = "var(--muted)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = item.id === currentVaultItemId ? "color-mix(in srgb, var(--accent) 8%, white)" : "white"; }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  {item.service}
                  {item.id === currentVaultItemId && <span style={{ fontSize: 10, background: "var(--accent)", color: "white", borderRadius: 3, padding: "1px 5px" }}>{dt("devices.linked", "linked")}</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 1 }}>
                  {item.username}{item.url ? ` · ${item.url}` : ""}
                </div>
              </div>
              {item.tags?.length > 0 && (
                <div style={{ display: "flex", gap: 3 }}>
                  {item.tags.slice(0,2).map(t => (
                    <span key={t} style={{ fontSize: 9.5, background: "var(--muted)", color: "var(--muted-fg)", borderRadius: 3, padding: "1px 5px", fontWeight: 500 }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function deviceAction(dev, action) {
  if (action === "copyip")   return copyTo(dev.mgmtIp, `IP ${dev.name}`);
  if (action === "copy-ssh") return copyTo(`ssh ${dev.sshUser}@${dev.mgmtIp}`, "SSH command");
  const labels = {
    web: `Opening web UI for ${dev.name}…`,
  };
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg: labels[action], kind: "info" } }));
}

function DeviceCard({ dev, vaultItem, onSelect, onToggleFav, onSSH, onEdit }) {
  const kind = getDeviceKind(dev.kind);
  return (
    <div onClick={() => onSelect(dev)} style={{
      background: "white", border: "1px solid var(--border)",
      borderRadius: 8, padding: 12, cursor: "pointer",
      borderLeft: `3px solid ${kind.color}`,
      transition: "border-color .12s",
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.borderLeftColor = kind.color; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = kind.color; }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DeviceStatusDot status={dev.status} />
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 13 }}>{dev.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(dev); }} title="Edit device"
              style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 13, padding: "0 2px", lineHeight: 1 }}>
              ✎
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onToggleFav(dev.id); }}
            style={{ background: "none", border: 0, cursor: "pointer", color: dev.favorite ? "#f59e0b" : "var(--muted-fg)", fontSize: 14, padding: 0, lineHeight: 1 }}>
            {dev.favorite ? "★" : "☆"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          padding: "2px 6px", borderRadius: 3, fontFamily: "var(--font-mono)",
          background: `${kind.color}1a`, color: kind.color,
        }}>{kind.label.toUpperCase()}</span>
        <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{dev.vendor} · {dev.model}</span>
        {vaultItem && (
          <span title={`Credential: ${vaultItem.service}`} style={{ marginLeft: "auto", fontSize: 10, color: "var(--ok)", display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 8px", fontSize: 11, marginBottom: 8 }}>
          <span style={{ color: "var(--muted-fg)" }}>{dt("devices.mgmtIp", "Management IP")}</span> <span style={{ fontFamily: "var(--font-mono)" }}>{dev.mgmtIp}</span>
        <span style={{ color: "var(--muted-fg)" }}>{dt("devices.site", "Site")}</span>    <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{dev.site}</span>
        <span style={{ color: "var(--muted-fg)" }}>OS</span>      <span style={{ fontFamily: "var(--font-mono)" }}>{dev.os}</span>
        {dev.portsTotal && <>
          <span style={{ color: "var(--muted-fg)" }}>{dt("devices.ports", "Ports")}</span><span style={{ fontFamily: "var(--font-mono)" }}><b>{dev.portsUsed}</b>/{dev.portsTotal} {dt("devices.used", "used")}</span>
        </>}
      </div>

      {dev.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
          {dev.tags.map(tid => <TagPill key={tid} id={tid} />)}
        </div>
      )}

      <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
        <button style={{ ...btnStyle, background: vaultItem ? "#0f172a" : "white", color: vaultItem ? "#e2e8f0" : "var(--fg)", borderColor: vaultItem ? "#334155" : "var(--border)" }}
          onClick={() => onSSH(dev)} title={`ssh ${dev.sshUser}@${dev.mgmtIp}`}>
          <span style={{ fontFamily: "var(--font-mono)" }}>›_</span> SSH
        </button>
        <button style={btnStyle} onClick={() => deviceAction(dev, "web")}>
          ↗ Web
        </button>
        <button style={{ ...btnStyle, padding: "0 7px", marginLeft: "auto" }} onClick={() => deviceAction(dev, "copyip")} title="Copy IP">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
  height: 26, padding: "0 9px",
  border: "1px solid var(--border)", background: "white",
  borderRadius: 5, fontSize: 11.5, fontWeight: 500,
  color: "var(--fg)", cursor: "pointer", fontFamily: "inherit",
};

// Fabric correlation panel — only for devices flagged with a fabricProvider.
function fmtOctets(o) {
  if (o == null) return "—";
  if (o >= 1e12) return (o / 1e12).toFixed(1) + " TB";
  if (o >= 1e9)  return (o / 1e9).toFixed(1) + " GB";
  if (o >= 1e6)  return (o / 1e6).toFixed(1) + " MB";
  if (o >= 1e3)  return (o / 1e3).toFixed(1) + " KB";
  return o + " B";
}
function agoTxt(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return window.I18N.t("ui.timeAgo", "{value} ago", { value: s + "s" });
  if (s < 3600) return window.I18N.t("ui.timeAgo", "{value} ago", { value: Math.floor(s / 60) + " min" });
  return window.I18N.t("ui.timeAgo", "{value} ago", { value: Math.floor(s / 3600) + " h" });
}
function FabricPanel({ dev }) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");
  // The correlation needs a live workload source (vCenter). Only show the panel
  // when that connection is active — null = checking, false = hide.
  const [vcOk, setVcOk]     = useState(null);

  const load = () => window.HQ_API.request(`/api/fabric/${dev.id}/correlation`)
    .then(d => { setData(d); setErr(""); })
    .catch(e => setErr(e.payload?.error || e.message))
    .finally(() => setLoad(false));

  useEffect(() => {
    let alive = true;
    window.HQ_API.request("/api/connectors/status")
      .then(st => {
        const vc = st && st.vcenter;
        const ok = !!(vc && vc.configured && vc.status === "ok");
        if (!alive) return;
        setVcOk(ok);
        if (ok) { setLoad(true); load(); }
      })
      .catch(() => { if (alive) setVcOk(false); });
    return () => { alive = false; };
  }, [dev.id]);

  if (vcOk !== true) return null;  // hidden until a vCenter connection is active

  const collect = () => {
    setBusy(true); setErr("");
    window.HQ_API.request(`/api/fabric/${dev.id}/collect`, { method: "POST" })
      .then(() => load())
      .catch(e => setErr(e.payload?.error || e.message))
      .finally(() => setBusy(false));
  };

  const s = data?.summary;
  const th = { textAlign: "left", padding: "4px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: .4, color: "var(--muted-fg)", position: "sticky", top: 0, background: "white" };
  const td = { padding: "3px 6px", fontSize: 11, borderTop: "1px solid var(--border)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={section}>{window.I18N.t("ui.devices.fabric", "Fabric · MAC ↔ VM correlation")}</div>
        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb,#13bef9 14%,white)", color: "#0b87b3", fontFamily: "var(--font-mono)" }}>{dev.fabricProvider}</span>
        <button onClick={collect} disabled={busy} style={{ ...btnStyle, marginLeft: "auto", height: 26, padding: "0 10px", opacity: busy ? .6 : 1 }}>{busy ? window.I18N.t("devices.collecting", "Collecting…") : "⟳ Colectar"}</button>
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 22%,var(--border))", borderRadius: 6, padding: "7px 10px", marginBottom: 8 }}>{err === "vault-locked" ? window.I18N.t("ui.devices.locked", "Vault locked — unlock it in Passwords.") : err === "no-cred-linked" ? "Vincula una credencial al device primero." : err}</div>}
      {loading ? <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
        : !data?.collected ? <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{dt("devices.noDataYet", "No data yet.")} {window.I18N.t("ui.devices.press", "Click")} <b>{dt("devices.collect", "Colectar")}</b> {window.I18N.t("ui.devices.collectHelp", "(reads the MAC table and traffic over SSH and correlates them with vCenter).")}</div>
        : (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 8 }}>
            {[["MACs", s.total], ["Con VM", s.matched], [window.I18N.t("ui.devices.withoutVm", "No VM"), s.orphan], ["VM sin MAC", s.missing]].map(([l, v]) => (
              <div key={l} style={{ background: "var(--muted)", borderRadius: 6, padding: "6px 8px" }}>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{v}</div>
                <div style={{ fontSize: 10, color: "var(--muted-fg)" }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginBottom: 6 }}>{window.I18N.t("ui.devices.collected", "Collected")} {agoTxt(s.collectedAt)} {window.I18N.t("ui.devices.indexed", "· vCenter indexed")} {agoTxt(s.indexedAt)} ({s.workloads} {window.I18N.t("ui.devices.fiHelp", "VMs) · this is only this FI; the other half is on its peer.")} </div>
          <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>VLAN</th><th style={th}>MAC</th><th style={th}>Port</th><th style={th}>In/Out</th><th style={{ ...th, fontFamily: "inherit" }}>VM</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} style={{ background: r.workload ? "white" : "color-mix(in srgb,var(--warn) 7%,white)" }}>
                    <td style={td}>{r.segment}</td>
                    <td style={td}>{r.mac}</td>
                    <td style={td}>{r.port}</td>
                    <td style={{ ...td, color: "var(--muted-fg)" }}>{fmtOctets(r.trafficIn)} / {fmtOctets(r.trafficOut)}</td>
                    <td style={{ ...td, fontFamily: "inherit" }}>{r.workload || <span style={{ color: "var(--muted-fg)", fontStyle: "italic" }}>{window.I18N.t("ui.devices.noVm", "(no VM)")}</span>}{r.net ? <span style={{ color: "var(--muted-fg)", fontSize: 10 }}> · {r.net}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
    </div>
  );
}

function DeviceDetail({ dev, vaultItem, vaultItems, onClose, onSSH, onLinkVault }) {
  if (!dev) return null;
  const kind = getDeviceKind(dev.kind);
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0,
      width: 460, maxWidth: "100vw", background: "white", borderLeft: "1px solid var(--border)",
      boxShadow: "-10px 0 24px -16px rgba(0,0,0,.18)",
      zIndex: 50, display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <DeviceStatusDot status={dev.status} />
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14 }}>{dev.name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: `${kind.color}1a`, color: kind.color, fontFamily: "var(--font-mono)" }}>{kind.label.toUpperCase()}</span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", fontSize: 18, color: "var(--muted-fg)" }}>×</button>
      </div>
      <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Device info */}
        <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 12px", fontSize: 12 }}>
          <span style={kk}>{dt("devices.vendorLabel", "Vendor")}</span>    <span>{dev.vendor}</span>
          <span style={kk}>{dt("devices.model", "Model")}</span>     <span style={{ fontFamily: "var(--font-mono)" }}>{dev.model}</span>
          <span style={kk}>{dt("devices.firmware", "OS / Firmware")}</span> <span style={{ fontFamily: "var(--font-mono)" }}>{dev.firmware}</span>
          <span style={kk}>{dt("devices.serial", "Serial")}</span>    <span style={vv} onClick={() => copyTo(dev.serial, "Serial")}>{dev.serial}</span>
          <span style={kk}>{dt("devices.mgmtIp", "Management IP")}</span>   <span style={vv} onClick={() => copyTo(dev.mgmtIp, "Mgmt IP")}>{dev.mgmtIp}</span>
          <span style={kk}>{dt("devices.sshUser", "SSH user")}</span>  <span style={vv} onClick={() => copyTo(dev.sshUser, "User")}>{dev.sshUser}@:{dev.sshPort}</span>
          <span style={kk}>SSH cmd</span>   <span style={vv} onClick={() => copyTo(`ssh ${dev.sshUser}@${dev.mgmtIp}`, "SSH command")}>ssh {dev.sshUser}@{dev.mgmtIp}</span>
          <span style={kk}>Site</span>      <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{dev.site}</span>
          <span style={kk}>{dt("devices.location", "Location")}</span>  <span>{dev.location}</span>
          <span style={kk}>{dt("devices.uptime", "Uptime")}</span>    <span style={{ fontFamily: "var(--font-mono)" }}>{dev.uptime}</span>
          {dev.portsTotal && <>
            <span style={kk}>{dt("devices.ports", "Ports")}</span>   <span style={{ fontFamily: "var(--font-mono)" }}><b>{dev.portsUsed}</b> {dt("devices.used", "in use")} / {dev.portsTotal} total</span>
          </>}
          <span style={kk}>{dt("devices.lastBackup", "Last backup")}</span> <span style={{ fontFamily: "var(--font-mono)" }}>{dev.lastConfigBackup}</span>
        </div>

        {/* Vault credential */}
        <div>
          <div style={section}>{dt("devices.vaultCredential", "Vault credential")}</div>
          {vaultItem ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "5px 10px", fontSize: 12, padding: "10px 12px", background: "color-mix(in srgb, var(--ok) 6%, white)" }}>
                <span style={kk}>{dt("devices.service", "Service")}</span> <span style={{ fontWeight: 500 }}>{vaultItem.service}</span>
                <span style={kk}>{dt("devices.sshUser", "User")}</span>    <span style={{ fontFamily: "var(--font-mono)" }}>{vaultItem.user || vaultItem.username}</span>
                {vaultItem.url && <><span style={kk}>URL</span> <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{vaultItem.url}</span></>}
              </div>
              <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px", display: "flex", gap: 6 }}>
                <button onClick={() => onSSH(dev)} style={{ ...btnStyle, flex: 1, height: 28, background: "#0f172a", color: "#e2e8f0", borderColor: "#334155" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>›_</span> Open SSH Console
                </button>
                <button onClick={() => onLinkVault(dev)} style={{ ...btnStyle, height: 28, padding: "0 10px" }}>
                  Change
                </button>
              </div>
            </div>
          ) : (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: "12px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{dt("devices.noCredential", "No credential linked")}</div>
                <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 2 }}>{dt("devices.linkHint", "Associate a vault entry to use the SSH console with auto-fill.")}</div>
              </div>
              <button onClick={() => onLinkVault(dev)} style={{ ...btnStyle, height: 30, background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}>
                + Link
              </button>
            </div>
          )}
        </div>

        {/* Fabric correlation (only for fabric-interconnect-capable devices) */}
        {dev.fabricProvider && <FabricPanel dev={dev} />}

        {/* Tags */}
        <div>
          <div style={section}>Tags</div>
          {dev.tags?.length ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {dev.tags.map(tid => <TagPill key={tid} id={tid} size="md" />)}
            </div>
          ) : <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>—</span>}
        </div>

        {/* Quick actions */}
        <div>
          <div style={section}>{dt("devices.quickActions", "Quick actions")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <ActionCard icon="›_" label="SSH Console" sub={`${dev.sshUser}@${dev.mgmtIp}`} onClick={() => onSSH(dev)} dark />
            <ActionCard icon="⎘" label="Copy SSH"    sub="Command to clipboard"    onClick={() => copyTo(`ssh ${dev.sshUser}@${dev.mgmtIp}`, "SSH command")} />
          </div>
        </div>

        {dev.notes && (
          <div>
            <div style={section}>{dt("devices.notes", "Notes")}</div>
            <div style={{ fontSize: 12.5, background: "var(--muted)", borderRadius: 6, padding: 10, lineHeight: 1.5 }}>{dev.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const kk = { color: "var(--muted-fg)", fontWeight: 500 };
const vv = { fontFamily: "var(--font-mono)", cursor: "pointer", color: "var(--fg)", textDecoration: "underline dotted var(--border)", textUnderlineOffset: 3 };
const section = { fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, color: "var(--muted-fg)", textTransform: "uppercase", marginBottom: 6 };

function ActionCard({ icon, label, sub, onClick, dark = false }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start", textAlign: "left",
      padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6,
      background: dark ? "#0f172a" : "white",
      cursor: "pointer", fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: dark ? "#e2e8f0" : "var(--fg)" }}>
        <span style={{ color: dark ? "#4ade80" : "var(--accent)", fontFamily: "var(--font-mono)" }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 10.5, color: dark ? "#64748b" : "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{sub}</div>
    </button>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-fg)" }}>
      {label}:
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          height: 32, padding: "0 26px 0 8px", border: "1px solid var(--border)",
          borderRadius: 6, fontSize: 12, fontFamily: "inherit",
          background: "white", color: "var(--fg)", cursor: "pointer",
          appearance: "none",
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
          backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
        }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ── New Device Modal ─────────────────────────────────────────────────────────
const FIELD = { display:"flex", flexDirection:"column", gap:4 };
const LBL   = { fontSize:12, fontWeight:500, color:"var(--muted-fg)" };
const INP   = { height:32, padding:"0 10px", border:"1px solid var(--border)", borderRadius:6, fontSize:13, fontFamily:"inherit", background:"white", color:"var(--fg)" };
const SEL   = { ...INP, cursor:"pointer" };

function NewDeviceModal({ onSave, onClose, vaultItems = [] }) {
  const [form, setForm] = useState({
    name:"", kind:"server",
    mgmtIp:"", vaultItemId:"", sshPort:"22", sshUser:"admin",
    location:"", serial:"", notes:"", tags:[],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedVaultItem = vaultItems.find(v => v.id === form.vaultItemId) || null;

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.mgmtIp.trim()) { setErr("Name and Management IP are required."); return; }
    setSaving(true); setErr("");
    try {
      const body = { ...form, sshUser: form.sshUser.trim() || "admin" };
      const dev = await window.HQ_API.request("/api/devices", { method:"POST", body });
      onSave(dev, form.vaultItemId || null);
    } catch(ex) {
      setErr(ex.message || "Failed to save device.");
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:1200, display:"flex", alignItems:"center", justifyContent:"center" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"white", borderRadius:12, width:"min(640px,95vw)", maxHeight:"90vh", overflowY:"auto",
                    boxShadow:"0 20px 60px rgba(0,0,0,.25)", padding:24 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:600 }}>{dt("devices.newTitle", "New device")}</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"var(--muted-fg)", lineHeight:1, padding:2 }}>×</button>
        </div>

        <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Row 1: Name + Kind */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.hostname", "Hostname / Name")} *</label>
              <input style={INP} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="device-01" autoFocus />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.deviceType", "Device type")} *</label>
              <select style={SEL} value={form.kind} onChange={e=>set("kind",e.target.value)}>
                {deviceTypeValues().map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: Mgmt IP + Port + SSH User */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.managementIp", "Management IP")} *</label>
              <input style={INP} value={form.mgmtIp} onChange={e=>set("mgmtIp",e.target.value)} placeholder="10.0.0.1" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>SSH Port</label>
              <input style={INP} type="number" value={form.sshPort} onChange={e=>set("sshPort",e.target.value)} placeholder="22" min="1" max="65535" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.sshUser", "SSH User")}</label>
              <input style={INP} value={form.sshUser} onChange={e=>set("sshUser",e.target.value)} placeholder="admin" />
            </div>
          </div>

          {/* Row 3: Vault Credential — optional. Without one, the SSH User
              above still connects; you'll just be asked for the password
              the first time (same manual-password prompt SSH Workspace
              already shows on an auth failure), instead of needing a vault
              entry to SSH in at all. */}
          <div style={FIELD}>
            <label style={LBL}>SSH Credential <span style={{ fontWeight:400 }}>(from vault, optional)</span></label>
            {vaultItems.length > 0 ? (
              <select style={SEL} value={form.vaultItemId} onChange={e=>set("vaultItemId",e.target.value)}>
                <option value="">— no vault credential (ask for password when connecting) —</option>
                {vaultItems.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.service} · {v.user || v.username || "—"}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ ...INP, display:"flex", alignItems:"center", gap:6, color:"var(--muted-fg)", fontSize:12, cursor:"default" }}>
                🔒 No vault credentials yet — you'll be asked for a password when you connect
              </div>
            )}
            {selectedVaultItem && (
              <span style={{ fontSize:11, color:"var(--ok)", marginTop:2 }}>
                ✓ Password from <b>{selectedVaultItem.service}</b> — SSH user above still applies
              </span>
            )}
          </div>

          {/* Row 5: Location + Serial */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.location", "Location")}</label>
              <input style={INP} value={form.location} onChange={e=>set("location",e.target.value)} placeholder="Rack 1" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.serial", "Serial Number")}</label>
              <input style={INP} value={form.serial} onChange={e=>set("serial",e.target.value)} placeholder="SN-0001" />
            </div>
          </div>

          {/* Row 6: Tags */}
          <div style={FIELD}>
            <label style={LBL}>{dt("tags.optional", "Tags (optional)")}</label>
            {window.TagPicker
              ? <window.TagPicker value={form.tags} onChange={next => set("tags", next)} />
              : null}
          </div>

          {/* Row 7: Notes */}
          <div style={FIELD}>
            <label style={LBL}>{dt("devices.notes", "Notes")}</label>
            <textarea style={{ ...INP, height:60, paddingTop:8, resize:"vertical", lineHeight:1.4 }}
              value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Any notes about this device…" />
          </div>

          {err && <p style={{ margin:0, fontSize:12, color:"var(--err)", background:"color-mix(in srgb,var(--err) 8%,white)", padding:"6px 10px", borderRadius:6 }}>{err}</p>}

          <div style={{ display:"flex", justifyContent:"flex-end", gap:8, paddingTop:4 }}>
            <button type="button" onClick={onClose} style={{ height:34, padding:"0 16px", border:"1px solid var(--border)", borderRadius:6, background:"white", fontSize:13, fontFamily:"inherit", cursor:"pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{ height:34, padding:"0 18px", border:"none", borderRadius:6, background:"var(--accent)", color:"white", fontSize:13, fontWeight:600, fontFamily:"inherit", cursor:saving?"wait":"pointer", opacity:saving?0.7:1 }}>
              {saving ? "Saving…" : "Create Device"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Device Modal ────────────────────────────────────────────────────────
function EditDeviceModal({ dev, onSave, onClose }) {
  const [form, setForm] = useState({
    name:      dev.name      || "",
    hostname:  dev.hostname  || dev.name || "",
    vmName:   dev.vmName    || "",
    kind:      dev.kind      || "server",
    vendor:    dev.vendor    || "",
    model:     dev.model     || "",
    os:        dev.os        || "",
    firmware:  dev.firmware  || "",
    mgmtIp:   dev.mgmtIp    || "",
    sshPort:  String(dev.sshPort ?? 22),
    sshUser:  dev.sshUser    || "admin",
    site:     dev.site       || "",
    location: dev.location   || "",
    serial:   dev.serial     || "",
    status:   dev.status     || "online",
    tags:     dev.tags || [],
    notes:    dev.notes      || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.mgmtIp.trim()) { setErr("Name and Management IP are required."); return; }
    setSaving(true); setErr("");
    try {
      const body = {
        ...form,
        sshPort: parseInt(form.sshPort, 10) || 22,
      };
      const updated = await window.HQ_API.request(`/api/devices/${dev.id}`, { method: "PUT", body });
      onSave(updated || { ...dev, ...body, id: dev.id });
    } catch (ex) {
      setErr(ex.message || "Failed to save device.");
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:1200, display:"flex", alignItems:"center", justifyContent:"center" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"white", borderRadius:12, width:"min(640px,96vw)", maxHeight:"92vh", overflowY:"auto",
                    boxShadow:"0 20px 60px rgba(0,0,0,.25)", padding:24 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div>
            <h2 style={{ margin:0, fontSize:16, fontWeight:600 }}>{dt("devices.editTitle", "Edit device")}</h2>
            <div style={{ fontSize:11.5, color:"var(--muted-fg)", fontFamily:"var(--font-mono)", marginTop:2 }}>{dev.id}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"var(--muted-fg)", lineHeight:1, padding:2 }}>×</button>
        </div>

        <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Row 1: Name + Kind */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.hostname", "Hostname / Name")} *</label>
              <input style={INP} value={form.name} onChange={e=>set("name",e.target.value)} autoFocus />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.deviceType", "Device Type")}</label>
              <select style={SEL} value={form.kind} onChange={e=>set("kind",e.target.value)}>
                {deviceTypeValues().map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: Vendor + Model */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.vendorLabel", "Vendor")}</label>
              <input style={INP} value={form.vendor} onChange={e=>set("vendor",e.target.value)} placeholder="Cisco" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.model", "Model")}</label>
              <input style={INP} value={form.model} onChange={e=>set("model",e.target.value)} placeholder="ASR 9001" />
            </div>
          </div>

          {/* Row 3: OS + Firmware */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.os", "OS")}</label>
              <input style={INP} value={form.os} onChange={e=>set("os",e.target.value)} placeholder="IOS-XR 7.10.2" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.firmware", "Firmware / Version")}</label>
              <input style={INP} value={form.firmware} onChange={e=>set("firmware",e.target.value)} placeholder="IOS-XR 7.10.2" />
            </div>
          </div>

          {/* Row 4: Mgmt IP + SSH Port + SSH User */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.managementIp", "Management IP")} *</label>
              <input style={INP} value={form.mgmtIp} onChange={e=>set("mgmtIp",e.target.value)} placeholder="10.0.0.1" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>SSH Port</label>
              <input style={INP} type="number" value={form.sshPort} onChange={e=>set("sshPort",e.target.value)} min="1" max="65535" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.sshUser", "SSH User")}</label>
              <input style={INP} value={form.sshUser} onChange={e=>set("sshUser",e.target.value)} placeholder="admin" />
            </div>
          </div>

          {/* Row 5: Site + Status */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.site", "Site")}</label>
              {/* Texto libre y no una lista: los sitios son de quien instala
                  Lintaya, no del producto. La lista traia tres ciudades
                  concretas y obligaba a "Other" a cualquiera con un cuarto. */}
              <input style={INP} value={form.site} onChange={e=>set("site",e.target.value)} placeholder={dt("devices.sitePlaceholder", "Data center, office, region…")} />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.status", "Status")}</label>
              <select style={SEL} value={form.status} onChange={e=>set("status",e.target.value)}>
                <option value="online">Online</option>
                <option value="warn">{dt("devices.warning", "Warning")}</option>
                <option value="offline">Offline</option>
                <option value="maint">{dt("devices.maintenance", "Maintenance")}</option>
              </select>
            </div>
          </div>

          {/* Row 6: Location + Serial */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.location", "Location")}</label>
              <input style={INP} value={form.location} onChange={e=>set("location",e.target.value)} placeholder="Rack 1" />
            </div>
            <div style={FIELD}>
              <label style={LBL}>{dt("devices.serial", "Serial Number")}</label>
              <input style={INP} value={form.serial} onChange={e=>set("serial",e.target.value)} placeholder="SN-0001" />
            </div>
          </div>

          {/* Row 7: vCenter VM Name */}
          <div style={FIELD}>
            <label style={LBL}>{window.I18N.t("ui.devices.vmName", "VM name in vCenter")} <span style={{ fontWeight:400, color:"var(--muted-fg)" }}>{window.I18N.t("ui.devices.vmNameHelp", "(if different from the device name)")}</span></label>
            <input style={INP} value={form.vmName} onChange={e=>set("vmName",e.target.value)} placeholder="srv-app-01" />
          </div>

          {/* Row 8: Tags */}
          <div style={FIELD}>
            <label style={LBL}>{dt("tags.optional", "Tags (optional)")}</label>
            {window.TagPicker
              ? <window.TagPicker value={form.tags} onChange={next => set("tags", next)} />
              : null}
          </div>

          {/* Row 8: Notes */}
          <div style={FIELD}>
            <label style={LBL}>{dt("devices.notes", "Notes")}</label>
            <textarea style={{ ...INP, height:64, paddingTop:8, resize:"vertical", lineHeight:1.4 }}
              value={form.notes} onChange={e=>set("notes",e.target.value)} />
          </div>

          {err && <p style={{ margin:0, fontSize:12, color:"var(--err)", background:"color-mix(in srgb,var(--err) 8%,white)", padding:"6px 10px", borderRadius:6 }}>{err}</p>}

          <div style={{ display:"flex", justifyContent:"flex-end", gap:8, paddingTop:4 }}>
            <button type="button" onClick={onClose} style={{ height:34, padding:"0 16px", border:"1px solid var(--border)", borderRadius:6, background:"white", fontSize:13, fontFamily:"inherit", cursor:"pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{ height:34, padding:"0 18px", border:"none", borderRadius:6, background:"var(--accent)", color:"white", fontSize:13, fontWeight:600, fontFamily:"inherit", cursor:saving?"wait":"pointer", opacity:saving?0.7:1 }}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────
function DeviceTable({ devices, getVaultItem, onSelect, onToggleFav, onSSH, onEdit, sortBy, sortDir, onSort }) {
  const TD = { padding: "7px 10px", fontSize: 12, borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

  const SortTH = ({ col, label, align }) => {
    const active = sortBy === col;
    return (
      <th onClick={() => onSort(col)} style={{
        padding: "7px 10px", fontSize: 10.5, fontWeight: 700,
        color: active ? "var(--accent)" : "var(--muted-fg)",
        letterSpacing: 0.5, textTransform: "uppercase",
        borderBottom: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
        textAlign: align || "left", whiteSpace: "nowrap",
        cursor: "pointer", userSelect: "none",
        background: active ? "color-mix(in srgb, var(--accent) 5%, var(--muted))" : "var(--muted)",
      }}>
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : <span style={{ opacity: 0.3 }}>↕</span>}
      </th>
    );
  };

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
        <thead>
          <tr>
            <SortTH col="status"  label="Status" />
            <SortTH col="name"    label="Name" />
            <SortTH col="kind"    label="Type" />
            <SortTH col="vendor"  label="Vendor / Model" />
            <SortTH col="mgmtIp" label="Mgmt IP" />
            <SortTH col="site"    label="Site" />
            <SortTH col="os"      label="OS" />
            <th style={{ padding: "7px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--muted-fg)", letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "2px solid var(--border)", textAlign: "left", background: "var(--muted)" }}>Tags</th>
            <th style={{ padding: "7px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--muted-fg)", letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "2px solid var(--border)", textAlign: "center", background: "var(--muted)" }}>{dt("devices.actions", "Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {devices.map(d => {
            const kind = getDeviceKind(d.kind);
            const vaultItem = getVaultItem(d.id);
            return (
              <tr key={d.id} onClick={() => onSelect(d)}
                style={{ cursor: "pointer", borderLeft: `3px solid ${kind.color}` }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--muted)"}
                onMouseLeave={e => e.currentTarget.style.background = "white"}>
                <td style={TD}>
                  <DeviceStatusDot status={d.status} size={9} />
                </td>
                <td style={{ ...TD, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {d.name}
                    {vaultItem && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>}
                  </div>
                </td>
                <td style={TD}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: `${kind.color}1a`, color: kind.color, fontFamily: "var(--font-mono)" }}>
                    {kind.label.toUpperCase()}
                  </span>
                </td>
                <td style={{ ...TD, color: "var(--muted-fg)" }}>{d.vendor} {d.model}</td>
                <td style={{ ...TD, fontFamily: "var(--font-mono)" }}>{d.mgmtIp}</td>
                <td style={{ ...TD, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{d.site}</td>
                <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 11 }}>{d.os}</td>
                <td style={TD}>
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {(d.tags || []).slice(0, 3).map(tid => <TagPill key={tid} id={tid} />)}
                  </div>
                </td>
                <td style={{ ...TD, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <button onClick={() => onSSH(d)} style={{ ...btnStyle, height: 24, padding: "0 7px", fontSize: 11, background: vaultItem ? "#0f172a" : "white", color: vaultItem ? "#e2e8f0" : "var(--fg)", borderColor: vaultItem ? "#334155" : "var(--border)" }}>
                      <span style={{ fontFamily: "var(--font-mono)" }}>›_</span>
                    </button>
                    {onEdit && <button onClick={() => onEdit(d)} style={{ ...btnStyle, height: 24, padding: "0 7px", fontSize: 11 }}>✎</button>}
                    <button onClick={() => onToggleFav(d.id)} style={{ ...btnStyle, height: 24, padding: "0 6px", fontSize: 13, color: d.favorite ? "#f59e0b" : "var(--muted-fg)" }}>
                      {d.favorite ? "★" : "☆"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Grid view (compact) ────────────────────────────────────────────────────────
function DeviceGrid({ devices, getVaultItem, onSelect, onToggleFav, onSSH, onEdit }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 7 }}>
      {devices.map(d => {
        const kind = getDeviceKind(d.kind);
        const vaultItem = getVaultItem(d.id);
        return (
          <div key={d.id} onClick={() => onSelect(d)} style={{
            background: "white", border: "1px solid var(--border)", borderRadius: 7,
            borderLeft: `3px solid ${kind.color}`, padding: "9px 10px",
            cursor: "pointer", display: "flex", flexDirection: "column", gap: 5,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.borderLeftColor = kind.color; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = kind.color; }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <DeviceStatusDot status={d.status} size={7} />
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{d.name}</span>
              </div>
              <div style={{ display: "flex", gap: 2 }} onClick={e => e.stopPropagation()}>
                {onEdit && <button onClick={() => onEdit(d)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 11, padding: 0, lineHeight: 1 }}>✎</button>}
                <button onClick={() => onToggleFav(d.id)} style={{ background: "none", border: 0, cursor: "pointer", color: d.favorite ? "#f59e0b" : "var(--muted-fg)", fontSize: 12, padding: 0, lineHeight: 1 }}>
                  {d.favorite ? "★" : "☆"}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--muted-fg)" }}>{d.mgmtIp}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "space-between" }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: `${kind.color}1a`, color: kind.color, fontFamily: "var(--font-mono)" }}>{kind.label.toUpperCase()}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{d.site}</span>
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.vendor} {d.model}</div>
            <div onClick={e => e.stopPropagation()} style={{ marginTop: 2 }}>
              <button onClick={() => onSSH(d)} style={{ ...btnStyle, height: 22, padding: "0 7px", fontSize: 10.5, width: "100%", background: vaultItem ? "#0f172a" : "white", color: vaultItem ? "#e2e8f0" : "var(--fg)", borderColor: vaultItem ? "#334155" : "var(--border)" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>›_</span> SSH
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DevicesView({ onOpenSSH, onCountChange }) {
  window.I18N?.useLocale();
  const [q, setQ] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favOverrides, setFavOverrides] = useState({});
  const [selected, setSelected] = useState(null);

  // View mode
  const [viewMode, setViewMode] = useState("cards");

  // Sort
  const [sortBy,  setSortBy]  = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  // New device
  const [showNewDevice, setShowNewDevice] = useState(false);
  const [customDevices, setCustomDevices] = useState([]);

  // Edit device
  const [editTarget, setEditTarget] = useState(null);

  // SSH console modal
  const [sshTarget, setSshTarget]   = useState(null);   // device for SSH console
  // Vault picker modal
  const [vaultTarget, setVaultTarget] = useState(null); // device for vault linking

  // Vault data
  const [vaultMap, setVaultMap]     = useState({});     // { devId: vaultItemId }
  const [vaultItems, setVaultItems] = useState([]);     // public metadata (no passwords)
  const [vaultLoaded, setVaultLoaded] = useState(false);

  // Load vault map + items + custom devices once
  useEffect(() => {
    async function load() {
      try {
        const [map, items, devs] = await Promise.all([
          window.HQ_API.request("/api/devices/vault-map"),
          window.HQ_API.request("/api/vault/items"),
          window.HQ_API.request("/api/devices"),
        ]);
        setVaultMap(map || {});
        setVaultItems(items || []);
        setCustomDevices(devs || []);
        onCountChange?.((window.APP_DATA?.DEVICES?.length || 0) + (devs?.length || 0));
      } catch (e) {
        console.warn("[devices] load error:", e.message);
      }
      setVaultLoaded(true);
    }
    load();
  }, []);

  const allStatic = useMemo(() => [...window.APP_DATA.DEVICES, ...customDevices], [customDevices]);

  const toggleFav = (id) => setFavOverrides(p => ({ ...p, [id]: !(p[id] ?? (allStatic.find(d => d.id === id)?.favorite ?? false)) }));

  const all = useMemo(() => allStatic.map(d => ({ ...d, favorite: favOverrides[d.id] ?? d.favorite })), [allStatic, favOverrides]);
  const vendors = useMemo(() => Array.from(new Set(allStatic.map(d => d.vendor).filter(Boolean))).sort(), [allStatic]);

  const devices = useMemo(() => {
    const filtered = all.filter(d => {
      if (siteFilter !== "all" && d.site !== siteFilter) return false;
      if (kindFilter !== "all" && d.kind !== kindFilter) return false;
      if (vendorFilter !== "all" && d.vendor !== vendorFilter) return false;
      if (favoritesOnly && !d.favorite) return false;
      if (tagFilter.length && !tagFilter.every(t => d.tags?.includes(t))) return false;
      if (q) {
        const s = q.toLowerCase();
        return d.name.toLowerCase().includes(s)
            || (d.model || "").toLowerCase().includes(s)
            || d.mgmtIp.includes(s)
            || (d.vendor || "").toLowerCase().includes(s)
            || (d.os || "").toLowerCase().includes(s)
            || (d.tags || []).some(t => t.toLowerCase().includes(s));
      }
      return true;
    });
    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = (a[sortBy] || "").toString().toLowerCase();
      const vb = (b[sortBy] || "").toString().toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [all, q, siteFilter, kindFilter, vendorFilter, favoritesOnly, tagFilter, sortBy, sortDir]);

  const pagination = usePagination(devices, { key: "devices" });

  const siteOptions = useMemo(
    () => [...new Set(all.map(d => d.site).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(site => [site, site]),
    [all],
  );

  const counts = useMemo(() => ({
    total: all.length,
    sites: new Set(all.map(d => d.site).filter(Boolean)).size,
    warn: all.filter(d => d.status === "warn").length,
  }), [all]);

  // Helper: get vault item for a device
  const getVaultItem = useCallback((devId) => {
    const vid = vaultMap[devId];
    return vid ? vaultItems.find(v => v.id === vid) || null : null;
  }, [vaultMap, vaultItems]);

  // Save vault association
  async function handlePickVault(vaultItemId) {
    if (!vaultTarget) return;
    try {
      await window.HQ_API.request(`/api/devices/${vaultTarget.id}/vault`, { method: "PUT", body: { vaultItemId: vaultItemId || null } });
      setVaultMap(prev => {
        const next = { ...prev };
        if (vaultItemId) next[vaultTarget.id] = vaultItemId;
        else delete next[vaultTarget.id];
        return next;
      });
      window.dispatchEvent(new CustomEvent("toast", { detail: {
        msg: vaultItemId ? `Credential linked to ${vaultTarget.name}` : `Credential unlinked from ${vaultTarget.name}`,
        kind: "ok",
      }}));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Failed to save: " + e.message, kind: "err" } }));
    }
    setVaultTarget(null);
  }

  // Open SSH — use the real xterm.js workspace if available, else fall back to modal
  function handleSSH(dev) {
    const vaultItem = getVaultItem(dev.id);
    if (onOpenSSH) {
      onOpenSSH(dev, vaultItem);
    } else {
      setSshTarget(dev);
    }
  }
  function handleLinkVault(dev) {
    setVaultTarget(dev);
  }

  async function handleEditSave(updated) {
    // Update in customDevices list (for devices added via the UI)
    setCustomDevices(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d));
    // Also refresh selected panel if it was this device
    setSelected(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
    setEditTarget(null);
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Device "${updated.name}" updated`, kind: "ok" } }));
  }

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom: 16, gap:12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{dt("devices.title", "Devices")}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
            {dt("devices.summary", "{total} network devices · {sites} sites · {warn} with warnings", { total: counts.total, sites: counts.sites, warn: counts.warn })}
            {vaultLoaded && Object.keys(vaultMap).length > 0 && (
              <span> · <span style={{ color: "var(--ok)" }}>🔒 {Object.keys(vaultMap).length} with linked credentials</span></span>
            )}
          </p>
        </div>
        <button onClick={() => setShowNewDevice(true)} style={{
          display:"inline-flex", alignItems:"center", gap:6, height:34, padding:"0 14px",
          background:"var(--accent)", color:"white", border:"none", borderRadius:7,
          fontSize:13, fontWeight:600, fontFamily:"inherit", cursor:"pointer", flexShrink:0,
        }}>
          + {dt("devices.new", "New device")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "0 1 280px" }}>
          <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)" }}>⌕</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={dt("devices.search", "Search by name, IP, or model…")}
            style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "white", fontFamily: "inherit" }} />
        </div>
        {/* Las opciones salen de los equipos que hay, no de una lista fija:
            antes ofrecia dos sedes concretas aunque no existiera ningun equipo
            en ellas, y escondia cualquier otro sitio. Se calcula sobre la lista
            completa y no la filtrada, para que elegir uno no deje el
            desplegable con esa sola opcion. */}
        <FilterSelect label={dt("devices.site", "Site")} value={siteFilter}
          options={[["all", dt("devices.all", "All")], ...siteOptions]} onChange={setSiteFilter} />
        <FilterSelect label={dt("devices.type", "Type")} value={kindFilter} options={[["all",dt("devices.all", "All")], ...deviceTypeValues().map(v => [v.id, v.label])]} onChange={setKindFilter} />
        <FilterSelect label={dt("devices.vendor", "Vendor")} value={vendorFilter} options={[["all",dt("devices.all", "All")], ...vendors.map(v => [v, v])]} onChange={setVendorFilter} />
        <button onClick={() => setFavoritesOnly(f => !f)} style={{
          height: 32, padding: "0 10px", border: "1px solid var(--border)",
          background: favoritesOnly ? "color-mix(in srgb, #f59e0b 14%, white)" : "white",
          color: favoritesOnly ? "#a16207" : "var(--fg)", borderRadius: 6,
          fontSize: 12, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
        }}>★ {dt("devices.favorites", "Favorites")}</button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>
            {dt("devices.showing", "Showing {shown} of {total}", { shown: devices.length, total: counts.total })}
          </span>
          {/* Sort selector for Cards/Grid views */}
          {viewMode !== "table" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-fg)" }}>
              Sort:
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{ height: 32, padding: "0 24px 0 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "white", color: "var(--fg)", cursor: "pointer", appearance: "none",
                  backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}>
                <option value="name">{dt("devices.name", "Name")}</option>
                <option value="site">{dt("devices.site", "Site")}</option>
                <option value="kind">{dt("devices.type", "Type")}</option>
                <option value="vendor">{dt("devices.vendor", "Vendor")}</option>
                <option value="os">{dt("devices.os", "OS")}</option>
                <option value="mgmtIp">IP</option>
                <option value="status">{dt("devices.status", "Status")}</option>
              </select>
              <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                style={{ height: 32, width: 32, border: "1px solid var(--border)", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {sortDir === "asc" ? "↑" : "↓"}
              </button>
            </label>
          )}

          <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--muted)", borderRadius: 7 }}>
            {[["cards","▦","Cards"],["table","≡","Table"],["grid","⋮⋮","Grid"]].map(([mode, icon, label]) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                height: 26, padding: "0 9px", borderRadius: 5, fontSize: 12,
                fontFamily: "inherit", fontWeight: 500, cursor: "pointer",
                background: viewMode === mode ? "white" : "transparent",
                border: viewMode === mode ? "1px solid var(--border)" : "1px solid transparent",
                boxShadow: viewMode === mode ? "0 1px 1px rgba(0,0,0,.04)" : "none",
                color: viewMode === mode ? "var(--fg)" : "var(--muted-fg)",
              }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{icon}</span> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <TagFilter value={tagFilter} onChange={setTagFilter} items={window.APP_DATA.DEVICES} />
      </div>

      {viewMode === "table" && (
        <DeviceTable
          devices={pagination.pageItems}
          getVaultItem={getVaultItem}
          onSelect={setSelected}
          onToggleFav={toggleFav}
          onSSH={handleSSH}
          onEdit={setEditTarget}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      )}
      {viewMode === "grid" && (
        <DeviceGrid
          devices={pagination.pageItems}
          getVaultItem={getVaultItem}
          onSelect={setSelected}
          onToggleFav={toggleFav}
          onSSH={handleSSH}
          onEdit={setEditTarget}
        />
      )}
      {viewMode === "cards" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {pagination.pageItems.map(d => (
            <DeviceCard
              key={d.id}
              dev={d}
              vaultItem={getVaultItem(d.id)}
              onSelect={setSelected}
              onToggleFav={toggleFav}
              onSSH={handleSSH}
              onEdit={setEditTarget}
            />
          ))}
        </div>
      )}

      {devices.length > 0 && <PaginationBar {...pagination} />}

      {devices.length === 0 && (
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted-fg)", border: "1px dashed var(--border)", borderRadius: 8 }}>
          {counts.total === 0 ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{dt("devices.emptyTitle", "No devices yet")}</div>
              <div style={{ fontSize: 13, marginBottom: 20 }}>{dt("devices.firstDevice", "Add your first network device to start tracking it here.")}</div>
              <button onClick={() => setShowNewDevice(true)} style={{
                height:34, padding:"0 18px", background:"var(--accent)", color:"white", border:"none",
                borderRadius:7, fontSize:13, fontWeight:600, fontFamily:"inherit", cursor:"pointer",
              }}>+ Add your first device</button>
            </>
          ) : (
            "No devices match the current filters."
          )}
        </div>
      )}

      <DeviceDetail
        dev={selected}
        vaultItem={selected ? getVaultItem(selected.id) : null}
        vaultItems={vaultItems}
        onClose={() => setSelected(null)}
        onSSH={handleSSH}
        onLinkVault={handleLinkVault}
      />

      {sshTarget && (
        <SSHConsoleModal
          dev={sshTarget}
          vaultItem={getVaultItem(sshTarget.id)}
          onClose={() => setSshTarget(null)}
        />
      )}

      {vaultTarget && (
        <VaultPickerModal
          dev={vaultTarget}
          currentVaultItemId={vaultMap[vaultTarget.id] || null}
          vaultItems={vaultItems}
          onPick={handlePickVault}
          onClose={() => setVaultTarget(null)}
        />
      )}

      {editTarget && (
        <EditDeviceModal
          dev={editTarget}
          onSave={handleEditSave}
          onClose={() => setEditTarget(null)}
        />
      )}

      {showNewDevice && (
        <NewDeviceModal
          vaultItems={vaultItems}
          onSave={async (dev, vaultItemId) => {
            setCustomDevices(prev => [...prev, dev]);
            setShowNewDevice(false);
            if (vaultItemId) {
              try {
                await window.HQ_API.request(`/api/devices/${dev.id}/vault`, { method:"PUT", body:{ vaultItemId } });
                setVaultMap(prev => ({ ...prev, [dev.id]: vaultItemId }));
              } catch(e) {
                console.warn("[devices] vault link failed:", e.message);
              }
            }
            window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `Device "${dev.name}" created${vaultItemId ? " · credential linked 🔒" : ""}`, kind: "ok" } }));
          }}
          onClose={() => setShowNewDevice(false)}
        />
      )}
    </div>
  );
}

window.DevicesView = DevicesView;
