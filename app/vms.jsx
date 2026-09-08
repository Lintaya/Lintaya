// VMs module — vista del parque de VMware vCenter
const { useState, useMemo, useEffect, useRef, useCallback } = React;
const vt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

// ── Helpers ──────────────────────────────────────────────────────────────────
function StatusDot({ status, size = 8 }) {
  const colors = {
    online:  "var(--ok)",
    warn:    "var(--warn)",
    offline: "var(--err)",
    maint:   "var(--muted-fg)",
  };
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: 999,
      background: colors[status] || "var(--muted-fg)", flexShrink: 0,
      boxShadow: status === "online" ? `0 0 0 3px color-mix(in srgb, ${colors.online} 18%, transparent)` : "none",
    }} />
  );
}

function EnvBadge({ env }) {
  const map = {
    prod: { bg: "color-mix(in srgb, var(--err) 12%, white)",    fg: "var(--err)",    label: "PROD" },
    qa:   { bg: "color-mix(in srgb, var(--warn) 14%, white)",   fg: "#9a6f00",       label: "QA" },
    dev:  { bg: "color-mix(in srgb, var(--accent) 12%, white)", fg: "var(--accent)", label: "DEV" },
  };
  const s = map[env] || map.dev;
  return (
    <span style={{ display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:600,
      letterSpacing:0.4,padding:"2px 6px",borderRadius:4,
      background:s.bg,color:s.fg,fontFamily:"var(--font-mono)",
    }}>{s.label}</span>
  );
}

function Spinner({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
      strokeWidth="2.5" strokeLinecap="round"
      style={{ animation:"spin .75s linear infinite", flexShrink:0 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <path d="M12 2a10 10 0 0 1 10 10" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/>
    </svg>
  );
}

function copyToClipboard(text, label = "value") {
  navigator.clipboard?.writeText(text);
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `${label} copied`, kind: "ok" } }));
}

function vmAction(vm, action) {
  if (action === "copyip") { copyToClipboard(vm.ip, `IP ${vm.name}`); return; }
  const msgs = {
    rdp:     `Downloading RDP file for ${vm.ip}…`,
    web:     `Opening ${vm.webUrl}…`,
    vcenter: `Opening VM in ${vm.vcenterName}…`,
  };
  if (msgs[action]) window.dispatchEvent(new CustomEvent("toast", { detail: { msg: msgs[action], kind: "info" } }));
}

// ── load xterm.js from local server (no CDN needed) ──────────────────────────
let _xtermLoaded = false;
function loadXterm() {
  if (_xtermLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[href="/lib/xterm.css"]')) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = "/lib/xterm.css";
      document.head.appendChild(l);
    }
    const load = (src) => new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement("script"); s.src = src;
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    load("/lib/xterm.js")
      .then(() => load("/lib/addon-fit.js"))
      .then(() => { _xtermLoaded = true; resolve(); })
      .catch(reject);
  });
}

// ── SSH Session Tab (single terminal inside VMSSHManager) ────────────────────
function VMSSHTab({ session, active, wsRegistryRef, termRegistryRef, onStatusChange, reconnectRegistryRef }) {
  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const wsRef        = useRef(null);
  const fitAddonRef  = useRef(null);

  const { vm, vaultItem } = session;
  const vmIp = vm.ip && vm.ip !== "—" ? vm.ip : null;
  const user = vaultItem?.user || vm.sshUser || (vm.isWindows ? null : "root");

  const [status,     setStatus]     = useState("loading");
  const [errMsg,     setErrMsg]     = useState("");
  const [showPwBox,  setShowPwBox]  = useState(false);
  const [manualPw,   setManualPw]   = useState("");
  const [manualUser, setManualUser] = useState(user || "root");
  const [connecting, setConnecting] = useState(false);
  // Manual IP entry — used when vCenter didn't report an IP (VMware Tools not running, etc.)
  const [manualIp,  setManualIp]  = useState(vmIp || "");
  const [showIpBox, setShowIpBox] = useState(!vmIp);
  const serverSessionIdRef  = useRef(null); // server-side SSH pool session ID
  const lastCredSourceRef   = useRef(vaultItem?.id ? "vault" : "none"); // "vault" | "manual" | "none"
  // The effective IP: prefer what vCenter knows, fall back to what user typed
  const effectiveIp = useRef(vmIp);

  // Register WS + term refs in shared registries
  useEffect(() => {
    wsRegistryRef.current[session.id]   = wsRef;
    if (termRegistryRef) termRegistryRef.current[session.id] = termRef;
    return () => {
      delete wsRegistryRef.current[session.id];
      if (termRegistryRef) delete termRegistryRef.current[session.id];
    };
  }, [session.id]);

  // Let the tab strip trigger a reconnect on a closed/errored session without switching to it
  useEffect(() => {
    if (!reconnectRegistryRef) return;
    reconnectRegistryRef.current[session.id] = () => openSession(null);
    return () => { delete reconnectRegistryRef.current[session.id]; };
  }); // no deps — always re-registers the latest openSession closure

  // Re-fit terminal when this tab becomes the active one
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
        // Force xterm to repaint all rows — fixes blank terminal after tab switch
        const term = termRef.current;
        if (term) term.refresh(0, term.rows - 1);
      } catch {}
      const ws = wsRef.current, term = termRef.current;
      if (ws?.readyState === WebSocket.OPEN && term)
        ws.send(JSON.stringify({ type:"resize", cols:term.cols, rows:term.rows }));
    }, 60);
    return () => clearTimeout(t);
  }, [active]);

  // Open (or reattach to) a server-side SSH session, then connect WebSocket
  // usernameOverride: typed in auth-fail dialog; ipOverride: typed in no-IP dialog
  async function openSession(passwordOverride, ipOverride, usernameOverride) {
    const ip       = ipOverride       || effectiveIp.current;
    const username = usernameOverride || user || "root";
    if (!ip) return;
    const term = termRef.current;
    setStatus("connecting"); setErrMsg(""); setShowPwBox(false); setConnecting(false);
    onStatusChange(session.id, "connecting");

    // Use actual terminal size so the pty starts at the right cols/rows
    const cols = termRef.current?.cols || 120;
    const rows = termRef.current?.rows || 30;

    // Track what credential source we'll use for the hint in auth-fail dialog
    if (passwordOverride) lastCredSourceRef.current = "manual";
    else if (vaultItem?.id) lastCredSourceRef.current = "vault";
    else lastCredSourceRef.current = "none";

    let serverSessionId;
    try {
      const body = {
        ip, username, port: vm.sshPort || 22,
        cols, rows,
        ...(vaultItem?.id && !passwordOverride ? { vaultItemId: vaultItem.id } : {}),
        ...(passwordOverride ? { password: passwordOverride } : {}),
        ...(vm.execCommand ? { execCommand: vm.execCommand, vmId: vm.vmId || vm.id } : {}),
        ...(vm.jump && vm.jump.host ? { jump: vm.jump } : {}),
      };
      const data = await window.HQ_API.request("/api/ssh/session", { method:"POST", body });
      serverSessionId = data.sessionId;
      serverSessionIdRef.current = serverSessionId;
      if (data.reattach && term)
        term.writeln("\x1b[90m# Reattaching to existing session for " + username + "@" + ip + "…\x1b[0m");
      else if (term)
        term.writeln("\x1b[90m# Connecting to " + username + "@" + ip + "…\x1b[0m");
    } catch (err) {
      if (err.payload?.error === "vault-locked") {
        setStatus("error");
        setErrMsg("🔒 Vault is locked — go to the Passwords tab and unlock it, then click Retry.");
      } else {
        setStatus("error"); setErrMsg("Could not create SSH session: " + err.message);
      }
      onStatusChange(session.id, "error");
      return;
    }

    const token  = window.HQ_API.getToken();
    const params = new URLSearchParams({ token, sessionId: serverSessionId });
    const ws = new WebSocket(`ws://${location.host}/api/ssh/terminal?${params}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "status" && msg.msg === "connected") {
        setStatus("connected"); setShowPwBox(false);
        onStatusChange(session.id, "connected");
      } else if (msg.type === "status" && msg.msg === "closed") {
        setStatus("closed"); onStatusChange(session.id, "closed");
        if (term) term.writeln("\r\n\x1b[90m── session ended ──\x1b[0m");
      } else if (msg.type === "data") {
        if (term) term.write(Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)));
      } else if (msg.type === "error") {
        const isAuthFail = msg.msg.toLowerCase().includes("authentication");
        const ns = isAuthFail ? "authfail" : "error";
        setStatus(ns); setErrMsg(msg.msg); onStatusChange(session.id, ns);
        if (isAuthFail) setShowPwBox(true);
        else if (term) term.writeln("\r\n\x1b[31m✕ " + msg.msg + "\x1b[0m");
      }
    };
    ws.onclose = () => {
      setStatus(s => {
        if (s === "connected") { onStatusChange(session.id, "closed"); return "closed"; }
        return s;
      });
    };
    ws.onerror = () => { setStatus("error"); setErrMsg("WebSocket connection failed."); onStatusChange(session.id, "error"); };
    if (term) {
      term.onData(data => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type:"data", data: btoa(String.fromCharCode(...new TextEncoder().encode(data))) }));
      });
    }
  }

  // Boot xterm.js and attempt connection — if IP is already known, connect immediately
  function bootTerminal(ip) {
    effectiveIp.current = ip;
    let resizeObs, cleanup = false;
    loadXterm().then(() => {
      if (cleanup || !containerRef.current) return;
      const term = new window.Terminal({
        cursorBlink: true, scrollback: 2000,
        fontFamily: "Menlo, Consolas, 'Courier New', monospace", fontSize: 13,
        theme: { background:"#0f172a", foreground:"#e2e8f0", cursor:"#4ade80", selectionBackground:"rgba(74,222,128,.25)" },
      });
      const fitAddon = new window.FitAddon.FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon); term.open(containerRef.current); fitAddon.fit();
      termRef.current = term;

      // ── Paste support: Ctrl+V / Cmd+V → send to SSH session ──
      term.attachCustomKeyEventHandler((e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "v" && e.type === "keydown") {
          navigator.clipboard.readText().then((text) => {
            if (!text) return;
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type:"data", data: btoa(String.fromCharCode(...new TextEncoder().encode(text))) }));
          }).catch(() => {});
          return false; // prevent browser default
        }
        return true;
      });
      // Also handle right-click / middle-click paste on the terminal element
      term.element?.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text");
        if (!text) return;
        e.preventDefault();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type:"data", data: btoa(String.fromCharCode(...new TextEncoder().encode(text))) }));
      });

      openSession(null, ip);
      resizeObs = new ResizeObserver(() => {
        try { fitAddonRef.current?.fit(); } catch {}
        const ws = wsRef.current, t = termRef.current;
        if (ws?.readyState === WebSocket.OPEN && t)
          ws.send(JSON.stringify({ type:"resize", cols:t.cols, rows:t.rows }));
      });
      resizeObs.observe(containerRef.current);
    }).catch(err => { setStatus("error"); setErrMsg("Failed to load terminal: " + err.message); onStatusChange(session.id, "error"); });
    return () => { cleanup = true; wsRef.current?.close(); termRef.current?.dispose(); resizeObs?.disconnect(); };
  }

  useEffect(() => {
    if (vmIp) return bootTerminal(vmIp);
    // No IP from vCenter — wait for user to provide one (showIpBox is already true)
    onStatusChange(session.id, "idle");
    setStatus("idle");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
      visibility: active ? "visible" : "hidden", pointerEvents: active ? "auto" : "none" }}>
      {/* Terminal canvas — hidden while overlays are up */}
      <div ref={containerRef}
        style={{ flex:1, overflow:"hidden", padding:"4px 2px", background:"#0f172a",
          ...(showPwBox || showIpBox || (status==="error" && !showPwBox) ? { visibility:"hidden" } : {}) }} />

      {/* ── No-IP overlay: ask user for an IP / hostname ── */}
      {showIpBox && (
        <div style={{ position:"absolute",inset:0,background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div style={{ width:360,background:"#1e293b",borderRadius:8,padding:24,border:"1px solid #334155",boxShadow:"0 8px 32px rgba(0,0,0,.5)" }}>
            <div style={{ fontFamily:"var(--font-mono)",color:"#facc15",fontSize:12,marginBottom:6 }}>⚠ No IP address found</div>
            <div style={{ fontFamily:"var(--font-mono)",color:"#94a3b8",fontSize:12,marginBottom:14,lineHeight:1.5 }}>
              {vm.name} — vCenter didn't report an IP (VMware Tools may not be running).<br/>
              Enter the IP or hostname to connect anyway:
            </div>
            <input
              type="text" value={manualIp} onChange={e => setManualIp(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter" && manualIp.trim()) {
                  setShowIpBox(false);
                  bootTerminal(manualIp.trim());
                }
              }}
              placeholder="e.g. 10.0.1.50 or hostname"
              style={{ width:"100%",height:34,padding:"0 10px",background:"#0f172a",border:"1px solid #475569",
                borderRadius:5,color:"#e2e8f0",fontFamily:"var(--font-mono)",fontSize:13,boxSizing:"border-box",outline:"none" }}
            />
            <div style={{ display:"flex",gap:8,marginTop:12 }}>
              <button
                onClick={() => {
                  const trimmed = manualIp.trim();
                  if (!trimmed) return;
                  setShowIpBox(false);
                  bootTerminal(trimmed);
                }}
                disabled={!manualIp.trim()}
                style={{ flex:1,height:32,background:"#2563eb",border:"none",borderRadius:5,color:"white",
                  cursor:manualIp.trim()?"pointer":"default",fontFamily:"inherit",fontSize:12,opacity:manualIp.trim()?1:0.5 }}>
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Closed banner */}
      {status === "closed" && (
        <div style={{ position:"absolute",bottom:0,left:0,right:0,background:"rgba(15,23,42,.92)",
          borderTop:"1px solid #334155",padding:"5px 12px",display:"flex",alignItems:"center",gap:8,zIndex:5 }}>
          <span style={{ fontFamily:"var(--font-mono)",color:"#64748b",fontSize:11 }}>○ session ended</span>
          <button onClick={() => openSession(null)}
            style={{ height:22,padding:"0 10px",background:"#334155",border:"1px solid #475569",
              borderRadius:4,color:"#e2e8f0",cursor:"pointer",fontFamily:"inherit",fontSize:11 }}>↺ Reconnect</button>
        </div>
      )}

      {/* Auth-fail overlay */}
      {showPwBox && (
        <div style={{ position:"absolute",inset:0,background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div style={{ width:360,background:"#1e293b",borderRadius:8,padding:22,border:"1px solid #334155",boxShadow:"0 8px 32px rgba(0,0,0,.5)" }}>
            {/* Header */}
            <div style={{ fontFamily:"var(--font-mono)",color:"#f87171",fontSize:12,marginBottom:4 }}>✕ Authentication failed</div>
            <div style={{ fontFamily:"var(--font-mono)",color:"#475569",fontSize:11,marginBottom:14 }}>
              {lastCredSourceRef.current === "vault"
                ? `Vault credential tried and rejected by ${effectiveIp.current}`
                : lastCredSourceRef.current === "manual"
                  ? `Manual password rejected by ${effectiveIp.current}`
                  : `No credential available — server at ${effectiveIp.current} requires a password`}
            </div>

            {/* Username */}
            <div style={{ fontFamily:"var(--font-mono)",color:"#64748b",fontSize:11,marginBottom:4 }}>{vt("vms.username", "Username")}</div>
            <input
              type="text" value={manualUser} onChange={e => setManualUser(e.target.value)}
              onKeyDown={e => { if (e.key === "Tab") { e.preventDefault(); document.getElementById("ssh-pw-input")?.focus(); } }}
              style={{ width:"100%",height:32,padding:"0 10px",background:"#0f172a",border:"1px solid #475569",
                borderRadius:5,color:"#e2e8f0",fontFamily:"var(--font-mono)",fontSize:13,boxSizing:"border-box",outline:"none",marginBottom:10 }}
            />

            {/* Password */}
            <div style={{ fontFamily:"var(--font-mono)",color:"#64748b",fontSize:11,marginBottom:4 }}>{vt("vms.password", "Password")}</div>
            <input
              id="ssh-pw-input"
              type="password" value={manualPw} onChange={e => setManualPw(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key==="Enter" && manualPw && manualUser) openSession(manualPw, null, manualUser); }}
              placeholder="Password…"
              style={{ width:"100%",height:32,padding:"0 10px",background:"#0f172a",border:"1px solid #475569",
                borderRadius:5,color:"#e2e8f0",fontFamily:"var(--font-mono)",fontSize:13,boxSizing:"border-box",outline:"none" }} />

            <div style={{ display:"flex",gap:8,marginTop:14 }}>
              <button
                onClick={() => { if (manualPw && manualUser && !connecting) openSession(manualPw, null, manualUser); }}
                disabled={!manualPw || !manualUser || connecting}
                style={{ flex:1,height:32,background:"#2563eb",border:"none",borderRadius:5,color:"white",
                  cursor:manualPw&&manualUser&&!connecting?"pointer":"default",fontFamily:"inherit",fontSize:12,
                  opacity:!manualPw||!manualUser||connecting?0.5:1 }}>
                {connecting ? "Connecting…" : "Connect"}
              </button>
              <button onClick={() => { setShowPwBox(false); setStatus("closed"); onStatusChange(session.id,"closed"); }}
                style={{ height:32,padding:"0 14px",background:"#334155",border:"1px solid #475569",borderRadius:5,color:"#e2e8f0",cursor:"pointer",fontFamily:"inherit",fontSize:12 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && !showPwBox && (
        <div style={{ position:"absolute",inset:0,background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div style={{ textAlign:"center",color:"#f87171",fontFamily:"var(--font-mono)",fontSize:13 }}>
            <div style={{ fontSize:24,marginBottom:8 }}>✕</div>
            <div style={{ maxWidth:300,lineHeight:1.5 }}>{errMsg}</div>
            <div style={{ display:"flex",gap:8,justifyContent:"center",marginTop:16 }}>
              <button onClick={() => openSession(null)}
                style={{ padding:"6px 16px",background:"#334155",border:"1px solid #475569",borderRadius:5,color:"#e2e8f0",cursor:"pointer",fontFamily:"inherit",fontSize:12 }}>↺ Retry</button>
              <button onClick={() => { setStatus("idle"); setShowIpBox(true); setManualIp(effectiveIp.current || ""); }}
                style={{ padding:"6px 16px",background:"#1e293b",border:"1px solid #475569",borderRadius:5,color:"#94a3b8",cursor:"pointer",fontFamily:"inherit",fontSize:12 }}>✎ Change IP</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VMSSHManager — draggable multi-tab SSH + broadcast mode ───────────────────
function VMSSHManager({ sessions, onClose, onRemoveSession }) {
  const [activeId,     setActiveId]     = useState(sessions[0]?.id);
  const [tabStatuses,  setTabStatuses]  = useState({});
  const [broadcast,    setBroadcast]    = useState(false);
  const [broadcastCmd, setBroadcastCmd] = useState("");
  const [pos,  setPos]  = useState(() => ({
    x: Math.max(20, Math.round((window.innerWidth  - 1100) / 2)),
    y: Math.max(20, Math.round((window.innerHeight -  600) / 2)),
  }));
  const [size, setSize] = useState({ w:1100, h:600 });
  const draggingRef    = useRef(false);
  const dragStartRef   = useRef({});
  const resizingRef    = useRef(false);
  const resizeStartRef = useRef({});
  const wsRegistryRef  = useRef({});  // { sessionId → wsRef }

  // Auto-switch to newest tab when sessions array grows
  const prevLen = useRef(sessions.length);
  useEffect(() => {
    if (sessions.length > prevLen.current) setActiveId(sessions[sessions.length - 1].id);
    prevLen.current = sessions.length;
  }, [sessions]);

  // Recover if active tab was removed
  useEffect(() => {
    if (!sessions.find(s => s.id === activeId) && sessions.length > 0)
      setActiveId(sessions[sessions.length - 1].id);
  }, [sessions, activeId]);

  // Global drag + resize mouse handlers
  useEffect(() => {
    const onMove = (e) => {
      if (draggingRef.current) {
        const { mouseX, mouseY, posX, posY } = dragStartRef.current;
        setPos({
          x: Math.max(0, Math.min(window.innerWidth  - 200, posX + e.clientX - mouseX)),
          y: Math.max(0, Math.min(window.innerHeight -  80, posY + e.clientY - mouseY)),
        });
      }
      if (resizingRef.current) {
        const { mouseX, mouseY, sizeW, sizeH } = resizeStartRef.current;
        setSize({ w: Math.max(600, sizeW + e.clientX - mouseX), h: Math.max(360, sizeH + e.clientY - mouseY) });
      }
    };
    const onUp = () => { draggingRef.current = false; resizingRef.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  function onTitleBarDown(e) {
    if (e.target.closest("button,input")) return;
    draggingRef.current = true;
    dragStartRef.current = { mouseX:e.clientX, mouseY:e.clientY, posX:pos.x, posY:pos.y };
    e.preventDefault();
  }
  function onResizeDown(e) {
    resizingRef.current = true;
    resizeStartRef.current = { mouseX:e.clientX, mouseY:e.clientY, sizeW:size.w, sizeH:size.h };
    e.preventDefault(); e.stopPropagation();
  }

  function sendBroadcast() {
    if (!broadcastCmd.trim()) return;
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(broadcastCmd + "\n")));
    Object.values(wsRegistryRef.current).forEach(wsRef => {
      if (wsRef?.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type:"data", data:encoded }));
    });
    setBroadcastCmd("");
  }

  const SC = { loading:"#94a3b8", connecting:"#f59e0b", connected:"#4ade80", error:"#f87171", authfail:"#f87171", closed:"#64748b" };
  const SD = { loading:"⏳", connecting:"◌", connected:"●", error:"✕", authfail:"✕", closed:"○" };

  return (
    <div style={{
      position:"fixed", left:pos.x, top:pos.y, width:size.w, height:size.h, zIndex:300,
      background:"#0f172a", borderRadius:10, overflow:"hidden",
      display:"flex", flexDirection:"column",
      boxShadow:"0 24px 64px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.08)",
      minWidth:600, minHeight:360,
    }}>
      {/* ── Title bar (drag handle) ── */}
      <div onMouseDown={onTitleBarDown}
        style={{ background:"#1e293b", height:40, padding:"0 10px",
          display:"flex", alignItems:"center", gap:6,
          borderBottom:"1px solid #334155", flexShrink:0,
          cursor:"grab", userSelect:"none", WebkitUserSelect:"none" }}>
        {/* Traffic lights */}
        <div style={{ display:"flex", gap:5, marginRight:4, flexShrink:0 }}>
          <span onClick={onClose} title="Close all"
            style={{ width:12,height:12,borderRadius:999,background:"#ef4444",display:"block",cursor:"pointer" }} />
          <span style={{ width:12,height:12,borderRadius:999,background:"#f59e0b",display:"block" }} />
          <span style={{ width:12,height:12,borderRadius:999,background:"#22c55e",display:"block" }} />
        </div>

        {/* Tab strip */}
        <div style={{ display:"flex", gap:2, overflow:"hidden", flex:1, alignItems:"center", minWidth:0 }}>
          {sessions.map(s => {
            const st  = tabStatuses[s.id] || "loading";
            const act = s.id === activeId;
            return (
              <div key={s.id} onClick={() => setActiveId(s.id)}
                style={{ display:"flex", alignItems:"center", gap:4, padding:"0 6px 0 8px", height:26,
                  borderRadius:4, cursor:"pointer", flexShrink:0, maxWidth:200,
                  background: act ? "#0f172a" : "transparent",
                  border: act ? "1px solid #334155" : "1px solid transparent" }}>
                <span style={{ color:SC[st]||"#94a3b8", fontSize:7, flexShrink:0 }}>{SD[st]||"○"}</span>
                <span style={{ fontFamily:"var(--font-mono)", fontSize:11,
                  color: act ? "#e2e8f0" : "#94a3b8",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:140 }}>
                  {s.vm.name}
                </span>
                <button onClick={e => { e.stopPropagation(); onRemoveSession(s.id); }}
                  style={{ background:"none",border:0,cursor:"pointer",color:"#64748b",fontSize:13,lineHeight:1,padding:0,marginLeft:2,flexShrink:0 }}>×</button>
              </div>
            );
          })}
        </div>

        {/* Right controls */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          <button onClick={() => setBroadcast(b => !b)} title="Send same command to all open sessions"
            style={{ height:24, padding:"0 8px", borderRadius:4, cursor:"pointer", fontFamily:"inherit", fontSize:11,
              display:"flex", alignItems:"center", gap:3,
              border: broadcast ? "1px solid #f59e0b" : "1px solid #334155",
              background: broadcast ? "rgba(245,158,11,.15)" : "transparent",
              color: broadcast ? "#f59e0b" : "#64748b" }}>
            <span style={{ fontSize:10 }}>⊹</span>{broadcast ? "Broadcast ON" : "Broadcast"}
          </button>
          <button onClick={onClose}
            style={{ background:"none",border:0,cursor:"pointer",color:"#64748b",fontSize:18,lineHeight:1,padding:"0 2px" }}>×</button>
        </div>
      </div>

      {/* ── Terminal panels ── */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        {sessions.map(s => (
          <VMSSHTab key={s.id} session={s} active={s.id === activeId}
            wsRegistryRef={wsRegistryRef} termRegistryRef={termRegistryRef}
            onStatusChange={(id, st) => setTabStatuses(p => ({ ...p, [id]:st }))} />
        ))}
        {sessions.length === 0 && (
          <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100%",
            color:"#475569",fontFamily:"var(--font-mono)",fontSize:13 }}>{vt("vms.noSessions", "No active sessions.")}</div>
        )}
      </div>

      {/* ── Broadcast bar ── */}
      {broadcast && (
        <div style={{ borderTop:"1px solid #334155", background:"#1e293b", padding:"6px 10px",
          display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
          <span style={{ fontSize:10,fontWeight:700,color:"#f59e0b",fontFamily:"var(--font-mono)",flexShrink:0,letterSpacing:.5 }}>
            ⊹ BROADCAST
          </span>
          <input value={broadcastCmd} onChange={e => setBroadcastCmd(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendBroadcast(); }}
            placeholder="Command → all sessions (Enter to send)…"
            style={{ flex:1,height:28,padding:"0 10px",background:"#0f172a",border:"1px solid #334155",
              borderRadius:4,color:"#e2e8f0",fontFamily:"var(--font-mono)",fontSize:12,
              outline:"none",boxSizing:"border-box" }} />
          <button onClick={sendBroadcast}
            style={{ height:28,padding:"0 12px",background:"rgba(245,158,11,.15)",border:"1px solid #f59e0b",
              borderRadius:4,color:"#f59e0b",cursor:"pointer",fontFamily:"inherit",fontSize:12,flexShrink:0 }}>
            Send ↵
          </button>
          <span style={{ fontSize:10,color:"#475569",fontFamily:"var(--font-mono)",flexShrink:0 }}>
            → {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* ── Resize handle (bottom-right corner) ── */}
      <div onMouseDown={onResizeDown}
        style={{ position:"absolute",right:0,bottom:0,width:16,height:16,cursor:"nwse-resize",zIndex:10,
          background:"linear-gradient(135deg, transparent 40%, #475569 40%, #475569 60%, transparent 60%)" }} />
    </div>
  );
}

// ── VM Vault Picker Modal ─────────────────────────────────────────────────────
function VMVaultPickerModal({ vm, currentVaultItemId, vaultItems, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const inputRef = React.useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // By default only show conn-ssh tagged credentials; showAll overrides
  const sshItems = useMemo(() => vaultItems.filter(v => v.tags?.includes("conn-ssh")), [vaultItems]);
  const baseItems = showAll ? vaultItems : (sshItems.length > 0 ? sshItems : vaultItems);

  const filtered = useMemo(() => {
    if (!q) return baseItems;
    const s = q.toLowerCase();
    return baseItems.filter(v =>
      v.service.toLowerCase().includes(s) ||
      (v.user || "").toLowerCase().includes(s) ||
      (v.url || "").toLowerCase().includes(s)
    );
  }, [baseItems, q]);

  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:210,
      display:"flex",alignItems:"center",justifyContent:"center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:440,maxHeight:500,background:"white",borderRadius:10,
        boxShadow:"0 16px 48px rgba(0,0,0,.22)",display:"flex",flexDirection:"column",overflow:"hidden",
      }}>
        <div style={{ padding:"12px 14px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8 }}>
          <span style={{ fontSize:14,fontWeight:600 }}>{vt("vms.linkCredential", "Link vault credential")}</span>
          <span style={{ fontSize:11.5,color:"var(--muted-fg)",flex:1 }}>for {vm.name}</span>
          <button onClick={onClose} style={{ background:"none",border:0,cursor:"pointer",color:"var(--muted-fg)",fontSize:18,lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:"8px 12px",borderBottom:"1px solid var(--border)",display:"flex",gap:8,alignItems:"center" }}>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search credentials…"
            style={{ flex:1,height:32,padding:"0 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,fontFamily:"inherit",boxSizing:"border-box" }} />
          {sshItems.length > 0 && (
            <button onClick={() => setShowAll(a => !a)}
              style={{ height:32,padding:"0 10px",border:"1px solid var(--border)",borderRadius:6,
                fontSize:11,fontFamily:"inherit",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
                background: showAll ? "var(--accent)" : "var(--muted)",
                color: showAll ? "white" : "var(--muted-fg)" }}>
              {showAll ? "SSH only" : `Show all (${vaultItems.length})`}
            </button>
          )}
        </div>
        <div style={{ overflow:"auto",flex:1 }}>
          {currentVaultItemId && (
            <div onClick={() => onPick(null)} style={{ padding:"8px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid var(--border)",background:"var(--muted)" }}>
              <span style={{ fontSize:12,color:"var(--err)" }}>✕ Remove credential link</span>
            </div>
          )}
          {filtered.length === 0 && <div style={{ padding:24,textAlign:"center",color:"var(--muted-fg)",fontSize:13 }}>{vt("vms.noCredentials", "No credentials found")}</div>}
          {filtered.map(item => (
            <div key={item.id} onClick={() => onPick(item.id)} style={{
              padding:"9px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,
              borderBottom:"1px solid var(--border)",
              background:item.id===currentVaultItemId?"color-mix(in srgb, var(--accent) 8%, white)":"white",
            }}
            onMouseEnter={e => { if (item.id!==currentVaultItemId) e.currentTarget.style.background="var(--muted)"; }}
            onMouseLeave={e => { e.currentTarget.style.background=item.id===currentVaultItemId?"color-mix(in srgb, var(--accent) 8%, white)":"white"; }}>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontWeight:500,fontSize:13,display:"flex",alignItems:"center",gap:6 }}>
                  {item.service}
                  {item.id===currentVaultItemId && <span style={{ fontSize:10,background:"var(--accent)",color:"white",borderRadius:3,padding:"1px 5px" }}>{vt("vms.linked", "linked")}</span>}
                </div>
                <div style={{ fontSize:11,color:item.user?"var(--muted-fg)":"var(--warn)",fontFamily:"var(--font-mono)",marginTop:1 }}>
                  {item.user || "(no username)"}
                  {item.url ? ` · ${item.url}` : ""}
                </div>
              </div>
              {item.tags?.length > 0 && (
                <div style={{ display:"flex",gap:3 }}>
                  {item.tags.slice(0,2).map(t => <span key={t} style={{ fontSize:9.5,background:"var(--muted)",color:"var(--muted-fg)",borderRadius:3,padding:"1px 5px",fontWeight:500 }}>{t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Source banner ─────────────────────────────────────────────────────────────
function SourceBanner({ meta, source, onSwitch, onRefresh, refreshing }) {
  if (source !== "live" || !meta?.length) return null;
  const latest = meta.reduce((a, b) => (!a || b.syncedAt > a.syncedAt ? b : a), null);
  const syncedAgo = latest?.syncedAt
    ? (() => {
        const diff = Date.now() - new Date(latest.syncedAt).getTime();
        if (diff < 60000) return `${Math.round(diff/1000)}s ago`;
        if (diff < 3600000) return `${Math.round(diff/60000)} min ago`;
        return new Date(latest.syncedAt).toLocaleTimeString();
      })()
    : "—";

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:8, padding:"6px 12px",
      background:"color-mix(in srgb, var(--ok) 8%, white)",
      border:"1px solid color-mix(in srgb, var(--ok) 20%, var(--border))",
      borderRadius:7, fontSize:12, marginBottom:12, flexWrap:"wrap",
    }}>
      <span style={{ width:7,height:7,borderRadius:999,background:"var(--ok)",flexShrink:0 }} />
      <span style={{ fontWeight:600, color:"var(--ok)" }}>{vt("vms.liveData", "Live data")}</span>
      <span style={{ color:"var(--muted-fg)" }}>·</span>
      {meta.map(m => (
        <span key={m.id} style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--fg)" }}>
          {m.name}: <b>{m.vmCount ?? m.hostCount}</b>
        </span>
      ))}
      <span style={{ color:"var(--muted-fg)" }}>· synced {syncedAgo}</span>
      <button onClick={onRefresh} disabled={refreshing}
        style={{ height:22,padding:"0 8px",border:"1px solid var(--border)",background:"white",
          borderRadius:4,fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,marginLeft:4 }}>
        {refreshing ? <Spinner size={10} /> : "↻"} Refresh
      </button>
      <button onClick={onSwitch}
        style={{ marginLeft:"auto",height:22,padding:"0 8px",border:"1px solid var(--border)",
          background:"white",borderRadius:4,fontSize:11,cursor:"pointer",color:"var(--muted-fg)" }}>
        {vt("vms.offlineMode", "Offline mode")}
      </button>
    </div>
  );
}

// ── Resource display ──────────────────────────────────────────────────────────
function CapacityBar({ value, label, danger = 80 }) {
  if (!value) return null;
  const color = value >= danger ? "var(--err)" : value >= 60 ? "var(--warn)" : "var(--ok)";
  return (
    <div style={{ display:"flex",alignItems:"center",gap:6,fontSize:11,fontFamily:"var(--font-mono)" }}>
      <span style={{ color:"var(--muted-fg)",width:24 }}>{label}</span>
      <div style={{ flex:1,height:4,background:"var(--muted)",borderRadius:2,overflow:"hidden" }}>
        <div style={{ width:`${value}%`,height:"100%",background:color }} />
      </div>
      <span style={{ width:28,textAlign:"right",color:"var(--fg)" }}>{value}%</span>
    </div>
  );
}

function UsageBar({ pct, label, warn = 70, crit = 90 }) {
  const color = pct >= crit ? "var(--err)" : pct >= warn ? "var(--warn)" : "var(--ok)";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, minWidth:0 }}>
      <span style={{ fontSize:10, color:"var(--muted-fg)", width:26, flexShrink:0, fontFamily:"var(--font-mono)" }}>{label}</span>
      <div style={{ flex:1, height:5, borderRadius:3, background:"var(--muted)", overflow:"hidden", minWidth:40 }}>
        <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3, transition:"width .4s" }} />
      </div>
      <span style={{ fontSize:10, fontFamily:"var(--font-mono)", width:30, textAlign:"right", flexShrink:0,
        color: pct >= crit ? "var(--err)" : pct >= warn ? "var(--warn)" : "var(--fg)",
        fontWeight: pct >= warn ? 600 : 400 }}>
        {pct}%
      </span>
    </div>
  );
}

// ── Tag helpers ───────────────────────────────────────────────────────────────
// Stable color per category name
function tagColor(categoryName) {
  const palette = [
    ["#2563eb","#eff6ff"],  // blue
    ["#0891b2","#ecfeff"],  // cyan
    ["#059669","#d1fae5"],  // green
    ["#7c3aed","#ede9fe"],  // purple
    ["#d97706","#fef3c7"],  // amber
    ["#dc2626","#fee2e2"],  // red
    ["#db2777","#fce7f3"],  // pink
    ["#0d9488","#ccfbf1"],  // teal
  ];
  if (!categoryName) return palette[0];
  let h = 0;
  for (let i = 0; i < categoryName.length; i++) h = (h * 31 + categoryName.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function TagChip({ tag, small = false }) {
  const [fg, bg] = tagColor(tag.categoryName);
  return (
    <span
      title={tag.categoryName ? `${tag.categoryName}: ${tag.tagName}` : tag.tagName}
      style={{
        display:"inline-block", fontSize: small ? 9.5 : 10.5, fontWeight:500,
        padding: small ? "1px 5px" : "2px 7px", borderRadius:10,
        background:bg, color:fg, whiteSpace:"nowrap",
        maxWidth:110, overflow:"hidden", textOverflow:"ellipsis",
        lineHeight:"1.4",
      }}>
      {tag.tagName}
    </span>
  );
}

function ResourceSummary({ vm }) {
  const hasPct = vm.cpuPct != null || vm.memPct != null;
  // Live vCenter data with real usage percentages
  if (hasPct) {
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:3, minWidth:100 }}>
        {vm.cpuPct != null
          ? <UsageBar pct={vm.cpuPct} label="CPU" />
          : <div style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--muted-fg)" }}>
              <b style={{ color:"var(--fg)" }}>{vm.cpuCount}</b> vCPU
            </div>}
        {vm.memPct != null
          ? <UsageBar pct={vm.memPct} label="RAM" warn={80} crit={92} />
          : <div style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--muted-fg)" }}>
              <b style={{ color:"var(--fg)" }}>{vm.memGB}</b> GB
            </div>}
      </div>
    );
  }
  // Static config only (no usage data yet)
  if (vm.cpuCount > 0 && vm.cpu === 0) {
    return (
      <div style={{ fontSize:11,fontFamily:"var(--font-mono)",color:"var(--muted-fg)",lineHeight:1.6 }}>
        <div><b style={{ color:"var(--fg)" }}>{vm.cpuCount}</b> vCPU</div>
        <div><b style={{ color:"var(--fg)" }}>{vm.memGB}</b> GB RAM</div>
      </div>
    );
  }
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:2 }}>
      <CapacityBar value={vm.cpu}  label="CPU" />
      <CapacityBar value={vm.ram}  label="RAM" />
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────
function VMRowActions({ vm, compact = false, onSSH, hasVaultCred = false }) {
  const btn = {
    display:"inline-flex",alignItems:"center",justifyContent:"center",
    gap:4,height:compact?24:28,padding:compact?"0 7px":"0 9px",
    border:"1px solid var(--border)",background:"white",
    borderRadius:5,fontSize:11.5,fontWeight:500,color:"var(--fg)",cursor:"pointer",fontFamily:"inherit",
  };
  const sshBtn = {
    ...btn,
    background: hasVaultCred ? "#0f172a" : "white",
    color: hasVaultCred ? "#e2e8f0" : "var(--fg)",
    borderColor: hasVaultCred ? "#334155" : "var(--border)",
  };
  return (
    <div style={{ display:"inline-flex",gap:4,alignItems:"center" }}>
      {vm.isWindows ? (
        <button style={btn} onClick={() => vmAction(vm,"rdp")} title="Open RDP"><span style={{ fontSize:10 }}>▶</span> RDP</button>
      ) : (
        <button style={sshBtn} onClick={() => onSSH ? onSSH(vm) : vmAction(vm,"ssh")} title={`ssh ${vm.sshUser||"root"}@${vm.ip}`}><span style={{ fontSize:10 }}>›_</span> SSH</button>
      )}
      {vm.hasWeb && <button style={btn} onClick={() => vmAction(vm,"web")}><span style={{ fontSize:10 }}>↗</span> Web</button>}
      <button style={{ ...btn,padding:"0 7px" }} onClick={() => vmAction(vm,"copyip")} title="Copy IP">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────
function VMTable({ vms, onSelect, onToggleFav, isLive, sortBy, sortDir, onSort, onSSH, getVaultItem }) {
  const SortTh = ({ col, label, width, mono, align }) => {
    const active = sortBy === col;
    return (
      <th onClick={() => onSort(col)}
        style={{ ...thCell(width, mono ? "var(--font-mono)" : undefined, align),
          cursor:"pointer", userSelect:"none",
          color: active ? "var(--accent)" : "var(--muted-fg)",
          whiteSpace:"nowrap" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
          {label}
          <span style={{ fontSize:8, opacity: active ? 1 : 0.4, color: active ? "var(--accent)" : "currentColor" }}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        </span>
      </th>
    );
  };
  return (
    <div style={{ border:"1px solid var(--border)",borderRadius:8,background:"white",overflow:"hidden" }}>
      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12.5 }}>
        <thead>
          <tr style={{ background:"var(--muted)",color:"var(--muted-fg)",fontSize:10.5,letterSpacing:0.5,textTransform:"uppercase" }}>
            <th style={thCell(28)}></th>
            <SortTh col="name"    label="Name" />
            <SortTh col="env"     label="Env"  width={54} />
            {isLive ? (
              <>
                <SortTh col="ip"       label="IP"       width={130} mono />
                <SortTh col="cluster"  label="Cluster"  width={110} />
                <SortTh col="hostName" label="Host"     width={130} mono />
                <SortTh col="cpuPct"   label="CPU %"    width={60} />
                <SortTh col="memPct"   label="RAM %"    width={60} />
              </>
            ) : (
              <>
                <SortTh col="ip"       label="IP"       width={130} mono />
                <SortTh col="vlanId"   label="VLAN"     width={90} />
                <SortTh col="site"     label="Site"     width={50} />
                <SortTh col="hostName" label="Host (UCS)" width={140} />
                <SortTh col="cpu"      label="CPU"      width={75} />
                <SortTh col="ram"      label="RAM"      width={75} />
                <SortTh col="uptime"   label="Uptime"   width={70} />
              </>
            )}
            <th style={thCell(160,"inherit","right")}>{vt("vms.actions", "Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {vms.map((vm, i) => {
            const zebraBg = i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent";
            return (
            <tr key={vm.id} onClick={() => onSelect(vm)}
              style={{ borderTop:"1px solid var(--border)",cursor:"pointer",background:zebraBg }}
              onMouseEnter={e => e.currentTarget.style.background="var(--row-hover)"}
              onMouseLeave={e => e.currentTarget.style.background=zebraBg}>
              <td style={tdCell("center")}>
                <button onClick={e => { e.stopPropagation(); onToggleFav(vm.id); }}
                  style={{ background:"none",border:0,cursor:"pointer",padding:2,
                    color:vm.favorite?"#f59e0b":"var(--muted-fg)" }}>
                  {vm.favorite ? "★" : "☆"}
                </button>
              </td>
              <td style={tdCell()}>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <StatusDot status={vm.status} />
                  <div style={{ display:"flex",flexDirection:"column",gap:3 }}>
                    <span style={{ display:"flex",alignItems:"center",gap:5 }}>
                      <span style={{ fontFamily:"var(--font-mono)",fontWeight:500 }}>{vm.name}</span>
                      {vm.isDevice && <span title={vm.deviceName ? `Device: ${vm.deviceName}` : window.I18N.t("ui.vms.registered", "Registered in Devices")} style={{ display:"inline-flex",alignItems:"center",gap:3,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"0 5px",height:14,flexShrink:0 }}>
                        <span style={{ width:6,height:6,borderRadius:"50%",background:"#2563eb",display:"inline-block",flexShrink:0 }} />
                        {vm.deviceName && vm.deviceName !== vm.name && <span style={{ fontSize:9,fontFamily:"var(--font-mono)",color:"#1d4ed8",fontWeight:600,lineHeight:1 }}>{vm.deviceName}</span>}
                      </span>}
                    </span>
                    {isLive && vm.tags?.length > 0 && (
                      <div style={{ display:"flex",gap:3,flexWrap:"wrap" }}>
                        {vm.tags.slice(0,3).map((t,i) => <TagChip key={i} tag={t} small />)}
                        {vm.tags.length > 3 && <span style={{ fontSize:9,color:"var(--muted-fg)",alignSelf:"center" }}>+{vm.tags.length-3}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td style={tdCell()}><EnvBadge env={vm.env} /></td>
              {isLive ? (
                <>
                  <td style={{ ...tdCell(), fontFamily:"var(--font-mono)", fontSize:11.5 }}>
                    {vm.ip !== "—" ? (
                      <span style={{ cursor:"pointer", color:"var(--fg)" }}
                        onClick={e => { e.stopPropagation(); copyToClipboard(vm.ip, `IP ${vm.name}`); }}>
                        {vm.ip}
                      </span>
                    ) : (
                      <span style={{ color:"var(--muted-fg)" }}>—</span>
                    )}
                  </td>
                  <td style={tdCell()}>
                    {vm.cluster && vm.cluster !== "—" ? (
                      <span style={{
                        fontSize:10.5, fontFamily:"var(--font-mono)", fontWeight:600,
                        padding:"2px 6px", borderRadius:3,
                        background: vm.cluster.startsWith("MEX") ? "#2563eb18" : "#0891b218",
                        color:       vm.cluster.startsWith("MEX") ? "#2563eb"   : "#0891b2",
                      }}>{vm.cluster}</span>
                    ) : (
                      <span style={{ fontSize:11,color:"var(--muted-fg)" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdCell(), fontFamily:"var(--font-mono)", fontSize:11, color:"var(--muted-fg)" }}>
                    {vm.hostName !== "—" ? vm.hostName : <span style={{ color:"var(--muted-fg)" }}>—</span>}
                  </td>
                  <td style={tdCell()}>
                    {vm.cpuPct != null
                      ? <UsageBar pct={vm.cpuPct} label="" warn={70} crit={90} />
                      : <span style={{ fontSize:11, color:"var(--muted-fg)", fontFamily:"var(--font-mono)" }}>{vm.cpuCount} vCPU</span>}
                  </td>
                  <td style={tdCell()}>
                    {vm.memPct != null
                      ? <UsageBar pct={vm.memPct} label="" warn={80} crit={92} />
                      : <span style={{ fontSize:11, color:"var(--muted-fg)", fontFamily:"var(--font-mono)" }}>{vm.memGB} GB</span>}
                  </td>
                </>
              ) : (
                <>
                  <td style={{ ...tdCell(),fontFamily:"var(--font-mono)",color:"var(--muted-fg)" }}>{vm.ip}</td>
                  <td style={tdCell()}>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontFamily:"var(--font-mono)",color:"var(--muted-fg)" }}>
                      <span style={{ fontWeight:600,color:"var(--fg)" }}>{vm.vlanId}</span>
                      <span>{vm.vlanName}</span>
                    </span>
                  </td>
                  <td style={tdCell()}>
                    <span style={{ fontSize:11,fontWeight:600,color:vm.site==="MEX"?"#2563eb":"#0891b2",fontFamily:"var(--font-mono)" }}>{vm.site}</span>
                  </td>
                  <td style={tdCell()}>
                    <div style={{ display:"flex",flexDirection:"column",lineHeight:1.2 }}>
                      <span style={{ fontSize:10.5,color:"var(--muted-fg)",fontFamily:"var(--font-mono)" }}>{vm.hostName}</span>
                      <span style={{ fontSize:9.5,color:"var(--muted-fg)" }}>{vm.hostGen} · {vm.os?.split(" ")[0]}</span>
                    </div>
                  </td>
                  <td style={tdCell()}><ResourceSummary vm={vm} /></td>
                  <td style={{ ...tdCell(),fontFamily:"var(--font-mono)",color:"var(--muted-fg)",fontSize:11 }}>{vm.uptime}</td>
                </>
              )}
              <td style={{ ...tdCell(),textAlign:"right" }} onClick={e => e.stopPropagation()}>
                <VMRowActions vm={vm} compact onSSH={onSSH} hasVaultCred={!!(getVaultItem && getVaultItem(vm.id))} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function thCell(w, ff, align) { return { textAlign:align||"left",padding:"8px 10px",fontWeight:600,width:w,fontFamily:ff||"inherit" }; }
function tdCell(align) { return { textAlign:align||"left",padding:"8px 10px",verticalAlign:"middle" }; }

// ── Cards view ────────────────────────────────────────────────────────────────
function VMCard({ vm, onSelect, onToggleFav, onSSH, hasVaultCred = false }) {
  return (
    <div onClick={() => onSelect(vm)} style={{
      border:"1px solid var(--border)",background:"white",borderRadius:8,padding:12,
      cursor:"pointer",transition:"border-color .12s",
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor="var(--accent)"; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; }}>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6 }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,minWidth:0 }}>
          <StatusDot status={vm.status} />
          <span style={{ fontFamily:"var(--font-mono)",fontWeight:600,fontSize:13,color:"var(--fg)",
            whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{vm.name}</span>
        </div>
        <button onClick={e => { e.stopPropagation(); onToggleFav(vm.id); }}
          style={{ background:"none",border:0,cursor:"pointer",color:vm.favorite?"#f59e0b":"var(--muted-fg)",fontSize:14,padding:0 }}>
          {vm.favorite ? "★" : "☆"}
        </button>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap" }}>
        <EnvBadge env={vm.env} />
        {vm.ip !== "—" && (
          <span style={{ fontFamily:"var(--font-mono)",fontSize:11,color:"var(--muted-fg)",cursor:"pointer" }}
            onClick={e => { e.stopPropagation(); copyToClipboard(vm.ip, `IP ${vm.name}`); }}>
            {vm.ip}
          </span>
        )}
        {vm.tags?.length > 0 && vm.tags.slice(0,2).map((t,i) => <TagChip key={i} tag={t} small />)}
        {vm.tags?.length > 2 && <span style={{ fontSize:9,color:"var(--muted-fg)" }}>+{vm.tags.length-2}</span>}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"max-content 1fr",gap:"2px 8px",fontSize:11,marginBottom:8,color:"var(--muted-fg)" }}>
        {vm.vlanId ? (
          <><span>VLAN</span><span style={{ fontFamily:"var(--font-mono)" }}><b style={{ color:"var(--fg)" }}>{vm.vlanId}</b> {vm.vlanName}</span></>
        ) : (
          <><span>vCenter</span><span style={{ fontFamily:"var(--font-mono)",color:"var(--fg)" }}>{vm.vcenterName}</span></>
        )}
        {vm.cluster && vm.cluster !== "—" && (
          <><span>Cluster</span><span style={{ fontFamily:"var(--font-mono)",fontWeight:600,color:"var(--fg)" }}>{vm.cluster}</span></>
        )}
        <span>Site</span><span style={{ fontFamily:"var(--font-mono)",fontWeight:600,color:vm.site==="MEX"?"#2563eb":"#0891b2" }}>{vm.site}</span>
      </div>
      <div style={{ marginBottom:8 }}>
        <ResourceSummary vm={vm} />
      </div>
      {vm.services?.length > 0 && (
        <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:8 }}>
          {vm.services.map((s,i) => (
            <span key={i} style={{ fontSize:10,padding:"2px 6px",borderRadius:4,background:`${s.color}18`,color:s.color,fontWeight:600 }}>
              {s.icon} {s.tag}
            </span>
          ))}
        </div>
      )}
      <div onClick={e => e.stopPropagation()}>
        <VMRowActions vm={vm} onSSH={onSSH} hasVaultCred={hasVaultCred} />
      </div>
    </div>
  );
}

// ── Mini grid ─────────────────────────────────────────────────────────────────
function VMMini({ vms, onSelect }) {
  return (
    <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:6 }}>
      {vms.map(vm => (
        <button key={vm.id} onClick={() => onSelect(vm)}
          title={`${vm.name} · ${vm.vcenterName || vm.ip} · ${vm.cpuCount ? vm.cpuCount+"vCPU "+vm.memGB+"GB" : vm.os}`}
          style={{ display:"flex",alignItems:"center",gap:6,padding:"6px 8px",
            background:"white",border:"1px solid var(--border)",borderRadius:5,cursor:"pointer",
            fontFamily:"var(--font-mono)",fontSize:11,color:"var(--fg)",textAlign:"left",minWidth:0 }}>
          <StatusDot status={vm.status} size={6} />
          <span style={{ flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{vm.name}</span>
          {vm.isDevice && <span title={window.I18N.t("ui.vms.registered", "Registered in Devices")} style={{ width:7,height:7,borderRadius:"50%",background:"#2563eb",display:"inline-block",flexShrink:0 }} />}
          {vm.favorite && <span style={{ color:"#f59e0b" }}>★</span>}
        </button>
      ))}
    </div>
  );
}

// ── Inline SSH username editor inside vault credential card ───────────────────
function VaultSshUserField({ value, fallback, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value || fallback || "");
  const [saving,  setSaving]  = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  // Keep draft in sync when vault item changes (different VM selected)
  useEffect(() => { setDraft(value || fallback || ""); setEditing(false); }, [value, fallback]);

  async function save() {
    if (!onSave) return;
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value || fallback || ""); setEditing(false); } }}
          style={{ height:22, padding:"0 6px", border:"1px solid var(--accent)", borderRadius:4,
            fontFamily:"var(--font-mono)", fontSize:12, width:130, outline:"none" }}
        />
        <button onClick={save} disabled={saving}
          style={{ height:22, padding:"0 8px", background:"var(--accent)", color:"white", border:"none",
            borderRadius:4, fontSize:11, cursor:"pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "…" : "Save"}
        </button>
        <button onClick={() => { setDraft(value || fallback || ""); setEditing(false); }}
          style={{ height:22, padding:"0 6px", background:"none", border:"1px solid var(--border)",
            borderRadius:4, fontSize:11, cursor:"pointer", color:"var(--muted-fg)" }}>✕</button>
      </span>
    );
  }

  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:"var(--font-mono)" }}>
      {value
        ? <span>{value}</span>
        : <span>
            <span style={{ color:"var(--warn)" }}>{fallback || "—"}</span>
            <span style={{ color:"var(--muted-fg)", fontSize:10, marginLeft:4 }}>(set username →)</span>
          </span>
      }
      {onSave && (
        <button onClick={() => setEditing(true)}
          title="Set SSH username"
          style={{ height:18, padding:"0 5px", background:"none", border:"1px solid var(--border)",
            borderRadius:3, fontSize:10, cursor:"pointer", color:"var(--muted-fg)", lineHeight:1 }}>✎</button>
      )}
    </span>
  );
}

// ── Inline SSH port editor inside vault credential card ───────────────────────
function VaultSshPortField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value ? String(value) : "");
  const [saving,  setSaving]  = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value ? String(value) : ""); setEditing(false); }, [value]);

  async function save() {
    if (!onSave) return;
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        <input
          ref={inputRef}
          type="number" min="1" max="65535"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value ? String(value) : ""); setEditing(false); } }}
          placeholder="22"
          style={{ height:22, padding:"0 6px", border:"1px solid var(--accent)", borderRadius:4,
            fontFamily:"var(--font-mono)", fontSize:12, width:70, outline:"none" }}
        />
        <button onClick={save} disabled={saving}
          style={{ height:22, padding:"0 8px", background:"var(--accent)", color:"white", border:"none",
            borderRadius:4, fontSize:11, cursor:"pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "…" : "Save"}
        </button>
        <button onClick={() => { setDraft(value ? String(value) : ""); setEditing(false); }}
          style={{ height:22, padding:"0 6px", background:"none", border:"1px solid var(--border)",
            borderRadius:4, fontSize:11, cursor:"pointer", color:"var(--muted-fg)" }}>✕</button>
      </span>
    );
  }

  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:"var(--font-mono)" }}>
      {value
        ? <span>{value}</span>
        : <span style={{ color:"var(--muted-fg)" }}>22 <span style={{ fontSize:10 }}>(default)</span></span>}
      {onSave && (
        <button onClick={() => setEditing(true)}
          title="Set SSH port"
          style={{ height:18, padding:"0 5px", background:"none", border:"1px solid var(--border)",
            borderRadius:3, fontSize:10, cursor:"pointer", color:"var(--muted-fg)", lineHeight:1 }}>✎</button>
      )}
    </span>
  );
}

// ── Manual IP override field (for VMs without VMware Tools reporting a guest IP) ──
function ManualIpField({ vm, onSave }) {
  const hasIp = vm.ip && vm.ip !== "—";
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(hasIp ? vm.ip : "");
  const [saving,  setSaving]  = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(hasIp ? vm.ip : ""); setEditing(false); }, [vm.id, vm.ip]);

  async function save() {
    if (!onSave || !draft.trim()) return;
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  }
  async function remove() {
    if (!onSave) return;
    setSaving(true);
    await onSave(null);
    setSaving(false);
  }

  if (editing) {
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(hasIp ? vm.ip : ""); setEditing(false); } }}
          placeholder="10.0.1.50"
          style={{ height:22, padding:"0 6px", border:"1px solid var(--accent)", borderRadius:4,
            fontFamily:"var(--font-mono)", fontSize:12, width:110, outline:"none" }}
        />
        <button onClick={save} disabled={saving || !draft.trim()}
          style={{ height:22, padding:"0 8px", background:"var(--accent)", color:"white", border:"none",
            borderRadius:4, fontSize:11, cursor:"pointer", opacity: (saving || !draft.trim()) ? 0.6 : 1 }}>
          {saving ? "…" : "Save"}
        </button>
        <button onClick={() => { setDraft(hasIp ? vm.ip : ""); setEditing(false); }}
          style={{ height:22, padding:"0 6px", background:"none", border:"1px solid var(--border)",
            borderRadius:4, fontSize:11, cursor:"pointer", color:"var(--muted-fg)" }}>✕</button>
      </span>
    );
  }

  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
      {hasIp
        ? <span style={{ fontFamily:"var(--font-mono)", cursor:"pointer", color:"var(--fg)",
            textDecoration:"underline dotted var(--border)", textUnderlineOffset:3 }}
            onClick={() => copyToClipboard(vm.ip, "IP")}>{vm.ip}</span>
        : <span style={{ color:"var(--muted-fg)", fontSize:11.5 }}>{vt("vms.notReported", "not reported")}</span>}
      {vm.ipOverride && (
        <span style={{ fontSize:9, fontWeight:700, color:"var(--muted-fg)", background:"var(--muted)",
          padding:"1px 4px", borderRadius:3, letterSpacing:0.3 }}>MANUAL</span>
      )}
      {onSave && (
        <button onClick={() => setEditing(true)}
          title={hasIp ? "Edit manual IP" : window.I18N.t("ui.vms.manualIpHelp", "Add manual IP (VMware Tools does not report it)")}
          style={{ height:18, padding:"0 5px", background:"none", border:"1px solid var(--border)",
            borderRadius:3, fontSize:10, cursor:"pointer", color:"var(--muted-fg)", lineHeight:1 }}>✎</button>
      )}
      {vm.ipOverride && onSave && (
        <button onClick={remove} disabled={saving}
          title={window.I18N.t("ui.vms.removeIp", "Remove manual IP")}
          style={{ height:18, padding:"0 5px", background:"none", border:"1px solid var(--border)",
            borderRadius:3, fontSize:10, cursor:"pointer", color:"var(--err)", lineHeight:1 }}>×</button>
      )}
    </span>
  );
}

// ── Jump host (ProxyJump / bastion) editor inside vault credential card ───────
function VaultJumpField({ value, vaultItems, onSave }) {
  const [editing, setEditing] = useState(false);
  const [host, setHost] = useState(value?.host || "");
  const [port, setPort] = useState(value?.port ? String(value.port) : "22");
  const [user, setUser] = useState(value?.user || "");
  const [credId, setCredId] = useState(value?.vaultItemId || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHost(value?.host || "");
    setPort(value?.port ? String(value.port) : "22");
    setUser(value?.user || "");
    setCredId(value?.vaultItemId || "");
    setEditing(false);
  }, [value]);

  const sshCreds = (vaultItems || []).filter(v => v.tags?.includes("conn-ssh"));
  const credList = sshCreds.length > 0 ? sshCreds : (vaultItems || []);

  async function save() {
    if (!onSave) return;
    setSaving(true);
    await onSave(host.trim() ? { host: host.trim(), port: parseInt(port, 10) || 22, user: user.trim() || null, vaultItemId: credId || null } : null);
    setSaving(false);
    setEditing(false);
  }
  async function remove() {
    if (!onSave) return;
    setSaving(true);
    await onSave(null);
    setSaving(false);
    setEditing(false);
  }

  const inp = { height:24, padding:"0 6px", border:"1px solid var(--border)", borderRadius:4, fontFamily:"var(--font-mono)", fontSize:12, outline:"none" };

  if (editing) {
    return (
      <div style={{ gridColumn:"1 / -1", border:"1px solid var(--accent)", borderRadius:6, padding:10, marginTop:4, display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <input value={host} onChange={e=>setHost(e.target.value)} placeholder="jump host IP" style={{ ...inp, flex:"1 1 130px" }} />
          <span style={{ color:"var(--muted-fg)", fontSize:11 }}>:</span>
          <input value={port} onChange={e=>setPort(e.target.value)} type="number" min="1" max="65535" placeholder="22" style={{ ...inp, width:64 }} />
          <input value={user} onChange={e=>setUser(e.target.value)} placeholder="user" style={{ ...inp, width:110 }} />
        </div>
        <select value={credId} onChange={e=>setCredId(e.target.value)} style={{ ...inp, height:26 }}>
          <option value="">{window.I18N.t("ui.vms.jumpCredential", "— jump host credential —")}</option>
          {credList.map(c => <option key={c.id} value={c.id}>{c.service}{c.user ? ` (${c.user})` : ""}</option>)}
        </select>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={save} disabled={saving} style={{ height:24, padding:"0 10px", background:"var(--accent)", color:"white", border:"none", borderRadius:4, fontSize:11, cursor:"pointer", opacity:saving?0.6:1 }}>{saving ? "…" : "Save"}</button>
          {value && <button onClick={remove} disabled={saving} style={{ height:24, padding:"0 10px", background:"none", border:"1px solid #fecaca", color:"#b91c1c", borderRadius:4, fontSize:11, cursor:"pointer" }}>{vt("vms.remove", "Remove")}</button>}
          <button onClick={() => setEditing(false)} style={{ height:24, padding:"0 8px", background:"none", border:"1px solid var(--border)", borderRadius:4, fontSize:11, cursor:"pointer", color:"var(--muted-fg)" }}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:"var(--font-mono)", fontSize:11.5 }}>
      {value?.host
        ? <span>{value.user ? value.user + "@" : ""}{value.host}:{value.port || 22}</span>
        : <span style={{ color:"var(--muted-fg)" }}>{window.I18N.t("vms.direct", "direct")} <span style={{ fontSize:10 }}>{window.I18N.t("ui.vms.noJump", "(no jump host)")}</span></span>}
      {onSave && (
        <button onClick={() => setEditing(true)} title={window.I18N.t("ui.vms.configureJump", "Configure jump host")}
          style={{ height:18, padding:"0 5px", background:"none", border:"1px solid var(--border)", borderRadius:3, fontSize:10, cursor:"pointer", color:"var(--muted-fg)", lineHeight:1 }}>✎</button>
      )}
    </span>
  );
}

// ── VM detail panel ───────────────────────────────────────────────────────────
function VMDetail({ vm, onClose, vaultItem, vaultItems, onSSH, onLinkVault, onSaveVaultSshUser, sshPort, onSaveVaultSshPort, jump, onSaveVaultJump, onSaveManualIp }) {
  if (!vm) return null;
  const kk = { color:"var(--muted-fg)",fontWeight:500 };
  const vv = { fontFamily:"var(--font-mono)",cursor:"pointer",color:"var(--fg)",textDecoration:"underline dotted var(--border)",textUnderlineOffset:3 };
  const sectionTitle = { fontSize:10.5,fontWeight:600,letterSpacing:0.6,color:"var(--muted-fg)",textTransform:"uppercase",marginBottom:6 };
  const btnStyle = { display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,height:26,padding:"0 9px",border:"1px solid var(--border)",background:"white",borderRadius:5,fontSize:11.5,fontWeight:500,color:"var(--fg)",cursor:"pointer",fontFamily:"inherit" };

  // Lazy-load NIC + vDisk details from vCenter REST
  const [netDetail, setNetDetail] = React.useState(null);
  const [netLoading, setNetLoading] = React.useState(false);
  React.useEffect(() => {
    if (!vm?.id) return;
    setNetDetail(null);
    setNetLoading(true);
    window.HQ_API.request(`/api/vms-live/${vm.id}/network`)
      .then(d => setNetDetail(d))
      .catch(() => setNetDetail(null))
      .finally(() => setNetLoading(false));
  }, [vm?.id]);

  // Container monitoring: is this VM marked as a Docker host? + its containers
  const [isDockerHost, setIsDockerHost] = React.useState(false);
  const [containers, setContainers] = React.useState(null);
  const [collectingC, setCollectingC] = React.useState(false);
  const [cErr, setCErr] = React.useState(null);   // last collect error (auth/timeout/etc.)
  const [consulted, setConsulted] = React.useState(false); // a collect ran ok (even if 0 containers)
  const friendlyDockerErr = (e) =>
    /vault-locked/.test(e)                       ? window.I18N.t("ui.vms.locked", "🔒 Vault locked — unlock it in Passwords and retry")
    : /no-cred-linked/.test(e)                   ? window.I18N.t("ui.vms.noCredential", "No SSH credential linked to this VM")
    : /cred-fetch-failed|cred-empty/.test(e)     ? window.I18N.t("ui.vms.credentialFailed", "Could not read the vault credential")
    : /no-docker-runtime/.test(e)                ? window.I18N.t("ui.vms.noDocker", "Neither Docker nor Podman is installed on this VM")
    : /docker-permission/.test(e)                ? window.I18N.t("ui.vms.dockerPermission", "The SSH user lacks Docker permissions (add them to the 'docker' group)")
    : /authentication methods failed|auth/i.test(e) ? window.I18N.t("ui.vms.authFailed", "SSH authentication failed — the credential is not valid for this VM")
    : /timeout|ETIMEDOUT|timed out/i.test(e)     ? window.I18N.t("ui.vms.timeout", "Timeout — host unreachable (VPN?)")
    : /no-ip/.test(e)                            ? window.I18N.t("ui.vms.noIp", "No IP reported for this VM")
    : /ECONNREFUSED/.test(e)                     ? window.I18N.t("ui.vms.refused", "Connection refused (SSH is not responding on :22)")
    : /no-creds-or-vault-locked/.test(e)         ? window.I18N.t("ui.vms.credentialOrLocked", "No credential or vault locked")
    : e;
  React.useEffect(() => {
    if (!vm?.id) return;
    setContainers(null); setCErr(null); setConsulted(false);
    window.HQ_API.request("/api/containers/hosts")
      .then(d => setIsDockerHost((d.hosts || []).includes(vm.id)))
      .catch(() => {});
    window.HQ_API.request(`/api/containers?vmId=${encodeURIComponent(vm.id)}`)
      .then(d => setContainers(d.containers || []))
      .catch(() => setContainers([]));
  }, [vm?.id]);
  const toggleDockerHost = () => {
    const enabled = !isDockerHost;
    setIsDockerHost(enabled);
    window.HQ_API.request(`/api/vms/${vm.id}/container-monitor`, { method: "PUT", body: { enabled } })
      .then(() => window.dispatchEvent(new CustomEvent("toast", { detail: { msg: enabled ? window.I18N.t("ui.vms.dockerHostEnabled", "VM marked as a Docker host") : window.I18N.t("ui.vms.dockerMonitoringDisabled", "Container monitoring disabled"), kind: "ok" } })))
      .catch(() => window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.mail.saveFailed", "Could not save"), kind: "error" } })));
  };
  const collectContainers = () => {
    setCollectingC(true); setCErr(null);
    window.HQ_API.request("/api/containers/collect", { method: "POST", body: { vmId: vm.id } })
      .then(async (r) => {
        if (r && r.error) {
          setCErr(friendlyDockerErr(r.error));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Docker: " + friendlyDockerErr(r.error), kind: "error" } }));
          return;
        }
        const d = await window.HQ_API.request(`/api/containers?vmId=${encodeURIComponent(vm.id)}`);
        setContainers(d.containers || []);
        setConsulted(true);
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `✓ Consultado — ${(d.containers||[]).length} contenedor(es)`, kind: "ok" } }));
      })
      .catch(e => setCErr(e.message))
      .finally(() => setCollectingC(false));
  };
  return (
    <div style={{ position:"fixed",right:0,top:0,bottom:0,width:420,background:"white",
      borderLeft:"1px solid var(--border)",boxShadow:"-10px 0 24px -16px rgba(0,0,0,.18)",
      zIndex:50,display:"flex",flexDirection:"column" }}>
      <div style={{ padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <StatusDot status={vm.status} />
          <span style={{ fontFamily:"var(--font-mono)",fontWeight:600,fontSize:14 }}>{vm.name}</span>
          <EnvBadge env={vm.env} />
        </div>
        <button onClick={onClose} style={{ background:"none",border:0,cursor:"pointer",fontSize:18,color:"var(--muted-fg)" }}>×</button>
      </div>
      <div style={{ padding:16,overflow:"auto",display:"flex",flexDirection:"column",gap:16 }}>
        <div style={{ display:"grid",gridTemplateColumns:"max-content 1fr",gap:"6px 12px",fontSize:12 }}>
          <span style={kk}>IP</span><span><ManualIpField vm={vm} onSave={onSaveManualIp} /></span>
          {vm.vlanId && <><span style={kk}>VLAN</span><span><b style={{ fontFamily:"var(--font-mono)" }}>{vm.vlanId}</b> · {vm.vlanName}</span></>}
          <span style={kk}>Hostname</span>  <span style={vv} onClick={() => copyToClipboard(vm.name,"Hostname")}>{vm.name}</span>
          {vm.vcenterName && <><span style={kk}>vCenter</span><span>{vm.vcenterName}</span></>}
          {vm.hostName !== "—" && <><span style={kk}>Host UCS</span><span style={{ fontFamily:"var(--font-mono)" }}>{vm.hostName}</span></>}
          {vm.os !== "—" && <><span style={kk}>OS</span><span>{vm.os}</span></>}
          {vm.cpuCount > 0 && <><span style={kk}>vCPU</span><span style={{ fontFamily:"var(--font-mono)" }}>{vm.cpuCount} vCPU / {vm.memGB} GB</span></>}
          {vm.power_state && <><span style={kk}>{vt("hosts.power", "Power")}</span><span style={{ fontFamily:"var(--font-mono)",color:vm.status==="online"?"var(--ok)":vm.status==="warn"?"var(--warn)":"var(--err)" }}>{vm.power_state}</span></>}
          {vm.uptime !== "—" && <><span style={kk}>Uptime</span><span style={vv}>{vm.uptime}</span></>}
          {!vm.isWindows && vm.ip && vm.ip !== "—" && (() => { const u = vaultItem?.user || vm.sshUser || "root"; const p = sshPort && sshPort !== 22 ? ` -p ${sshPort}` : ""; const cmd = `ssh ${u}@${vm.ip}${p}`; return <><span style={kk}>SSH</span><span style={vv} onClick={() => copyToClipboard(cmd,"SSH cmd")}>{cmd}</span></>; })()}
          {vm.hasWeb && <><span style={kk}>Web</span><span style={vv} onClick={() => copyToClipboard(vm.webUrl,"URL")}>{vm.webUrl}</span></>}
        </div>

        {vm.tags?.length > 0 && (
          <div>
            <div style={sectionTitle}>vCenter Tags</div>
            <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
              {vm.tags.map((t,i) => <TagChip key={i} tag={t} />)}
            </div>
            {[...new Set(vm.tags.map(t => t.categoryName).filter(Boolean))].length > 0 && (
              <div style={{ marginTop:6,fontSize:10.5,color:"var(--muted-fg)" }}>
                {[...new Set(vm.tags.map(t => t.categoryName).filter(Boolean))].map((cat, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    <span style={{ fontWeight:500 }}>{cat}</span>: {vm.tags.filter(t => t.categoryName === cat).map(t => t.tagName).join(", ")}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contenedores (Docker) */}
        <div>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,gap:8 }}>
            <div style={sectionTitle}>{window.I18N.t("nav.containers.label", "Containers")}</div>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              {(() => { const pu = (containers || []).find(c => c.portainerUrl)?.portainerUrl; return pu ? (
                <a href={pu} target="_blank" rel="noreferrer" style={{ fontSize:11,fontWeight:600,color:"#0b87b3",textDecoration:"none" }}>{window.I18N.t("containers.openPortainer", "Open in Portainer ↗")}</a>
              ) : null; })()}
              <label style={{ display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--muted-fg)",cursor:"pointer" }}>
                <input type="checkbox" checked={isDockerHost} onChange={toggleDockerHost} />
                Docker host
              </label>
            </div>
          </div>
          {containers === null ? (
            <div style={{ fontSize:11.5,color:"var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
          ) : containers.length > 0 ? (
            <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
              {containers.map(c => (
                <div key={c.id} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 8px",border:"1px solid var(--border)",borderRadius:5 }}>
                  <span style={{ width:6,height:6,borderRadius:999,background:c.state==="running"?"var(--ok)":"var(--muted-fg)",flexShrink:0 }} />
                  <span style={{ fontFamily:"var(--font-mono)",fontSize:11.5,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }} title={c.name}>{isSin ? window.I18N.t("ui.vms.noCluster", "No cluster") : c.name}</span>
                  <span style={{ fontSize:10,color:"var(--muted-fg)",fontFamily:"var(--font-mono)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:110 }} title={c.image}>{c.image}</span>
                  <span style={{ fontSize:9,fontWeight:700,padding:"1px 4px",borderRadius:3,fontFamily:"var(--font-mono)",background:c.source==="portainer"?"color-mix(in srgb,#13bef9 14%,white)":"var(--muted)",color:c.source==="portainer"?"#0b87b3":"var(--muted-fg)" }}>{c.source==="portainer"?"PT":"SSH"}</span>
                  <span style={{ fontSize:9.5,fontWeight:700,fontFamily:"var(--font-mono)",color:c.state==="running"?"var(--ok)":"var(--muted-fg)" }}>{c.state==="running"?"UP":"OFF"}</span>
                </div>
              ))}
            </div>
          ) : isDockerHost ? (
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              <div style={{ fontSize:11.5,color:"var(--muted-fg)",display:"flex",alignItems:"center",gap:8 }}>
                {cErr ? window.I18N.t("ui.vms.containersFailed", "Could not retrieve containers.")
                  : consulted ? window.I18N.t("ui.vms.noRunningContainers", "✓ Retrieved — this VM has no running containers.")
                  : window.I18N.t("ui.vms.noCachedContainers", "No cached containers.")}
                <button onClick={collectContainers} disabled={collectingC} style={{ ...btnStyle, height:24 }}>{collectingC ? window.I18N.t("ui.vms.querying", "Fetching… (~10-20s)") : window.I18N.t("ui.vms.queryNow", "Fetch now")}</button>
              </div>
              {cErr && (
                <div style={{ fontSize:11,lineHeight:1.4,padding:"6px 8px",borderRadius:5,background:"color-mix(in srgb,var(--err) 8%,white)",border:"1px solid color-mix(in srgb,var(--err) 22%,var(--border))",color:"var(--err)" }}>
                  ⚠️ {cErr}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize:11.5,color:"var(--muted-fg)",lineHeight:1.4 }}>{window.I18N.t("ui.vms.enable", "Enable")} <b>Docker host</b> {window.I18N.t("ui.vms.dockerHelp", "to monitor this VM's containers over SSH (requires a vault credential and VPN). If the VM is already in Portainer, its containers appear here automatically after synchronization.")} </div>
          )}
        </div>

        {(vm.cpu > 0 || vm.cpuCount > 0) && (
          <div>
            <div style={sectionTitle}>{vt("vms.resources", "Resources")}</div>
            <ResourceSummary vm={vm} />
          </div>
        )}

        {/* Disk — from SOAP guest.disk (requires VMware Tools) */}
        {vm.disks?.length > 0 && (
          <div>
            <div style={sectionTitle}>{vt("vms.disk", "Disk")}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {vm.disks.map((d, i) => (
                <div key={i} style={{ display:"flex", flexDirection:"column", gap:2 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:10.5, fontFamily:"var(--font-mono)" }}>
                    <span style={{ color:"var(--muted-fg)" }}>{d.path}</span>
                    <span style={{ color:"var(--fg)" }}>{d.freeGB} GB free / {d.capacityGB} GB</span>
                  </div>
                  <UsageBar pct={d.usedPct} label="" warn={75} crit={90} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Network — lazy-loaded from vCenter REST */}
        <div>
          <div style={sectionTitle}>{vt("vms.network", "Network")}</div>
          {netLoading ? (
            <div style={{ fontSize:11.5, color:"var(--muted-fg)" }}>{vt("vms.loading", "Loading…")}</div>
          ) : netDetail?.nics?.length > 0 ? (
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {netDetail.nics.map((nic, i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns:"max-content 1fr max-content", gap:"3px 10px",
                  fontSize:11.5, padding:"7px 10px", borderRadius:6,
                  background: nic.connected ? "color-mix(in srgb,var(--ok) 6%,white)" : "var(--muted)",
                  border:"1px solid var(--border)" }}>
                  <span style={{ color:"var(--muted-fg)", fontSize:10, gridRow:"1/3", display:"flex", alignItems:"center" }}>
                    {nic.connected ? "🟢" : "⚫"}
                  </span>
                  <span style={{ fontFamily:"var(--font-mono)", fontWeight:600, fontSize:11 }}>{nic.networkName}</span>
                  <span style={{ fontFamily:"var(--font-mono)", fontSize:10, color:"var(--muted-fg)", textAlign:"right" }}>{nic.type}</span>
                  <span style={{ fontFamily:"var(--font-mono)", fontSize:10, color:"var(--muted-fg)" }}>{nic.mac}</span>
                  <span style={{ fontSize:10, color: nic.connected ? "var(--ok)" : "var(--muted-fg)" }}>{nic.connected ? "Connected" : "Disconnected"}</span>
                </div>
              ))}
            </div>
          ) : vm.allIps?.length > 0 ? (
            /* Fallback: show IPs from SOAP guest.net if REST fails */
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {vm.allIps.map((ip, i) => (
                <span key={i} onClick={() => copyToClipboard(ip,"IP")}
                  style={{ fontFamily:"var(--font-mono)", fontSize:11.5, padding:"3px 8px",
                    borderRadius:4, background:"var(--muted)", cursor:"pointer",
                    border:"1px solid var(--border)" }}>{ip}</span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize:11.5, color:"var(--muted-fg)" }}>{vt("vms.noNetwork", "No network data available")}</div>
          )}
        </div>

        {vm.services?.length > 0 && (
          <div>
            <div style={sectionTitle}>{vt("vms.services", "Services")}</div>
            <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
              {vm.services.map((s,i) => (
                <span key={i} style={{ fontSize:11,padding:"3px 7px",borderRadius:4,background:`${s.color}18`,color:s.color,fontWeight:600 }}>
                  {s.icon} {s.tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {!vm.isWindows && (
          <div>
            <div style={sectionTitle}>{vt("vms.vaultCredential", "Vault credential")}</div>
            {vaultItem ? (
              <div style={{ border:"1px solid var(--border)",borderRadius:6,overflow:"hidden" }}>
                <div style={{ display:"grid",gridTemplateColumns:"max-content 1fr",gap:"5px 10px",fontSize:12,padding:"10px 12px",background:"color-mix(in srgb, var(--ok) 6%, white)" }}>
                  <span style={kk}>Service</span><span style={{ fontWeight:500 }}>{vaultItem.service}</span>
                  <span style={kk}>User</span>
                  <VaultSshUserField
                    value={vaultItem.user}
                    fallback={vm.sshUser || (vm.isWindows ? "" : "root")}
                    onSave={onSaveVaultSshUser}
                  />
                  <span style={kk}>Port</span>
                  <VaultSshPortField value={sshPort} onSave={onSaveVaultSshPort} />
                  <span style={kk}>Jump</span>
                  <VaultJumpField value={jump} vaultItems={vaultItems} onSave={onSaveVaultJump} />
                  {vaultItem.url && <><span style={kk}>URL</span><span style={{ fontFamily:"var(--font-mono)",fontSize:11 }}>{vaultItem.url}</span></>}
                </div>
                <div style={{ borderTop:"1px solid var(--border)",padding:"8px 12px",display:"flex",gap:6 }}>
                  <button onClick={() => onSSH && onSSH(vm)} style={{ ...btnStyle,flex:1,height:28,background:"#0f172a",color:"#e2e8f0",borderColor:"#334155" }}>
                    <span style={{ fontFamily:"var(--font-mono)" }}>›_</span> Open SSH Console
                  </button>
                  <button onClick={() => onLinkVault && onLinkVault(vm)} style={{ ...btnStyle,height:28,padding:"0 10px" }}>{vt("vms.change", "Change")}</button>
                </div>
              </div>
            ) : (
              <div style={{ border:"1px dashed var(--border)",borderRadius:6,padding:12,display:"flex",alignItems:"center",gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12.5,fontWeight:500 }}>{vt("vms.noCredential", "No credential linked")}</div>
                  <div style={{ fontSize:11,color:"var(--muted-fg)",marginTop:2 }}>{vt("vms.linkHint", "Associate a vault entry to use the SSH console with auto-fill.")}</div>
                </div>
                <button onClick={() => onLinkVault && onLinkVault(vm)} style={{ ...btnStyle,height:30,background:"var(--accent)",color:"white",borderColor:"var(--accent)" }}>+ Link</button>
              </div>
            )}
          </div>
        )}

        <div>
          <div style={sectionTitle}>{vt("vms.quickActions", "Quick actions")}</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
            <BigAction icon="›_" label={vm.isWindows?"RDP":"SSH"} sub={`${vaultItem?.user || vm.sshUser || "root"}@${vm.ip}`} onClick={() => vm.isWindows ? vmAction(vm,"rdp") : (onSSH ? onSSH(vm) : vmAction(vm,"ssh"))} />
            <BigAction icon="↗" label="vCenter" sub={vm.vcenterName||"vCenter"} onClick={() => vmAction(vm,"vcenter")} />
            <BigAction icon="⎘" label="Copy name" sub={vm.name} onClick={() => copyToClipboard(vm.name,"VM name")} />
            {vm.ip !== "—" && <BigAction icon="⎘" label="Copy IP" sub={vm.ip} onClick={() => vmAction(vm,"copyip")} />}
          </div>
        </div>

        {vm.notes && (
          <div>
          <div style={sectionTitle}>{vt("vms.notes", "Notes")}</div>
            <div style={{ fontSize:12.5,background:"var(--muted)",borderRadius:6,padding:10,lineHeight:1.5 }}>{vm.notes}</div>
          </div>
        )}

        <div>
          <div style={sectionTitle}>{vt("vms.frequentCommands", "Frequent commands")}</div>
          <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
            {(window.APP_DATA?.SNIPPETS ?? []).slice(0,3).map(s => (
              <button key={s.id} onClick={() => copyToClipboard(s.body,s.title)}
                style={{ textAlign:"left",padding:"6px 8px",border:"1px solid var(--border)",borderRadius:5,
                  background:"white",cursor:"pointer",fontSize:11.5,fontFamily:"var(--font-mono)" }}>
                <div style={{ color:"var(--muted-fg)",fontSize:10 }}>{s.title}</div>
                <div style={{ color:"var(--fg)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{s.body}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BigAction({ icon, label, sub, onClick, disabled }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{
      display:"flex",flexDirection:"column",gap:2,alignItems:"flex-start",textAlign:"left",
      padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,
      background:disabled?"var(--muted)":"white",cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,
    }}>
      <div style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600 }}>
        <span style={{ color:"var(--accent)",fontFamily:"var(--font-mono)" }}>{icon}</span>{label}
      </div>
      <div style={{ fontSize:10.5,color:"var(--muted-fg)",fontFamily:"var(--font-mono)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140 }}>{sub}</div>
    </button>
  );
}

// ── Main VMs browser ──────────────────────────────────────────────────────────
function VMsBrowser({ tweaks, onOpenSSH: externalOpenSSH, sshSessions: externalSessions = [], onNavigateToSSH }) {
  // If we arrived here by clicking a VM in a host's detail panel, focus it via search
  const [q, setQ] = useState(() => {
    const f = window.__hqVmFocus;
    if (f) { delete window.__hqVmFocus; return f; }
    return "";
  });
  const [envFilter, setEnvFilter] = useState("all");
  const [vcFilter, setVcFilter]   = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [hostFilter, setHostFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vlanFilter, setVlanFilter] = useState("all");
  const [tagFilter, setTagFilter]   = useState("all");

  // Vault linking state
  const [vaultTarget, setVaultTarget] = useState(null);
  const [vmVaultMap, setVmVaultMap]   = useState({});
  const [vaultItems, setVaultItems]   = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [groupBy, setGroupBy] = useState("none");
  const [selected, setSelected] = useState(null);
  const [favOverrides, setFavOverrides] = useState({});

  // Live data state
  const [liveVMs, setLiveVMs] = useState(null);   // null = loading, [] = empty, [...] = loaded
  const [liveMeta, setLiveMeta] = useState([]);
  const [dataSource, setDataSource] = useState("live"); // "live" | "mock"
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [sortBy, setSortBy]         = useState("name");
  const [sortDir, setSortDir]       = useState("asc");
  const [showUnmonitored, setShowUnmonitored] = useState(false); // include VMs from disabled hosts

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const loadLiveVMs = () => {
    setRefreshing(true);
    return window.HQ_API.request("/api/vms-live")
      .then(d => { setLiveVMs(d.vms || []); setLiveMeta(d.meta || []); setDataSource("live"); })
      .catch(() => { setLiveVMs([]); setDataSource("mock"); })
      .finally(() => setRefreshing(false));
  };

  // Full sync: triggers vCenter data pull then reloads the VM list
  const syncAndLoad = () => {
    setSyncing(true);
    window.HQ_API.request("/api/connectors/vcenter/vcenter/sync", { method: "POST" })
      .catch(() => {})
      .finally(() => { setSyncing(false); loadLiveVMs(); });
  };

  // On mount: show cached data instantly, then auto-sync for fresh vCenter data
  useEffect(() => { loadLiveVMs().then(() => syncAndLoad()); }, []);

  // Load vm vault map (vm-id → vault-item-id) + public vault metadata
  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/vms/vault-map").catch(() => ({})),
      window.HQ_API.request("/api/vault/items").catch(() => []),
    ]).then(([map, items]) => {
      setVmVaultMap(map || {});
      setVaultItems(items || []);
    });
  }, []);

  // vmVaultMap values are now { vaultItemId, sshUser } objects (or legacy plain strings)
  const getVaultEntry = (vmId) => {
    const entry = vmVaultMap[vmId];
    if (!entry) return null;
    // Support legacy plain-string format
    if (typeof entry === "string") return { vaultItemId: entry, sshUser: null };
    return entry;
  };

  const getVaultItem = (vmId) => {
    const entry = getVaultEntry(vmId);
    if (!entry) return null;
    const item = vaultItems.find(v => v.id === entry.vaultItemId) || null;
    if (!item) return null;
    // Merge stored sshUser override into the item so it propagates everywhere
    return entry.sshUser ? { ...item, user: entry.sshUser } : item;
  };

  async function handlePickVault(vaultItemId) {
    if (!vaultTarget) return;
    try {
      const existingEntry = getVaultEntry(vaultTarget.id);
      await window.HQ_API.request(`/api/vms/${vaultTarget.id}/vault`, {
        method: "PUT",
        body: { vaultItemId: vaultItemId || null, sshUser: existingEntry?.sshUser || null },
      });
      setVmVaultMap(prev => {
        const next = { ...prev };
        if (vaultItemId) next[vaultTarget.id] = { vaultItemId, sshUser: existingEntry?.sshUser || null };
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

  async function handleSaveVaultSshUser(vmId, sshUser) {
    const entry = getVaultEntry(vmId);
    if (!entry) return;
    try {
      await window.HQ_API.request(`/api/vms/${vmId}/vault`, {
        method: "PUT",
        body: { vaultItemId: entry.vaultItemId, sshUser: sshUser || null },
      });
      setVmVaultMap(prev => ({ ...prev, [vmId]: { ...entry, sshUser: sshUser || null } }));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "SSH username saved", kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Failed to save: " + e.message, kind: "err" } }));
    }
  }

  async function handleSaveVaultSshPort(vmId, sshPort) {
    const entry = getVaultEntry(vmId);
    if (!entry) return;
    const port = sshPort ? parseInt(sshPort, 10) || null : null;
    try {
      await window.HQ_API.request(`/api/vms/${vmId}/vault`, {
        method: "PUT",
        body: { vaultItemId: entry.vaultItemId, sshPort: port },
      });
      setVmVaultMap(prev => ({ ...prev, [vmId]: { ...entry, sshPort: port } }));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: port ? `SSH port set to ${port}` : "SSH port reset to 22", kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Failed to save: " + e.message, kind: "err" } }));
    }
  }

  function openSSH(vm) {
    if (!externalOpenSSH) return;
    const entry = getVaultEntry(vm.id);
    const vmWithConn = (entry?.sshPort || entry?.jump)
      ? { ...vm, sshPort: entry.sshPort || vm.sshPort, jump: entry.jump || null }
      : vm;
    externalOpenSSH(vmWithConn, getVaultItem(vm.id));
  }

  async function handleSaveVaultJump(vmId, jump) {
    const entry = getVaultEntry(vmId);
    if (!entry) return;
    try {
      await window.HQ_API.request(`/api/vms/${vmId}/vault`, {
        method: "PUT",
        body: { vaultItemId: entry.vaultItemId, jump: jump || null },
      });
      setVmVaultMap(prev => ({ ...prev, [vmId]: { ...entry, jump: jump || null } }));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: jump ? `Jump host saved (${jump.host})` : "Jump host removed", kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Failed to save: " + e.message, kind: "err" } }));
    }
  }

  async function handleSaveManualIp(vmId, vmName, ip) {
    try {
      await window.HQ_API.request("/api/vms/ip-overrides", {
        method: "POST",
        body: { name: vmName, ip: ip || null },
      });
      setLiveVMs(prev => prev.map(v => v.name === vmName ? { ...v, ip: ip || "—", ipOverride: !!ip } : v));
      setSelected(prev => prev && prev.name === vmName ? { ...prev, ip: ip || "—", ipOverride: !!ip } : prev);
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: ip ? `IP manual guardada: ${ip}` : window.I18N.t("ui.vms.ipRemoved", "Manual IP removed"), kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Failed to save: " + e.message, kind: "err" } }));
    }
  }

  const isLive    = dataSource === "live" && liveVMs?.length > 0;
  const isOffline = dataSource === "mock" && liveVMs?.length > 0;
  // "Offline mode" still shows last real vCenter data — no demo fallback, show empty state instead
  const liveBase = liveVMs?.length > 0 ? liveVMs : [];
  // VMs on hosts disabled for monitoring are hidden by default (toggle to include)
  const hiddenCount = liveBase.filter(v => v.monitoringEnabled === false).length;
  const rawVMs = useMemo(
    () => showUnmonitored ? liveBase : liveBase.filter(v => v.monitoringEnabled !== false),
    [liveBase, showUnmonitored]
  );

  const toggleFav = (id) => setFavOverrides(p => {
    const cur = p[id] ?? rawVMs.find(v => v.id === id)?.favorite ?? false;
    return { ...p, [id]: !cur };
  });

  const vms = useMemo(() => {
    const base = rawVMs.map(v => ({ ...v, favorite: favOverrides[v.id] ?? v.favorite ?? false }));
    return base.filter(v => {
      if (envFilter !== "all" && v.env !== envFilter) return false;
      if (vcFilter !== "all" && v.vcenter !== vcFilter) return false;
      if (!isLive && vlanFilter !== "all" && String(v.vlanId) !== String(vlanFilter)) return false;
      if (siteFilter !== "all" && v.site !== siteFilter) return false;
      if (isLive && clusterFilter !== "all" && v.cluster !== clusterFilter) return false;
      if (isLive && hostFilter !== "all" && v.hostName !== hostFilter) return false;
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (tagFilter !== "all" && !(v.tags || []).some(t => t.tagName === tagFilter)) return false;
      if (favoritesOnly && !v.favorite) return false;
      if (q) {
        const s = q.toLowerCase();
        return v.name.toLowerCase().includes(s)
          || (v.ip && v.ip.includes(s))
          || (v.os && v.os.toLowerCase().includes(s))
          || (v.vcenterName && v.vcenterName.toLowerCase().includes(s))
          || (v.services || []).some(sv => sv.tag.toLowerCase().includes(s))
          || (v.tags || []).some(t => t.tagName.toLowerCase().includes(s) || t.categoryName.toLowerCase().includes(s));
      }
      return true;
    }).sort((a, b) => {
      const NUMERIC = ["cpuPct","memPct","cpuCount","memGB","cpu","ram","disk"];
      let va = a[sortBy] ?? (NUMERIC.includes(sortBy) ? -1 : "");
      let vb = b[sortBy] ?? (NUMERIC.includes(sortBy) ? -1 : "");
      let cmp;
      if (NUMERIC.includes(sortBy)) {
        cmp = (Number(va) || 0) - (Number(vb) || 0);
      } else {
        cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [q, envFilter, vcFilter, vlanFilter, siteFilter, clusterFilter, hostFilter, statusFilter, tagFilter, favoritesOnly, favOverrides, rawVMs, isLive, sortBy, sortDir]);

  // Grouping runs on just the current page's slice, not the full filtered
  // list — a page of 25 can span several groups (a cluster's VMs may
  // continue on the next page without repeating its header), same tradeoff
  // any paginated grouped list makes. `pagination.total`/`pagination.pageSize`
  // below always reflect the full filtered `vms`, never the page slice.
  const pagination = usePagination(vms, { key: "vms" });
  const pageVms = pagination.pageItems;

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key:"all", title:null, items:pageVms }];
    if (groupBy === "vcenter") {
      const vcIds = [...new Set(pageVms.map(v => v.vcenter))];
      return vcIds.map(id => ({
        key: id,
        title: pageVms.find(v => v.vcenter === id)?.vcenterName || id,
        items: pageVms.filter(v => v.vcenter === id),
      })).filter(g => g.items.length);
    }
    if (groupBy === "env") {
      return ["prod","qa","dev"].map(e => ({
        key:e, title:e.toUpperCase(), items:pageVms.filter(v => v.env === e),
      })).filter(g => g.items.length);
    }
    if (groupBy === "site") {
      return ["MEX","GDL"].map(s => ({
        key:s, title:`Site ${s}`, items:pageVms.filter(v => v.site === s),
      })).filter(g => g.items.length);
    }
    if (isLive && groupBy === "cluster") {
      const clNames = [...new Set(pageVms.map(v => v.cluster || "—"))].sort();
      return clNames.map(cl => ({
        key: cl, title: `Cluster: ${cl}`, items: pageVms.filter(v => (v.cluster || "—") === cl),
      })).filter(g => g.items.length);
    }
    if (isLive && groupBy === "host") {
      const hostNames = [...new Set(pageVms.map(v => v.hostName || "—"))].sort();
      return hostNames.map(h => ({
        key: h, title: `Host: ${h}`, items: pageVms.filter(v => (v.hostName || "—") === h),
      })).filter(g => g.items.length);
    }
    if (!isLive && groupBy === "vlan") {
      return window.APP_DATA.VLANS.map(vl => ({
        key:`vlan-${vl.id}`, title:`VLAN ${vl.id} · ${vl.name} — ${vl.desc}`,
        items:pageVms.filter(v => v.vlanId === vl.id),
      })).filter(g => g.items.length);
    }
    if (!isLive && groupBy === "host") {
      return window.APP_DATA.HOSTS.map(h => ({
        key:h.id, title:`${h.shortName} · ${h.model} · ${h.site}`,
        items:pageVms.filter(v => v.hostId === h.id),
      })).filter(g => g.items.length);
    }
    return [{ key:"all", title:null, items:pageVms }];
  }, [pageVms, groupBy, isLive]);

  const counts = useMemo(() => ({
    total:   rawVMs.length,
    online:  rawVMs.filter(v => v.status === "online").length,
    warn:    rawVMs.filter(v => v.status === "warn").length,
    offline: rawVMs.filter(v => v.status === "offline").length,
    maint:   rawVMs.filter(v => v.status === "maint").length,
  }), [rawVMs]);

  const density = tweaks.vmDensity;

  // Loading state
  if (liveVMs === null) {
    return (
      <div style={{ display:"flex",alignItems:"center",gap:8,padding:24,color:"var(--muted-fg)",fontSize:13 }}>
        <Spinner /> Loading live VMs from vCenter…
      </div>
    );
  }

  return (
    <div>
      {/* Source banner */}
      {isLive && (
        <SourceBanner meta={liveMeta} source={dataSource}
          onSwitch={() => setDataSource("mock")} onRefresh={syncAndLoad} refreshing={syncing || refreshing} />
      )}
      {/* Offline mode banner — still showing last real data */}
      {isOffline && (
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
          background:"color-mix(in srgb, var(--muted-fg) 6%, white)",
          border:"1px solid var(--border)", borderRadius:7, fontSize:12, marginBottom:12 }}>
          <span style={{ width:7,height:7,borderRadius:999,background:"var(--muted-fg)",flexShrink:0 }} />
          <span style={{ fontWeight:600,color:"var(--muted-fg)" }}>{vt("vms.offlineMode", "Offline mode")}</span>
          <span style={{ color:"var(--muted-fg)" }}>· showing last cached vCenter data</span>
          <button onClick={() => { setDataSource("live"); syncAndLoad(); }}
            style={{ marginLeft:"auto",height:22,padding:"0 8px",border:"1px solid var(--border)",
              background:"white",borderRadius:4,fontSize:11,cursor:"pointer",color:"var(--accent)",fontWeight:600 }}>
            ↻ Go live
          </button>
        </div>
      )}
      {/* No data at all — vCenter never synced */}
      {!isLive && !isOffline && liveVMs?.length === 0 && (
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
          background:"color-mix(in srgb, var(--warn) 8%, white)",
          border:"1px solid color-mix(in srgb, var(--warn) 20%, var(--border))",
          borderRadius:7,fontSize:12,marginBottom:12 }}>
          <span style={{ color:"var(--warn)" }}>⚠</span>
          <span>No vCenter data yet. Go to <b>Connectors → VMware vCenter → Configure</b> to connect.</span>
        </div>
      )}

      {/* SSH Workspace active banner */}
      {externalSessions.length > 0 && (
        <div onClick={onNavigateToSSH} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
          background:"#0f172a",border:"1px solid #334155",borderRadius:7,fontSize:12,marginBottom:12,cursor:"pointer" }}>
          <span style={{ width:7,height:7,borderRadius:999,background:"#4ade80",flexShrink:0 }} />
          <span style={{ fontFamily:"var(--font-mono)",color:"#e2e8f0",fontWeight:600 }}>SSH Workspace</span>
          <span style={{ color:"#475569" }}>·</span>
          <span style={{ color:"#94a3b8" }}>{externalSessions.length} session{externalSessions.length !== 1 ? "s" : ""} active</span>
          <span style={{ marginLeft:"auto",color:"#60a5fa",fontSize:11 }}>{vt("vms.openWorkspace", "Open workspace →")}</span>
        </div>
      )}

      {/* Counts + density */}
      <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:14,gap:16,flexWrap:"wrap" }}>
        <p style={{ margin:0,color:"var(--muted-fg)",fontSize:13 }}>
          {counts.total} VMs · {counts.online} <span style={{ color:"var(--ok)" }}>online</span>
          {counts.warn > 0 && <> · {counts.warn} <span style={{ color:"var(--warn)" }}>warn</span></>}
          {counts.offline > 0 && <> · {counts.offline} <span style={{ color:"var(--err)" }}>offline</span></>}
          {counts.maint > 0 && <> · {counts.maint} maint</>}
          {isLive && <span style={{ marginLeft:8,fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ok)" }}>● live</span>}
        </p>
        <div style={{ display:"flex",gap:4,padding:3,background:"var(--muted)",borderRadius:7 }}>
          <DensityBtn active={density==="table"} onClick={() => window.setTweak("vmDensity","table")} label="Table" icon="≡" />
          <DensityBtn active={density==="cards"} onClick={() => window.setTweak("vmDensity","cards")} label="Cards" icon="▦" />
          <DensityBtn active={density==="mini"}  onClick={() => window.setTweak("vmDensity","mini")}  label="Grid"  icon="⋮⋮" />
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"nowrap",overflowX:"auto" }}>
        <div style={{ position:"relative",flex:"0 0 220px" }}>
          <span style={{ position:"absolute",left:9,top:8,color:"var(--muted-fg)",fontSize:13 }}>⌕</span>
          <input placeholder="Search name, IP…" value={q} onChange={e => setQ(e.target.value)}
            style={{ width:"100%",height:32,padding:"0 10px 0 28px",border:"1px solid var(--border)",
              borderRadius:6,fontSize:13,fontFamily:"inherit",background:"white",outline:"none" }}
            onFocus={e => e.target.style.borderColor="var(--accent)"}
            onBlur={e => e.target.style.borderColor="var(--border)"} />
        </div>

        {/* Live-mode filters */}
        {isLive && (
          <FilterChip label="Cluster" value={clusterFilter}
            options={[["all","All"],...[...new Set(rawVMs.map(v=>v.cluster).filter(c=>c&&c!=="—"))].sort().map(c=>[c,c])]}
            onChange={setClusterFilter} />
        )}
        {isLive && (
          <FilterChip label="Host" value={hostFilter}
            options={[["all","All"],...[...new Set(rawVMs.map(v=>v.hostName).filter(h=>h&&h!=="—"))].sort().map(h=>[h,h])]}
            onChange={setHostFilter} />
        )}
        {isLive && (() => {
          const allTags = [...new Set(rawVMs.flatMap(v => (v.tags||[]).map(t => t.tagName)))].sort();
          if (!allTags.length) return null;
          return (
            <FilterChip label="Tag" value={tagFilter}
              options={[["all","All"],...allTags.map(t=>[t,t])]}
              onChange={setTagFilter} />
          );
        })()}

        {/* Mock-mode filters */}
        {!isLive && <FilterChip label="VLAN"  value={vlanFilter}  options={[["all","All"],...window.APP_DATA.VLANS.map(v=>[String(v.id),`${v.id} · ${v.name}`])]} onChange={setVlanFilter} />}

        {/* Shared filters */}
        <FilterChip label="Env"    value={envFilter}    options={[["all","All"],["prod","Prod"],["qa","QA"],["dev","Dev"]]} onChange={setEnvFilter} />
        <FilterChip label="Status" value={statusFilter} options={[["all","All"],["online","Online"],["warn","Warn"],["offline","Offline"]]} onChange={setStatusFilter} />
        <FilterChip label="Group"  value={groupBy}
          options={isLive
            ? [["none","None"],["cluster","Cluster"],["host","Host"],["env","Env"]]
            : [["none","None"],["vcenter","vCenter"],["site","Site"],["env","Env"],["vlan","VLAN"],["host","UCS Host"]]}
          onChange={setGroupBy} />

        <button onClick={() => setFavoritesOnly(f => !f)} style={{
          flexShrink:0,height:32,padding:"0 10px",border:"1px solid var(--border)",
          background:favoritesOnly?"color-mix(in srgb, #f59e0b 14%, white)":"white",
          color:favoritesOnly?"#a16207":"var(--fg)",borderRadius:6,fontSize:12,fontFamily:"inherit",
          cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6 }}>★ Favs</button>
        {isLive && hiddenCount > 0 && (
          <button onClick={() => setShowUnmonitored(s => !s)}
            title={window.I18N.t("ui.vms.unmonitoredHelp", "VMs on hosts with monitoring disabled")}
            style={{ flexShrink:0,height:32,padding:"0 10px",border:"1px solid var(--border)",
              background:showUnmonitored?"var(--muted)":"white",color:"var(--muted-fg)",
              borderRadius:6,fontSize:12,fontFamily:"inherit",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6 }}>
            {showUnmonitored ? window.I18N.t("ui.hide", "Hide") : window.I18N.t("ui.show", "Show")} {window.I18N.t("ui.vms.unmonitored", "unmonitored (")}{hiddenCount})
          </button>
        )}
        {isLive && (
          <button onClick={syncAndLoad} disabled={syncing || refreshing}
            title="Pull fresh data from vCenter (full sync)"
            style={{ flexShrink:0, height:32, padding:"0 12px",
              border:"1px solid var(--accent)", borderRadius:6,
              background: syncing ? "color-mix(in srgb,var(--accent) 10%,white)" : "white",
              color:"var(--accent)", fontSize:12, fontWeight:600,
              fontFamily:"inherit", cursor: syncing ? "wait" : "pointer",
              display:"inline-flex", alignItems:"center", gap:5 }}>
            {syncing ? <Spinner size={11} /> : <span style={{ fontSize:13 }}>⟳</span>}
            {syncing ? "Syncing…" : "Sync vCenter"}
          </button>
        )}
        <div style={{ marginLeft:"auto",flexShrink:0,fontSize:12,color:"var(--muted-fg)",whiteSpace:"nowrap" }}>
          <b style={{ color:"var(--fg)" }}>{vms.length}</b> / {counts.total}
        </div>
      </div>

      {/* List */}
      <div style={{ display:"flex",flexDirection:"column",gap:18 }}>
        {grouped.map(g => (
          <div key={g.key}>
            {g.title && (
              <div style={{ fontSize:11,fontWeight:600,letterSpacing:0.6,color:"var(--muted-fg)",textTransform:"uppercase",marginBottom:8 }}>
                {g.title} <span style={{ color:"var(--muted-fg)" }}>· {g.items.length}</span>
              </div>
            )}
            {density==="table" && <VMTable vms={g.items} onSelect={setSelected} onToggleFav={toggleFav} isLive={isLive} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} onSSH={openSSH} getVaultItem={getVaultItem} />}
            {density==="cards" && (
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))",gap:10 }}>
                {g.items.map(vm => <VMCard key={vm.id} vm={vm} onSelect={setSelected} onToggleFav={toggleFav} onSSH={openSSH} hasVaultCred={!!getVaultItem(vm.id)} />)}
              </div>
            )}
            {density==="mini" && <VMMini vms={g.items} onSelect={setSelected} />}
          </div>
        ))}
        {vms.length === 0 && (
          <div style={{ padding:40,textAlign:"center",color:"var(--muted-fg)",border:"1px dashed var(--border)",borderRadius:8 }}>
            No results. Adjust filters or clear the search.
          </div>
        )}
      </div>

      <PaginationBar {...pagination} />

      <VMDetail
        vm={selected}
        onClose={() => setSelected(null)}
        vaultItem={selected ? getVaultItem(selected.id) : null}
        vaultItems={vaultItems}
        onSSH={openSSH}
        onLinkVault={vm => { setVaultTarget(vm); }}
        onSaveVaultSshUser={(sshUser) => selected && handleSaveVaultSshUser(selected.id, sshUser)}
        sshPort={selected ? (getVaultEntry(selected.id)?.sshPort || null) : null}
        onSaveVaultSshPort={(p) => selected && handleSaveVaultSshPort(selected.id, p)}
        jump={selected ? (getVaultEntry(selected.id)?.jump || null) : null}
        onSaveVaultJump={(j) => selected && handleSaveVaultJump(selected.id, j)}
        onSaveManualIp={(ip) => selected && handleSaveManualIp(selected.id, selected.name, ip)}
      />


      {vaultTarget && (
        <VMVaultPickerModal
          vm={vaultTarget}
          currentVaultItemId={getVaultEntry(vaultTarget.id)?.vaultItemId || null}
          vaultItems={vaultItems}
          onPick={handlePickVault}
          onClose={() => setVaultTarget(null)}
        />
      )}
    </div>
  );
}

// ── Hosts browser ─────────────────────────────────────────────────────────────
function HostsBrowser({ onNavigate }) {
  const [hostsTab, setHostsTab] = useState("hosts"); // "hosts" | "topology"
  const [siteFilter, setSiteFilter] = useState("all");
  const [clusterFilter, setClusterFilter] = useState("all"); // "all" | cluster name | "—" (sin cluster)
  const [q, setQ] = useState("");
  const [selectedHost, setSelectedHost] = useState(null);
  const [devices, setDevices] = useState([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);

  useEffect(() => {
    window.HQ_API.request("/api/devices").then(d => setDevices(d || [])).catch(() => {}).finally(() => setDevicesLoaded(true));
  }, []);

  // Live data state
  const [liveHosts, setLiveHosts] = useState(null);
  const [liveMeta, setLiveMeta]   = useState([]);
  const [dataSource, setDataSource] = useState("live");
  const [refreshing, setRefreshing] = useState(false);
  const [disabledHosts, setDisabledHosts] = useState(new Set());
  const [vmsByCluster, setVmsByCluster] = useState({}); // clusterName → VM count
  const [vmsByHost, setVmsByHost] = useState({});       // hostId → [vms]

  // Load per-host monitoring state (disabled hosts hide their VMs from the dashboard)
  useEffect(() => {
    window.HQ_API.request("/api/hosts/monitoring")
      .then(d => setDisabledHosts(new Set(d.disabled || [])))
      .catch(() => {});
    // VMs per cluster (distribution summary) and per host (host detail panel)
    window.HQ_API.request("/api/vms-live")
      .then(d => {
        const byCluster = {}, byHost = {};
        for (const v of (d.vms || [])) {
          const c = v.cluster || "—"; byCluster[c] = (byCluster[c] || 0) + 1;
          if (v.liveHostId) (byHost[v.liveHostId] = byHost[v.liveHostId] || []).push(v);
        }
        setVmsByCluster(byCluster);
        setVmsByHost(byHost);
      })
      .catch(() => {});
  }, []);

  const toggleMonitoring = (hostId, enabled) => {
    setDisabledHosts(prev => {
      const n = new Set(prev);
      if (enabled) n.delete(hostId); else n.add(hostId);
      return n;
    });
    window.HQ_API.request(`/api/hosts/${hostId}/monitoring`, { method: "PUT", body: { enabled } })
      .then(() => window.dispatchEvent(new CustomEvent("toast", { detail: { msg: enabled ? "Monitoreo habilitado" : window.I18N.t("ui.vms.monitoringOff", "Monitoring disabled — VMs hidden"), kind: "ok" } })))
      .catch(() => window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.vms.saveFailed", "Could not save the change"), kind: "error" } })));
  };

  const loadLiveHosts = () => {
    setRefreshing(true);
    return window.HQ_API.request("/api/hosts-live")
      .then(d => { setLiveHosts(d.hosts || []); setLiveMeta(d.meta || []); setDataSource("live"); })
      .catch(() => { setLiveHosts([]); setDataSource("mock"); })
      .finally(() => setRefreshing(false));
  };

  const syncAndLoadHosts = () => {
    setRefreshing(true);
    window.HQ_API.request("/api/connectors/vcenter/vcenter/sync", { method: "POST" })
      .catch(() => {})
      .finally(() => loadLiveHosts());
  };

  // On mount: show cached data instantly, then auto-sync for fresh vCenter data
  useEffect(() => { loadLiveHosts().then(() => syncAndLoadHosts()); }, []);

  const isLive    = dataSource === "live" && liveHosts?.length > 0;
  const isOffline = dataSource === "mock" && liveHosts?.length > 0;
  const rawHosts  = liveHosts?.length > 0 ? liveHosts : [];

  const hosts = useMemo(() => rawHosts.filter(h => {
    if (siteFilter !== "all" && h.site !== siteFilter) return false;
    if (clusterFilter !== "all" && (h.cluster || "—") !== clusterFilter) return false;
    if (q) {
      const s = q.toLowerCase();
      return h.name.toLowerCase().includes(s)
        || h.shortName?.toLowerCase().includes(s)
        || (h.model || "").toLowerCase().includes(s)
        || (h.cluster || "").toLowerCase().includes(s)
        || (h.mgmtIp || "").includes(s);
    }
    return true;
  }), [siteFilter, clusterFilter, q, rawHosts]);

  const hostsPagination = usePagination(hosts, { key: "ucs-hosts" });

  const siteOptions = useMemo(
    () => [...new Set(rawHosts.map(h => h.site).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      .map(site => [site, `${site} (${rawHosts.filter(h => h.site === site).length})`]),
    [rawHosts],
  );

  const counts = useMemo(() => ({
    total:  rawHosts.length,
    sites:  new Set(rawHosts.map(h => h.site).filter(Boolean)).size,
    online: rawHosts.filter(h => h.status === "online").length,
    offline:rawHosts.filter(h => h.status === "offline").length,
    vmsByHost: {},
  }), [rawHosts, isLive]);

  // Host + VM distribution per cluster (Sin cluster = standalone/disconnected hosts)
  const clusterDist = useMemo(() => {
    const byCluster = {};
    for (const h of rawHosts) {
      const c = (h.cluster && h.cluster !== "—") ? h.cluster : "Sin cluster";
      byCluster[c] = (byCluster[c] || 0) + 1;
    }
    const names = Object.keys(byCluster).filter(c => c !== "Sin cluster").sort();
    if (byCluster["Sin cluster"]) names.push("Sin cluster");
    return names.map(c => ({
      name: c,
      hosts: byCluster[c],
      vms: vmsByCluster[c === "Sin cluster" ? "—" : c] || 0,
    }));
  }, [rawHosts, vmsByCluster]);

  if (liveHosts === null) {
    return (
      <div style={{ display:"flex",alignItems:"center",gap:8,padding:24,color:"var(--muted-fg)",fontSize:13 }}>
        <Spinner /> Loading live hosts from vCenter…
      </div>
    );
  }

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display:"flex", gap:4, padding:3, background:"var(--muted)", borderRadius:7, width:"max-content", marginBottom:14 }}>
        {[["hosts","Hosts"],["topology",window.I18N.t("ui.topology", "Topology")]].map(([k,l]) => (
          <button key={k} onClick={() => setHostsTab(k)} style={{
            height:28, padding:"0 12px",
            background: hostsTab===k ? "white" : "transparent",
            border: hostsTab===k ? "1px solid var(--border)" : "1px solid transparent",
            boxShadow: hostsTab===k ? "0 1px 1px rgba(0,0,0,.04)" : "none",
            borderRadius:5, fontSize:12.5, fontFamily:"inherit",
            color: hostsTab===k ? "var(--fg)" : "var(--muted-fg)",
            cursor:"pointer", fontWeight:500,
          }}>{l}</button>
        ))}
      </div>

      {hostsTab === "topology" && (
        <TopologyPanel clusterDist={clusterDist} devices={devices} devicesLoaded={devicesLoaded} hosts={rawHosts} />
      )}

      {hostsTab === "hosts" && <>
      {/* Source banner */}
      {isLive && (
        <SourceBanner meta={liveMeta} source={dataSource}
          onSwitch={() => setDataSource("mock")} onRefresh={loadLiveHosts} refreshing={refreshing} />
      )}
      {isOffline && (
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
          background:"color-mix(in srgb, var(--muted-fg) 6%, white)",
          border:"1px solid var(--border)", borderRadius:7, fontSize:12, marginBottom:12 }}>
          <span style={{ width:7,height:7,borderRadius:999,background:"var(--muted-fg)",flexShrink:0 }} />
          <span style={{ fontWeight:600,color:"var(--muted-fg)" }}>{vt("vms.offlineMode", "Offline mode")}</span>
          <span style={{ color:"var(--muted-fg)" }}>· showing last cached vCenter data</span>
          <button onClick={() => { setDataSource("live"); syncAndLoadHosts(); }}
            style={{ marginLeft:"auto",height:22,padding:"0 8px",border:"1px solid var(--border)",
              background:"white",borderRadius:4,fontSize:11,cursor:"pointer",color:"var(--accent)",fontWeight:600 }}>
            ↻ Go live
          </button>
        </div>
      )}
      {!isLive && !isOffline && liveHosts?.length === 0 && (
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
          background:"color-mix(in srgb, var(--warn) 8%, white)",
          border:"1px solid color-mix(in srgb, var(--warn) 20%, var(--border))",
          borderRadius:7,fontSize:12,marginBottom:12 }}>
          <span style={{ color:"var(--warn)" }}>⚠</span>
          <span>No vCenter data yet. Go to <b>Connectors → VMware vCenter → Configure</b> to connect.</span>
        </div>
      )}

      <p style={{ margin:"0 0 14px",color:"var(--muted-fg)",fontSize:13 }}>
        {counts.total} hosts · {counts.sites} {counts.sites === 1 ? "site" : "sites"}
        · {counts.online} <span style={{ color:"var(--ok)" }}>online</span>
        {counts.offline > 0 && <> · {counts.offline} <span style={{ color:"var(--err)" }}>offline</span></>}
        {isLive && <span style={{ marginLeft:8,fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ok)" }}>● live</span>}
      </p>

      {/* Distribución por cluster (clic para filtrar) */}
      {isLive && clusterDist.length > 0 && (
        <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:14 }}>
          {clusterDist.map(c => {
            const isSin = c.name === "Sin cluster";
            const fval = isSin ? "—" : c.name;
            const active = clusterFilter === fval;
            return (
              <div key={c.name}
                onClick={() => setClusterFilter(active ? "all" : fval)}
                title={isSin ? window.I18N.t("ui.vms.standaloneHelp", "Standalone or disconnected hosts (not in a cluster) — click to filter") : window.I18N.t("ui.vms.filter", "Filter by {0}", { 0: c.name })}
                style={{ display:"flex",flexDirection:"column",gap:2,padding:"8px 12px",borderRadius:8,minWidth:118,
                  border:`1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active ? "color-mix(in srgb,var(--accent) 8%,white)" : (isSin ? "var(--muted)" : "white"),
                  cursor: "pointer" }}>
                <span style={{ fontFamily:"var(--font-mono)",fontWeight:700,fontSize:12,color:isSin?"var(--muted-fg)":"var(--fg)" }}>{c.name}</span>
                <span style={{ fontSize:11,color:"var(--muted-fg)" }}>
                  <b style={{ color:"var(--fg)" }}>{c.hosts}</b> hosts
                  {c.vms > 0 && <> · <b style={{ color:"var(--fg)" }}>{c.vms}</b> VMs</>}
                  {isSin && c.vms === 0 && window.I18N.t("ui.vms.standalone", " · standalone/disconnected")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center" }}>
        <div style={{ position:"relative",flex:"0 1 280px" }}>
          <span style={{ position:"absolute",left:9,top:8,color:"var(--muted-fg)",fontSize:13 }}>⌕</span>
          <input placeholder="Search host, mgmt IP, cluster…" value={q} onChange={e => setQ(e.target.value)}
            style={{ width:"100%",height:32,padding:"0 10px 0 28px",border:"1px solid var(--border)",
              borderRadius:6,fontSize:13,fontFamily:"inherit",background:"white" }} />
        </div>
        {/* Las opciones salen de los hosts que hay: la lista fija ofrecia dos
            sedes concretas y escondia cualquier otra. */}
        <FilterChip label="Site" value={siteFilter}
          options={[["all","All"], ...siteOptions]}
          onChange={setSiteFilter} />
        <div style={{ marginLeft:"auto",fontSize:12,color:"var(--muted-fg)" }}>{hosts.length} of {counts.total}</div>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",gap:10 }}>
        {hostsPagination.pageItems.map(h => {
          const vmCount = counts.vmsByHost[h.id] || 0;
          const genColor = h.gen==="M4"?"#a8a29e":h.gen==="M5"?"#2563eb":"#10b981";
          const siteColor = h.site==="MEX"?"#2563eb":"#0891b2";
          return (
            <div key={h.id} onClick={() => setSelectedHost(h)}
              style={{ background:"white",border:"1px solid var(--border)",borderRadius:8,padding:12,cursor:"pointer" }}
              onMouseEnter={e => e.currentTarget.style.borderColor="var(--accent)"}
              onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6 }}>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <StatusDot status={h.status} />
                  <span style={{ fontFamily:"var(--font-mono)",fontWeight:600,fontSize:13 }}>{h.shortName || h.name.split(".")[0]}</span>
                </div>
                <div style={{ display:"flex",gap:4 }}>
                  {disabledHosts.has(h.id) && (
                    <span style={{ fontSize:10,fontWeight:700,letterSpacing:0.4,padding:"2px 6px",borderRadius:3,
                      fontFamily:"var(--font-mono)",background:"var(--muted)",color:"var(--muted-fg)" }} title={window.I18N.t("ui.vms.monitoringOff", "Monitoring disabled — VMs hidden")}>MON OFF</span>
                  )}
                  <span style={{ fontSize:10,fontWeight:700,letterSpacing:0.4,padding:"2px 6px",borderRadius:3,
                    fontFamily:"var(--font-mono)",background:`${siteColor}1a`,color:siteColor }}>{h.site}</span>
                  {h.gen && h.gen !== "—" && (
                    <span style={{ fontSize:10,fontWeight:700,letterSpacing:0.4,padding:"2px 6px",borderRadius:3,
                      fontFamily:"var(--font-mono)",background:`${genColor}1a`,color:genColor }}>{h.gen}</span>
                  )}
                </div>
              </div>
              <div style={{ fontSize:11,color:"var(--muted-fg)",marginBottom:8,fontFamily:"var(--font-mono)" }}>
                {h.name}
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"max-content 1fr",gap:"3px 8px",fontSize:11,marginBottom:10 }}>
                <span style={{ color:"var(--muted-fg)" }}>vCenter</span>   <span style={{ fontFamily:"var(--font-mono)" }}>{h.vcenterName}</span>
                {h.cluster !== "—" && <><span style={{ color:"var(--muted-fg)" }}>Cluster</span><span style={{ fontFamily:"var(--font-mono)" }}>{h.cluster}</span></>}
                {h.mgmtIp !== "—" && <><span style={{ color:"var(--muted-fg)" }}>Mgmt IP</span><span style={{ fontFamily:"var(--font-mono)" }}>{h.mgmtIp}</span></>}
                {h.chassisId && <><span style={{ color:"var(--muted-fg)" }}>Chassis/Slot</span><span style={{ fontFamily:"var(--font-mono)" }}>Chassis {h.chassisId} · Slot {h.slot}</span></>}
                {h.esxiVersion !== "—" && <><span style={{ color:"var(--muted-fg)" }}>ESXi</span><span style={{ fontFamily:"var(--font-mono)" }}>{h.esxiVersion}</span></>}
                {h.cores > 0 && <><span style={{ color:"var(--muted-fg)" }}>{vt("hosts.cores", "Cores/RAM")}</span><span style={{ fontFamily:"var(--font-mono)" }}>{h.cores}c / {h.ramTotalGB}GB</span></>}
                <span style={{ color:"var(--muted-fg)" }}>Status</span>
                <span style={{ fontFamily:"var(--font-mono)",color:h.status==="online"?"var(--ok)":h.status==="offline"?"var(--err)":"var(--warn)" }}>
                  {h.connection_state || (h.status==="online"?"CONNECTED":"DISCONNECTED")}
                </span>
              </div>
              {(h.cpu > 0 || h.ram > 0) && (
                <div style={{ display:"flex",flexDirection:"column",gap:3,marginBottom:10 }}>
                  <CapacityBar value={h.cpu} label="CPU" />
                  <CapacityBar value={h.ram} label="RAM" />
                </div>
              )}
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:"var(--muted-fg)" }}>
                {!isLive && <span><b style={{ color:"var(--fg)",fontFamily:"var(--font-mono)" }}>{vmCount}</b> VMs</span>}
                {isLive && <span style={{ fontSize:10,fontFamily:"var(--font-mono)",color:"var(--ok)" }}>● {h.power_state}</span>}
                {h.uptime !== "—" && <span style={{ fontFamily:"var(--font-mono)" }}>{h.uptime}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <PaginationBar {...hostsPagination} />

      <HostDetail host={selectedHost} isLive={isLive} onClose={() => setSelectedHost(null)}
        monitoringEnabled={selectedHost ? !disabledHosts.has(selectedHost.id) : true}
        onToggleMonitoring={toggleMonitoring}
        liveVms={selectedHost ? (vmsByHost[selectedHost.id] || []) : []}
        onOpenVM={(vm) => { window.__hqVmFocus = vm.name; onNavigate && onNavigate("vms"); }} />
      </>}
    </div>
  );
}

// ── Topology tab — MEX/GDL infra flow diagrams (mermaid, built from live Devices + cluster data) ──
let topoMermaidInitDone = false;
function TopologyDiagram({ code }) {
  const [svg, setSvg]     = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!window.mermaid) { setError(window.I18N.t("ui.mermaidFailed", "Mermaid failed to load")); return; }
    if (!topoMermaidInitDone) {
      window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
      topoMermaidInitDone = true;
    }
    const id = `topo-${Math.random().toString(36).slice(2)}`;
    window.mermaid.render(id, code)
      .then(({ svg }) => setSvg(svg))
      .catch(e => setError(e.message || window.I18N.t("home.mermaid.renderError", "Error rendering the diagram")));
  }, [code]);

  if (error) return <div style={{ fontSize:11.5, color:"var(--err)", padding:10 }}>⚠ {error}</div>;
  if (!svg) return <div style={{ fontSize:11.5, color:"var(--muted-fg)", padding:10 }}>{window.I18N.t("ui.rendering", "Rendering…")}</div>;
  return <div style={{ overflowX:"auto" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function buildTopoMermaid({ clusterName, hostCount, vmCount, routers, fis, chassisList }) {
  const esc = s => String(s).replace(/"/g, "'");
  const lines = ["flowchart TD"];
  lines.push(`MPLS["MPLS / OAM"]`);
  routers.forEach((r, i) => {
    lines.push(`R${i}["${esc(r.name)}<br/>${r.mgmtIp}"]`);
    lines.push(`MPLS --> R${i}`);
  });
  if (fis.length) {
    fis.forEach((f, i) => {
      const role = i === 0 ? "Primary" : "Subordinate";
      lines.push(`FI${i}["${esc(f.name)}<br/>${f.mgmtIp} · ${role}"]`);
    });
    routers.forEach((r, i) => lines.push(`R${i} --> FI${i % fis.length}`));
    if (fis.length === 2) lines.push(`FI0 -.-> FI1`);
    lines.push(`VC["vCenter — ${esc(clusterName)}<br/>${hostCount} hosts · ${vmCount} VMs"]`);
    if (chassisList && chassisList.length) {
      // Real chassis inventory from UCS Manager — only the ones that actually hold hosts of this cluster
      chassisList.forEach((c, i) => {
        lines.push(`C${i}["Chasis ${c.id}<br/>${c.hostsInCluster} host${c.hostsInCluster === 1 ? "" : "s"} de ${esc(clusterName)}"]`);
        fis.forEach((_, fi) => lines.push(`FI${fi} --> C${i}`));
        lines.push(`C${i} --> VC`);
      });
    } else {
      fis.forEach((_, i) => lines.push(`FI${i} --> VC`));
    }
  } else {
    lines.push(`FIX["Fabric Interconnect<br/>no inventariado en Devices"]:::missing`);
    routers.forEach((r, i) => lines.push(`R${i} --> FIX`));
    lines.push(`VC["vCenter — ${esc(clusterName)}<br/>${hostCount} hosts · ${vmCount} VMs"]`);
    lines.push(`FIX --> VC`);
    lines.push(`classDef missing fill:#fff3cd,stroke:#d97706,stroke-dasharray: 5 5,color:#92400e`);
  }
  return lines.join("\n");
}

function TopologyPanel({ clusterDist, devices, devicesLoaded, hosts }) {
  const byName = Object.fromEntries(clusterDist.map(c => [c.name, c]));
  const sites = [
    { site: "MEX", clusters: ["MEX-TOOLS", "MEX-HX"] },
    { site: "GDL", clusters: ["GDL-TOOLS", "GDL-HX"] },
  ];

  // Real chassis inventory from UCS Manager (chassis/blades), fetched once
  const [ucsmSites, setUcsmSites] = useState({});
  useEffect(() => {
    window.HQ_API.request("/api/connectors/status")
      .then(d => setUcsmSites(d?.ucsm?.sites || {}))
      .catch(() => {});
  }, []);

  if (!devicesLoaded) {
    return <div style={{ padding:24, color:"var(--muted-fg)", fontSize:13, display:"flex", alignItems:"center", gap:8 }}><Spinner /> {window.I18N.t("ui.vms.loadingInventory", "Loading Devices inventory…")}</div>;
  }

  if (!devices.length) {
    return <div style={{ padding:24, color:"var(--muted-fg)", fontSize:13 }}>{window.I18N.t("ui.vms.noDevices", "No Devices registered — topology correlates UCS Manager chassis with routers and fabric interconnects from Devices.")}</div>;
  }

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(420px, 1fr))", gap:14 }}>
      {sites.flatMap(({ site, clusters }) => clusters.map(clusterName => {
        const routers = devices.filter(d => d.kind === "router" && d.model === "NCS-5500" && d.site === site)
          .sort((a,b) => a.name.localeCompare(b.name));
        // Same FI pair serves both the -TOOLS and -HX clusters of a site
        const fis = devices.filter(d => d.fabricProvider === "ucs-nxos" && d.site === site)
          .sort((a,b) => a.name.localeCompare(b.name));
        const c = byName[clusterName];
        // Real chassis holding hosts of THIS cluster (a chassis can mix TOOLS + HX blades)
        const siteChassis = ucsmSites[site]?.chassis || [];
        const chassisList = siteChassis.map(ch => ({
          id: ch.id,
          hostsInCluster: (hosts || []).filter(h => h.chassisId === ch.id && h.cluster === clusterName).length,
        })).filter(ch => ch.hostsInCluster > 0).sort((a,b) => a.id.localeCompare(b.id));
        const code = buildTopoMermaid({
          clusterName,
          hostCount: c?.hosts ?? 0,
          vmCount: c?.vms ?? 0,
          routers: routers.map(r => ({ name: r.name, mgmtIp: r.mgmtIp })),
          fis: fis.map(f => ({ name: f.name, mgmtIp: f.mgmtIp })),
          chassisList,
        });
        return (
          <div key={clusterName} style={{ background:"white", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden" }}>
            <div style={{ padding:"10px 14px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"var(--font-mono)", fontWeight:700, fontSize:12.5 }}>{clusterName}</span>
              <span style={{ fontSize:11, color:"var(--muted-fg)" }}>{c?.hosts ?? 0} hosts · {c?.vms ?? 0} VMs</span>
              {!fis.length && <span style={{ marginLeft:"auto", fontSize:9.5, fontWeight:700, padding:"2px 6px", borderRadius:3, background:"#fff3cd", color:"#92400e" }}>{window.I18N.t("ui.vms.fiMissing", "FI NOT IN INVENTORY")}</span>}
            </div>
            <TopologyDiagram code={code} />
          </div>
        );
      }))}
    </div>
  );
}

function HostDetail({ host, isLive, onClose, monitoringEnabled = true, onToggleMonitoring, liveVms = [], onOpenVM }) {
  if (!host) return null;
  const kk = { color:"var(--muted-fg)",fontWeight:500 };
  const vv = { fontFamily:"var(--font-mono)",cursor:"pointer",color:"var(--fg)",textDecoration:"underline dotted var(--border)",textUnderlineOffset:3 };
  const sectionTitle = { fontSize:10.5,fontWeight:600,letterSpacing:0.6,color:"var(--muted-fg)",textTransform:"uppercase",marginBottom:6 };
  const vms = (isLive ? liveVms : [])
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={{ position:"fixed",right:0,top:0,bottom:0,width:460,background:"white",
      borderLeft:"1px solid var(--border)",boxShadow:"-10px 0 24px -16px rgba(0,0,0,.18)",
      zIndex:50,display:"flex",flexDirection:"column" }}>
      <div style={{ padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <StatusDot status={host.status} />
          <span style={{ fontFamily:"var(--font-mono)",fontWeight:600,fontSize:14 }}>{host.shortName || host.name.split(".")[0]}</span>
          {host.gen && host.gen !== "—" && (
            <span style={{ fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:3,background:"var(--muted)",color:"var(--muted-fg)",fontFamily:"var(--font-mono)" }}>{host.gen}</span>
          )}
        </div>
        <button onClick={onClose} style={{ background:"none",border:0,cursor:"pointer",fontSize:18,color:"var(--muted-fg)" }}>×</button>
      </div>
      <div style={{ padding:16,overflow:"auto",display:"flex",flexDirection:"column",gap:16 }}>
        <div style={{ display:"grid",gridTemplateColumns:"max-content 1fr",gap:"6px 12px",fontSize:12 }}>
          <span style={kk}>FQDN</span>       <span style={vv} onClick={() => copyToClipboard(host.fqdn||host.name,"FQDN")}>{host.fqdn||host.name}</span>
          <span style={kk}>vCenter</span>    <span>{host.vcenterName}</span>
          <span style={kk}>Site</span>       <span style={{ fontFamily:"var(--font-mono)",fontWeight:600,color:host.site==="MEX"?"#2563eb":"#0891b2" }}>{host.site}</span>
          <span style={kk}>{vt("hosts.power", "Power")}</span>      <span style={{ fontFamily:"var(--font-mono)",color:host.status==="online"?"var(--ok)":host.status==="offline"?"var(--err)":"var(--warn)" }}>{host.power_state || "—"}</span>
          <span style={kk}>Connection</span> <span style={{ fontFamily:"var(--font-mono)" }}>{host.connection_state || "—"}</span>
          {host.model !== "—" && <><span style={kk}>Model</span><span style={{ fontFamily:"var(--font-mono)" }}>{host.model}</span></>}
          {host.cluster !== "—" && <><span style={kk}>Cluster</span><span style={{ fontFamily:"var(--font-mono)" }}>{host.cluster}</span></>}
          {host.mgmtIp !== "—" && <><span style={kk}>Mgmt IP</span><span style={vv} onClick={() => copyToClipboard(host.mgmtIp,"Mgmt IP")}>{host.mgmtIp}</span></>}
          {host.esxiVersion !== "—" && <><span style={kk}>ESXi</span><span style={{ fontFamily:"var(--font-mono)" }}>{host.esxiVersion}</span></>}
          {host.cores > 0 && <><span style={kk}>CPU</span><span style={{ fontFamily:"var(--font-mono)" }}>{host.cpuModel} · {host.cores} {vt("hosts.cores", "cores")}</span></>}
          {host.ramTotalGB > 0 && <><span style={kk}>RAM</span><span style={{ fontFamily:"var(--font-mono)" }}>{host.ramTotalGB} GB</span></>}
          {host.uptime !== "—" && <><span style={kk}>Uptime</span><span style={{ fontFamily:"var(--font-mono)" }}>{host.uptime}</span></>}
        </div>

        {(host.cpu > 0 || host.ram > 0) && (
          <div>
            <div style={sectionTitle}>{vt("hosts.resources", "Resources")}</div>
            <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
              <CapacityBar value={host.cpu} label="CPU" />
              <CapacityBar value={host.ram} label="RAM" />
            </div>
          </div>
        )}

        {isLive && onToggleMonitoring && (
          <div>
            <div style={sectionTitle}>{window.I18N.t("ui.vms.monitoring", "Monitoring")}</div>
            <button onClick={() => onToggleMonitoring(host.id, !monitoringEnabled)}
              style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
                padding:"10px 12px",borderRadius:7,cursor:"pointer",fontFamily:"inherit",fontSize:12.5,fontWeight:600,
                border:`1px solid ${monitoringEnabled ? "color-mix(in srgb,var(--ok) 30%,var(--border))" : "var(--border)"}`,
                background: monitoringEnabled ? "color-mix(in srgb,var(--ok) 7%,white)" : "var(--muted)",
                color: monitoringEnabled ? "var(--ok)" : "var(--muted-fg)" }}>
              <span>{monitoringEnabled ? "🟢 Habilitado" : "⚪ Deshabilitado"}</span>
              <span style={{ fontSize:11,fontWeight:500 }}>{monitoringEnabled ? window.I18N.t("ui.vms.disable", "Click to disable") : window.I18N.t("ui.vms.enableClick", "Click to enable")}</span>
            </button>
            {!monitoringEnabled && (
              <div style={{ fontSize:11,color:"var(--muted-fg)",marginTop:6,lineHeight:1.4 }}>{window.I18N.t("ui.vms.hostVms", "This host's VMs are")} <b>{window.I18N.t("ui.vms.hidden", "hidden")}</b> {window.I18N.t("ui.vms.hiddenHelp", "from dashboard counts and lists.")} </div>
            )}
          </div>
        )}

        <div>
          <div style={sectionTitle}>{vt("hosts.actions", "Actions")}</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
            <BigAction icon="↗" label="vCenter" sub="open in browser" onClick={() => window.dispatchEvent(new CustomEvent("toast",{detail:{msg:"Opening host in vCenter…"}}))} />
            {host.mgmtIp !== "—" && <BigAction icon="›_" label="SSH ESXi" sub={`root@${host.mgmtIp}`} onClick={() => window.dispatchEvent(new CustomEvent("toast",{detail:{msg:`Opening SSH to ${host.mgmtIp}…`}}))} />}
            <BigAction icon="⎘" label="Copy FQDN" sub={host.fqdn||host.name} onClick={() => copyToClipboard(host.fqdn||host.name,"FQDN")} />
          </div>
        </div>

        {vms.length > 0 ? (
          <div>
            <div style={sectionTitle}>VMs on this host ({vms.length})</div>
            <div style={{ display:"flex",flexDirection:"column",gap:4,maxHeight:340,overflow:"auto" }}>
              {vms.map(vm => (
                <div key={vm.id}
                  onClick={isLive && onOpenVM ? () => onOpenVM(vm) : undefined}
                  title={isLive && onOpenVM ? `Ver ${vm.name} en VMs` : vm.name}
                  style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 8px",border:"1px solid var(--border)",borderRadius:5,
                    cursor: isLive && onOpenVM ? "pointer" : "default" }}
                  onMouseEnter={isLive && onOpenVM ? (e => e.currentTarget.style.borderColor="var(--accent)") : undefined}
                  onMouseLeave={isLive && onOpenVM ? (e => e.currentTarget.style.borderColor="var(--border)") : undefined}>
                  <StatusDot status={vm.status} size={6} />
                  <span style={{ fontFamily:"var(--font-mono)",fontSize:11.5,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{vm.name}</span>
                  {isLive && vm.ip && vm.ip !== "—" && (
                    <span style={{ fontFamily:"var(--font-mono)",fontSize:10.5,color:"var(--muted-fg)" }}>{vm.ip}</span>
                  )}
                  {isLive && (
                    <span style={{ fontSize:9.5,fontWeight:700,fontFamily:"var(--font-mono)",color:vm.power_state==="POWERED_ON"?"var(--ok)":"var(--muted-fg)" }}>
                      {vm.power_state==="POWERED_ON"?"ON":"OFF"}
                    </span>
                  )}
                  <EnvBadge env={vm.env} />
                </div>
              ))}
            </div>
          </div>
        ) : isLive ? (
          <div style={{ fontSize:11.5,color:"var(--muted-fg)",fontStyle:"italic" }}>{window.I18N.t("ui.vms.noHostVms", "No VMs on this host.")}</div>
        ) : null}
      </div>
    </div>
  );
}

// Public demo data only. Real network inventories belong in the authenticated
// live connector response and must never be shipped with the application.
const PUBLIC_VLAN_DATA = [
  {
    id: "demo-network",
    label: "Demo network",
    name: "DEMO",
    gdl: [
      { ip: "10.0.0.1", name: "demo-host-01", notes: "Example address", type: "host" },
      { ip: "10.0.0.2", name: "demo-host-02", notes: "Example address", type: "host" },
    ],
    mex: [],
  },
];

function IPReferenceView() {
  const [q, setQ]         = useState("");
  const [open, setOpen]   = useState(() => Object.fromEntries(PUBLIC_VLAN_DATA.map(v => [v.id, true])));
  const [vcMap, setVcMap] = useState({});   // ip → { name, power_state }
  const [devMap, setDevMap] = useState({}); // ip → { name, kind }

  useEffect(() => {
    const token = window.HQ_API?.getToken?.();
    if (!token) return;
    fetch("/api/vms-live", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.vms) return;
        const map = {};
        data.vms.forEach(vm => { if (vm.ip && vm.ip !== "—") map[vm.ip] = { name: vm.name, power: vm.power_state }; });
        setVcMap(map);
      })
      .catch(() => {});
    // Load devices to cross-reference IPs
    fetch("/api/devices", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(devs => {
        const map = {};
        (devs || []).forEach(d => { if (d.mgmtIp) map[d.mgmtIp] = { name: d.name, kind: d.kind }; });
        setDevMap(map);
      })
      .catch(() => {});
  }, []);

  const toggle = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));

  const matches = (rows) => !q ? rows : rows.filter(r =>
    r.ip.includes(q) ||
    (r.name||"").toLowerCase().includes(q.toLowerCase()) ||
    (r.notes||"").toLowerCase().includes(q.toLowerCase())
  );

  const rowStyle = (r) => ({
    background: r.type === "network" ? "color-mix(in srgb,var(--accent) 8%,white)"
              : r.type === "gateway" ? "color-mix(in srgb,var(--ok) 8%,white)"
              : r.warn                ? "color-mix(in srgb,var(--err) 6%,white)"
              : devMap[r.ip]          ? "#e8f0fe"   // light blue — IP is a registered Device
              : "white",
    borderTop: "1px solid var(--border)",
    borderLeft: devMap[r.ip] ? "3px solid #2563eb" : "3px solid transparent",
  });

  const IPTable = ({ rows, site, color }) => {
    const filtered = matches(rows);
    if (!filtered.length && q) return null;
    return (
      <div style={{ flex:1, minWidth:0, border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <div style={{ padding:"7px 12px", background:color+"18", borderBottom:"1px solid var(--border)",
          display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontWeight:700, fontSize:12, color, fontFamily:"var(--font-mono)" }}>{site}</span>
          <span style={{ fontSize:11, color:"var(--muted-fg)" }}>{rows[0]?.ip?.includes("/") ? rows[0].ip : "—"}</span>
          {Object.keys(devMap).length > 0 && filtered.filter(r => devMap[r.ip]).length > 0 && (
            <span style={{ fontSize:10, color:"#2563eb", display:"inline-flex", alignItems:"center", gap:4, background:"#e8f0fe", padding:"1px 7px", borderRadius:3, fontWeight:600 }}>
              📡 {filtered.filter(r => devMap[r.ip]).length} {window.I18N.t("ui.vms.inDevices", "in Devices")} </span>
          )}
          <span style={{ marginLeft:"auto", fontSize:11, color:"var(--muted-fg)" }}>{filtered.length} entries</span>
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr style={{ background:"var(--muted)", fontSize:10.5, letterSpacing:0.4, textTransform:"uppercase", color:"var(--muted-fg)" }}>
              <th style={{ padding:"5px 10px", textAlign:"left", fontFamily:"var(--font-mono)", width:130 }}>IP</th>
              <th style={{ padding:"5px 10px", textAlign:"left" }}>{vt("vms.serverName", "Server Name")}</th>
              <th style={{ padding:"5px 10px", textAlign:"left", width:70 }}>{vt("vms.admin", "Admin")}</th>
              <th style={{ padding:"5px 10px", textAlign:"left" }}>{vt("vms.notes", "Notes")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} style={rowStyle(r)}
                onMouseEnter={e => { if(!r.type) e.currentTarget.style.background="var(--row-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = rowStyle(r).background; }}>
                <td style={{ padding:"5px 10px", fontFamily:"var(--font-mono)", fontSize:11.5,
                  color: r.type ? "var(--muted-fg)" : "var(--accent)", cursor: r.type ? "default" : "pointer" }}
                  onClick={() => !r.type && copyToClipboard(r.ip, "IP")}>
                  {r.ip}
                </td>
                <td style={{ padding:"5px 10px", fontStyle: r.italic ? "italic" : "normal",
                  color: r.warn ? "var(--err)" : r.type ? "var(--muted-fg)" : "var(--fg)",
                  fontWeight: r.type ? 500 : 400 }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                    <span>{r.name || <span style={{ color:"var(--muted-fg)" }}>—</span>}</span>
                    {devMap[r.ip] && (
                      <span title={`Registered device: ${devMap[r.ip].name}`} style={{
                        display:"inline-flex", alignItems:"center", gap:3,
                        fontSize:10, fontWeight:600, fontStyle:"normal",
                        padding:"1px 6px", borderRadius:3, fontFamily:"var(--font-mono)",
                        background:"#2563eb", color:"white", cursor:"default",
                      }}>
                        📡 {devMap[r.ip].name}
                      </span>
                    )}
                    {vcMap[r.ip] && (
                      <span title={`vCenter: ${vcMap[r.ip].name} (${vcMap[r.ip].power})`} style={{
                        display:"inline-flex", alignItems:"center", gap:3,
                        fontSize:10, fontWeight:500, fontStyle:"normal",
                        padding:"1px 5px", borderRadius:3, fontFamily:"var(--font-mono)",
                        background: vcMap[r.ip].power === "POWERED_ON"
                          ? "color-mix(in srgb,var(--ok) 14%,white)"
                          : "color-mix(in srgb,var(--muted-fg) 10%,white)",
                        color: vcMap[r.ip].power === "POWERED_ON" ? "var(--ok)" : "var(--muted-fg)",
                        border: "1px solid var(--border)", cursor:"default",
                      }}>
                        {vcMap[r.ip].power === "POWERED_ON" ? "●" : "○"}
                        <span style={{ color:"var(--fg)", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {vcMap[r.ip].name}
                        </span>
                      </span>
                    )}
                  </span>
                </td>
                <td style={{ padding:"5px 10px", fontFamily:"var(--font-mono)", fontSize:11, color:"var(--muted-fg)" }}>
                  {r.admin || ""}
                </td>
                <td style={{ padding:"5px 10px", fontSize:11.5, color: r.warn ? "var(--err)" : "var(--muted-fg)" }}>
                  {r.notes || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // When searching, auto-expand VLANs that have matches
  const hasMatch = (vlan) =>
    matches(vlan.gdl).length > 0 || matches(vlan.mex).length > 0;

  const isOpen = (vlan) => q ? hasMatch(vlan) : !!open[vlan.id];

  return (
    <div>
      {/* Header bar */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:"0 1 260px" }}>
          <span style={{ position:"absolute", left:9, top:8, color:"var(--muted-fg)", fontSize:13 }}>⌕</span>
          <input placeholder="Search IP, name, notes…" value={q} onChange={e => setQ(e.target.value)}
            style={{ width:"100%", height:32, padding:"0 10px 0 28px", border:"1px solid var(--border)",
              borderRadius:6, fontSize:13, fontFamily:"inherit", background:"white", outline:"none",
              boxSizing:"border-box" }}
            onFocus={e => e.target.style.borderColor="var(--accent)"}
            onBlur={e => e.target.style.borderColor="var(--border)"} />
        </div>
        <span style={{ fontSize:12, color:"var(--muted-fg)" }}>{vt("vms.clickIp", "Click any IP to copy")}</span>
        <button onClick={() => {
          const allOpen = {};
          PUBLIC_VLAN_DATA.forEach(v => allOpen[v.id] = true);
          setOpen(allOpen);
        }} style={{ marginLeft:"auto", fontSize:12, padding:"4px 10px", borderRadius:6,
          border:"1px solid var(--border)", background:"white", cursor:"pointer", color:"var(--muted-fg)", fontFamily:"inherit" }}>
          Expand all
        </button>
        <button onClick={() => setOpen({})} style={{ fontSize:12, padding:"4px 10px", borderRadius:6,
          border:"1px solid var(--border)", background:"white", cursor:"pointer", color:"var(--muted-fg)", fontFamily:"inherit" }}>
          Collapse all
        </button>
      </div>

      {/* Accordion */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {PUBLIC_VLAN_DATA.map(vlan => {
          const opened = isOpen(vlan);
          const isEmpty = vlan.gdl.length === 0 && vlan.mex.length === 0;
          const totalEntries = vlan.gdl.filter(r => !r.type).length + vlan.mex.filter(r => !r.type).length;

          return (
            <div key={vlan.id} style={{ border:"1px solid var(--border)", borderRadius:10, overflow:"hidden",
              boxShadow: opened ? "0 2px 8px rgba(0,0,0,.05)" : "none" }}>
              {/* Accordion header */}
              <button onClick={() => !q && toggle(vlan.id)} style={{
                width:"100%", display:"flex", alignItems:"center", gap:10,
                padding:"10px 16px", background: opened ? "var(--muted)" : "white",
                border:"none", cursor: q ? "default" : "pointer", textAlign:"left",
                fontFamily:"inherit", transition:"background .15s",
              }}>
                <span style={{ fontSize:12, color: opened ? "var(--accent)" : "var(--muted-fg)",
                  transition:"transform .2s", display:"inline-block",
                  transform: opened ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:4,
                  background: isEmpty ? "var(--muted)" : "color-mix(in srgb,var(--accent) 12%,white)",
                  color: isEmpty ? "var(--muted-fg)" : "var(--accent)",
                  fontFamily:"var(--font-mono)", letterSpacing:0.4 }}>{vlan.label}</span>
                {vlan.name && <span style={{ fontSize:13, fontWeight:600, color:"var(--fg)" }}>{vlan.name}</span>}
                {vlan.gdl[0]?.ip && <span style={{ fontSize:11, color:"var(--muted-fg)", fontFamily:"var(--font-mono)" }}>
                  GDL {vlan.gdl[0].ip} · MEX {vlan.mex[0]?.ip || "—"}
                </span>}
                <span style={{ marginLeft:"auto", fontSize:11, color:"var(--muted-fg)" }}>
                  {isEmpty ? "no data yet" : `${totalEntries} IPs`}
                </span>
              </button>

              {/* Accordion body */}
              {opened && (
                <div style={{ padding:14, background:"white", borderTop:"1px solid var(--border)" }}>
                  {isEmpty ? (
                    <div style={{ padding:"24px 0", textAlign:"center", color:"var(--muted-fg)", fontSize:13 }}>
                      <div style={{ fontSize:22, marginBottom:6 }}>📋</div>
                      No data yet — share the Excel screenshot for <strong>{vlan.label}</strong> to add IPs
                    </div>
                  ) : (
                    <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                      <IPTable rows={vlan.gdl} site="GDL" color="#0891b2" />
                      <IPTable rows={vlan.mex} site="MEX" color="#2563eb" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Wrappers ──────────────────────────────────────────────────────────────────
// ── SSH Workspace — full-page multi-session terminal environment ─────────────
function SSHWorkspaceView({ sessions, onRemoveSession, onBack, onClear, focusSessionId, onFocusHandled, onSessionStatus }) {
  const [activeId,     setActiveId]     = useState(sessions[0]?.id);
  const [tabStatuses,  setTabStatuses]  = useState({});
  // Mirrors each tab's live status up to the shell so the Devices/VMs sub-item
  // that started it can show whether it's actually still connected, not just
  // whether SSH Workspace happens to be the page you're looking at.
  const handleStatusChange = (id, st) => {
    setTabStatuses(p => ({ ...p, [id]: st }));
    onSessionStatus?.(id, st);
  };
  const [broadcast,    setBroadcast]    = useState(false);
  const [broadcastCmd, setBroadcastCmd] = useState("");
  // layout: "tabs" | "grid"
  const [layout, setLayout] = useState("tabs");
  const wsRegistryRef   = useRef({});
  const termRegistryRef = useRef({});
  const reconnectRegistryRef = useRef({});
  const [copied, setCopied] = useState(false);

  // "Back" should return to wherever the tab you're looking at was opened
  // from (Devices/Containers), not always assume VMs.
  const activeSession = sessions.find(s => s.id === activeId);
  const backTarget = activeSession?.source === "devices" ? "devices" : activeSession?.source === "containers" ? "containers" : "vms";
  const backLabel  = backTarget === "devices" ? "Devices" : backTarget === "containers" ? "Containers" : "VMs";

  function copyActiveTerminal() {
    const termRef = termRegistryRef.current[activeId];
    const term    = termRef?.current;
    if (!term) return;
    try {
      term.selectAll();
      const text = term.getSelection();
      term.clearSelection();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    } catch (e) {
      console.warn("[copy terminal]", e.message);
    }
  }

  // Auto-switch to newest tab when sessions grow
  const prevLen = useRef(sessions.length);
  useEffect(() => {
    if (sessions.length > prevLen.current) setActiveId(sessions[sessions.length - 1].id);
    prevLen.current = sessions.length;
  }, [sessions]);

  // Recover if active tab was removed
  useEffect(() => {
    if (!sessions.find(s => s.id === activeId) && sessions.length > 0)
      setActiveId(sessions[sessions.length - 1].id);
  }, [sessions, activeId]);

  // A sidebar sub-item (Devices/VMs → an already-open session) asked to jump
  // straight to that tab — same one-shot pattern window.__pendingRepoOpen
  // uses for pinned repos, but threaded through props since this view isn't
  // the one reading the pending ref.
  useEffect(() => {
    if (!focusSessionId) return;
    if (sessions.find(s => s.id === focusSessionId)) setActiveId(focusSessionId);
    onFocusHandled?.();
  }, [focusSessionId]);

  // Switch back to tabs if only one session left
  useEffect(() => {
    if (sessions.length <= 1 && layout === "grid") setLayout("tabs");
  }, [sessions.length]);

  function sendBroadcast() {
    if (!broadcastCmd.trim()) return;
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(broadcastCmd + "\n")));
    Object.values(wsRegistryRef.current).forEach(wsRef => {
      if (wsRef?.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type:"data", data:encoded }));
    });
    setBroadcastCmd("");
  }

  const SC = { loading:"#94a3b8", connecting:"#f59e0b", connected:"#4ade80", error:"#f87171", authfail:"#f87171", closed:"#64748b" };
  const SD = { loading:"⏳", connecting:"◌", connected:"●", error:"✕", authfail:"✕", closed:"○" };

  // Grid columns: 1→1, 2→2, 3→2, 4→2, 5+→3
  const gridCols = sessions.length <= 1 ? 1 : sessions.length <= 4 ? 2 : 3;

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, background:"#0f172a", overflow:"hidden" }}>

      {/* ── Header bar ── */}
      <div style={{ background:"#1e293b", borderBottom:"1px solid #334155", padding:"0 14px",
        display:"flex", alignItems:"center", gap:8, height:46, flexShrink:0 }}>

        {/* Back to wherever the active session was opened from */}
        <button onClick={() => onBack(backTarget)}
          style={{ height:28, padding:"0 10px", background:"#334155", border:"none", borderRadius:5,
            color:"#94a3b8", cursor:"pointer", fontFamily:"inherit", fontSize:12, flexShrink:0,
            display:"flex", alignItems:"center", gap:5 }}>
          ‹ {backLabel}
        </button>

        <div style={{ width:1, height:20, background:"#334155", flexShrink:0 }} />

        {/* Tab strip — only shown in tabs mode */}
        {layout === "tabs" && (
          <div style={{ display:"flex", gap:3, overflowX:"auto", overflowY:"hidden", flex:1, alignItems:"center", minWidth:0,
            scrollbarWidth:"none", msOverflowStyle:"none" }}>
            {sessions.map(s => {
              const st  = tabStatuses[s.id] || "loading";
              const act = s.id === activeId;
              return (
                <div key={s.id} onClick={() => setActiveId(s.id)}
                  style={{ display:"flex", alignItems:"center", gap:5, padding:"0 7px 0 9px", height:30,
                    borderRadius:5, cursor:"pointer", flexShrink:0, maxWidth:240,
                    background: act ? "#0f172a" : "rgba(255,255,255,.04)",
                    border: act ? "1px solid #334155" : "1px solid transparent" }}>
                  <span style={{ color:SC[st]||"#94a3b8", fontSize:8, flexShrink:0 }}>{SD[st]||"○"}</span>
                  <span style={{ fontFamily:"var(--font-mono)", fontSize:12,
                    color: act ? "#e2e8f0" : "#94a3b8",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:140 }}>
                    {s.vm.name}
                  </span>
                  {s.vm.ip && s.vm.ip !== "—" && (
                    <span style={{ fontSize:10, color:"#475569", fontFamily:"var(--font-mono)", flexShrink:0 }}>
                      {s.vm.ip}
                    </span>
                  )}
                  {(st === "closed" || st === "error") && (
                    <button onClick={e => { e.stopPropagation(); reconnectRegistryRef.current[s.id]?.(); }}
                      title="Reconnect"
                      style={{ background:"none",border:0,cursor:"pointer",color:"#60a5fa",fontSize:12,
                        lineHeight:1,padding:0,marginLeft:2,flexShrink:0 }}>↺</button>
                  )}
                  <button onClick={e => { e.stopPropagation(); onRemoveSession(s.id); }}
                    style={{ background:"none",border:0,cursor:"pointer",color:"#64748b",fontSize:14,
                      lineHeight:1,padding:0,marginLeft:4,flexShrink:0 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
        {layout === "grid" && <div style={{ flex:1 }} />}

        {/* Right controls */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          <button onClick={() => onBack(backTarget)} title={`Go back to ${backLabel} to open another SSH session`}
            style={{ height:28, padding:"0 10px", background:"rgba(37,99,235,.15)", border:"1px solid #2563eb36",
              borderRadius:5, color:"#60a5fa", cursor:"pointer", fontFamily:"inherit", fontSize:12,
              display:"flex", alignItems:"center", gap:4 }}>
            + Add Session
          </button>

          <button onClick={copyActiveTerminal} title="Copy full terminal output to clipboard"
            style={{ height:28, padding:"0 10px", borderRadius:5, cursor:"pointer", fontFamily:"inherit", fontSize:12,
              display:"flex", alignItems:"center", gap:4,
              border: copied ? "1px solid #4ade80" : "1px solid #334155",
              background: copied ? "rgba(74,222,128,.15)" : "transparent",
              color: copied ? "#4ade80" : "#94a3b8",
              transition:"all .2s" }}>
            {copied ? "✓ Copied" : "⎘ Copy"}
          </button>

          {/* Layout toggle — tabs vs grid */}
          {sessions.length > 1 && (
            <div style={{ display:"flex", border:"1px solid #334155", borderRadius:5, overflow:"hidden" }}>
              <button
                onClick={() => setLayout("tabs")}
                title="Single terminal (tabs)"
                style={{ height:28, width:32, background: layout==="tabs" ? "#334155" : "transparent",
                  border:"none", cursor:"pointer", color: layout==="tabs" ? "#e2e8f0" : "#64748b",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>
                {/* Tab icon */}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="4" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M1 7h3V4H1" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => setLayout("grid")}
                title="Split view (all terminals visible)"
                style={{ height:28, width:32, background: layout==="grid" ? "#334155" : "transparent",
                  border:"none", borderLeft:"1px solid #334155", cursor:"pointer",
                  color: layout==="grid" ? "#e2e8f0" : "#64748b",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                {/* Grid icon */}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </button>
            </div>
          )}

          <button onClick={() => setBroadcast(b => !b)} title="Send same command to all open sessions"
            style={{ height:28, padding:"0 10px", borderRadius:5, cursor:"pointer", fontFamily:"inherit", fontSize:12,
              display:"flex", alignItems:"center", gap:4,
              border: broadcast ? "1px solid #f59e0b" : "1px solid #334155",
              background: broadcast ? "rgba(245,158,11,.15)" : "transparent",
              color: broadcast ? "#f59e0b" : "#64748b" }}>
            <span style={{ fontSize:10 }}>⊹</span>{broadcast ? "Broadcast ON" : "Broadcast"}
          </button>
          {sessions.length > 0 && (
            <button onClick={onClear} title="Close all sessions and return to VMs"
              style={{ height:28, padding:"0 8px", background:"none", border:"1px solid #334155",
                borderRadius:5, color:"#475569", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
              Close all
            </button>
          )}
        </div>
      </div>

      {/* ── Terminal area ── */}
      <div style={{ flex:1, overflow: layout==="grid" ? "auto" : "hidden",
        ...(layout==="grid" ? {
          display:"grid",
          gridTemplateColumns:`repeat(${gridCols}, 1fr)`,
          gap:3, padding:3, background:"#020617",
        } : { position:"relative" }) }}>

        {sessions.length === 0 ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            height:"100%", color:"#475569", fontFamily:"var(--font-mono)", gap:16, textAlign:"center" }}>
            <div style={{ fontSize:40, marginBottom:4 }}>›_</div>
            <div style={{ fontSize:15, color:"#64748b" }}>{vt("vms.noSshSessions", "No active SSH sessions")}</div>
            <div style={{ fontSize:12, color:"#334155" }}>{vt("vms.goVmsSsh", "Go to VMs and click SSH to open a terminal")}</div>
            <button onClick={() => onBack(backTarget)}
              style={{ marginTop:8, height:34, padding:"0 20px", background:"#2563eb", border:"none",
                borderRadius:6, color:"white", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>
              ← Go to {backLabel}
            </button>
          </div>
        ) : layout === "tabs" ? (
          // ── Tabs mode: stacked absolute, only active visible ──
          sessions.map(s => (
            <VMSSHTab key={s.id} session={s} active={s.id === activeId}
              wsRegistryRef={wsRegistryRef} termRegistryRef={termRegistryRef} reconnectRegistryRef={reconnectRegistryRef}
              onStatusChange={handleStatusChange} />
          ))
        ) : (
          // ── Grid mode: each pane is a sized box with a label bar ──
          sessions.map(s => {
            const st = tabStatuses[s.id] || "loading";
            return (
              <div key={s.id} style={{ position:"relative", minHeight:220,
                border: s.id === activeId ? "1px solid #4ade8044" : "1px solid #1e293b",
                borderRadius:4, overflow:"hidden", display:"flex", flexDirection:"column",
                cursor:"pointer" }}
                onClick={() => setActiveId(s.id)}>
                {/* Pane label bar */}
                <div style={{ height:26, background:"#1e293b", borderBottom:"1px solid #0f172a",
                  display:"flex", alignItems:"center", gap:6, padding:"0 8px", flexShrink:0 }}>
                  <span style={{ color:SC[st]||"#94a3b8", fontSize:8 }}>{SD[st]||"○"}</span>
                  <span style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"#94a3b8",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
                    {s.vm.name}
                  </span>
                  {s.vm.ip && s.vm.ip !== "—" && (
                    <span style={{ fontSize:10, color:"#475569", fontFamily:"var(--font-mono)" }}>
                      {s.vm.ip}
                    </span>
                  )}
                  {(st === "closed" || st === "error") && (
                    <button onClick={e => { e.stopPropagation(); reconnectRegistryRef.current[s.id]?.(); }}
                      title="Reconnect"
                      style={{ background:"none",border:0,cursor:"pointer",color:"#60a5fa",fontSize:12,
                        lineHeight:1,padding:0,flexShrink:0 }}>↺</button>
                  )}
                  <button onClick={e => { e.stopPropagation(); onRemoveSession(s.id); }}
                    style={{ background:"none",border:0,cursor:"pointer",color:"#475569",
                      fontSize:13,lineHeight:1,padding:0,flexShrink:0 }}>×</button>
                </div>
                {/* Terminal fills remaining space */}
                <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
                  <VMSSHTab key={s.id + "-grid"} session={s} active={true}
                    wsRegistryRef={wsRegistryRef} termRegistryRef={termRegistryRef} reconnectRegistryRef={reconnectRegistryRef}
                    onStatusChange={handleStatusChange} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Broadcast bar ── */}
      {broadcast && (
        <div style={{ borderTop:"1px solid #334155", background:"#1e293b", padding:"8px 14px",
          display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
          <span style={{ fontSize:10,fontWeight:700,color:"#f59e0b",fontFamily:"var(--font-mono)",flexShrink:0,letterSpacing:.5 }}>
            ⊹ BROADCAST
          </span>
          <input value={broadcastCmd} onChange={e => setBroadcastCmd(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendBroadcast(); }}
            placeholder="Command → all sessions (Enter to send)…"
            style={{ flex:1, height:32, padding:"0 12px", background:"#0f172a", border:"1px solid #334155",
              borderRadius:5, color:"#e2e8f0", fontFamily:"var(--font-mono)", fontSize:13,
              outline:"none", boxSizing:"border-box" }} />
          <button onClick={sendBroadcast}
            style={{ height:32, padding:"0 14px", background:"rgba(245,158,11,.15)", border:"1px solid #f59e0b",
              borderRadius:5, color:"#f59e0b", cursor:"pointer", fontFamily:"inherit", fontSize:13, flexShrink:0 }}>
            Send ↵
          </button>
          <span style={{ fontSize:11, color:"#475569", fontFamily:"var(--font-mono)", flexShrink:0 }}>
            → {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function VMsView({ tweaks, sshSessions, onOpenSSH, onNavigateToSSH }) {
  const [tab, setTab] = useState("vms");
  window.I18N?.useLocale();

  const tabBtn = (id, label, icon) => (
    <button onClick={() => setTab(id)} style={{
      display:"inline-flex", alignItems:"center", gap:6,
      height:32, padding:"0 14px",
      background: tab === id ? "white" : "transparent",
      border: tab === id ? "1px solid var(--border)" : "1px solid transparent",
      boxShadow: tab === id ? "0 1px 2px rgba(0,0,0,.06)" : "none",
      borderRadius:6, fontSize:13, fontWeight: tab === id ? 600 : 400,
      color: tab === id ? "var(--fg)" : "var(--muted-fg)",
      cursor:"pointer", fontFamily:"inherit",
    }}>
      <span>{icon}</span>{label}
    </button>
  );

  return (
    <div style={{ padding:20, maxWidth:1480, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, gap:16 }}>
        <h1 style={{ fontSize:22, fontWeight:600, margin:0, letterSpacing:-0.2 }}>{vt("nav.vms.label", "Virtual Machines")}</h1>
        <div style={{ display:"flex", gap:4, padding:3, background:"var(--muted)", borderRadius:8 }}>
          {tabBtn("vms",  "VMs",          "🖥")}
          {tabBtn("ips",  vt("vms.ipReference", "IP Reference"), "📋")}
        </div>
      </div>
      {tab === "vms" && <VMsBrowser tweaks={tweaks} onOpenSSH={onOpenSSH} sshSessions={sshSessions} onNavigateToSSH={onNavigateToSSH} />}
      {tab === "ips" && <IPReferenceView />}
    </div>
  );
}
window.HostsBrowser = HostsBrowser;

function DensityBtn({ active, onClick, label, icon }) {
  return (
    <button onClick={onClick} style={{
      display:"inline-flex",alignItems:"center",gap:5,height:26,padding:"0 9px",
      background:active?"white":"transparent",
      border:active?"1px solid var(--border)":"1px solid transparent",
      boxShadow:active?"0 1px 1px rgba(0,0,0,.04)":"none",
      borderRadius:5,fontSize:12,fontFamily:"inherit",
      color:active?"var(--fg)":"var(--muted-fg)",cursor:"pointer",fontWeight:500,
    }}>
      <span style={{ fontFamily:"var(--font-mono)" }}>{icon}</span> {label === "Table" ? vt("vms.table", label) : label === "Cards" ? vt("vms.cards", label) : label === "Grid" ? vt("vms.grid", label) : label}
    </button>
  );
}

function FilterChip({ label, value, options, onChange }) {
  const translatedLabel = { Cluster: "vms.cluster", Host: "vms.host", Tag: "vms.tag", VLAN: "vms.vlan", Env: "vms.env", Status: "vms.status", Group: "vms.group", Site: "vms.site" }[label];
  return (
    <label style={{ display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:"var(--muted-fg)" }}>
      {translatedLabel ? vt(translatedLabel, label) : label}:
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ height:32,padding:"0 26px 0 8px",border:"1px solid var(--border)",
          borderRadius:6,fontSize:12,fontFamily:"inherit",background:"white",color:"var(--fg)",cursor:"pointer",
          appearance:"none",
          backgroundImage:"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
          backgroundRepeat:"no-repeat",backgroundPosition:"right 8px center" }}>
        {options.map(([v,l]) => <option key={v} value={v}>{v === "all" ? vt("vms.all", l) : v === "none" ? vt("vms.none", l) : v === "online" ? vt("vms.online", l) : v === "warn" ? vt("vms.warn", l) : v === "offline" ? vt("vms.offline", l) : l}</option>)}
      </select>
    </label>
  );
}

window.VMsView = VMsView;
window.SSHWorkspaceView = SSHWorkspaceView;
