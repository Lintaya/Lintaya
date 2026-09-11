// Repos — navegador de repositorios (GitLab, GitHub o Bitbucket, según el prop
// `provider` de ReposView): árbol de archivos, visor de código, git local,
// Build/Pipeline (GitLab pipelines y GitHub Actions runs — solo lectura en
// GitHub, "Run build" es GitLab-only; Bitbucket Pipelines queda pendiente).
// Datos reales vía los conectores existentes (/api/connectors/:provider/*).
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const rt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

const PROVIDER_LABELS = { gitlab: "GitLab", github: "GitHub", bitbucket: "Bitbucket" };

// Mermaid inicializa una sola vez por scope de script (mismo patrón que home.jsx,
// que vive en otro scope y no puede compartir este flag).
let reposMermaidInitDone = false;

const PIPELINE_META = {
  success:  { label: "Passed",   color: "var(--ok)",      icon: "✓" },
  failed:   { label: "Failed",   color: "var(--err)",     icon: "✕" },
  running:  { label: "Running",  color: "var(--accent)",  icon: "◐" },
  pending:  { label: "Pending",  color: "var(--warn)",    icon: "◔" },
  created:  { label: "Pending",  color: "var(--warn)",    icon: "◔" },
  canceled: { label: "Canceled", color: "var(--muted-fg)",icon: "⊘" },
  skipped:  { label: "Skipped",  color: "var(--muted-fg)",icon: "⊘" },
  manual:   { label: "Manual",   color: "var(--muted-fg)",icon: "▶" },
  none:     { label: "No runs",  color: "var(--muted-fg)",icon: "–" },
};

// Colors for common languages reported by GitLab's /languages endpoint. Anything
// unlisted falls back to a stable hash-based color so it's still legible.
const LANG_COLORS = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Go: "#00ADD8",
  Ruby: "#701516", Java: "#b07219", PHP: "#4F5D95", "C++": "#f34b7d", C: "#555555",
  "C#": "#178600", Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c",
  Vue: "#41b883", Dockerfile: "#384d54", Makefile: "#427819", Rust: "#dea584",
  Kotlin: "#A97BFF", Swift: "#F05138", Lua: "#000080", Perl: "#0298c3",
};
function langColor(lang) {
  if (LANG_COLORS[lang]) return LANG_COLORS[lang];
  let h = 0;
  for (let i = 0; i < (lang || "").length; i++) h = (h * 31 + lang.charCodeAt(i)) >>> 0;
  const palette = ["#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6", "#f97316"];
  return palette[h % palette.length];
}

function toast(msg, kind = "info") {
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, kind } }));
}

function LangDot({ lang }) {
  if (!lang) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted-fg)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: langColor(lang) }} />
      {lang}
    </span>
  );
}

// `direct=true` skips the GitLab avatar proxy and renders `url` as-is — for
// GitHub (avatars.githubusercontent.com) and any other public, CORS-friendly
// avatar host. GitLab's own avatars need the proxy: they live behind
// PRIVATE-TOKEN auth on a self-hosted instance a plain <img> can't send.
function GitlabAvatar({ url, size = 14, direct = false }) {
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    setObjectUrl(null);
    if (!url || direct) return;
    let revoke = null;
    let cancelled = false;
    fetch(`/api/connectors/gitlab/avatar?u=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${window.HQ_API.getToken()}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        const obj = URL.createObjectURL(blob);
        revoke = obj;
        setObjectUrl(obj);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [url]);

  const src = direct ? url : objectUrl;
  if (!src) return null;
  return (
    <img src={src} alt="" width={size} height={size}
      style={{ borderRadius: "50%", flexShrink: 0 }} />
  );
}

function PipelineBadge({ status }) {
  const m = PIPELINE_META[status] || PIPELINE_META.none;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background: `${m.color}18`, color: m.color, fontFamily: "var(--font-mono)",
    }}>{m.icon} {m.label}</span>
  );
}

function VisibilityBadge({ visibility }) {
  if (!visibility) return null;
  const meta = visibility === "public"
    ? { icon: "🌐", label: "Public", color: "var(--muted-fg)", bg: "rgba(120, 113, 108, 0.10)" }
    : visibility === "internal"
      ? { icon: "🔗", label: "Internal", color: "#a16207", bg: "rgba(217, 119, 6, 0.10)" }
      : { icon: "🔒", label: "Private", color: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 10%, white)" };
  return (
    <span title={`Visibilidad: ${meta.label}`} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background: meta.bg, color: meta.color, fontFamily: "var(--font-mono)",
    }}>{meta.icon} {meta.label}</span>
  );
}

function ForkBadge({ fork }) {
  if (!fork) return null;
  return (
    <span title={window.I18N.t("ui.repos.fork", "This repository is a fork")} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background: "rgba(120, 113, 108, 0.10)", color: "var(--muted-fg)", fontFamily: "var(--font-mono)",
    }}>🍴 Fork</span>
  );
}

function CloneBadge({ clone }) {
  if (!clone?.path) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background: "rgba(22, 163, 74, 0.10)", color: "var(--ok)", fontFamily: "var(--font-mono)",
    }}>
      ⌁ Local
    </span>
  );
}

function BranchBadge({ clone }) {
  if (!clone?.path || !clone?.branch) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background: "rgba(37, 99, 235, 0.10)", color: "#2563eb", fontFamily: "var(--font-mono)",
    }}>
      ⎇ {clone.branch}
    </span>
  );
}

// Latest tag/release from the provider's API (synced, not the local clone —
// a repo can have a real tag in GitLab/GitHub/Bitbucket with the local
// checkout sitting on a branch that shares no part of that name, so this is
// deliberately independent of BranchBadge above).
function TagBadge({ tag }) {
  if (!tag?.name) return null;
  return (
    <span title={tag.when ? `Release ${tag.name} · ${timeAgo(tag.when)}` : `Release ${tag.name}`} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background: "rgba(217, 119, 6, 0.10)", color: "#d97706", fontFamily: "var(--font-mono)",
    }}>
      🏷 {tag.name}
    </span>
  );
}

const miniBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
  height: 24, padding: "0 8px", border: "1px solid var(--border)", background: "white",
  borderRadius: 5, fontSize: 10.5, fontWeight: 600, color: "var(--accent)", cursor: "pointer", fontFamily: "inherit",
};

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function isNetworkToolsRepo(repo) {
  return /network-tools/i.test(repo?.name || "")
    || /network-tools/i.test(repo?.path || "")
    || /network-tools/i.test(repo?.localClone?.path || "");
}

function isPythonRepo(repo) {
  return repo?.localClone?.envSupported !== false;
}

function RuntimeBadge({ runtime }) {
  if (!runtime) return null;
  const state = runtime.status || "stopped";
  const live = state === "running";
  const starting = state === "starting";
  const isError = state === "error";
  const label = live ? "RUNNING" : starting ? "STARTING" : isError ? "ERROR" : "STOPPED";
  const color = live ? "#2563eb" : starting ? "#0891b2" : isError ? "var(--err)" : "var(--muted-fg)";
  const background = live
    ? "rgba(37, 99, 235, 0.10)"
    : starting
      ? "rgba(8, 145, 178, 0.10)"
      : isError
        ? "rgba(220, 38, 38, 0.10)"
        : "rgba(120, 113, 108, 0.10)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background, color, fontFamily: "var(--font-mono)",
    }}>
      NT {label}
    </span>
  );
}

function EnvBadge({ clone }) {
  const status = clone?.envStatus;
  if (!status) return null;
  const colors = {
    ready: ["rgba(22, 163, 74, 0.10)", "var(--ok)", "READY"],
    preparing: ["rgba(8, 145, 178, 0.10)", "#0891b2", "PREPARING"],
    error: ["rgba(220, 38, 38, 0.10)", "var(--err)", "ERROR"],
  };
  const [background, color, label] = colors[status] || colors.ready;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4,
      background, color, fontFamily: "var(--font-mono)",
    }}>
      ENV {label}
    </span>
  );
}

// window.prompt()/confirm() no funcionan de forma confiable como PWA instalada
// (Chrome los suprime en display-mode:standalone) — por eso todo input de texto
// pasa por un modal propio en vez de diálogos nativos del navegador.
function TextPromptModal({ title, label, defaultValue, confirmLabel, onSubmit, onClose }) {
  const [value, setValue] = useState(defaultValue || "");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const submit = () => {
    const v = value.trim();
    if (v) onSubmit(v);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 500,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 380, background: "white", borderRadius: 10,
        boxShadow: "0 16px 48px rgba(0,0,0,.22)", border: "1px solid var(--border)",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ padding: 16 }}>
          {label && <div style={{ fontSize: 12, color: "var(--muted-fg)", marginBottom: 8 }}>{label}</div>}
          <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
            style={{ width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-mono)", boxSizing: "border-box" }} />
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={miniBtn}>{window.I18N.t("connectors.cancel", "Cancel")}</button>
          <button onClick={submit} style={{ ...miniBtn, background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}>{confirmLabel || window.I18N.t("ui.accept", "Accept")}</button>
        </div>
      </div>
    </div>
  );
}

function LinkExistingModal({ repo, onClose, onLinked }) {
  const [pathValue, setPathValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [mismatch, setMismatch] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const pickFolder = async () => {
    setPicking(true);
    try {
      const r = await window.HQ_API.request("/api/system/pick-folder");
      if (r.path) { setPathValue(r.path); setMismatch(null); }
    } catch (e) {
      toast(window.I18N.t("ui.repos.browseFailed", "Could not open the folder picker:") + " " + e.message, "error");
    } finally {
      setPicking(false);
    }
  };

  const attempt = async (force) => {
    if (!pathValue.trim()) return;
    setSaving(true);
    try {
      const r = await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/link-existing`, {
        method: "POST", body: { path: pathValue.trim(), force },
      });
      onLinked(r);
      toast(`Repo vinculado a ${r.path}`, "ok");
      onClose();
    } catch (e) {
      if (e.status === 409) {
        setMismatch(e.message);
      } else {
        toast(window.I18N.t("ui.repos.linkFailed", "Could not link:") + " " + e.message, "error");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 500,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 460, background: "white", borderRadius: 10,
        boxShadow: "0 16px 48px rgba(0,0,0,.22)", border: "1px solid var(--border)",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{window.I18N.t("ui.repos.linkClone", "🔗 Link existing clone")}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.clonePath", "Local path of the existing clone")} <b style={{ color: "var(--fg)" }}>{repo.name}</b>:
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input ref={inputRef} value={pathValue} onChange={e => { setPathValue(e.target.value); setMismatch(null); }}
              onKeyDown={e => e.key === "Enter" && attempt(false)}
              placeholder="C:\Users\...\carpeta-del-repo"
              style={{ flex: 1, minWidth: 0, height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-mono)", boxSizing: "border-box" }} />
            <button onClick={pickFolder} disabled={picking} title={window.I18N.t("ui.repos.browse", "Choose a folder with Windows Explorer")} style={{
              ...miniBtn, height: 32, flexShrink: 0, opacity: picking ? .6 : 1, cursor: picking ? "wait" : "pointer",
            }}>{picking ? "…" : "📁 Elegir"}</button>
          </div>
          {mismatch && (
            <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 6, padding: "8px 10px", lineHeight: 1.5 }}>
              {mismatch}
            </div>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={miniBtn}>{window.I18N.t("connectors.cancel", "Cancel")}</button>
          {mismatch ? (
            <button onClick={() => attempt(true)} disabled={saving} style={{ ...miniBtn, background: "var(--err)", color: "white", borderColor: "var(--err)", opacity: saving ? .6 : 1 }}>
              {saving ? "…" : window.I18N.t("ui.repos.forceLink", "Link anyway")}
            </button>
          ) : (
            <button onClick={() => attempt(false)} disabled={saving || !pathValue.trim()} style={{ ...miniBtn, background: "var(--accent)", color: "white", borderColor: "var(--accent)", opacity: saving ? .6 : 1 }}>
              {saving ? window.I18N.t("ui.repos.linking", "Linking…") : window.I18N.t("ui.link", "Link")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RepoSettingsModal({ repo, onClose, onSave }) {
  const [visible, setVisible] = useState(repo.settings?.visible !== false);
  const [clonePath, setClonePath] = useState(repo.settings?.clonePath || "");
  const [pinned, setPinned] = useState(!!repo.settings?.pinned);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(repo.id, { visible, clonePath: clonePath.trim() || null, pinned });
      onClose();
    } catch (e) {
      toast(window.I18N.t("ui.saveFailedPrefix", "Could not save:") + " " + e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, background: "white", borderRadius: 10,
        boxShadow: "0 16px 48px rgba(0,0,0,.22)", border: "1px solid var(--border)",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⚙ {repo.name}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} style={{ width: 15, height: 15, marginTop: 1, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{window.I18N.t("ui.repos.visible", "Visible in the list")}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 1 }}>{window.I18N.t("ui.repos.visibleHelp", "When disabled, this repo is hidden from the Repos grid/list (nothing is deleted or uncloned).")}</div>
            </div>
          </label>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{window.I18N.t("ui.repos.preferredPath", "Preferred clone path")}</div>
            <input value={clonePath} onChange={e => setClonePath(e.target.value)}
              placeholder={window.I18N.t("ui.repos.defaultPath", "Default: server/gitlab-clones/<id or owner_repo>-<name>")}
              style={{ width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-mono)", boxSizing: "border-box" }} />
            <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 4 }}>{window.I18N.t("ui.repos.pathHelp", "Absolute path. Applies only to the next Clone — does not move an existing clone.")} </div>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} style={{ width: 15, height: 15, marginTop: 1, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{window.I18N.t("ui.repos.pin", "Add to Repos submenu")}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 1 }}>{window.I18N.t("ui.repos.pinHelp", "Appears as a shortcut under Repos in the sidebar so you can open this repo directly.")}</div>
            </div>
          </label>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={miniBtn}>{window.I18N.t("connectors.cancel", "Cancel")}</button>
          <button onClick={save} disabled={saving} style={{
            ...miniBtn, background: "var(--accent)", color: "white", borderColor: "var(--accent)",
            opacity: saving ? .6 : 1, cursor: saving ? "wait" : "pointer",
          }}>{saving ? window.I18N.t("ui.saving", "Saving…") : window.I18N.t("settings.ai.save", "Save")}</button>
        </div>
      </div>
    </div>
  );
}

function RepoCard({ repo, providerLabel, onSelect, onClone, onLinkExisting, cloning, onPlayNetworkTools, onPrepareEnv, networkTools, networkToolsBusy, preparingEnvId, onOpenVscodeWeb, onOpenSettings, repoRuntime, playingRepoId, onPlayGeneric }) {
  const isLocal = !!repo.localClone?.path;
  const isNetworkToolsLocal = isNetworkToolsRepo(repo) && isLocal;
  const isRunning = networkTools?.status === "running";
  const canPrepareEnv = isLocal && isPythonRepo(repo);
  const envBusy = preparingEnvId === repo.id;
  const isGenericPlayable = isLocal && !isNetworkToolsLocal && !!repo.localClone?.playable;
  const isGenericRunning = repoRuntime?.status === "running";
  const genericBusy = playingRepoId === repo.id;
  return (
    <div onClick={() => onSelect(repo)} style={{
      background: "white", border: "1px solid var(--border)", borderRadius: 8,
      padding: 12, cursor: "pointer", display: "flex", flexDirection: "column", gap: 8,
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
    onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.name}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{repo.path}</div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {repo.settings?.visible === false && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
              letterSpacing: 0.4, textTransform: "uppercase", padding: "2px 7px", borderRadius: 4,
              background: "rgba(120, 113, 108, 0.14)", color: "var(--muted-fg)", fontFamily: "var(--font-mono)",
            }}>{window.I18N.t("ui.repos.hidden", "🙈 Hidden")}</span>
          )}
          {repo.settings?.pinned && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
              letterSpacing: 0.4, textTransform: "uppercase", padding: "2px 7px", borderRadius: 4,
              background: "rgba(217, 119, 6, 0.12)", color: "#d97706", fontFamily: "var(--font-mono)",
            }}>📌 Pinned</span>
          )}
          <VisibilityBadge visibility={repo.visibility} />
          <ForkBadge fork={repo.fork} />
          <CloneBadge clone={repo.localClone} />
          <BranchBadge clone={repo.localClone} />
          <TagBadge tag={repo.latestTag} />
          <EnvBadge clone={repo.localClone} />
          {isNetworkToolsLocal && <RuntimeBadge runtime={networkTools} />}
          {isGenericPlayable && <RuntimeBadge runtime={repoRuntime} />}
          <PipelineBadge status={repo.pipelineStatus} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.4, minHeight: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.description || " "}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "var(--muted-fg)", flexWrap: "wrap" }}>
        <LangDot lang={repo.language} />
        {repo.language && <span>·</span>}
        <span style={{ fontFamily: "var(--font-mono)" }}>{repo.defaultBranch}</span>
        {repo.openMRs > 0 && <><span>·</span><span style={{ color: "var(--accent)", fontWeight: 600 }}>{repo.openMRs} MR{repo.openMRs > 1 ? "s" : ""}</span></>}
      </div>

      {repo.lastCommit && (
        <div style={{ fontSize: 11, color: "var(--muted-fg)", display: "flex", gap: 5, alignItems: "center", paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{repo.lastCommit.sha}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{repo.lastCommit.message}</span>
          <span style={{ flexShrink: 0 }}>{timeAgo(repo.lastCommit.when)}</span>
        </div>
      )}

      {repo.topics?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {repo.topics.map(t => <window.TagPill key={t} id={t} />)}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", minHeight: 14, fontFamily: "var(--font-mono)" }}>
        {repo.localClone?.path
          ? `${repo.localClone.path}${repo.localClone.branch ? ` · ${repo.localClone.branch}` : ""}`
          : window.I18N.t("ui.repos.notCloned", "Not cloned locally")}
      </div>

      <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button title={window.I18N.t("ui.repos.settings", "Repository settings")} style={miniBtn} onClick={() => onOpenSettings(repo)}>⚙</button>
        <a href={repo.webUrl} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: "none" }}>↗ {rt("repos.openIn", "Open in")} {providerLabel || PROVIDER_LABELS[repo.provider] || repo.provider}</a>
        {isNetworkToolsLocal && (
          <button
            style={{
              ...miniBtn,
              background: isRunning ? "rgba(37, 99, 235, 0.10)" : "#0ea5e9",
              color: isRunning ? "#2563eb" : "white",
              borderColor: isRunning ? "rgba(37, 99, 235, 0.22)" : "#0ea5e9",
              opacity: networkToolsBusy ? 0.65 : 1,
              cursor: networkToolsBusy ? "wait" : "pointer",
            }}
            disabled={networkToolsBusy}
            onClick={async (e) => {
              e.stopPropagation();
              await onPlayNetworkTools(repo, isRunning);
            }}
          >{isRunning ? "↗ Open" : "▶ Play"}</button>
        )}
        {isGenericPlayable && (
          <button
            title={isGenericRunning ? "" : `Arranca ${repo.localClone.entrypoint}`}
            style={{
              ...miniBtn,
              background: isGenericRunning ? "rgba(37, 99, 235, 0.10)" : "#0ea5e9",
              color: isGenericRunning ? "#2563eb" : "white",
              borderColor: isGenericRunning ? "rgba(37, 99, 235, 0.22)" : "#0ea5e9",
              opacity: genericBusy ? 0.65 : 1,
              cursor: genericBusy ? "wait" : "pointer",
            }}
            disabled={genericBusy}
            onClick={async (e) => {
              e.stopPropagation();
              await onPlayGeneric(repo, isGenericRunning);
            }}
          >{isGenericRunning ? "↗ Open" : "▶ Play"}</button>
        )}
        {canPrepareEnv && (
          <button
            style={{
              ...miniBtn,
              background: repo.localClone.envStatus === "ready" ? "rgba(22, 163, 74, 0.10)" : "rgba(37, 99, 235, 0.10)",
              color: repo.localClone.envStatus === "ready" ? "var(--ok)" : "var(--accent)",
              borderColor: repo.localClone.envStatus === "ready" ? "rgba(22, 163, 74, 0.18)" : "rgba(37, 99, 235, 0.18)",
              opacity: envBusy ? 0.65 : 1,
              cursor: envBusy ? "wait" : "pointer",
            }}
            disabled={envBusy}
            onClick={async (e) => {
              e.stopPropagation();
              await onPrepareEnv(repo);
            }}
          >{envBusy ? "⟳ Preparando…" : (repo.localClone.envStatus === "ready" ? window.I18N.t("ui.repos.refreshEnvironment", "↻ Refresh environment") : "⚙ Preparar entorno")}</button>
        )}
        {!isLocal && (
          <button
            style={{ ...miniBtn, opacity: cloning ? 0.65 : 1, cursor: cloning ? "wait" : "pointer" }}
            disabled={cloning}
            onClick={(e) => { e.stopPropagation(); onClone(repo); }}
          >{window.I18N.t("ui.repos.clone", "⎘ Clone")}</button>
        )}
        {!isLocal && (
          <button
            title={window.I18N.t("ui.repos.existingCloneHelp", "Already cloned manually elsewhere — link it without cloning again")}
            style={{ ...miniBtn, opacity: cloning ? 0.65 : 1, cursor: cloning ? "wait" : "pointer" }}
            disabled={cloning}
            onClick={(e) => { e.stopPropagation(); onLinkExisting(repo); }}
          >{window.I18N.t("ui.repos.alreadyCloned", "🔗 Already cloned")}</button>
        )}
        {isLocal && (
          <button
            style={{ ...miniBtn, background: "#1e1e1e", color: "white", borderColor: "#1e1e1e" }}
            onClick={async (e) => {
              e.stopPropagation();
              try {
                toast(window.I18N.t("ui.repos.startingVscode", "Starting VS Code Web…"), "info");
                const r = await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/vscode-web`, { method: "POST" });
                onOpenVscodeWeb(r.url);
              } catch (err) {
                toast(window.I18N.t("ui.repos.vscodeFailed", "Could not open VS Code Web:") + " " + err.message, "error");
              }
            }}
          >🖥 VS Code</button>
        )}
        {isLocal && (
          <button
            style={miniBtn}
            onClick={async (e) => {
              e.stopPropagation();
              await navigator.clipboard?.writeText(repo.localClone.path);
              toast(window.I18N.t("ui.repos.pathCopied", "Local path copied"), "ok");
            }}
          >{window.I18N.t("ui.repos.localPath", "⧉ Local path")}</button>
        )}
      </div>
    </div>
  );
}

function fileIcon(path) {
  const ext = path.split(".").pop();
  return ext === "go" ? "🐹" : ext === "py" ? "🐍" : ext === "tsx" || ext === "ts" ? "🔷" : ext === "yml" || ext === "yaml" ? "⚙" : "📄";
}

function buildFileTree(files) {
  const root = { name: "", path: "", type: "dir", children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (isFile) {
        if (!node.children.has(part)) node.children.set(part, { name: part, path: acc, type: "file" });
      } else {
        if (!node.children.has(part)) node.children.set(part, { name: part, path: acc, type: "dir", children: new Map() });
        node = node.children.get(part);
      }
    });
  }
  return root;
}

// Mismo shape de nodo que buildFileTree, pero construido incrementalmente a
// partir de lo que ya se pidió por carpeta (`dirChildren`) — un folder cuyo
// contenido todavía no se pidió queda con children vacío y loaded:false, así
// FileTreeNode sabe mostrar "Cargando…" y disparar el fetch en vez de tratarlo
// como una carpeta vacía de verdad.
function buildLazyTree(dirChildren) {
  const build = (dirPath) => {
    const entry = dirChildren[dirPath];
    const children = new Map();
    if (entry) {
      for (const f of entry.folders) {
        const childLoaded = !!dirChildren[f.path];
        children.set(f.name, {
          name: f.name, path: f.path, type: "dir", loaded: childLoaded,
          children: childLoaded ? build(f.path).children : new Map(),
        });
      }
      for (const f of entry.files) {
        children.set(f.name, { name: f.name, path: f.path, type: "file" });
      }
    }
    return { name: "", path: dirPath, type: "dir", loaded: !!entry, children };
  };
  return build("");
}

function sortedChildren(node) {
  return Array.from(node.children.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function FileTreeNode({ node, depth, activePath, onOpen, expanded, toggleExpand, onContextMenu }) {
  const indent = 8 + depth * 14;
  if (node.type === "file") {
    const active = node.path === activePath;
    return (
      <button onClick={() => onOpen(node.path)}
        onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(node, e); } : undefined}
        title={node.path} style={{
        display: "flex", alignItems: "center", gap: 6, width: "100%",
        padding: `5px 8px 5px ${indent}px`, border: 0, borderRadius: 5,
        background: active ? "color-mix(in srgb, var(--accent) 10%, white)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg)",
        fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "left",
        cursor: "pointer", fontWeight: active ? 600 : 400,
      }}>
        <span style={{ color: "var(--muted-fg)", fontSize: 10, width: 12, flexShrink: 0 }}>{fileIcon(node.name)}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
      </button>
    );
  }
  const isOpen = expanded.has(node.path);
  return (
    <div>
      <button onClick={() => toggleExpand(node.path)} style={{
        display: "flex", alignItems: "center", gap: 6, width: "100%",
        padding: `5px 8px 5px ${indent}px`, border: 0, borderRadius: 5, background: "transparent",
        color: "var(--fg)", fontFamily: "var(--font-mono)", fontSize: 12,
        textAlign: "left", cursor: "pointer", fontWeight: 600,
      }}>
        <span style={{ color: "var(--muted-fg)", fontSize: 9, width: 12, flexShrink: 0 }}>{isOpen ? "▾" : "▸"}</span>
        <span style={{ color: "var(--muted-fg)", fontSize: 10, width: 12, flexShrink: 0 }}>{isOpen ? "📂" : "📁"}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
      </button>
      {isOpen && (
        node.loaded === false ? (
          <div style={{ padding: `5px 8px 5px ${indent + 14}px`, fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
        ) : sortedChildren(node).map(c => (
          <FileTreeNode key={c.path} node={c} depth={depth + 1} activePath={activePath} onOpen={onOpen} expanded={expanded} toggleExpand={toggleExpand} onContextMenu={onContextMenu} />
        ))
      )}
    </div>
  );
}

function FileContextMenu({ x, y, node, repoId, provider, onClose, onRenamed, onDuplicated }) {
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (renaming) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [renaming]);

  const submitRename = async (newName) => {
    if (newName === node.name) { onClose(); return; }
    try {
      const r = await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repoId)}/fs/rename`, {
        method: "POST", body: { path: node.path, newName },
      });
      onRenamed(node.path, r.path);
      toast(`Renombrado a ${newName}`, "ok");
    } catch (e) {
      toast(window.I18N.t("ui.repos.renameFailed", "Could not rename:") + " " + e.message, "error");
    }
    onClose();
  };

  if (renaming) {
    return (
      <TextPromptModal title="Rename" label={window.I18N.t("ui.repos.newName", "New name for \"{0}\"", { 0: node.name })} defaultValue={node.name}
        confirmLabel={window.I18N.t("ui.rename", "Rename")} onSubmit={submitRename} onClose={onClose} />
    );
  }

  const duplicate = async () => {
    onClose();
    try {
      const r = await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repoId)}/fs/duplicate`, {
        method: "POST", body: { path: node.path },
      });
      onDuplicated(r.path);
      toast(`Duplicado como ${r.path.split("/").pop()}`, "ok");
    } catch (e) {
      toast(window.I18N.t("ui.repos.duplicateFailed", "Could not duplicate:") + " " + e.message, "error");
    }
  };

  const copyPath = async () => {
    onClose();
    await navigator.clipboard?.writeText(node.path);
    toast(window.I18N.t("ui.pathCopied", "Path copied"), "ok");
  };

  const itemStyle = {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "7px 12px", border: 0, background: "transparent",
    fontSize: 12.5, fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: "var(--fg)",
  };

  return (
    <div onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 400 }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: "fixed", left: x, top: y, minWidth: 170,
        background: "white", border: "1px solid var(--border)", borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,.18)", overflow: "hidden", padding: 4,
      }}>
        <button style={itemStyle} onClick={() => setRenaming(true)}
          onMouseEnter={e => e.currentTarget.style.background = "var(--muted)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          ✎ Rename
        </button>
        <button style={itemStyle} onClick={duplicate}
          onMouseEnter={e => e.currentTarget.style.background = "var(--muted)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{window.I18N.t("ui.repos.duplicate", "⧉ Duplicate")} </button>
        <button style={itemStyle} onClick={copyPath}
          onMouseEnter={e => e.currentTarget.style.background = "var(--muted)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{window.I18N.t("ui.repos.copyRelative", "⎘ Copy relative path")} </button>
      </div>
    </div>
  );
}

function FileTree({
  files, lazy, dirChildren, loadingDirs, onExpandDir,
  activePath, onOpen, truncated, treeTotal, repoId, provider, onFileRenamed, onFileDuplicated,
}) {
  const tree = useMemo(() => lazy ? buildLazyTree(dirChildren) : buildFileTree(files), [lazy, dirChildren, files]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [menu, setMenu] = useState(null); // { x, y, node }

  useEffect(() => {
    if (!activePath) return;
    setExpanded(prev => {
      const next = new Set(prev);
      const parts = activePath.split("/");
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        next.add(acc);
      }
      return next;
    });
  }, [activePath]);

  // Modo lazy: cualquier carpeta que quede expandida (por click o por el
  // auto-expand de arriba) y todavía no se haya pedido, se pide acá — cubre
  // los dos caminos con una sola fuente de verdad en vez de duplicar el
  // disparo del fetch en toggleExpand.
  useEffect(() => {
    if (!lazy) return;
    for (const path of expanded) {
      if (!dirChildren[path] && !loadingDirs?.has(path)) onExpandDir(path);
    }
  }, [lazy, expanded, dirChildren, loadingDirs, onExpandDir]);

  const toggleExpand = (path) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleContextMenu = repoId ? (node, e) => setMenu({ x: e.clientX, y: e.clientY, node }) : undefined;
  const rootLoaded = !lazy || !!dirChildren[""];
  const isEmpty = lazy
    ? rootLoaded && !dirChildren[""].folders.length && !dirChildren[""].files.length
    : files.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {!rootLoaded ? (
        <div style={{ fontSize: 11.5, color: "var(--muted-fg)", padding: "6px 8px" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
      ) : sortedChildren(tree).map(node => (
        <FileTreeNode key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} expanded={expanded} toggleExpand={toggleExpand} onContextMenu={handleContextMenu} />
      ))}
      {!lazy && truncated && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, margin: "4px 8px", padding: "6px 8px" }}>{window.I18N.t("ui.repos.showing", "⚠ Showing")} {files.length}{treeTotal > files.length ? ` de ${treeTotal}+` : ""} {window.I18N.t("ui.repos.truncated", "files — the list is truncated")} </div>
      )}
      {isEmpty && <div style={{ fontSize: 11.5, color: "var(--muted-fg)", padding: "6px 8px" }}>{window.I18N.t("ui.repos.noFiles", "No files")}</div>}
      {menu && (
        <FileContextMenu x={menu.x} y={menu.y} node={menu.node} repoId={repoId} provider={provider} onClose={() => setMenu(null)}
          onRenamed={onFileRenamed} onDuplicated={onFileDuplicated} />
      )}
    </div>
  );
}

function CodeViewer({ projectId, provider, path, branch, source = "remote", editable, onToggleEdit }) {
  const [content, setContent] = useState("");
  const [imageDataUri, setImageDataUri] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [fileCommits, setFileCommits] = useState(null);
  const [expandedSha, setExpandedSha] = useState(null);
  const [expandedDiff, setExpandedDiff] = useState(null);
  const textareaRef = useRef(null);
  const codeContainerRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const searchInputRef = useRef(null);
  const previewMatchCountRef = useRef(0);
  const isHtml = /\.(html?|htm)$/i.test(path || "");
  const isMarkdown = /\.mdx?$/i.test(path || "");
  const isCode = /\.(js|jsx|ts|tsx|py|java|c|cpp|h|hpp|go|rs|rb|php|sh|bash|zsh|sql|json|yaml|yml|toml|xml|css|scss|less|md|markdown|txt|csv|env|gitignore|dockerignore|dockerfile|makefile|cmake)$/i.test(path || "");
  const canPreview = isHtml || isMarkdown;

  // Syntax highlighting helper
  const highlightSyntax = useCallback((code, lang) => {
    if (!code) return "";
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Simple regex-based highlighting
    let highlighted = escaped;

    // Keywords (JS/TS/Python/Go/Rust)
    const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|default|from|async|await|try|catch|finally|throw|new|this|super|typeof|instanceof|in|of|void|delete|yield|static|get|set|constructor)\b/g;
    highlighted = highlighted.replace(keywords, '<span style="color:#c084fc">$1</span>');

    // Strings
    highlighted = highlighted.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '<span style="color:#86efac">$&</span>');

    // Numbers
    highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#fcd34d">$1</span>');

    // Comments (single line)
    highlighted = highlighted.replace(/(\/\/.*$)/gm, '<span style="color:#6b7280">$1</span>');

    // Comments (multi-line)
    highlighted = highlighted.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6b7280">$1</span>');

    // Functions
    highlighted = highlighted.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span style="color:#60a5fa">$1</span>');

    return highlighted;
  }, []);

  useEffect(() => {
    if (!path) return;
    setLoading(true); setError(null); setImageDataUri(null);
    const query = source === "local"
      ? `path=${encodeURIComponent(path)}&source=local`
      : `path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}`;
    window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(projectId)}/file?${query}`)
      .then(d => {
        if (d.encoding === "base64" && d.mime) {
          setImageDataUri(`data:${d.mime};base64,${d.content}`);
          setContent("");
        } else {
          setContent(d.content || "");
        }
      })
      .catch(e => setError(e.status === 404 && source !== "local"
        ? window.I18N.t("ui.repos.localOnlyFile", "This file does not exist on {0} yet — it is a local change that has not been pushed (new, renamed, or duplicated). Switch the tree to Local to view it, or commit and push.", { 0: PROVIDER_LABELS[provider] || "GitLab" })
        : e.message))
      .finally(() => setLoading(false));
  }, [projectId, provider, path, branch, source]);

  useEffect(() => { setPreview(false); setSplitView(false); setShowSearch(false); setSearchTerm(""); setShowHistory(false); setFileCommits(null); setExpandedSha(null); setExpandedDiff(null); }, [path]);

  // Diff de ESTE archivo entre el commit elegido y la versión actual (branch)
  // — no el commit completo contra su padre, que mezclaba otros archivos que
  // esa corrida también tocó.
  useEffect(() => {
    if (!expandedSha) { setExpandedDiff(null); return; }
    setExpandedDiff(null);
    window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(projectId)}/git/file-diff-since?path=${encodeURIComponent(path)}&sha=${expandedSha}&ref=${encodeURIComponent(branch)}`)
      .then(d => setExpandedDiff(d.diff || []))
      .catch(() => setExpandedDiff([]));
  }, [expandedSha, provider, projectId, path, branch]);
  useEffect(() => { if (showSearch) searchInputRef.current?.focus(); }, [showSearch]);

  // Últimos commits que tocaron este archivo — siempre contra la API remota
  // del proveedor (GitLab/GitHub/Bitbucket), sin importar si se está viendo
  // el árbol Local o el remoto: "quién lo cambió río arriba" es la pregunta,
  // no el estado de este checkout.
  useEffect(() => {
    if (!showHistory || !path || fileCommits !== null) return;
    window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(projectId)}/file-commits?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}&limit=5`)
      .then(d => setFileCommits(d.commits || []))
      .catch(() => setFileCommits([]));
  }, [showHistory, path, provider, projectId, branch, fileCommits]);

  // Search matches
  const matches = useMemo(() => {
    if (!searchTerm) return [];
    const needle = searchTerm.toLowerCase();
    const hay = content.toLowerCase();
    const found = [];
    let i = 0;
    while (true) {
      const at = hay.indexOf(needle, i);
      if (at === -1) break;
      found.push(at);
      i = at + needle.length;
    }
    return found;
  }, [content, searchTerm]);

  useEffect(() => { setMatchIdx(0); }, [searchTerm, path]);

  const gotoMatch = delta => {
    if (!matches.length) return;
    setMatchIdx(i => (i + delta + matches.length) % matches.length);
  };

  // Sync scroll between line numbers and textarea
  const handleScroll = useCallback(() => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    if (preview || !matches.length || !textareaRef.current) return;
    const start = matches[matchIdx] ?? matches[0];
    const ta = textareaRef.current;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, start + searchTerm.length);
    const line = content.slice(0, start).split("\n").length - 1;
    const lineHeight = 12.5 * 1.6;
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
    handleScroll();
  }, [matchIdx, matches, preview, handleScroll]);

  // Line numbers
  const lineCount = content.split("\n").length;
  const lineNumbers = useMemo(() => {
    return Array.from({ length: lineCount }, (_, i) => i + 1);
  }, [lineCount]);

  // Markdown preview
  const [markdownDoc, setMarkdownDoc] = useState("");
  useEffect(() => {
    if (!isMarkdown || !preview) { setMarkdownDoc(""); previewMatchCountRef.current = 0; return; }
    if (!window.marked) { setMarkdownDoc(`<p style='font-family:sans-serif;color:#dc2626;padding:16px'>${window.I18N.t("ui.repos.markedFailed", "Marked failed to load.")}</p>`); return; }
    let cancelled = false;

    (async () => {
      const blocks = [];
      let withPlaceholders = (content || "").replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
        const id = `mermaid-repos-${blocks.length}-${Math.random().toString(36).slice(2)}`;
        blocks.push({ id, code });
        return `<div id="${id}"></div>`;
      });

      let body = window.marked.parse(withPlaceholders);

      if (searchTerm) {
        const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const needle = new RegExp(escaped, "gi");
        let n = 0;
        body = body.split(/(<[^>]+>)/g)
          .map(part => part.startsWith("<") ? part : part.replace(needle, m => `<mark id="hq-match-${n++}" style="background:#fde047">${m}</mark>`))
          .join("");
        previewMatchCountRef.current = n;
      } else {
        previewMatchCountRef.current = 0;
      }

      if (blocks.length && window.mermaid) {
        if (!reposMermaidInitDone) {
          window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
          reposMermaidInitDone = true;
        }
        for (const block of blocks) {
          try {
            const { svg } = await window.mermaid.render(`svg-${block.id}`, block.code);
            body = body.replace(`<div id="${block.id}"></div>`, `<div style="margin:12px 0">${svg}</div>`);
          } catch (e) {
            body = body.replace(`<div id="${block.id}"></div>`, `<p style="color:#dc2626;font-size:.9em">⚠ ${e.message || window.I18N.t("home.mermaid.renderError", "Error rendering the diagram")}</p>`);
          }
        }
      }

      if (cancelled) return;
      setMarkdownDoc(`<!doctype html><html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, Segoe UI, sans-serif; color: #1f2937; padding: 20px 28px; line-height: 1.6; max-width: 860px; margin: 0 auto; }
        h1, h2, h3, h4 { font-weight: 600; line-height: 1.3; margin: 1.2em 0 .5em; }
        h1 { font-size: 1.7em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
        h2 { font-size: 1.35em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
        code { font-family: ui-monospace, monospace; background: #f1f5f9; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
        pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow: auto; }
        pre code { background: none; padding: 0; color: inherit; }
        a { color: #0891b2; }
        blockquote { margin: 0; padding: 0 1em; color: #64748b; border-left: 3px solid #e5e7eb; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
        img { max-width: 100%; }
      </style></head><body>${body}</body></html>`);
    })();

    return () => { cancelled = true; };
  }, [isMarkdown, preview, content, searchTerm]);

  const previewSrc = useMemo(() => {
    if (!markdownDoc) return "";
    const count = previewMatchCountRef.current;
    const anchor = count ? `#hq-match-${((matchIdx % count) + count) % count}` : "";
    return `data:text/html;charset=utf-8,${encodeURIComponent(markdownDoc)}${anchor}`;
  }, [markdownDoc, matchIdx]);

  // Syntax highlighted code for read-only mode
  const highlightedCode = useMemo(() => {
    if (!content || editable) return null;
    return highlightSyntax(content, path);
  }, [content, editable, path, highlightSyntax]);

  const btnStyle = (active) => ({
    height: 24, padding: "0 9px", fontSize: 11, borderRadius: 5,
    border: "1px solid var(--border)", background: active ? "var(--accent)" : "white",
    color: active ? "white" : "var(--fg)", cursor: "pointer", fontFamily: "inherit",
  });

  const renderCodePanel = () => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {editable ? (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Line numbers */}
          <div ref={lineNumbersRef} style={{
            width: 45, flexShrink: 0, overflow: "hidden",
            background: "#151210", color: "#525252", fontFamily: "var(--font-mono)",
            fontSize: 12.5, lineHeight: 1.6, padding: "14px 8px 14px 0",
            textAlign: "right", userSelect: "none", borderRight: "1px solid #2a2a2a",
          }}>
            {lineNumbers.map(n => (
              <div key={n} style={{ height: 12.5 * 1.6 }}>{n}</div>
            ))}
          </div>
          {/* Editable textarea */}
          <textarea
            ref={textareaRef}
            readOnly={!editable}
            value={content}
            onChange={e => setContent(e.target.value)}
            onScroll={handleScroll}
            spellCheck={false}
            style={{
              flex: 1, resize: "none", border: 0, outline: "none",
              padding: "14px 14px 14px 12px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6,
              background: "#1c1917", color: "#e7e5e4",
              whiteSpace: "pre", overflow: "auto",
            }}
          />
        </div>
      ) : (
        <div ref={codeContainerRef} style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Line numbers */}
          <div ref={lineNumbersRef} style={{
            width: 45, flexShrink: 0, overflow: "hidden",
            background: "#151210", color: "#525252", fontFamily: "var(--font-mono)",
            fontSize: 12.5, lineHeight: 1.6, padding: "14px 8px 14px 0",
            textAlign: "right", userSelect: "none", borderRight: "1px solid #2a2a2a",
          }}>
            {lineNumbers.map(n => (
              <div key={n} style={{ height: 12.5 * 1.6 }}>{n}</div>
            ))}
          </div>
          {/* Syntax highlighted code */}
          <div
            ref={textareaRef}
            onScroll={handleScroll}
            style={{
              flex: 1, overflow: "auto", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6,
              background: "#1c1917", color: "#e7e5e4", padding: "14px", whiteSpace: "pre",
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode || "" }}
          />
        </div>
      )}
    </div>
  );

  const renderPreviewPanel = () => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {isHtml ? (
        <iframe title="preview" srcDoc={content} sandbox="allow-scripts allow-forms allow-popups" style={{ flex: 1, border: 0, background: "white" }} />
      ) : isMarkdown && markdownDoc ? (
        <iframe key="md-preview" title="preview" src={previewSrc} sandbox="allow-popups" style={{ flex: 1, border: 0, background: "white" }} />
      ) : isMarkdown ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)", fontSize: 13 }}>{window.I18N.t("ui.repos.rendering", "Rendering preview…")}</div>
      ) : null}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--muted)", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</span>

        {/* View mode buttons */}
        {canPreview && (
          <div style={{ display: "flex", gap: 2, background: "#e5e7eb", borderRadius: 5, padding: 2 }}>
            <button onClick={() => { setPreview(false); setSplitView(false); }} style={btnStyle(!preview && !splitView)}>{"</>"}</button>
            <button onClick={() => { setPreview(true); setSplitView(false); }} style={btnStyle(preview && !splitView)}>{rt("repos.preview", "Preview")}</button>
            <button onClick={() => { setSplitView(true); setPreview(true); }} style={btnStyle(splitView)} title="Split view">⊞ Split</button>
          </div>
        )}

        {!imageDataUri && (
          <>
            <button onClick={onToggleEdit} title={window.I18N.t("ui.repos.localEdit", "Local editing")} style={btnStyle(editable)}>
              {editable ? "✎ Edit" : "✎"}
            </button>
            <button onClick={() => { navigator.clipboard?.writeText(content); toast(window.I18N.t("ui.copied", "Copied"), "ok"); }} style={btnStyle(false)}>⧉</button>
            <button onClick={() => setShowSearch(v => !v)} title={window.I18N.t("settings.search", "Search")} style={btnStyle(showSearch)}>🔍</button>
            <button onClick={() => setShowHistory(v => !v)} title={window.I18N.t("ui.repos.recentChanges", "Recent changes to this file")} style={btnStyle(showHistory)}>🕘</button>
          </>
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") { setShowSearch(false); setSearchTerm(""); }
              else if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
            }}
            placeholder={window.I18N.t("apps.search", "Search…")}
            style={{
              flex: 1, height: 26, padding: "0 8px", fontSize: 12, fontFamily: "var(--font-mono)",
              border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--fg)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--muted-fg)", minWidth: 50, textAlign: "center" }}>
            {searchTerm ? (matches.length ? `${matchIdx + 1}/${matches.length}` : "0/0") : ""}
          </span>
          <button onClick={() => gotoMatch(-1)} disabled={!matches.length} style={{ height: 24, width: 24, borderRadius: 5, border: "1px solid var(--border)", background: "white", cursor: matches.length ? "pointer" : "default", opacity: matches.length ? 1 : .5 }}>↑</button>
          <button onClick={() => gotoMatch(1)} disabled={!matches.length} style={{ height: 24, width: 24, borderRadius: 5, border: "1px solid var(--border)", background: "white", cursor: matches.length ? "pointer" : "default", opacity: matches.length ? 1 : .5 }}>↓</button>
          <button onClick={() => { setShowSearch(false); setSearchTerm(""); }} style={{ height: 24, width: 24, borderRadius: 5, border: "1px solid var(--border)", background: "white", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* File history — last commits that touched this file, any provider.
          Click a row to compare that commit's version of THIS file against
          the one before it, inline (reuses CommitDiff — needs a local clone,
          same as the History tab's own diff view). The small ↗ opens the
          commit on the provider's site instead, without expanding the diff. */}
      {showHistory && (
        <div style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          <div style={{ padding: "8px 12px" }}>
            {fileCommits === null ? (
              <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
            ) : fileCommits.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.noFileHistory", "No history for this file.")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {fileCommits.map(c => (
                  <div key={c.sha} style={{
                    display: "flex", alignItems: "center", gap: 4, borderRadius: 5,
                    background: expandedSha === c.sha ? "var(--row-hover)" : "transparent",
                  }}>
                    <button type="button"
                      onClick={() => setExpandedSha(v => v === c.sha ? null : c.sha)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, textAlign: "left", flex: 1, minWidth: 0,
                        background: "transparent", border: 0, borderRadius: 5, padding: "3px 5px",
                        cursor: "pointer", font: "inherit", color: "inherit",
                      }}>
                      <GitlabAvatar url={c.authorAvatar} size={16} direct={!/^gitlab/.test(provider)} />
                      <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message || "(sin mensaje)"}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-fg)", flexShrink: 0 }}>{c.author || "?"}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{c.sha}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-fg)", flexShrink: 0, minWidth: 55, textAlign: "right" }}>{c.when ? timeAgo(c.when) : "—"}</span>
                    </button>
                    {c.webUrl && (
                      <a href={c.webUrl} target="_blank" rel="noreferrer" title={`Ver en ${PROVIDER_LABELS[provider] || provider}`}
                        style={{ flexShrink: 0, color: "var(--muted-fg)", textDecoration: "none", padding: "0 6px" }}>↗</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {expandedSha && (
            <div style={{ flex: 1, minHeight: 0, borderTop: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--muted-fg)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>{window.I18N.t("ui.repos.changesIn", "Changes in")} <code style={{ fontFamily: "var(--font-mono)" }}>{path}</code> {window.I18N.t("ui.repos.from", "from")} <code style={{ fontFamily: "var(--font-mono)" }}>{expandedSha}</code> {window.I18N.t("ui.repos.to", "to")} <code style={{ fontFamily: "var(--font-mono)" }}>{branch}</code>
              </div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                {expandedDiff === null ? (
                  <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("settings.loading", "Loading…")}</div>
                ) : expandedDiff.length === 0 || expandedDiff.every(l => !l) ? (
                  <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("ui.repos.unchangedFile", "No changes to this file since that commit (or the repo is not cloned locally).")}</div>
                ) : (
                  <DiffViewer lines={expandedDiff} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content area — hidden while a commit's diff is expanded above, so
          the two comparisons (full file vs. one diff) don't stack and fight
          for space; collapse the history row to see the file again. */}
      {expandedSha ? null : loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)", fontSize: 13, background: "#1c1917" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
      ) : error ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--err)", fontSize: 13, background: "#1c1917", padding: "0 40px", textAlign: "center", lineHeight: 1.6 }}>{error}</div>
      ) : imageDataUri ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#1c1917", overflow: "auto", padding: 20 }}>
          <img src={imageDataUri} alt={path} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      ) : splitView && canPreview ? (
        // Split view: code + preview side by side
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, borderRight: "1px solid var(--border)", overflow: "hidden" }}>
            {renderCodePanel()}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {renderPreviewPanel()}
          </div>
        </div>
      ) : preview && canPreview ? (
        renderPreviewPanel()
      ) : (
        renderCodePanel()
      )}
    </div>
  );
}

function JobCard({ job, active, onSelect }) {
  const m = PIPELINE_META[job.status] || PIPELINE_META.none;
  const spinning = job.status === "running";
  return (
    <button onClick={() => onSelect(job.id)} style={{
      display: "flex", alignItems: "center", gap: 7, textAlign: "left", width: "100%",
      padding: "7px 9px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
      borderTop: `1px solid ${active ? m.color : "var(--border)"}`,
      borderRight: `1px solid ${active ? m.color : "var(--border)"}`,
      borderBottom: `1px solid ${active ? m.color : "var(--border)"}`,
      borderLeft: `3px solid ${m.color}`,
      background: active ? `${m.color}14` : "white",
      boxShadow: active ? `0 0 0 1px ${m.color}33` : "none",
    }}>
      <span style={{ color: m.color, fontSize: 12, flexShrink: 0, display: "inline-block", animation: spinning ? "spin 1s linear infinite" : "none" }}>{m.icon}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 500, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.name}</span>
      <span style={{ fontSize: 10, color: "var(--muted-fg)", flexShrink: 0, fontFamily: "var(--font-mono)" }}>{formatDuration(job.duration)}</span>
    </button>
  );
}

// ── Build / Pipeline tab — Buildkite-style build page: header with pipeline history
// strip, jobs laid out as a stage-by-stage waterfall, click a job to see its log ──────
function BuildPanel({ repo, branch }) {
  const [pipelines, setPipelines]           = useState(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState(null);
  const [jobs, setJobs]                     = useState(null);
  const [selectedJobId, setSelectedJobId]   = useState(null);
  const [trace, setTrace]                   = useState(null);
  const [running, setRunning]               = useState(false);

  const loadPipelines = useCallback(() => {
    setPipelines(null);
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/pipelines?ref=${encodeURIComponent(branch)}`)
      .then(d => {
        const list = d.pipelines || [];
        setPipelines(list);
        setSelectedPipelineId(list[0]?.id ?? null);
      })
      .catch(() => { setPipelines([]); setSelectedPipelineId(null); });
  }, [repo.id, branch]);

  useEffect(loadPipelines, [loadPipelines]);

  useEffect(() => {
    if (!selectedPipelineId) { setJobs([]); setSelectedJobId(null); return; }
    setJobs(null); setSelectedJobId(null);
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/pipelines/${selectedPipelineId}/jobs`)
      .then(d => {
        const list = d.jobs || [];
        setJobs(list);
        const pick = list.find(j => j.status === "running")
          || [...list].reverse().find(j => j.status === "failed")
          || list[list.length - 1];
        setSelectedJobId(pick?.id ?? null);
      })
      .catch(() => setJobs([]));
  }, [repo.id, selectedPipelineId]);

  useEffect(() => {
    if (!selectedJobId) { setTrace(null); return; }
    setTrace(null);
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/jobs/${selectedJobId}/trace`)
      .then(t => setTrace(t.trace || []))
      .catch(() => setTrace([]));
  }, [repo.id, selectedJobId]);

  const runBuild = () => {
    setRunning(true);
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/pipelines`, { method: "POST", body: { ref: branch } })
      .then(r => { toast(`Pipeline #${r.id} disparado en ${branch}`, "ok"); setTimeout(loadPipelines, 1500); })
      .catch(e => toast(window.I18N.t("ui.repos.pipelineFailed", "Could not trigger the pipeline:") + " " + e.message, "error"))
      .finally(() => setRunning(false));
  };

  const current = pipelines?.find(p => p.id === selectedPipelineId) || null;
  const selectedJob = jobs?.find(j => j.id === selectedJobId) || null;
  const pm = PIPELINE_META[current?.status] || PIPELINE_META.none;

  const stages = useMemo(() => {
    if (!jobs) return [];
    const map = new Map();
    jobs.forEach(j => {
      if (!map.has(j.stage)) map.set(j.stage, []);
      map.get(j.stage).push(j);
    });
    return Array.from(map.entries()).map(([name, list]) => ({ name, jobs: list }));
  }, [jobs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", flex: 1, minWidth: 0 }}>
      <style>{"@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"}</style>

      {/* Header — status, branch/commit, run action */}
      <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 19, color: pm.color, flexShrink: 0 }}>{pm.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg)" }}>
              {current ? `Pipeline #${current.id}` : window.I18N.t("ui.repos.noPipelines", "No pipelines")} <span style={{ fontWeight: 400, color: "var(--muted-fg)" }}>en</span> {branch}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              {current ? (
                <>
                  <span>{current.sha}</span>
                  {current.author && (
                    <>
                      <span>·</span>
                      <GitlabAvatar url={current.authorAvatar} direct={repo.provider !== "gitlab"} />
                      <span>{current.author}</span>
                    </>
                  )}
                  <span>· {timeAgo(current.when)} · {current.duration}</span>
                </>
              ) : "—"}
            </div>
          </div>
          {/* GitHub no tiene "un" pipeline por repo que disparar (ver el
              comentario de PROVIDERS.github en repos.js) — el botón solo
              tiene sentido para GitLab. */}
          {/^gitlab/.test(repo.provider) && (
            <button onClick={runBuild} disabled={running} style={{
              height: 26, padding: "0 10px", fontSize: 11, borderRadius: 5,
              border: "1px solid var(--accent)", background: "var(--accent)", color: "white",
              cursor: running ? "default" : "pointer", fontFamily: "inherit", fontWeight: 600, opacity: running ? .6 : 1, flexShrink: 0,
            }}>{running ? window.I18N.t("ui.repos.triggering", "Triggering…") : `▶ ${rt("repos.runBuild", "Run build")}`}</button>
          )}
        </div>

        {/* Recent pipelines — build history strip, click to browse a past run's jobs */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
          {pipelines === null ? (
            <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</span>
          ) : pipelines.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.noHistory", "No history.")}</span>
          ) : pipelines.map(p => {
            const m = PIPELINE_META[p.status] || PIPELINE_META.none;
            const active = p.id === selectedPipelineId;
            return (
              <button key={p.id} onClick={() => setSelectedPipelineId(p.id)} title={`${p.sha} · ${timeAgo(p.when)}`} style={{
                display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontFamily: "inherit",
                padding: "4px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${active ? m.color : "var(--border)"}`,
                background: active ? `${m.color}16` : "white",
                color: active ? m.color : "var(--muted-fg)",
              }}>
                <span>{m.icon}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{p.sha}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stage waterfall — jobs grouped in columns (GitLab stage, or one column
          per job for GitHub Actions, which has no stage concept), left-to-right run order */}
      <div style={{ display: "flex", gap: 0, overflowX: "auto", padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--muted)", minHeight: 100 }}>
        {jobs === null ? (
          <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
        ) : stages.length === 0 ? (
          <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.noJobs", "No jobs in this pipeline.")}</div>
        ) : stages.map((stage, si) => (
          <React.Fragment key={stage.name}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 160, padding: "0 10px" }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--muted-fg)", marginBottom: 1 }}>{stage.name}</div>
              {stage.jobs.map(j => <JobCard key={j.id} job={j} active={j.id === selectedJobId} onSelect={setSelectedJobId} />)}
            </div>
            {si < stages.length - 1 && <div style={{ width: 1, background: "var(--border)", margin: "2px 2px 2px 0", flexShrink: 0 }} />}
          </React.Fragment>
        ))}
      </div>

      {/* Selected job's log */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--border)" }}>
        {selectedJob && <PipelineBadge status={selectedJob.status} />}
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg)" }}>{selectedJob?.name || "—"}</span>
        {selectedJob && <span style={{ fontSize: 11, color: "var(--muted-fg)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{formatDuration(selectedJob.duration)}</span>}
      </div>
      <div style={{
        flex: 1, overflow: "auto", padding: 14,
        background: "#1c1917", color: "#d6d3d1",
        fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap",
      }}>
        {trace === null ? (
          <span style={{ color: "var(--muted-fg)" }}>{selectedJobId ? window.I18N.t("settings.loading", "Loading…") : window.I18N.t("ui.repos.chooseJob", "Select a job to view its log.")}</span>
        ) : trace.length === 0 ? (
          <span style={{ color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.noLog", "No log available.")}</span>
        ) : trace.map((line, i) => (
          <div key={i} style={{
            color: /error/i.test(line) ? "#f87171" : line.trim().startsWith("$") ? "#7dd3fc" : /succeed|success|passed/i.test(line) ? "#86efac" : "inherit",
          }}>{line}</div>
        ))}
      </div>
    </div>
  );
}

// ── History tab — branches + commit log + diff + fetch/pull/push (SourceTree-style,
// operates on the real local clone via git, not just GitLab's API) ────────────────────
const gitToolbarBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
  height: 26, padding: "0 8px", border: "1px solid var(--border)", background: "white",
  borderRadius: 5, fontSize: 11, fontWeight: 600, color: "var(--fg)", cursor: "pointer", fontFamily: "inherit", flex: 1,
};

function BranchList({ branches, selectedBranch, currentBranch, onSelect, onCheckout, checkingOut }) {
  const locals  = branches.filter(b => !b.remote);
  const remotes = branches.filter(b => b.remote);
  const row = (b) => (
    <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <button onClick={() => onSelect(b.name)} style={{
        flex: 1, textAlign: "left", background: b.name === selectedBranch ? "color-mix(in srgb, var(--accent) 10%, white)" : "transparent",
        border: 0, borderRadius: 5, padding: "5px 6px", cursor: "pointer", fontFamily: "var(--font-mono)",
        fontSize: 11.5, color: b.name === selectedBranch ? "var(--accent)" : "var(--fg)",
        fontWeight: b.name === currentBranch ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }} title={b.name}>
        {b.name === currentBranch ? "● " : b.remote ? "⌥ " : "○ "}
        {b.remote ? `${b.name.replace(/^origin\//, "")} (origin)` : `${b.name} (local)`}
      </button>
      {b.name !== currentBranch && (
        <button onClick={() => onCheckout(b.name)} disabled={checkingOut} title={`git checkout ${b.name}`} style={{
          height: 20, width: 20, flexShrink: 0, border: "1px solid var(--border)", background: "white", borderRadius: 4,
          fontSize: 10, cursor: checkingOut ? "wait" : "pointer", color: "var(--muted-fg)",
        }}>⇄</button>
      )}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", marginBottom: 4 }}>{rt("repos.local", "Local")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{locals.map(row)}</div>
      </div>
      {remotes.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", marginBottom: 4 }}>{rt("repos.remote", "Remote (origin)")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{remotes.map(row)}</div>
        </div>
      )}
    </div>
  );
}

function RefBadge({ label }) {
  const isTag = label.startsWith("tag:");
  const text = label.replace(/^tag:\s*/, "").replace(/^HEAD -> /, "");
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)",
      background: isTag ? "rgba(217, 119, 6, 0.12)" : "rgba(37, 99, 235, 0.12)",
      color: isTag ? "#b45309" : "#2563eb", flexShrink: 0,
    }}>{isTag ? "🏷 " : "⎇ "}{text}</span>
  );
}

// Lane-assignment for the branch graph column — same idea as `git log --graph`, computed
// ourselves so we control one row per commit (git's own ASCII graph can use 2+ rows per
// commit around merges, which doesn't line up with our list). Handles linear history,
// merges (2+ parents → extra lanes), and branch points (2+ lanes waiting on the same sha
// → converge into one).
const GRAPH_PALETTE = ["#3b82f6", "#f97316", "#10b981", "#a855f7", "#ef4444", "#06b6d4", "#eab308", "#ec4899"];

function computeGraphLayout(commits) {
  const lanes = [];       // lanes[i] = sha this lane is waiting for, or null
  const laneColors = [];  // parallel array of colors
  let colorCursor = 0;
  const nextColor = () => GRAPH_PALETTE[(colorCursor++) % GRAPH_PALETTE.length];

  const rows = commits.map((c) => {
    const before = lanes.slice();
    const beforeColors = laneColors.slice();

    const matches = [];
    lanes.forEach((sha, i) => { if (sha === c.sha) matches.push(i); });
    const isFreshTip = matches.length === 0;
    let lane;
    if (!isFreshTip) {
      lane = matches[0];
    } else {
      lane = lanes.findIndex(v => v === null);
      if (lane === -1) { lane = lanes.length; lanes.push(null); laneColors.push(null); }
    }
    const mergingFrom = matches.slice(1); // other lanes that also pointed here → converge
    mergingFrom.forEach(i => { lanes[i] = null; });

    const color = isFreshTip ? nextColor() : (beforeColors[lane] || nextColor());

    // resolve this lane forward via first parent (keeps the same color/lane going down)
    if (c.parents.length === 0) {
      lanes[lane] = null; laneColors[lane] = null;
    } else {
      lanes[lane] = c.parents[0]; laneColors[lane] = color;
    }

    // extra parents (merge commit) spawn/reuse lanes going down, in new colors
    const extraParentLanes = [];
    for (let p = 1; p < c.parents.length; p++) {
      const psha = c.parents[p];
      let idx = lanes.findIndex(v => v === psha);
      if (idx === -1) {
        idx = lanes.findIndex(v => v === null);
        if (idx === -1) { idx = lanes.length; lanes.push(null); laneColors.push(null); }
        const col = nextColor();
        lanes[idx] = psha; laneColors[idx] = col;
        extraParentLanes.push({ lane: idx, color: col });
      } else {
        extraParentLanes.push({ lane: idx, color: laneColors[idx] });
      }
    }

    const throughLanes = before
      .map((sha, i) => (sha !== null && i !== lane && !mergingFrom.includes(i)) ? { lane: i, color: beforeColors[i] } : null)
      .filter(Boolean);

    return {
      sha: c.sha, lane, color, isFreshTip,
      hasOutgoing: c.parents.length > 0,
      mergingFrom: mergingFrom.map(i => ({ lane: i, color: beforeColors[i] })),
      extraParentLanes, throughLanes,
    };
  });

  const maxLanes = Math.max(1, ...rows.map(r => Math.max(r.lane, ...r.throughLanes.map(t => t.lane), ...r.mergingFrom.map(t => t.lane), ...r.extraParentLanes.map(t => t.lane), 0) + 1));
  return { rows, maxLanes };
}

function CommitGraphRow({ row, maxLanes, rowHeight, laneWidth = 14 }) {
  const width = maxLanes * laneWidth;
  const cx = (lane) => lane * laneWidth + laneWidth / 2;
  const midY = rowHeight / 2;
  return (
    <svg width={width} height={rowHeight} style={{ display: "block", flexShrink: 0, overflow: "visible" }}>
      {row.throughLanes.map(t => (
        <line key={`t${t.lane}`} x1={cx(t.lane)} y1={0} x2={cx(t.lane)} y2={rowHeight} stroke={t.color} strokeWidth="2" />
      ))}
      {!row.isFreshTip && (
        <line x1={cx(row.lane)} y1={0} x2={cx(row.lane)} y2={midY} stroke={row.color} strokeWidth="2" />
      )}
      {row.mergingFrom.map(m => (
        <path key={`m${m.lane}`} d={`M ${cx(m.lane)} 0 Q ${cx(m.lane)} ${midY} ${cx(row.lane)} ${midY}`} stroke={m.color} strokeWidth="2" fill="none" />
      ))}
      {row.hasOutgoing && (
        <line x1={cx(row.lane)} y1={midY} x2={cx(row.lane)} y2={rowHeight} stroke={row.color} strokeWidth="2" />
      )}
      {row.extraParentLanes.map(ep => (
        <path key={`e${ep.lane}`} d={`M ${cx(row.lane)} ${midY} Q ${cx(ep.lane)} ${midY} ${cx(ep.lane)} ${rowHeight}`} stroke={ep.color} strokeWidth="2" fill="none" />
      ))}
      <circle cx={cx(row.lane)} cy={midY} r={4} fill={row.color} stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

function CommitList({ commits, selectedSha, onSelect }) {
  const ROW_H = 30;
  const { rows, maxLanes } = useMemo(() => computeGraphLayout(commits), [commits]);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {commits.map((c, i) => (
        <div key={c.sha} onClick={() => onSelect(c.sha)} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "0 10px", cursor: "pointer",
          height: ROW_H, borderBottom: "1px solid var(--border)",
          background: c.sha === selectedSha ? "color-mix(in srgb, var(--accent) 8%, white)" : "transparent",
        }}
        onMouseEnter={e => { if (c.sha !== selectedSha) e.currentTarget.style.background = "var(--row-hover)"; }}
        onMouseLeave={e => { if (c.sha !== selectedSha) e.currentTarget.style.background = "transparent"; }}>
          <CommitGraphRow row={rows[i]} maxLanes={maxLanes} rowHeight={ROW_H} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-fg)", flexShrink: 0 }}>{c.shortSha}</span>
          {c.refs.map(r => <RefBadge key={r} label={r} />)}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
          <span style={{ fontSize: 11, color: "var(--muted-fg)", flexShrink: 0, width: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.author}</span>
          <span style={{ fontSize: 11, color: "var(--muted-fg)", flexShrink: 0, width: 70, textAlign: "right" }}>{timeAgo(c.date)}</span>
        </div>
      ))}
      {commits.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("ui.repos.noCommits", "No commits.")}</div>}
    </div>
  );
}

const FILE_STATUS_META = {
  A: { label: "Added",    color: "#16a34a", icon: "+" },
  M: { label: "Modified", color: "#d97706", icon: "●" },
  D: { label: "Deleted",  color: "#dc2626", icon: "−" },
  R: { label: "Renamed",  color: "#2563eb", icon: "→" },
  C: { label: "Copied",   color: "#2563eb", icon: "⎘" },
  "?": { label: "Untracked", color: "#6b7280", icon: "?" },
};

function CommitFileList({ files, selectedFile, onSelect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {files.map(f => {
        const meta = FILE_STATUS_META[f.status] || FILE_STATUS_META.M;
        const active = f.file === selectedFile;
        return (
          <div key={f.file} onClick={() => onSelect(f.file)} title={f.file} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", cursor: "pointer",
            background: active ? "color-mix(in srgb, var(--accent) 10%, white)" : "transparent",
            borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
          }}
          onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--row-hover)"; }}
          onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
            <span style={{
              width: 15, height: 15, flexShrink: 0, borderRadius: 3, background: `${meta.color}22`, color: meta.color,
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
            }}>{meta.icon}</span>
            <span style={{
              flex: 1, minWidth: 0, fontSize: 11.5, fontFamily: "var(--font-mono)",
              color: active ? "var(--accent)" : "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{f.file}</span>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              {f.additions > 0 && <span style={{ color: "#16a34a" }}>+{f.additions}</span>}
              {f.additions > 0 && f.deletions > 0 && " "}
              {f.deletions > 0 && <span style={{ color: "#dc2626" }}>-{f.deletions}</span>}
            </span>
          </div>
        );
      })}
      {files.length === 0 && <div style={{ padding: 14, fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.noFileChanges", "No file changes (or empty commit)")}</div>}
    </div>
  );
}

function CommitDiff({ projectId, provider, sha }) {
  const [data, setData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  useEffect(() => {
    setData(null); setSelectedFile(null);
    window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(projectId)}/git/commit/${sha}`)
      .then(d => { setData(d); if (d.files?.length) setSelectedFile(d.files[0].file); })
      .catch(() => setData({ files: [] }));
  }, [projectId, provider, sha]);

  if (!data) return <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("settings.loading", "Loading…")}</div>;

  const activeFile = data.files.find(f => f.file === selectedFile);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", padding: "8px 8px 4px" }}>
          {data.files.length} archivo{data.files.length === 1 ? "" : "s"} cambiado{data.files.length === 1 ? "" : "s"}
        </div>
        <CommitFileList files={data.files} selectedFile={selectedFile} onSelect={setSelectedFile} />
      </div>
      <div style={{ flex: 1, overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {activeFile ? (
          <DiffViewer lines={activeFile.diff} />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("repos.selectFile", "Select a file")} </div>
        )}
      </div>
    </div>
  );
}

function subTabBtn(active) {
  return {
    padding: "8px 14px", fontSize: 11.5, fontWeight: 600, border: 0, cursor: "pointer", fontFamily: "inherit",
    background: "transparent", color: active ? "var(--accent)" : "var(--muted-fg)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  };
}

// ── Paneles con ancho ajustable (árbol de archivos, lista de branches, file status) —
// arrastra el separador; el ancho se recuerda por panel vía localStorage. ──────────
function useReposResizableWidth(storageKey, defaultWidth, min = 160, max = 520) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= min && saved <= max ? saved : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    // Variable local a este gesto de arrastre — no depender de que React ya haya
    // re-renderizado widthRef.current antes del mouseup (si move+up llegan en el
    // mismo tick, como con eventos sintéticos, el ref todavía tiene el valor viejo).
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      currentWidth = Math.min(max, Math.max(min, startWidth + (ev.clientX - startX)));
      setWidth(currentWidth);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(storageKey, String(currentWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [min, max, storageKey]);

  return [width, onMouseDown];
}

function ResizeHandle({ onMouseDown }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={window.I18N.t("connectors.resizeHandle", "Drag to resize")}
      style={{
        width: 5, flexShrink: 0, cursor: "col-resize",
        background: hover ? "var(--accent)" : "transparent",
        borderRight: hover ? "none" : "1px solid var(--border)",
        transition: "background .1s",
      }}
    />
  );
}

// ── Diff viewer — toggle between the raw unified patch (as-is today) and a
// side-by-side "old vs new" comparison. Shared by WorkingCopyPanel (working
// copy diff) and CommitDiff (historical commit diff) — both already fed the
// same `lines: string[]` shape from their respective /git/diff endpoints, so
// the parsing/rendering logic only needs to exist once. ────────────────────

// Naive unified→split pairing: within a hunk, consecutive '-' lines are
// paired 1:1 with the consecutive '+' lines that immediately follow them
// (padding the shorter side with a blank cell) — same approach used by most
// lightweight diff viewers; it does not attempt word-level realignment.
function parseDiffToSplitHunks(lines) {
  const hunks = [];
  let current = null;
  let oldNum = 0, newNum = 0;
  let pendingRemoved = [];
  let pendingAdded = [];

  const flushPending = () => {
    if (!pendingRemoved.length && !pendingAdded.length) return;
    const max = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < max; i++) {
      const l = pendingRemoved[i];
      const r = pendingAdded[i];
      current.rows.push({
        left: l !== undefined ? { num: oldNum++, text: l, type: "del" } : null,
        right: r !== undefined ? { num: newNum++, text: r, type: "add" } : null,
      });
    }
    pendingRemoved = []; pendingAdded = [];
  };

  for (const line of lines) {
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      flushPending();
      current = { header: line, rows: [] };
      hunks.push(current);
      oldNum = Number(hunkMatch[1]);
      newNum = Number(hunkMatch[2]);
      continue;
    }
    if (!current) continue; // "diff --git"/"index"/"---"/"+++" preamble — not part of any hunk
    if (line.startsWith("+") && !line.startsWith("+++")) {
      pendingAdded.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      pendingRemoved.push(line.slice(1));
    } else {
      flushPending();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      current.rows.push({
        left: { num: oldNum++, text, type: "ctx" },
        right: { num: newNum++, text, type: "ctx" },
      });
    }
  }
  flushPending();
  return hunks;
}

const DIFF_ROW_BG = { del: "rgba(248,113,113,.14)", add: "rgba(134,239,172,.14)", ctx: "transparent" };
const DIFF_ROW_FG = { del: "#f87171", add: "#86efac", ctx: "#a8a29e" };

function DiffSplitCell({ row, side }) {
  const cell = row?.[side];
  return (
    <div style={{ display: "flex", background: cell ? DIFF_ROW_BG[cell.type] : "transparent" }}>
      <span style={{ width: 40, flexShrink: 0, textAlign: "right", padding: "0 8px", color: "var(--muted-fg)", opacity: 0.7, userSelect: "none" }}>
        {cell ? cell.num : ""}
      </span>
      <span style={{ padding: "0 10px 0 4px", color: cell ? DIFF_ROW_FG[cell.type] : "transparent", whiteSpace: "pre" }}>
        {cell ? (cell.text || " ") : " "}
      </span>
    </div>
  );
}

function DiffViewer({ lines }) {
  const [view, setView] = useState("unified"); // "unified" | "split"
  const hunks = useMemo(() => (view === "split" ? parseDiffToSplitHunks(lines) : null), [lines, view]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--surface)" }}>
        <button onClick={() => setView("unified")} style={diffViewToggleBtn(view === "unified")}>{rt("repos.unified", "Unified")}</button>
        <button onClick={() => setView("split")} style={diffViewToggleBtn(view === "split")} title={window.I18N.t("ui.repos.compareHelp", "Compare side by side: before and after")}>{rt("repos.split", "Split")}</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
        {view === "unified" ? (
          <div style={{ padding: 10, background: "#1c1917", fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre", minHeight: "100%" }}>
            {lines.map((line, i) => (
              <div key={i} style={{
                color: /^\+(?!\+\+)/.test(line) ? "#86efac" : /^-(?!--)/.test(line) ? "#f87171" : /^@@/.test(line) ? "#7dd3fc" : "#a8a29e",
              }}>{line || " "}</div>
            ))}
          </div>
        ) : (
          <div style={{ background: "#1c1917", fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.6, minHeight: "100%" }}>
            {hunks.length === 0 && <div style={{ padding: 10, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.unchanged", "No changes.")}</div>}
            {hunks.map((h, hi) => (
              <div key={hi}>
                <div style={{ padding: "3px 8px", color: "#7dd3fc", background: "rgba(125,211,252,.08)" }}>{h.header}</div>
                <div style={{ display: "flex" }}>
                  <div style={{ flex: 1, minWidth: 0, overflowX: "auto", borderRight: "1px solid var(--border)" }}>
                    {h.rows.map((row, ri) => <DiffSplitCell key={ri} row={row} side="left" />)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
                    {h.rows.map((row, ri) => <DiffSplitCell key={ri} row={row} side="right" />)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function diffViewToggleBtn(active) {
  return {
    height: 22, padding: "0 9px", fontSize: 10.5, fontWeight: 600, borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "color-mix(in srgb, var(--accent) 10%, white)" : "white",
    color: active ? "var(--accent)" : "var(--muted-fg)",
  };
}

// ── File tree — groups a flat file list (as returned by /git/status) into
// nested folders, collapsible, instead of one long flat list of full paths.
// `collapsedDirs`/`onToggleDir` are lifted to the caller so Staged and
// Unstaged sections can share one expand/collapse state (collapsing "app/"
// in one section collapses it in both — same folder, same repo). ──────────
function buildGitStatusTree(files) {
  const root = { path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.file.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) {
        node.dirs.set(seg, { name: seg, path: node.path ? `${node.path}/${seg}` : seg, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(seg);
    }
    node.files.push(f);
  }
  return root;
}

function countFilesRecursive(node) {
  let n = node.files.length;
  for (const dir of node.dirs.values()) n += countFilesRecursive(dir);
  return n;
}

function GitStatusTreeNode({ node, depth, collapsedDirs, onToggleDir, renderFile }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.file.localeCompare(b.file));
  return (
    <>
      {dirs.map(dir => {
        const collapsed = collapsedDirs.has(dir.path);
        return (
          <React.Fragment key={dir.path}>
            <div onClick={() => onToggleDir(dir.path)} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", paddingLeft: 8 + depth * 14,
              cursor: "pointer", fontSize: 11, color: "var(--muted-fg)", fontWeight: 600,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ width: 10, flexShrink: 0, transition: "transform .1s", transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir.name}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{countFilesRecursive(dir)}</span>
            </div>
            {!collapsed && <GitStatusTreeNode node={dir} depth={depth + 1} collapsedDirs={collapsedDirs} onToggleDir={onToggleDir} renderFile={renderFile} />}
          </React.Fragment>
        );
      })}
      {files.map(f => renderFile(f, depth))}
    </>
  );
}

// ── File Status (working copy) — staged/unstaged/untracked files not yet committed,
// mirrors SourceTree's "File Status" tab: stage/unstage per file, diff on the right, commit box ──
function WorkingCopyPanel({ repo, onStatusChange, onCommitted }) {
  const [status, setStatus]         = useState(null); // { staged: [], unstaged: [] }
  const [selected, setSelected]     = useState(null);  // { file, mode }
  const [diff, setDiff]             = useState(null);
  const [message, setMessage]       = useState("");
  const [busyFile, setBusyFile]     = useState(null);
  const [committing, setCommitting] = useState(false);
  const [sidebarWidth, onResizeStart] = useReposResizableWidth("repos.workingCopy.sidebarWidth", 260, 180, 480);
  // Un solo set compartido entre Staged/Unstaged: colapsar "app/" en una
  // sección lo colapsa en la otra también — es la misma carpeta del mismo repo.
  const [collapsedDirs, setCollapsedDirs] = useState(() => new Set());
  const toggleDir = (path) => setCollapsedDirs(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const load = useCallback(() => {
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/status`)
      .then(d => {
        setStatus(d);
        onStatusChange?.({ staged: d.staged.length, unstaged: d.unstaged.length });
      })
      .catch(() => setStatus({ staged: [], unstaged: [] }));
  }, [repo.id]);

  useEffect(load, [load]);

  const selectFile = (file, mode) => {
    setSelected({ file, mode });
    setDiff(null);
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/diff?file=${encodeURIComponent(file)}&mode=${mode}`)
      .then(d => setDiff(d.diff || []))
      .catch(() => setDiff([]));
  };

  const toggleStage = async (file, currentlyStaged) => {
    setBusyFile(file);
    try {
      await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/${currentlyStaged ? "unstage" : "stage"}`, { method: "POST", body: { file } });
      load();
    } catch (e) {
      toast(window.I18N.t("ui.repos.stageFailed", "Could not update staging:") + " " + e.message, "error");
    } finally {
      setBusyFile(null);
    }
  };

  const commit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/commit`, { method: "POST", body: { message } });
      toast(window.I18N.t("ui.repos.committed", "Commit created"), "ok");
      setMessage(""); setSelected(null); setDiff(null);
      load();
      onCommitted?.();
    } catch (e) {
      toast(window.I18N.t("ui.repos.commitFailed", "Could not commit:") + " " + e.message, "error");
    } finally {
      setCommitting(false);
    }
  };

  const stagedTree = useMemo(() => buildGitStatusTree(status?.staged || []), [status?.staged]);
  const unstagedTree = useMemo(() => buildGitStatusTree(status?.unstaged || []), [status?.unstaged]);

  if (!status) return <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("settings.loading", "Loading…")}</div>;

  const row = (f, staged, depth = 0) => {
    const meta = FILE_STATUS_META[f.status] || FILE_STATUS_META.M;
    const mode = staged ? "staged" : (f.status === "?" ? "untracked" : "unstaged");
    const active = selected?.file === f.file && selected?.mode === mode;
    const name = f.file.split("/").pop();
    return (
      <div key={`${staged ? "s" : "u"}-${f.file}`} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", paddingLeft: 8 + depth * 14,
        background: active ? "color-mix(in srgb, var(--accent) 10%, white)" : "transparent",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--row-hover)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
        <input type="checkbox" checked={staged} disabled={busyFile === f.file}
          onChange={() => toggleStage(f.file, staged)} style={{ cursor: "pointer", flexShrink: 0 }} />
        <span onClick={() => selectFile(f.file, mode)} title={f.file} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <span style={{
            width: 15, height: 15, flexShrink: 0, borderRadius: 3, background: `${meta.color}22`, color: meta.color,
            display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
          }}>{meta.icon}</span>
          <span style={{
            fontSize: 11.5, fontFamily: "var(--font-mono)", color: active ? "var(--accent)" : "var(--fg)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{name}</span>
        </span>
      </div>
    );
  };


  const totalChanges = status.staged.length + status.unstaged.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: sidebarWidth, flexShrink: 0, overflow: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", padding: "8px 8px 4px" }}>
            Staged files ({status.staged.length})
          </div>
          {status.staged.length === 0
            ? <div style={{ padding: "0 8px 8px", fontSize: 11, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.nothingStaged", "Nothing staged")}</div>
            : <GitStatusTreeNode node={stagedTree} depth={0} collapsedDirs={collapsedDirs} onToggleDir={toggleDir} renderFile={(f, depth) => row(f, true, depth)} />}
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase",
            padding: "10px 8px 4px", borderTop: "1px solid var(--border)", marginTop: 6,
          }}>
            Unstaged files ({status.unstaged.length})
          </div>
          {status.unstaged.length === 0
            ? <div style={{ padding: "0 8px 8px", fontSize: 11, color: "var(--muted-fg)" }}>{window.I18N.t("ui.repos.noChanges", "No changes")}</div>
            : <GitStatusTreeNode node={unstagedTree} depth={0} collapsedDirs={collapsedDirs} onToggleDir={toggleDir} renderFile={(f, depth) => row(f, false, depth)} />}
        </div>
        <ResizeHandle onMouseDown={onResizeStart} />
        <div style={{ flex: 1, overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)", fontSize: 12, textAlign: "center", padding: 20 }}>
              {totalChanges === 0 ? window.I18N.t("ui.repos.clean", "No local changes — working copy clean.") : window.I18N.t("ui.repos.chooseDiff", "Select a file to view the diff.")}
            </div>
          ) : diff === null ? (
            <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("settings.loading", "Loading…")}</div>
          ) : (
            <DiffViewer lines={diff} />
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={window.I18N.t("ui.repos.commitMessage", "Commit message…")} style={{
          flex: 1, resize: "none", height: 44, padding: "6px 8px", fontSize: 12, fontFamily: "inherit",
          border: "1px solid var(--border)", borderRadius: 6,
        }} />
        <button onClick={commit} disabled={committing || !message.trim() || status.staged.length === 0} style={{
          height: 44, padding: "0 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid var(--accent)",
          background: "var(--accent)", color: "white", fontFamily: "inherit", flexShrink: 0,
          cursor: (committing || !message.trim() || status.staged.length === 0) ? "default" : "pointer",
          opacity: (committing || !message.trim() || status.staged.length === 0) ? .5 : 1,
        }}>{committing ? "…" : "✓ Commit"}</button>
      </div>
    </div>
  );
}

function HistoryPanel({ repo, branch, onBranchChanged }) {
  const [branches, setBranches]         = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(branch);
  const [commits, setCommits]           = useState(null);
  const [selectedSha, setSelectedSha]   = useState(null);
  const [checkingOut, setCheckingOut]   = useState(false);
  const [busy, setBusy]                 = useState(null); // "fetch" | "pull" | "push" | null
  const [view, setView]                 = useState("status"); // "status" | "log"
  const [statusSummary, setStatusSummary] = useState(null);

  const loadBranches = useCallback(() => {
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/branches`)
      .then(d => setBranches(d.branches || []))
      .catch(() => setBranches([]));
  }, [repo.id]);

  const loadLog = useCallback((br) => {
    setCommits(null); setSelectedSha(null);
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/log?branch=${encodeURIComponent(br)}`)
      .then(d => setCommits(d.commits || []))
      .catch(() => setCommits([]));
  }, [repo.id]);

  useEffect(() => { loadBranches(); }, [loadBranches]);
  useEffect(() => { loadLog(selectedBranch); }, [selectedBranch, loadLog]);

  const checkout = async (name) => {
    setCheckingOut(true);
    try {
      const r = await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/checkout`, { method: "POST", body: { branch: name } });
      toast(`git checkout → ${r.branch}`, "ok");
      setSelectedBranch(r.branch);
      onBranchChanged?.(r.branch);
      loadBranches();
    } catch (e) {
      toast(window.I18N.t("ui.repos.checkoutFailed", "Could not check out:") + " " + e.message, "error");
    } finally {
      setCheckingOut(false);
    }
  };

  const runGitAction = async (action, label) => {
    setBusy(action);
    try {
      await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/git/${action}`, { method: "POST" });
      toast(`${label} OK`, "ok");
      loadBranches();
      loadLog(selectedBranch);
    } catch (e) {
      toast(window.I18N.t("ui.repos.operationFailed", "{0} failed: ", { 0: label }) + e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const currentBranch = branches?.find(b => b.current)?.name;
  const [branchesWidth, onBranchesResizeStart] = useReposResizableWidth("repos.history.branchesWidth", 230, 160, 420);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", width: "100%" }}>
      <div style={{ width: branchesWidth, flexShrink: 0, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => runGitAction("fetch", "Fetch")} disabled={!!busy} style={gitToolbarBtn}>{busy === "fetch" ? "…" : "⤓ Fetch"}</button>
          <button onClick={() => runGitAction("pull", "Pull")} disabled={!!busy} style={gitToolbarBtn}>{busy === "pull" ? "…" : `⇩ ${rt("repos.pull", "Pull")}`}</button>
          <button onClick={() => runGitAction("push", "Push")} disabled={!!busy} style={{ ...gitToolbarBtn, background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}>{busy === "push" ? "…" : `⇧ ${rt("repos.push", "Push")}`}</button>
        </div>
        {branches === null ? (
          <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
        ) : (
          <BranchList branches={branches} selectedBranch={selectedBranch} currentBranch={currentBranch} onSelect={setSelectedBranch} onCheckout={checkout} checkingOut={checkingOut} />
        )}
      </div>
      <ResizeHandle onMouseDown={onBranchesResizeStart} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button onClick={() => setView("status")} style={subTabBtn(view === "status")}>
            File Status{statusSummary ? ` (${statusSummary.staged + statusSummary.unstaged})` : ""}
          </button>
          <button onClick={() => setView("log")} style={subTabBtn(view === "log")}>{rt("repos.logHistory", "Log / History")}</button>
        </div>
        {view === "status" ? (
          <WorkingCopyPanel repo={repo} onStatusChange={setStatusSummary} onCommitted={() => loadLog(selectedBranch)} />
        ) : (
          <>
            <div style={{ flex: selectedSha ? "0 0 45%" : 1, overflow: "auto" }}>
              {commits === null ? (
                <div style={{ padding: 14, color: "var(--muted-fg)", fontSize: 12 }}>{window.I18N.t("settings.loading", "Loading…")}</div>
              ) : (
                <CommitList commits={commits} selectedSha={selectedSha} onSelect={setSelectedSha} />
              )}
            </div>
            {selectedSha && (
              <div style={{ flex: 1, overflow: "hidden", borderTop: "1px solid var(--border)" }}>
                <CommitDiff projectId={repo.id} provider={repo.provider} sha={selectedSha} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Pull Requests / Issues — lista de solo lectura de lo que el proveedor
// tiene abierto. Un mismo panel sirve a las dos pestañas: comparten el filtro
// de estado, la carga, el vacío y casi toda la fila, y solo difieren en el
// endpoint y en un par de campos propios. Partirlo en dos componentes
// duplicaría todo eso para quedarse con dos diferencias.
function RepoItemsPanel({ repo, kind }) {
  const esPR = kind === "pulls";
  const [items, setItems] = useState(null);
  const [estado, setEstado] = useState("open");
  const [fallo, setFallo] = useState(null);
  // Detalle desplegado. Se cachea por número: volver a abrir un PR ya visto no
  // debería pagar otra vez las cinco llamadas que cuesta armarlo.
  const [abierto, setAbierto] = useState(null);
  const [detalles, setDetalles] = useState({});

  const alternarDetalle = (numero) => {
    if (abierto === numero) { setAbierto(null); return; }
    setAbierto(numero);
    if (detalles[numero]) return;
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/pull-requests/${numero}`)
      .then(data => setDetalles(previo => ({ ...previo, [numero]: data })))
      .catch(error => setDetalles(previo => ({ ...previo, [numero]: { error: error?.detail || error?.message || String(error) } })));
  };

  useEffect(() => {
    // Cambiar de pestaña o de filtro mientras vuela la petición anterior podía
    // pintar la respuesta vieja encima de la nueva; el testigo la descarta.
    let cancelado = false;
    setItems(null); setFallo(null); setAbierto(null);
    const recurso = esPR ? "pull-requests" : "issues";
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/${recurso}?state=${estado}`)
      .then(data => { if (!cancelado) setItems((esPR ? data?.pullRequests : data?.issues) || []); })
      .catch(error => { if (!cancelado) { setFallo(error?.detail || error?.message || String(error)); setItems([]); } });
    return () => { cancelado = true; };
  }, [repo.provider, repo.id, estado, esPR]);

  const COLOR_ESTADO = { open: "#16a34a", merged: "#8250df", closed: "#6b7280" };
  const cuando = iso => {
    if (!iso) return "—";
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (dias <= 0) return rt("ui.repos.today", "today");
    if (dias === 1) return rt("ui.repos.yesterday", "yesterday");
    if (dias < 30) return rt("ui.repos.daysAgo", "{0}d ago", { 0: dias });
    return new Date(iso).toLocaleDateString();
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {[["open", rt("ui.repos.stateOpen", "Open")], ["closed", rt("ui.repos.stateClosed", "Closed")], ["all", rt("ui.repos.stateAll", "All")]].map(([clave, etiqueta]) => (
            <button key={clave} onClick={() => setEstado(clave)} style={{
              padding: "4px 12px", border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600,
              background: estado === clave ? "var(--accent)" : "transparent",
              color: estado === clave ? "white" : "var(--muted-fg)",
            }}>{etiqueta}</button>
          ))}
        </div>
        {items && !fallo && (
          <span style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>
            {rt("ui.repos.itemCount", "{0} shown", { 0: items.length })}
          </span>
        )}
      </div>

      {items === null && <div style={{ fontSize: 13, color: "var(--muted-fg)" }}>{rt("ui.repos.loadingItems", "Loading…")}</div>}

      {fallo && (
        <div style={{ fontSize: 12.5, color: "var(--err)", background: "color-mix(in srgb, var(--err) 8%, white)", border: "1px solid color-mix(in srgb, var(--err) 25%, var(--border))", borderRadius: 6, padding: "10px 12px" }}>
          {fallo}
        </div>
      )}

      {items && !fallo && items.length === 0 && (
        <div style={{ background: "white", border: "1px dashed var(--border)", borderRadius: 9, padding: "50px 20px", textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>
          {esPR ? rt("ui.repos.noPullRequests", "No pull requests here.") : rt("ui.repos.noIssues", "No issues here.")}
        </div>
      )}

      {items && !fallo && items.map(item => (
        <div key={item.number} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
        <div
          onClick={esPR ? () => alternarDetalle(item.number) : undefined}
          role={esPR ? "button" : undefined}
          tabIndex={esPR ? 0 : undefined}
          aria-expanded={esPR ? abierto === item.number : undefined}
          onKeyDown={esPR ? (event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); alternarDetalle(item.number); } }) : undefined}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", cursor: esPR ? "pointer" : "default" }}>
          <span style={{ flexShrink: 0, marginTop: 2, width: 9, height: 9, borderRadius: 999, background: COLOR_ESTADO[item.state] || "var(--muted-fg)" }}
            title={item.state} aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-fg)" }}>#{item.number}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
              {item.draft && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "var(--muted)", color: "var(--muted-fg)" }}>{rt("ui.repos.draft", "Draft")}</span>}
              {(item.labels || []).map(label => (
                <span key={label} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "var(--muted)", color: "var(--muted-fg)" }}>{label}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 3, fontFamily: "var(--font-mono)" }}>
              {item.author || "—"}
              {esPR && item.sourceBranch && <> · {item.sourceBranch} → {item.targetBranch}</>}
              {!esPR && (item.assignees || []).length > 0 && <> · {item.assignees.join(", ")}</>}
              {!esPR && item.comments > 0 && <> · {rt("ui.repos.comments", "{0} comments", { 0: item.comments })}</>}
              {" · "}{cuando(item.updatedAt)}
            </div>
          </div>
          {item.webUrl && (
            <a href={item.webUrl} target="_blank" rel="noreferrer" title={item.webUrl}
              onClick={event => event.stopPropagation()}
              style={{ flexShrink: 0, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>↗</a>
          )}
        </div>
        {esPR && abierto === item.number && <DetallePR detalle={detalles[item.number]} />}
        </div>
      ))}
    </div>
  );
}

// Detalle de un pull request: lo que la fila no cabe a decir. Vive fuera de
// RepoItemsPanel porque solo se monta cuando hay algo desplegado.
// ── Advisories ───────────────────────────────────────────────────────────────
// Reúne las tres fuentes de seguridad que GitHub expone por separado, porque
// mirar solo una da una falsa tranquilidad: un repositorio puede tener cero
// alertas de Dependabot y a la vez un aviso crítico escrito a mano.
//
// Las tres se piden a la vez y cada una falla por su cuenta: un token sin
// permiso para una no debe vaciar las otras dos, y "no tengo acceso" no es lo
// mismo que "no hay nada", así que se dicen distinto.
function AdvisoriesPanel({ repo }) {
  const [datos, setDatos] = useState({ advisories: null, scanning: null, dependabot: null });
  // { ruta, titulo }: la ruta ya trae la fuente, así que el modal no necesita
  // saber de qué sección salió.
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    let cancelado = false;
    const base = `/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}`;
    const pedir = (ruta, clave) => window.HQ_API.request(`${base}/${ruta}`)
      .then(respuesta => ({ ok: true, lista: respuesta?.[clave] || [] }))
      .catch(error => ({ ok: false, error: error?.detail || error?.message || String(error) }));

    setDatos({ advisories: null, scanning: null, dependabot: null });
    Promise.all([
      pedir("security-advisories", "advisories"),
      pedir("code-scanning-alerts", "alerts"),
      // state=open explícito: la ruta de Dependabot sin estado devuelve también
      // las ya arregladas, y pintarlas junto a los hallazgos abiertos con su
      // insignia de gravedad hace parecer que hay vulnerabilidades vivas que no
      // las hay. Code scanning arriba ya filtra por abiertas.
      pedir("dependabot-alerts?state=open", "alerts"),
    ]).then(([advisories, scanning, dependabot]) => {
      if (!cancelado) setDatos({ advisories, scanning, dependabot });
    });
    return () => { cancelado = true; };
  }, [repo.provider, repo.id]);

  // El orden es el de urgencia, no el alfabético: lo que hay que mirar primero
  // va primero, y es también el orden en que se cuentan los totales.
  const ESCALA = ["critical", "high", "medium", "moderate", "low", "warning", "note", "error"];
  const COLOR = {
    critical: "#b91c1c", high: "#dc2626", medium: "#ca8a04", moderate: "#ca8a04",
    low: "#0891b2", warning: "#ca8a04", note: "#64748b", error: "#dc2626",
  };
  const porGravedad = lista => lista.slice().sort((izquierda, derecha) => {
    const a = ESCALA.indexOf(String(izquierda.severity || "").toLowerCase());
    const b = ESCALA.indexOf(String(derecha.severity || "").toLowerCase());
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  });

  const insignia = severidad => (
    <span style={{
      fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
      padding: "1px 6px", borderRadius: 3, flexShrink: 0,
      color: COLOR[String(severidad || "").toLowerCase()] || "var(--muted-fg)",
      background: `color-mix(in srgb, ${COLOR[String(severidad || "").toLowerCase()] || "var(--muted-fg)"} 12%, white)`,
    }}>{severidad || "—"}</span>
  );

  const mono = { fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)" };
  const seccion = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", margin: "0 0 8px" };

  const bloque = (titulo, fuente, pintar, vacio) => (
    <div style={{ marginBottom: 20 }}>
      <div style={seccion}>
        {titulo}
        {fuente?.ok && <span style={{ marginLeft: 6, color: "var(--fg)" }}>{fuente.lista.length}</span>}
      </div>
      {!fuente && <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>{rt("ui.repos.loadingItems", "Loading…")}</div>}
      {fuente && !fuente.ok && (
        <div style={{ fontSize: 11.5, color: "var(--muted-fg)", fontStyle: "italic" }}>
          {rt("ui.repos.advisorySourceUnavailable", "Not available: {0}", { 0: fuente.error })}
        </div>
      )}
      {fuente?.ok && fuente.lista.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ok)" }}>✓ {vacio}</div>
      )}
      {fuente?.ok && porGravedad(fuente.lista).map(pintar)}
    </div>
  );

  const fila = (clave, contenido, ruta, titulo) => (
    <div key={clave}
      onClick={() => setAbierto({ ruta, titulo })}
      role="button" tabIndex={0}
      onKeyDown={evento => { if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); setAbierto({ ruta, titulo }); } }}
      style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "white", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 11px", marginBottom: 6, cursor: "pointer" }}>
      {contenido}
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      {bloque(
        rt("ui.repos.repoAdvisories", "Repository security advisories"),
        datos.advisories,
        item => fila(item.id, (
          <>
            {insignia(item.severity)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{item.summary || item.id}</div>
              <div style={mono}>{item.id}{item.cve ? ` · ${item.cve}` : ""} · {item.state}</div>
            </div>
            {item.webUrl && <a href={item.webUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>↗</a>}
          </>
        ), `security-advisories/${item.id}`, item.summary || item.id),
        rt("ui.repos.noRepoAdvisories", "This repository has published no advisories."),
      )}

      {bloque(
        rt("ui.repos.codeScanning", "Code scanning"),
        datos.scanning,
        item => fila(item.number, (
          <>
            {insignia(item.severity)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{item.description || item.rule}</div>
              <div style={mono}>
                {item.tool || "—"} · {item.rule}
                {item.path ? ` · ${item.path}:${item.line}` : ""}
              </div>
            </div>
            {item.webUrl && <a href={item.webUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>↗</a>}
          </>
        ), `code-scanning-alerts/${item.number}`, item.description || item.rule),
        rt("ui.repos.noCodeScanning", "No open code scanning alerts."),
      )}

      {bloque(
        rt("ui.repos.dependabot", "Dependabot"),
        datos.dependabot,
        item => fila(item.number, (
          <>
            {insignia(item.severity)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{item.summary || item.ghsaId}</div>
              <div style={mono}>
                {item.package}{item.ecosystem ? ` (${item.ecosystem})` : ""}
                {item.vulnerableRange ? ` · ${item.vulnerableRange}` : ""}
                {item.firstPatchedVersion ? ` → ${item.firstPatchedVersion}` : ""}
              </div>
            </div>
            {item.webUrl && <a href={item.webUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>↗</a>}
          </>
        ), `dependabot-alerts/${item.number}`, item.summary || item.package),
        rt("ui.repos.noDependabot", "No open Dependabot alerts."),
      )}
      {abierto && <AdvisoryDetailModal repo={repo} ruta={abierto.ruta} titulo={abierto.titulo} onClose={() => setAbierto(null)} />}
    </div>
  );
}

// Detalle de un aviso, sea cual sea su fuente: las tres rutas contestan la
// misma forma, así que aquí no hay ramas por origen — solo campos que están o
// no están. Lo que la fila no cabía a decir es justamente lo accionable: el
// cómo se arregla, la puntuación CVSS y el hallazgo concreto.
function AdvisoryDetailModal({ repo, ruta, titulo, onClose }) {
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    let cancelado = false;
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/${ruta}`)
      .then(data => { if (!cancelado) setDetalle(data); })
      .catch(error => { if (!cancelado) setDetalle({ error: error?.detail || error?.message || String(error) }); });
    return () => { cancelado = true; };
  }, [repo.provider, repo.id, ruta]);

  useEffect(() => {
    const alPulsar = evento => { if (evento.key === "Escape") onClose(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onClose]);

  const mono = { fontFamily: "var(--font-mono)", fontSize: 11 };
  const seccion = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", margin: "12px 0 5px" };
  const caja = { fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", background: "white", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", wordBreak: "break-word" };

  return (
    <div onClick={onClose} role="presentation"
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={evento => evento.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo || "Advisory"}
        style={{ width: "min(800px, 100%)", maxHeight: "86vh", overflow: "auto", background: "white", borderRadius: 10, border: "1px solid var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,.22)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{detalle?.title || titulo}</div>
          {(detalle?.webUrl) && (
            <a href={detalle.webUrl} target="_blank" rel="noreferrer"
              style={{ flexShrink: 0, fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>↗</a>
          )}
          <button onClick={onClose} aria-label={rt("home.close", "Close")}
            style={{ flexShrink: 0, background: "none", border: 0, cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--muted-fg)", fontFamily: "inherit" }}>×</button>
        </div>

        {!detalle && <div style={{ padding: 16, fontSize: 12, color: "var(--muted-fg)" }}>{rt("ui.repos.loadingItems", "Loading…")}</div>}
        {detalle?.error && <div style={{ padding: 16, fontSize: 12, color: "var(--err)" }}>{detalle.error}</div>}

        {detalle && !detalle.error && (
          <div style={{ padding: "10px 16px 16px", background: "color-mix(in srgb, var(--muted) 25%, white)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--muted-fg)" }}>
              {detalle.severity && <span style={{ fontWeight: 700, textTransform: "uppercase" }}>{detalle.severity}</span>}
              {detalle.state && <span>{detalle.state}</span>}
              {detalle.cvssScore != null && <span style={mono}>CVSS {detalle.cvssScore}</span>}
              {detalle.cve && <span style={mono}>{detalle.cve}</span>}
              {(detalle.cwes || []).length > 0 && <span style={mono}>{detalle.cwes.join(" · ")}</span>}
              {detalle.tool && <span>{detalle.tool}{detalle.rule ? ` · ${detalle.rule}` : ""}</span>}
              {detalle.path && <span style={mono}>{detalle.path}{detalle.line ? `:${detalle.line}` : ""}</span>}
              {detalle.fixedIn && <span style={{ color: "var(--ok)", fontWeight: 600 }}>{rt("ui.repos.fixedIn", "Fixed in {0}", { 0: detalle.fixedIn })}</span>}
            </div>

            {detalle.cvssVector && <div style={{ ...mono, color: "var(--muted-fg)", marginTop: 4 }}>{detalle.cvssVector}</div>}

            {detalle.finding && (
              <>
                <div style={seccion}>{rt("ui.repos.finding", "Finding")}</div>
                <div style={caja}>{detalle.finding}</div>
              </>
            )}

            {(detalle.affected || []).length > 0 && (
              <>
                <div style={seccion}>{rt("ui.repos.affected", "Affected")}</div>
                {detalle.affected.map(item => <div key={item} style={{ ...mono, padding: "1px 0" }}>{item}</div>)}
                {detalle.manifestPath && <div style={{ ...mono, color: "var(--muted-fg)", paddingTop: 2 }}>{detalle.manifestPath}</div>}
              </>
            )}

            {detalle.description && (
              <>
                <div style={seccion}>{rt("ui.repos.description", "Description")}</div>
                <div style={caja}>{detalle.description}</div>
              </>
            )}

            {(detalle.tags || []).length > 0 && (
              <>
                <div style={seccion}>{rt("ui.repos.tags", "Tags")}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {detalle.tags.map(tag => (
                    <span key={tag} style={{ ...mono, padding: "2px 7px", borderRadius: 999, background: "white", border: "1px solid var(--border)", color: "var(--muted-fg)" }}>{tag}</span>
                  ))}
                </div>
              </>
            )}

            {(detalle.credits || []).length > 0 && (
              <>
                <div style={seccion}>{rt("ui.repos.credits", "Reported by")}</div>
                <div style={mono}>{detalle.credits.join(", ")}</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetallePR({ detalle, acciones = null }) {
  const marco = { padding: "10px 12px 12px 31px", fontSize: 12, borderTop: "1px solid var(--border)" };
  if (!detalle) return <div style={{ ...marco, color: "var(--muted-fg)" }}>{rt("ui.repos.loadingItems", "Loading…")}</div>;
  if (detalle.error) return <div style={{ ...marco, color: "var(--err)" }}>{detalle.error}</div>;

  const checks = detalle.checks || { total: 0 };
  // mergeableState distingue lo que "se puede fusionar" esconde: dirty es
  // conflicto con la rama destino, unstable es fusionable pero con algún check
  // sin éxito, y blocked es que faltan revisiones o lo frena una regla de rama.
  const FUSION = {
    clean:    [rt("ui.repos.mergeClean", "Able to merge"), "var(--ok)"],
    unstable: [rt("ui.repos.mergeUnstable", "Able to merge · a check is not green"), "#ca8a04"],
    blocked:  [rt("ui.repos.mergeBlocked", "Blocked: reviews or branch rules pending"), "#ca8a04"],
    dirty:    [rt("ui.repos.mergeDirty", "Conflicts with the target branch"), "var(--err)"],
    behind:   [rt("ui.repos.mergeBehind", "Behind the target branch"), "#ca8a04"],
  };
  const fusion = FUSION[detalle.mergeableState] || null;
  const seccion = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", margin: "12px 0 5px" };
  const mono = { fontFamily: "var(--font-mono)", fontSize: 11 };
  const COLOR_CHECK = { success: "var(--ok)", pending: "#ca8a04" };
  const marcaRevision = estado => estado === "APPROVED" ? "✓" : estado === "CHANGES_REQUESTED" ? "✕" : "○";
  const colorRevision = estado => estado === "APPROVED" ? "var(--ok)" : estado === "CHANGES_REQUESTED" ? "var(--err)" : "var(--muted-fg)";

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px 14px", background: "color-mix(in srgb, var(--muted) 25%, white)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--muted-fg)" }}>
        {fusion && <span style={{ fontWeight: 600, color: fusion[1] }}>● {fusion[0]}</span>}
        {detalle.commitCount != null && <span>{rt("ui.repos.commitCount", "{0} commits", { 0: detalle.commitCount })}</span>}
        {detalle.changedFiles != null && <span>{rt("ui.repos.fileCount", "{0} files", { 0: detalle.changedFiles })}</span>}
        {detalle.additions != null && (
          <span style={mono}>
            <span style={{ color: "var(--ok)" }}>+{detalle.additions}</span>{" "}
            <span style={{ color: "var(--err)" }}>−{detalle.deletions}</span>
          </span>
        )}
        {checks.total > 0 && (
          <span>
            {rt("ui.repos.checkSummary", "{0}/{1} checks passed", { 0: checks.success, 1: checks.total })}
            {checks.failed > 0 && <span style={{ color: "var(--err)", fontWeight: 600 }}> · {rt("ui.repos.checksFailed", "{0} failed", { 0: checks.failed })}</span>}
            {checks.pending > 0 && <span style={{ color: "#ca8a04" }}> · {rt("ui.repos.checksPending", "{0} running", { 0: checks.pending })}</span>}
          </span>
        )}
        {detalle.comments > 0 && <span>{rt("ui.repos.comments", "{0} comments", { 0: detalle.comments })}</span>}
      </div>

      {((detalle.reviews || []).length > 0 || (detalle.requestedReviewers || []).length > 0) && (
        <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--muted-fg)" }}>
          {(detalle.reviews || []).map((revision, indice) => (
            <span key={indice} style={{ marginRight: 10 }}>
              <span style={{ fontWeight: 600, color: colorRevision(revision.state) }}>{marcaRevision(revision.state)}</span>{" "}{revision.author}
            </span>
          ))}
          {(detalle.requestedReviewers || []).map(persona => (
            <span key={persona} style={{ marginRight: 10 }}>○ {persona} <em>({rt("ui.repos.reviewPending", "pending")})</em></span>
          ))}
        </div>
      )}

      {detalle.body && (
        <>
          <div style={seccion}>{rt("ui.repos.description", "Description")}</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", background: "white", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>{detalle.body}</div>
        </>
      )}

      {(checks.runs || []).length > 0 && (
        <>
          <div style={seccion}>{rt("ui.repos.checks", "Checks")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {checks.runs.map((ejecucion, indice) => (
              <span key={indice} title={ejecucion.conclusion} style={{ ...mono, padding: "2px 7px", borderRadius: 999, background: "white", border: "1px solid var(--border)", color: COLOR_CHECK[ejecucion.conclusion] || "var(--err)" }}>
                {ejecucion.conclusion === "success" ? "✓" : ejecucion.conclusion === "pending" ? "◌" : "✕"} {ejecucion.name}
              </span>
            ))}
          </div>
        </>
      )}

      {(detalle.commits || []).length > 0 && (
        <>
          <div style={seccion}>{rt("ui.repos.commits", "Commits")}</div>
          {detalle.commits.map(commit => (
            <div key={commit.sha} style={{ ...mono, padding: "2px 0" }}>
              <span style={{ color: "var(--muted-fg)" }}>{commit.sha}</span> {commit.message}
            </div>
          ))}
        </>
      )}

      {(detalle.files || []).length > 0 && (
        <>
          <div style={seccion}>{rt("ui.repos.filesChanged", "Files changed")}</div>
          {detalle.files.map(archivo => (
            <div key={archivo.path} style={{ ...mono, padding: "2px 0", display: "flex", gap: 8 }}>
              <span style={{ color: "var(--ok)", minWidth: 36, textAlign: "right" }}>+{archivo.additions}</span>
              <span style={{ color: "var(--err)", minWidth: 36 }}>−{archivo.deletions}</span>
              <span style={{ wordBreak: "break-all" }}>{archivo.path}</span>
            </div>
          ))}
        </>
      )}
      {acciones}
    </div>
  );
}

// Botón de aprobar. Vive aparte porque su estado (enviando, resultado, error
// del proveedor) no es del detalle: el detalle se puede volver a pedir sin
// perder lo que el botón tenga que decir.
function BotonAprobarPR({ detalle, connectorId, onAprobado }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [fallo, setFallo] = useState(null);

  // Ya aprobado por quien sea: repetirlo no aporta y GitHub lo aceptaría igual,
  // creando una segunda revisión idéntica.
  const yaAprobado = (detalle.reviews || []).some(revision => revision.state === "APPROVED");
  if (yaAprobado && !resultado) {
    return (
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--ok)", fontWeight: 600 }}>
        ✓ {rt("ui.repos.alreadyApproved", "Already approved")}
      </div>
    );
  }

  const aprobar = async () => {
    if (enviando) return;
    setEnviando(true); setFallo(null);
    try {
      const respuesta = await window.HQ_API.request(
        `/api/connectors/${connectorId || "github"}/actions/approve-pull-request`,
        { method: "POST", body: { project: detalle.projectId, number: detalle.number } },
      );
      setResultado(respuesta?.result || { state: "APPROVED" });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: rt("ui.repos.approved", "Pull request approved"), kind: "ok" } }));
      onAprobado?.();
    } catch (error) {
      // El proveedor tiene la última palabra y su mensaje se muestra tal cual:
      // GitHub rechaza con 422 que alguien apruebe su propio pull request, y
      // decir solo "no se pudo" dejaría al usuario sin saber por qué.
      setFallo(error?.detail || error?.message || String(error));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      {resultado ? (
        <div style={{ fontSize: 11.5, color: "var(--ok)", fontWeight: 600 }}>
          ✓ {rt("ui.repos.approved", "Pull request approved")}
          {resultado.reviewer ? ` · ${resultado.reviewer}` : ""}
        </div>
      ) : (
        <button onClick={aprobar} disabled={enviando}
          style={{
            height: 30, padding: "0 14px", borderRadius: 6, cursor: enviando ? "progress" : "pointer",
            border: "1px solid var(--ok)", background: enviando ? "var(--muted)" : "var(--ok)",
            color: enviando ? "var(--muted-fg)" : "white", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          }}>
          {enviando ? rt("ui.repos.approving", "Approving…") : rt("ui.repos.approve", "✓ Approve")}
        </button>
      )}
      {fallo && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb, var(--err) 8%, white)", border: "1px solid color-mix(in srgb, var(--err) 25%, var(--border))", borderRadius: 6, padding: "8px 10px" }}>
          {fallo}
        </div>
      )}
    </div>
  );
}

// Modal de un pull request, para el block de Home y de los Boards. Reusa
// DetallePR en vez de repintar lo mismo: la pestaña del repositorio y el block
// deben contar lo mismo del mismo PR, y si divergen es un bug.
function CommitDetailModal({ commit, onClose }) {
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    let cancelado = false;
    // El item del block solo lleva el sha corto; el conector sabe de qué repo
    // es porque el sync lo guardó junto al commit.
    window.HQ_API.request(`/api/connectors/${commit.connectorId || "github"}/commits/${encodeURIComponent(commit.id)}`)
      .then(data => { if (!cancelado) setDetalle(data); })
      .catch(error => { if (!cancelado) setDetalle({ error: error?.detail || error?.message || String(error) }); });
    return () => { cancelado = true; };
  }, [commit]);

  useEffect(() => {
    const alPulsar = evento => { if (evento.key === "Escape") onClose(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onClose]);

  const mono = { fontFamily: "var(--font-mono)", fontSize: 11 };
  const seccion = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase", margin: "12px 0 5px" };

  return (
    <div onClick={onClose} role="presentation"
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={evento => evento.stopPropagation()} role="dialog" aria-modal="true" aria-label={commit?.title || "Commit"}
        style={{ width: "min(760px, 100%)", maxHeight: "86vh", overflow: "auto", background: "white", borderRadius: 10, border: "1px solid var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,.22)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{detalle?.title || commit?.title}</div>
            {commit?.subtitle && <div style={{ ...mono, color: "var(--muted-fg)", marginTop: 2 }}>{commit.subtitle}</div>}
          </div>
          {(detalle?.webUrl || commit?.url) && (
            <a href={detalle?.webUrl || commit.url} target="_blank" rel="noreferrer"
              style={{ flexShrink: 0, fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>↗</a>
          )}
          <button onClick={onClose} aria-label={rt("home.close", "Close")}
            style={{ flexShrink: 0, background: "none", border: 0, cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--muted-fg)", fontFamily: "inherit" }}>×</button>
        </div>

        {!detalle && <div style={{ padding: 16, fontSize: 12, color: "var(--muted-fg)" }}>{rt("ui.repos.loadingItems", "Loading…")}</div>}
        {detalle?.error && <div style={{ padding: 16, fontSize: 12, color: "var(--err)" }}>{detalle.error}</div>}

        {detalle && !detalle.error && (
          <div style={{ padding: "10px 16px 16px", background: "color-mix(in srgb, var(--muted) 25%, white)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--muted-fg)" }}>
              <span style={mono}>{detalle.sha}</span>
              <span>{detalle.author || "—"}{detalle.authorLogin && detalle.authorLogin !== detalle.author ? ` (${detalle.authorLogin})` : ""}</span>
              {detalle.stats?.additions != null && (
                <span style={mono}>
                  <span style={{ color: "var(--ok)" }}>+{detalle.stats.additions}</span>{" "}
                  <span style={{ color: "var(--err)" }}>−{detalle.stats.deletions}</span>
                </span>
              )}
              <span>{rt("ui.repos.fileCount", "{0} files", { 0: (detalle.files || []).length })}</span>
              {detalle.verified && <span style={{ color: "var(--ok)", fontWeight: 600 }}>✓ {rt("ui.repos.signed", "Signed")}</span>}
              {/* Dos padres significa que el commit es una fusión: sin decirlo,
                  un diff enorme y sin autor claro parece un commit gigante. */}
              {(detalle.parents || []).length > 1 && <span>{rt("ui.repos.mergeCommit", "Merge commit")}</span>}
            </div>

            {detalle.body && (
              <>
                <div style={seccion}>{rt("ui.repos.message", "Message")}</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto", background: "white", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>{detalle.body}</div>
              </>
            )}

            {(detalle.files || []).length > 0 && (
              <>
                <div style={seccion}>{rt("ui.repos.filesChanged", "Files changed")}</div>
                {detalle.files.map(archivo => (
                  <div key={archivo.path} style={{ ...mono, padding: "2px 0", display: "flex", gap: 8 }}>
                    <span style={{ color: "var(--ok)", minWidth: 36, textAlign: "right" }}>+{archivo.additions}</span>
                    <span style={{ color: "var(--err)", minWidth: 36 }}>−{archivo.deletions}</span>
                    <span style={{ wordBreak: "break-all" }}>{archivo.path}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
window.CommitDetailModal = CommitDetailModal;

function PullRequestDetailModal({ pr, onClose }) {
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    // El block trae el id como "owner/repo#numero": el proyecto y el número
    // viajan juntos porque un block puede mezclar PRs de varios repositorios.
    const corte = String(pr?.id || "").lastIndexOf("#");
    if (corte < 0) { setDetalle({ error: rt("ui.repos.prIdUnreadable", "Unreadable pull request reference.") }); return; }
    const proyecto = pr.id.slice(0, corte);
    const numero = pr.id.slice(corte + 1);
    let cancelado = false;
    window.HQ_API.request(`/api/connectors/${pr.connectorId || "github"}/projects/${encodeURIComponent(proyecto)}/pull-requests/${numero}`)
      .then(data => { if (!cancelado) setDetalle(data); })
      .catch(error => { if (!cancelado) setDetalle({ error: error?.detail || error?.message || String(error) }); });
    return () => { cancelado = true; };
  }, [pr]);

  useEffect(() => {
    const alPulsar = evento => { if (evento.key === "Escape") onClose(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onClose]);

  return (
    <div onClick={onClose} role="presentation"
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={evento => evento.stopPropagation()} role="dialog" aria-modal="true" aria-label={pr?.title || "Pull request"}
        style={{ width: "min(760px, 100%)", maxHeight: "86vh", overflow: "auto", background: "white", borderRadius: 10, border: "1px solid var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,.22)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{pr?.title}</div>
            {pr?.subtitle && <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{pr.subtitle}</div>}
          </div>
          {pr?.url && (
            <a href={pr.url} target="_blank" rel="noreferrer" title={pr.url}
              style={{ flexShrink: 0, fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>↗</a>
          )}
          <button onClick={onClose} aria-label={rt("home.close", "Close")}
            style={{ flexShrink: 0, background: "none", border: 0, cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--muted-fg)", fontFamily: "inherit" }}>×</button>
        </div>
        <DetallePR
          detalle={detalle}
          acciones={detalle && !detalle.error && detalle.state === "open" && (
            <BotonAprobarPR detalle={detalle} connectorId={pr?.connectorId} />
          )}
        />
      </div>
    </div>
  );
}
window.PullRequestDetailModal = PullRequestDetailModal;

function AnalysisPanel({ repo }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const endpoint = `/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/analysis`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.HQ_API.request(endpoint)
      .then((data) => { if (active) setReport(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await window.HQ_API.request(endpoint, { method: "POST" });
      setReport(data);
      toast(window.I18N.t("ui.repos.analysisDone", "Analysis completed · {0}/100", { 0: data.summary.score }), "ok");
    } catch (err) {
      setError(err.message);
      toast(window.I18N.t("ui.repos.analysisFailed", "Could not analyze:") + " " + err.message, "error");
    } finally {
      setRunning(false);
    }
  };

  const severityColor = { critical: "#991b1b", high: "#dc2626", medium: "#d97706", low: "#2563eb", info: "#64748b" };
  const scoreColor = !report ? "var(--muted-fg)" : report.summary.score >= 80 ? "var(--ok)" : report.summary.score >= 60 ? "#d97706" : "var(--err)";

  if (loading) return <div style={{ flex: 1, padding: 24, color: "var(--muted-fg)", fontSize: 13 }}>{window.I18N.t("ui.repos.loadingAnalysis", "Loading analysis…")}</div>;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20, background: "var(--muted)" }}>
      <div style={{ maxWidth: 1050, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{window.I18N.t("ui.repos.bestPractices", "Best practices")}</div>
            <div style={{ color: "var(--muted-fg)", fontSize: 12, marginTop: 3 }}>{window.I18N.t("ui.repos.analysisHelp", "Static analysis: does not install dependencies or execute code.")}</div>
          </div>
          <button onClick={runAnalysis} disabled={running} style={{
            ...topBtn, height: 32, padding: "0 14px", background: "var(--accent)", color: "white", borderColor: "var(--accent)",
            opacity: running ? .65 : 1, cursor: running ? "wait" : "pointer",
          }}>{running ? window.I18N.t("ui.repos.analyzing", "Analyzing…") : report ? "↻ Analizar de nuevo" : "▶ Analizar repositorio"}</button>
        </div>

        {error && <div style={{ padding: 10, borderRadius: 7, background: "rgba(220,38,38,.08)", color: "var(--err)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {!report ? (
          <div style={{ background: "white", border: "1px dashed var(--border)", borderRadius: 9, padding: "50px 20px", textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>{window.I18N.t("ui.repos.noReport", "This repository has no report yet. Analysis will check common rules and technology-specific rules.")} </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 9, padding: 16 }}>
                <div style={{ fontSize: 11, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: .5 }}>{window.I18N.t("ui.repos.score", "Score")}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 5 }}>
                  <span style={{ fontSize: 38, fontWeight: 750, color: scoreColor }}>{report.summary.score}</span>
                  <span style={{ color: "var(--muted-fg)", fontSize: 13 }}>/ 100 · {report.summary.grade}</span>
                </div>
                <div style={{ color: "var(--muted-fg)", fontSize: 11, marginTop: 5 }}>{report.repository.filesScanned} {window.I18N.t("ui.repos.files", "files ·")} {report.durationMs} ms</div>
              </div>
              <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 9, padding: 16 }}>
                <div style={{ fontSize: 11, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: .5, marginBottom: 10 }}>{window.I18N.t("ui.repos.summary", "Summary")}</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
                  {["critical", "high", "medium", "low"].map((severity) => (
                    <span key={severity} style={{ border: `1px solid ${severityColor[severity]}33`, background: `${severityColor[severity]}0d`, color: severityColor[severity], borderRadius: 5, padding: "4px 8px", fontSize: 11.5, fontWeight: 650 }}>
                      {report.summary.counts[severity] || 0} {severity}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(report.technologies || []).map((technology) => <span key={technology} style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--muted)", padding: "3px 7px", borderRadius: 4 }}>{technology}</span>)}
                  {!report.technologies?.length && <span style={{ color: "var(--muted-fg)", fontSize: 11.5 }}>{window.I18N.t("ui.repos.noTechnology", "No specific technology detected")}</span>}
                </div>
              </div>
            </div>

            {report.classification && (
              <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 9, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: .5, marginBottom: 9 }}>{window.I18N.t("ui.repos.projectType", "Project type")}</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {report.classification.types.map((type, index) => (
                    <span key={type.id} title={(type.signals || []).join(" · ")} style={{
                      border: index === 0 ? "1px solid rgba(37,99,235,.28)" : "1px solid var(--border)",
                      background: index === 0 ? "rgba(37,99,235,.08)" : "var(--muted)",
                      color: index === 0 ? "var(--accent)" : "var(--fg)", borderRadius: 5, padding: "5px 9px", fontSize: 11.5, fontWeight: index === 0 ? 650 : 500,
                    }}>{type.label} · {type.confidence}</span>
                  ))}
                  {(report.classification.traits || []).map((trait) => (
                    <span key={trait.id} title={trait.evidence} style={{
                      border: "1px dashed rgba(124,58,237,.35)", background: "rgba(124,58,237,.07)", color: "#7c3aed",
                      borderRadius: 5, padding: "5px 9px", fontSize: 11.5, fontWeight: 600,
                    }}>◈ {trait.label} · {trait.confidence}</span>
                  ))}
                </div>
              </div>
            )}

            {report.inventory?.length > 0 && (
              <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)", fontSize: 12.5, fontWeight: 650 }}>{window.I18N.t("ui.repos.stack", "Detected stack (")}{report.inventory.length})</div>
                {report.inventory.map((item, index) => (
                  <div key={`${item.ecosystem}-${item.name}-${index}`} style={{ padding: "9px 14px", borderTop: index ? "1px solid var(--border)" : 0, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 11.5 }}>
                    <div style={{ flex: "1 1 130px" }}><b>{item.name}</b><div style={{ color: "var(--muted-fg)", fontSize: 10.5 }}>{item.ecosystem} · {item.role}</div></div>
                    <div style={{ flex: "1 1 100px", fontFamily: "var(--font-mono)" }}>{item.version || item.constraint || window.I18N.t("ui.repos.unknownVersion", "unknown version")}</div>
                    <div style={{ flex: "2 1 150px", color: "var(--muted-fg)", fontFamily: "var(--font-mono)", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.sourceFile}>{item.sourceFile} · {item.confidence}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)", fontSize: 12.5, fontWeight: 650 }}>{window.I18N.t("ui.repos.findings", "Findings (")}{report.findings.length})</div>
              {report.findings.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "var(--ok)", fontSize: 13 }}>{window.I18N.t("ui.repos.noProblems", "No issues found with the current rules.")}</div>
              ) : report.findings.map((finding) => (
                <div key={finding.id} style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 11 }}>
                  <span style={{ flexShrink: 0, alignSelf: "flex-start", fontSize: 10, textTransform: "uppercase", fontWeight: 750, color: severityColor[finding.severity], background: `${severityColor[finding.severity]}0d`, borderRadius: 4, padding: "3px 6px" }}>{finding.severity}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 650 }}>{finding.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.45, marginTop: 3 }}>{finding.message}</div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 4 }}><b>{window.I18N.t("ui.repos.recommendation", "Recommendation:")}</b> {finding.recommendation}</div>
                    {(finding.file || finding.technology) && <div style={{ fontFamily: "var(--font-mono)", color: "var(--muted-fg)", fontSize: 10.5, marginTop: 5 }}>{finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : finding.technology} · {finding.category}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RepoDetail({ repo, onClose, onClone, onLinkExisting, cloning, onPlayNetworkTools, onStopNetworkTools, onPrepareEnv, networkTools, networkToolsBusy, preparingEnvId, onOpenVscodeWeb, onOpenSettings, repoRuntime, playingRepoId, onPlayGeneric, onStopGeneric }) {
  const isLocal = !!repo.localClone?.path;
  const isNetworkToolsLocal = isNetworkToolsRepo(repo) && isLocal;
  const isRunning = networkTools?.status === "running";
  const canPrepareEnv = isLocal && isPythonRepo(repo);
  const envBusy = preparingEnvId === repo.id;
  const [treeWidth, onTreeResizeStart] = useReposResizableWidth("repos.code.treeWidth", 260, 180, 480);
  const isGenericPlayable = isLocal && !isNetworkToolsLocal && !!repo.localClone?.playable;
  const isGenericRunning = repoRuntime?.status === "running";
  const genericBusy = playingRepoId === repo.id;
  const [tab, setTab]         = useState("code"); // code | build
  // Orden de las pestañas, por navegador — es una preferencia de esta pantalla,
  // igual que el orden del menú lateral. Guarda solo las claves: qué pestañas
  // existen depende del repositorio (local o no, GitHub o no), así que el orden
  // se aplica como ranking sobre las que haya y nunca inventa una que no toca.
  const [ordenTabs, setOrdenTabs] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem("hq.repoTabOrder") || "null");
      return Array.isArray(guardado) ? guardado : [];
    } catch { return []; }
  });
  const [menuTab, setMenuTab] = useState(null);

  const tabsDisponibles = [
    ["code", "Code"],
    ...(/^(gitlab|github)/.test(repo.provider) ? [["build", "Build / Pipeline"]] : []),
    ...(/^github/.test(repo.provider) ? [["pulls", rt("ui.repos.pullRequests", "Pull Requests")], ["issues", rt("ui.repos.issues", "Issues")], ["advisories", rt("ui.repos.advisories", "Advisories")]] : []),
    ...(isLocal ? [["history", "History"], ["analysis", rt("ui.repos.analysis", "Analysis")]] : []),
  ];
  // Las que el usuario ya ordenó van primero, en ese orden; una pestaña nueva
  // (añadida en una versión posterior) se queda donde la declara el código, en
  // vez de desaparecer o saltar al frente.
  const rangoTab = clave => {
    const posicion = ordenTabs.indexOf(clave);
    return posicion < 0 ? ordenTabs.length + tabsDisponibles.findIndex(([otra]) => otra === clave) : posicion;
  };
  const tabs = tabsDisponibles.slice().sort((izquierda, derecha) => rangoTab(izquierda[0]) - rangoTab(derecha[0]));
  const clavesTabs = tabs.map(([clave]) => clave);

  const moverTab = (clave, direccion) => {
    const desde = clavesTabs.indexOf(clave);
    const hasta = desde + direccion;
    if (desde < 0 || hasta < 0 || hasta >= clavesTabs.length) return;
    const siguiente = clavesTabs.slice();
    [siguiente[desde], siguiente[hasta]] = [siguiente[hasta], siguiente[desde]];
    // Se conservan las claves que ahora no se ven — otro repositorio puede
    // tenerlas — para que su posición relativa sobreviva al cambio.
    const total = [...siguiente, ...ordenTabs.filter(candidata => !siguiente.includes(candidata))];
    setOrdenTabs(total);
    try { localStorage.setItem("hq.repoTabOrder", JSON.stringify(total)); } catch {}
  };
  const [branch, setBranch]   = useState(repo.defaultBranch);
  const [branches, setBranches] = useState([repo.defaultBranch]);
  const [files, setFiles]     = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [treeTotal, setTreeTotal] = useState(0);
  // Remote-only: carga perezosa por carpeta (ver buildLazyTree) — { [dirPath]: {folders, files} }.
  // Local sigue usando `files` de arriba, plano y completo, sin lazy: git ls-files
  // es instantáneo en disco, no hay costo de red que ahorrar ahí.
  const [dirChildren, setDirChildren] = useState({});
  const [loadingDirs, setLoadingDirs] = useState(() => new Set());
  const [activeFile, setActiveFile] = useState(null);
  const [editable, setEditable] = useState(false);
  const [treeLoading, setTreeLoading] = useState(true);
  // The remote tree only ever shows what has been pushed. When a clone exists,
  // the working copy is what the user is actually editing, so it leads.
  const [source, setSource] = useState(isLocal ? "local" : "remote");

  useEffect(() => {
    window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/branches`)
      .then(d => { if (d.branches?.length) setBranches(d.branches); })
      .catch(() => {});
  }, [repo.id]);

  // Carga una carpeta remota (path="" = raíz) y la guarda en dirChildren.
  const fetchDir = useCallback((dirPath) => {
    const query = `dir=${encodeURIComponent(dirPath)}&ref=${encodeURIComponent(branch)}`;
    return window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/tree?${query}`)
      .then(d => ({ folders: d.folders || [], files: d.files || [] }))
      .catch(() => ({ folders: [], files: [] })); // no reintentar en loop: guardar vacío igual
  }, [repo.id, repo.provider, branch]);

  const expandDir = useCallback((dirPath) => {
    setLoadingDirs(prev => new Set(prev).add(dirPath));
    fetchDir(dirPath)
      .then(entry => setDirChildren(prev => ({ ...prev, [dirPath]: entry })))
      .finally(() => setLoadingDirs(prev => { const next = new Set(prev); next.delete(dirPath); return next; }));
  }, [fetchDir]);

  const loadTree = useCallback((keepActive) => {
    setTreeLoading(true);
    if (!keepActive) setActiveFile(null);

    if (source === "local") {
      return window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/tree?source=local`)
        .then(d => {
          setFiles(d.files || []);
          setTruncated(!!d.truncated);
          setTreeTotal(d.total || d.files?.length || 0);
          if (!keepActive && d.files?.length) setActiveFile(d.files[0].path);
          return d.files || [];
        })
        .catch(() => { setFiles([]); return []; })
        .finally(() => setTreeLoading(false));
    }

    // Remoto: solo la raíz de entrada — el resto se pide carpeta por carpeta
    // al expandir (ver FileTree/expandDir). Antes traía el árbol recursivo
    // completo de una, lo que en repos grandes (miles de archivos) forzaba un
    // cap arbitrario y una lista incompleta.
    setDirChildren({});
    return fetchDir("")
      .then(root => {
        setDirChildren({ "": root });
        if (!keepActive && root.files.length) setActiveFile(root.files[0].path);
        return root;
      })
      .finally(() => setTreeLoading(false));
  }, [repo.id, repo.provider, branch, source, fetchDir]);

  useEffect(() => { loadTree(false); }, [loadTree]);

  // Rename/duplicate tocan el disco del clon local, no GitLab — por eso el árbol
  // se actualiza aquí mismo (optimista) en vez de re-pedir /tree: ese endpoint lee
  // el ref remoto y nunca vería un archivo que todavía no se sube.
  const handleFileRenamed = useCallback((oldPath, newPath) => {
    setFiles(prev => prev.map(f => f.path === oldPath ? { ...f, path: newPath } : f).sort((a, b) => a.path.localeCompare(b.path)));
    setActiveFile(curr => curr === oldPath ? newPath : curr);
  }, []);

  const handleFileDuplicated = useCallback((newPath) => {
    setFiles(prev => [...prev, { path: newPath }].sort((a, b) => a.path.localeCompare(b.path)));
    setActiveFile(newPath);
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "white", zIndex: 60,
      display: "flex", flexDirection: "column",
    }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 16, padding: 4 }}>←</button>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14 }}>{repo.path}</span>
        <VisibilityBadge visibility={repo.visibility} />
        <ForkBadge fork={repo.fork} />
        <CloneBadge clone={repo.localClone} />
        <BranchBadge clone={repo.localClone} />
        <TagBadge tag={repo.latestTag} />
        <EnvBadge clone={repo.localClone} />
        {isNetworkToolsLocal && <RuntimeBadge runtime={networkTools} />}
        {isGenericPlayable && <RuntimeBadge runtime={repoRuntime} />}
        <PipelineBadge status={repo.pipelineStatus} />
        {/* Un <select> se ensancha hasta su opción más larga, y una rama de
           Dependabot pasa de 60 caracteres: sin tope empujaba fuera a los
           botones de al lado. El desplegable abierto sigue mostrando el nombre
           entero, y el title lo deja a mano sin abrirlo. */}
        <select value={branch} onChange={e => setBranch(e.target.value)} title={branch} style={{
          height: 28, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 5,
          fontSize: 11.5, fontFamily: "var(--font-mono)", background: "white", cursor: "pointer",
          maxWidth: 220, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap",
        }}>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          {isNetworkToolsLocal && (
            <button
              onClick={async () => {
                await onPlayNetworkTools(repo, isRunning);
              }}
              style={{
                ...topBtn,
                background: isRunning ? "rgba(37, 99, 235, 0.10)" : "#0ea5e9",
                color: isRunning ? "#2563eb" : "white",
                borderColor: isRunning ? "rgba(37, 99, 235, 0.22)" : "#0ea5e9",
                opacity: networkToolsBusy ? 0.65 : 1,
                cursor: networkToolsBusy ? "wait" : "pointer",
              }}
              disabled={networkToolsBusy}
            >{isRunning ? "↗ Open" : "▶ Play"}</button>
          )}
          {isNetworkToolsLocal && isRunning && (
            <button
              onClick={async () => {
                await onStopNetworkTools();
              }}
              style={{
                ...topBtn,
                background: "rgba(220, 38, 38, 0.08)",
                color: "var(--err)",
                borderColor: "rgba(220, 38, 38, 0.18)",
                opacity: networkToolsBusy ? 0.65 : 1,
                cursor: networkToolsBusy ? "wait" : "pointer",
              }}
              disabled={networkToolsBusy}
            >■ Stop</button>
          )}
          {isGenericPlayable && (
            <button
              title={isGenericRunning ? "" : `Arranca ${repo.localClone.entrypoint}`}
              onClick={async () => { await onPlayGeneric(repo, isGenericRunning); }}
              style={{
                ...topBtn,
                background: isGenericRunning ? "rgba(37, 99, 235, 0.10)" : "#0ea5e9",
                color: isGenericRunning ? "#2563eb" : "white",
                borderColor: isGenericRunning ? "rgba(37, 99, 235, 0.22)" : "#0ea5e9",
                opacity: genericBusy ? 0.65 : 1,
                cursor: genericBusy ? "wait" : "pointer",
              }}
              disabled={genericBusy}
            >{isGenericRunning ? "↗ Open" : "▶ Play"}</button>
          )}
          {isGenericPlayable && isGenericRunning && (
            <button
              onClick={async () => { await onStopGeneric(repo); }}
              style={{
                ...topBtn,
                background: "rgba(220, 38, 38, 0.08)",
                color: "var(--err)",
                borderColor: "rgba(220, 38, 38, 0.18)",
                opacity: genericBusy ? 0.65 : 1,
                cursor: genericBusy ? "wait" : "pointer",
              }}
              disabled={genericBusy}
            >■ Stop</button>
          )}
          {canPrepareEnv && (
            <button
              onClick={async () => {
                await onPrepareEnv(repo);
              }}
              style={{
                ...topBtn,
                background: repo.localClone.envStatus === "ready" ? "rgba(22, 163, 74, 0.10)" : "rgba(37, 99, 235, 0.10)",
                color: repo.localClone.envStatus === "ready" ? "var(--ok)" : "var(--accent)",
                borderColor: repo.localClone.envStatus === "ready" ? "rgba(22, 163, 74, 0.18)" : "rgba(37, 99, 235, 0.18)",
                opacity: envBusy ? 0.65 : 1,
                cursor: envBusy ? "wait" : "pointer",
              }}
              disabled={envBusy}
            >{envBusy ? "⟳ Preparando…" : (repo.localClone.envStatus === "ready" ? window.I18N.t("ui.repos.refreshEnvironment", "↻ Refresh environment") : "⚙ Preparar entorno")}</button>
          )}
          {!isLocal && (
            <button
              onClick={() => onClone(repo)}
              disabled={cloning}
              style={{ ...topBtn, opacity: cloning ? 0.65 : 1, cursor: cloning ? "wait" : "pointer" }}
            >{cloning ? "⏳ Clonando…" : window.I18N.t("ui.repos.clone", "⎘ Clone")}</button>
          )}
          {!isLocal && (
            <button
              title={window.I18N.t("ui.repos.existingCloneHelp", "Already cloned manually elsewhere — link it without cloning again")}
              onClick={() => onLinkExisting(repo)}
              disabled={cloning}
              style={{ ...topBtn, opacity: cloning ? 0.65 : 1, cursor: cloning ? "wait" : "pointer" }}
            >{window.I18N.t("ui.repos.alreadyCloned", "🔗 Already cloned")}</button>
          )}
          {isLocal && (
            <button
              onClick={async () => {
                try {
                  toast(window.I18N.t("ui.repos.startingVscode", "Starting VS Code Web…"), "info");
                  const r = await window.HQ_API.request(`/api/connectors/${repo.provider}/projects/${encodeURIComponent(repo.id)}/vscode-web`, { method: "POST" });
                  onOpenVscodeWeb(r.url);
                } catch (err) {
                  toast(window.I18N.t("ui.repos.vscodeFailed", "Could not open VS Code Web:") + " " + err.message, "error");
                }
              }}
              style={{ ...topBtn, background: "#1e1e1e", color: "white", borderColor: "#1e1e1e" }}
            >🖥 VS Code</button>
          )}
          {isLocal && (
            <button
              onClick={async () => {
                await navigator.clipboard?.writeText(repo.localClone.path);
                toast(window.I18N.t("ui.repos.pathCopied", "Local path copied"), "ok");
              }}
              style={topBtn}
            >{window.I18N.t("ui.repos.copyPath", "⧉ Copy path")}</button>
          )}
          {onOpenSettings && <button title={window.I18N.t("ui.repos.settings", "Repository settings")} onClick={() => onOpenSettings(repo)} style={topBtn}>⚙</button>}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 2, padding: "8px 16px 0", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: "8px 14px", border: 0, background: "transparent",
            borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === k ? "var(--fg)" : "var(--muted-fg)",
            fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
          }}
            onContextMenu={evento => {
              evento.preventDefault();
              setMenuTab({ clave: k, etiqueta: l, x: evento.clientX, y: evento.clientY });
            }}>{l}</button>
        ))}
      </div>
      {menuTab && window.LintayaContextMenu && (
        <window.LintayaContextMenu
          x={menuTab.x} y={menuTab.y} label={menuTab.etiqueta}
          onClose={() => setMenuTab(null)}
          options={[
            { clave: "left", etiqueta: rt("ui.repos.tabMoveLeft", "← Move left"),
              activa: clavesTabs.indexOf(menuTab.clave) > 0,
              motivo: rt("ui.repos.tabAtEdge", "Already at the edge."),
              hacer: () => moverTab(menuTab.clave, -1) },
            { clave: "right", etiqueta: rt("ui.repos.tabMoveRight", "Move right →"),
              activa: clavesTabs.indexOf(menuTab.clave) >= 0 && clavesTabs.indexOf(menuTab.clave) < clavesTabs.length - 1,
              motivo: rt("ui.repos.tabAtEdge", "Already at the edge."),
              hacer: () => moverTab(menuTab.clave, 1) },
          ]}
        />
      )}

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {tab === "code" && (
          <>
            <div style={{ width: treeWidth, flexShrink: 0, overflow: "auto", padding: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--muted-fg)", textTransform: "uppercase" }}>{rt("repos.files", "Files")}</span>
                {isLocal && (
                  <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
                    {[["local", "Local"], ["remote", PROVIDER_LABELS[repo.provider] || window.I18N.t("ui.repos.remote", "Remote")]].map(([key, label]) => (
                      <button key={key} onClick={() => setSource(key)}
                        title={key === "local"
                          ? window.I18N.t("ui.repos.localTreeHelp", "Your working copy on disk, including changes that have not been pushed")
                          : `Lo que ${PROVIDER_LABELS[repo.provider] || window.I18N.t("ui.repos.remoteLower", "the remote")} tiene en ${branch}`}
                        style={{
                          padding: "3px 8px", border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 10.5, fontWeight: 600,
                          background: source === key ? "var(--accent)" : "transparent",
                          color: source === key ? "white" : "var(--muted-fg)",
                        }}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
              {treeLoading ? (
                <div style={{ fontSize: 11.5, color: "var(--muted-fg)", padding: "6px 8px" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
              ) : (
                <FileTree files={files} lazy={source === "remote"} dirChildren={dirChildren} loadingDirs={loadingDirs} onExpandDir={expandDir}
                  activePath={activeFile} onOpen={setActiveFile} truncated={truncated} treeTotal={treeTotal}
                  repoId={isLocal ? repo.id : null} provider={repo.provider} onFileRenamed={handleFileRenamed} onFileDuplicated={handleFileDuplicated} />
              )}
            </div>
            <ResizeHandle onMouseDown={onTreeResizeStart} />
            <div style={{ flex: 1, overflow: "hidden" }}>
              {activeFile
                ? <CodeViewer projectId={repo.id} provider={repo.provider} path={activeFile} branch={branch} source={source} editable={editable} onToggleEdit={() => setEditable(v => !v)} />
                : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)", fontSize: 13 }}>{rt("repos.selectFile", "Select a file")}</div>}
            </div>
          </>
        )}
        {tab === "build" && <BuildPanel repo={repo} branch={branch} />}
        {(tab === "pulls" || tab === "issues") && <RepoItemsPanel repo={repo} kind={tab} />}
        {tab === "advisories" && <AdvisoriesPanel repo={repo} />}
        {tab === "history" && isLocal && <HistoryPanel repo={repo} branch={branch} onBranchChanged={setBranch} />}
        {tab === "analysis" && isLocal && <AnalysisPanel repo={repo} />}
      </div>
    </div>
  );
}

const topBtn = {
  display: "inline-flex", alignItems: "center", gap: 5,
  height: 28, padding: "0 10px", border: "1px solid var(--border)",
  background: "white", borderRadius: 6, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", color: "var(--fg)",
};

function ReposView({ provider = "gitlab", connectorType, connectorName }) {
  window.I18N?.useLocale();
  const [repos, setRepos]         = useState([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [cloningId, setCloningId] = useState(null);
  const [preparingEnvId, setPreparingEnvId] = useState(null);
  const [syncedAt, setSyncedAt]   = useState(null);
  const [networkTools, setNetworkTools] = useState(null);
  const [networkToolsBusy, setNetworkToolsBusy] = useState(false);
  const [q, setQ]                 = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState([]);
  const [selected, setSelected]   = useState(null);
  const [browserTarget, setBrowserTarget] = useState(null);
  const [view, setView]           = useState("grid"); // grid | list | group
  const [settingsRepo, setSettingsRepo] = useState(null);
  const [linkingRepo, setLinkingRepo] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const [repoRuntimes, setRepoRuntimes] = useState({});
  const [playingRepoId, setPlayingRepoId] = useState(null);

  const tagProvider = useCallback((list) => (list || []).map(r => ({ ...r, provider })), [provider]);

  const load = useCallback(() => {
    window.HQ_API.request("/api/connectors/status")
      .then(d => {
        const providerData = d[provider];
        setConfigured(!!providerData?.configured);
        const list = tagProvider(providerData?.projects);
        setRepos(list);
        setSyncedAt(providerData?.syncedAt || null);
        if (window.__pendingRepoOpen != null) {
          const target = list.find(r => r.id === window.__pendingRepoOpen);
          if (target) setSelected(target);
          window.__pendingRepoOpen = null;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [provider, tagProvider]);

  useEffect(load, [load]);

  // network-tools solo existe como repo de GitLab — no tiene sentido pollear/mostrar
  // su runtime en la vista de Repos GitHub.
  const loadNetworkTools = useCallback(() => {
    if (provider !== "gitlab") return;
    window.HQ_API.request("/api/repos/network-tools/status")
      .then(setNetworkTools)
      .catch(() => setNetworkTools(null));
  }, [provider]);

  useEffect(() => {
    if (provider !== "gitlab") return;
    loadNetworkTools();
    const timer = setInterval(loadNetworkTools, 5000);
    return () => clearInterval(timer);
  }, [loadNetworkTools, provider]);

  const loadRepoRuntimes = useCallback(() => {
    window.HQ_API.request(`/api/connectors/${provider}/runtimes`)
      .then(setRepoRuntimes)
      .catch(() => {});
  }, [provider]);

  useEffect(() => {
    loadRepoRuntimes();
    const timer = setInterval(loadRepoRuntimes, 5000);
    return () => clearInterval(timer);
  }, [loadRepoRuntimes]);

  const sync = () => {
    setSyncing(true);
    window.HQ_API.request(`/api/connectors/${provider}/sync`, { method: "POST" })
      .then(async r => {
        const d = await window.HQ_API.request("/api/connectors/status");
        const providerData = d[provider];
        setConfigured(!!providerData?.configured);
        setRepos(tagProvider(providerData?.projects));
        setSyncedAt(providerData?.syncedAt || r.syncedAt);
        loadNetworkTools();
        toast(`${PROVIDER_LABELS[provider] || "GitLab"} synced · ${r.projectCount} repos`, "ok");
      })
      .catch(e => toast("Sync failed: " + e.message, "error"))
      .finally(() => setSyncing(false));
  };

  const cloneRepo = async (repo) => {
    if (!repo?.id || cloningId === repo.id) return;
    setCloningId(repo.id);
    try {
      const r = await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repo.id)}/clone`, { method: "POST" });
      const localClone = {
        ...(r.localClone || {}),
        status: r.status || r.localClone?.status || "cloned",
        path: r.path || r.localClone?.path,
        branch: r.branch || r.localClone?.branch,
        cloneUrl: r.cloneUrl || r.localClone?.cloneUrl,
        at: new Date().toISOString(),
      };
      setRepos(prev => prev.map(item => item.id === repo.id ? { ...item, localClone } : item));
      setSelected(curr => curr?.id === repo.id ? { ...curr, localClone } : curr);
      loadNetworkTools();
      toast(`${r.status === "updated" ? window.I18N.t("ui.repos.cloneUpdated", "Clone updated") : window.I18N.t("ui.repos.cloned", "Repository cloned")} · ${r.path}`, "ok");
    } catch (e) {
      toast(window.I18N.t("ui.repos.cloneFailed", "Could not clone:") + " " + e.message, "error");
    } finally {
      setCloningId(null);
    }
  };

  const handleLinkedRepo = useCallback((repoId, r) => {
    const localClone = { ...(r.localClone || {}), path: r.path };
    setRepos(prev => prev.map(item => item.id === repoId ? { ...item, localClone } : item));
    setSelected(curr => curr?.id === repoId ? { ...curr, localClone } : curr);
  }, []);

  const prepareEnv = useCallback(async (repo) => {
    if (!repo?.id || preparingEnvId === repo.id) return;
    setPreparingEnvId(repo.id);
    try {
      const r = await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repo.id)}/prepare-env`, { method: "POST" });
      const localClone = {
        ...(r.localClone || {}),
        at: new Date().toISOString(),
      };
      setRepos(prev => prev.map(item => item.id === repo.id ? { ...item, localClone } : item));
      setSelected(curr => curr?.id === repo.id ? { ...curr, localClone } : curr);
      toast(`Entorno listo · ${r.installMode || "venv"}`, "ok");
    } catch (e) {
      toast(window.I18N.t("ui.repos.prepareFailed", "Could not prepare the environment:") + " " + e.message, "error");
    } finally {
      setPreparingEnvId(null);
    }
  }, [preparingEnvId]);

  const playNetworkTools = useCallback(async (repo, isRunning, opts = {}) => {
    if (!repo?.localClone?.path) return;
    setNetworkToolsBusy(true);
    try {
      let runtime = networkTools;
      if (!isRunning) {
        runtime = await window.HQ_API.request("/api/repos/network-tools/play", {
          method: "POST",
          body: { parentOrigin: window.location.origin },
        });
        setNetworkTools(runtime);
        toast("network-tools listo en el iframe", "ok");
      } else {
        runtime = await window.HQ_API.request("/api/repos/network-tools/status");
        setNetworkTools(runtime);
      }
      if (opts.reopen === false) return;
      setBrowserTarget({
        url: runtime?.url || "http://127.0.0.1:5100",
        label: "network-tools",
        app: { name: "network-tools", color: "#0ea5e9" },
      });
    } catch (e) {
      toast(window.I18N.t("ui.repos.networkStartFailed", "Could not open network-tools:") + " " + e.message, "error");
    } finally {
      setNetworkToolsBusy(false);
      loadNetworkTools();
    }
  }, [loadNetworkTools, networkTools]);

  const openVscodeWeb = useCallback((url) => {
    setBrowserTarget({ url, label: "VS Code", app: { name: "VS Code", color: "#007acc" } });
  }, []);

  const stopNetworkTools = useCallback(async () => {
    setNetworkToolsBusy(true);
    try {
      await window.HQ_API.request("/api/repos/network-tools/stop", { method: "POST" });
      setNetworkTools(prev => ({ ...(prev || {}), status: "stopped" }));
      if (browserTarget?.url?.includes("127.0.0.1:5100")) {
        setBrowserTarget(null);
      }
      toast("network-tools detenido", "ok");
    } catch (e) {
      toast(window.I18N.t("ui.repos.networkStopFailed", "Could not stop network-tools:") + " " + e.message, "error");
    } finally {
      setNetworkToolsBusy(false);
      loadNetworkTools();
    }
  }, [browserTarget, loadNetworkTools]);

  const playGenericRepo = useCallback(async (repo, isRunning) => {
    if (!repo?.localClone?.path) return;
    setPlayingRepoId(repo.id);
    try {
      let runtime;
      if (!isRunning) {
        runtime = await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repo.id)}/runtime/play`, { method: "POST" });
        toast(`${repo.name} listo en el iframe`, "ok");
      } else {
        runtime = await window.HQ_API.request(`/api/connectors/${provider}/runtimes`);
        runtime = runtime[repo.id];
      }
      setRepoRuntimes(prev => ({ ...prev, [repo.id]: runtime }));
      setBrowserTarget({
        url: runtime?.url,
        label: repo.name,
        app: { name: repo.name, color: "#0ea5e9" },
      });
    } catch (e) {
      toast(window.I18N.t("ui.repos.startFailed", "Could not open {0}: ", { 0: repo.name }) + e.message, "error");
    } finally {
      setPlayingRepoId(null);
      loadRepoRuntimes();
    }
  }, [loadRepoRuntimes, provider]);

  const stopGenericRepo = useCallback(async (repo) => {
    setPlayingRepoId(repo.id);
    try {
      await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repo.id)}/runtime/stop`, { method: "POST" });
      setRepoRuntimes(prev => ({ ...prev, [repo.id]: { ...(prev[repo.id] || {}), status: "stopped" } }));
      if (browserTarget?.url && browserTarget.url === repoRuntimes[repo.id]?.url) {
        setBrowserTarget(null);
      }
      toast(`${repo.name} detenido`, "ok");
    } catch (e) {
      toast(window.I18N.t("ui.repos.stopFailed", "Could not stop {0}: ", { 0: repo.name }) + e.message, "error");
    } finally {
      setPlayingRepoId(null);
      loadRepoRuntimes();
    }
  }, [browserTarget, repoRuntimes, loadRepoRuntimes, provider]);

  const groups = useMemo(() => Array.from(new Set(repos.map(r => r.group))).sort(), [repos]);

  const hiddenCount = useMemo(() => repos.filter(r => r.settings?.visible === false).length, [repos]);

  const filtered = useMemo(() => repos.filter(r => {
    if (!showHidden && r.settings?.visible === false) return false;
    if (groupFilter !== "all" && r.group !== groupFilter) return false;
    const isLocal = !!r.localClone?.path;
    if (locationFilter === "local" && !isLocal) return false;
    if (locationFilter === "remote" && isLocal) return false;
    if (pipelineFilter !== "all" && (r.pipelineStatus || "none") !== pipelineFilter) return false;
    if (tagFilter.length && !tagFilter.every(t => r.topics?.includes(t))) return false;
    if (q) {
      const s = q.toLowerCase();
      return r.name.toLowerCase().includes(s) || (r.description || "").toLowerCase().includes(s) || r.group.toLowerCase().includes(s);
    }
    return true;
  }).sort((a, b) => {
    const aLocal = !!a.localClone?.path;
    const bLocal = !!b.localClone?.path;
    return aLocal === bLocal ? 0 : aLocal ? -1 : 1;
  }), [repos, q, groupFilter, locationFilter, pipelineFilter, tagFilter, showHidden]);

  const pagination = usePagination(filtered, { key: "repos" });

  const saveRepoSettings = useCallback(async (repoId, patch) => {
    const r = await window.HQ_API.request(`/api/connectors/${provider}/projects/${encodeURIComponent(repoId)}/settings`, { method: "PUT", body: patch });
    setRepos(prev => prev.map(item => item.id === repoId ? { ...item, settings: r.settings } : item));
    setSelected(curr => curr?.id === repoId ? { ...curr, settings: r.settings } : curr);
    window.dispatchEvent(new CustomEvent("hq:repo-settings-changed"));
    toast(window.I18N.t("ui.repos.settingsSaved", "Repository settings saved"), "ok");
  }, [provider]);

  // Acceso directo desde el submenú de Repos en el sidebar (repos "pinned") —
  // ver Sidebar en app.jsx. window.__pendingRepoOpen cubre el caso "aún no
  // montado" (navegando hacia Repos); el evento cubre "ya estoy en Repos".
  useEffect(() => {
    const handler = (e) => {
      const id = e.detail?.id;
      if (id == null) return;
      setRepos(curr => {
        const target = curr.find(r => r.id === id);
        if (target) setSelected(target);
        return curr;
      });
    };
    window.addEventListener("hq:open-repo", handler);
    return () => window.removeEventListener("hq:open-repo", handler);
  }, []);

  const counts = useMemo(() => ({
    total:   repos.length,
    success: repos.filter(r => r.pipelineStatus === "success").length,
    failed:  repos.filter(r => r.pipelineStatus === "failed").length,
    running: repos.filter(r => r.pipelineStatus === "running").length,
  }), [repos]);

  // provider is the connector *instance* id — "github2" for a second GitHub
  // account — which PROVIDER_LABELS, keyed by type, cannot resolve. Read the
  // type first so an extra account stops labelling itself "GitLab".
  const providerLabel = PROVIDER_LABELS[connectorType] || PROVIDER_LABELS[provider] || connectorType || provider;

  if (!loading && !configured) {
    return (
      <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 16px", letterSpacing: -0.2 }}>{connectorName || providerLabel}</h1>
        <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border)", borderRadius: 10, background: "var(--muted)" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{window.I18N.t("boards.connector", "Connector")} {providerLabel} {window.I18N.t("ui.repos.notConfigured", "not configured")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-fg)", maxWidth: 440, margin: "0 auto 14px", lineHeight: 1.5 }}>{window.I18N.t("ui.repos.configureStart", "Configure the URL and token in Connectors →")} {providerLabel} {window.I18N.t("ui.repos.configureEnd", "to see your repositories here.")} </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{connectorName || providerLabel}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
            {counts.total} {providerLabel} repositories · {counts.success} passing · {counts.failed} failing · {counts.running} running
            {syncedAt && <> · synced {timeAgo(syncedAt)}</>}
          </p>
        </div>
        <button onClick={sync} disabled={syncing} style={{
          height: 32, padding: "0 14px", background: "#13bef9", color: "white", border: 0, borderRadius: 6,
          fontSize: 12.5, fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: syncing ? .6 : 1,
        }}>{syncing ? rt("repos.syncing", "Syncing…") : `⟳ ${rt("repos.sync", "Sync")}`}</button>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "0 1 280px" }}>
              <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)" }}>⌕</span>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search repo, group, description…"
                style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "white", fontFamily: "inherit" }} />
            </div>
            <FilterSelect label="Group" value={groupFilter} options={[["all","All"], ...groups.map(g => [g, g])]} onChange={setGroupFilter} />
            <FilterSelect label={rt("repos.local", "Local")} value={locationFilter} options={[["all",rt("repos.all", "All")], ["local",rt("repos.local", "Local")], ["remote",rt("repos.remote", "Remote")]]} onChange={setLocationFilter} />
            <FilterSelect label="Pipeline" value={pipelineFilter} options={[["all",rt("repos.all", "All")],["success",rt("repos.passed", "Passed")],["failed",rt("repos.failed", "Failed")],["running",rt("repos.running", "Running")],["none",rt("repos.noRuns", "No runs")]]} onChange={setPipelineFilter} />
            <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--muted)", borderRadius: 7 }}>
              <DensityBtn active={view === "grid"} onClick={() => setView("grid")} label="Grid" icon="▦" />
              <DensityBtn active={view === "list"} onClick={() => setView("list")} label="List" icon="≡" />
              <DensityBtn active={view === "group"} onClick={() => setView("group")} label="By group" icon="☷" />
            </div>
            {hiddenCount > 0 && (
              <button onClick={() => setShowHidden(v => !v)} style={{
                height: 26, padding: "0 9px", fontSize: 11.5, fontWeight: 600, borderRadius: 5,
                border: "1px solid var(--border)", background: showHidden ? "var(--muted)" : "white",
                color: "var(--muted-fg)", cursor: "pointer", fontFamily: "inherit",
              }}>{showHidden ? window.I18N.t("ui.repos.hideHidden", "🙈 Hide hidden repos") : window.I18N.t("ui.repos.showHidden", "🙈 Show hidden repos ({0})", { 0: hiddenCount })}</button>
            )}
            <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-fg)" }}>{rt("repos.showing", "Showing {shown} of {total}", { shown: filtered.length, total: counts.total })}</div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <window.TagFilter value={tagFilter} onChange={setTagFilter} items={repos.map(r => ({ tags: r.topics }))} />
          </div>

          <div style={{ display: view === "grid" ? "grid" : "flex", gridTemplateColumns: view === "grid" ? "repeat(auto-fill, minmax(300px, 1fr))" : undefined, flexDirection: view !== "grid" ? "column" : undefined, gap: view === "grid" ? 10 : (view === "group" ? 18 : 0) }}>
            {view === "grid" && pagination.pageItems.map(r => <RepoCard key={r.id} repo={r} providerLabel={providerLabel} onSelect={setSelected} onClone={cloneRepo} onLinkExisting={setLinkingRepo} cloning={cloningId === r.id} onPlayNetworkTools={playNetworkTools} onPrepareEnv={prepareEnv} networkTools={networkTools} networkToolsBusy={networkToolsBusy} preparingEnvId={preparingEnvId} onOpenVscodeWeb={openVscodeWeb} onOpenSettings={setSettingsRepo} repoRuntime={repoRuntimes[r.id]} playingRepoId={playingRepoId} onPlayGeneric={playGenericRepo} />)}
            {view === "list" && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "white" }}>
                {pagination.pageItems.map((r, i) => <RepoRow key={r.id} repo={r} onSelect={setSelected} first={i === 0} />)}
              </div>
            )}
            {view === "group" && groups
              .filter(g => groupFilter === "all" || g === groupFilter)
              .map(g => {
                const items = pagination.pageItems.filter(r => r.group === g);
                if (!items.length) return null;
                const passing = items.filter(r => r.pipelineStatus === "success").length;
                return (
                  <div key={g}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--muted-fg)", textTransform: "uppercase" }}>{g}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{items.length} repo{items.length > 1 ? "s" : ""} · {passing}/{items.length} passing</span>
                    </div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "white" }}>
                      {items.map((r, i) => <RepoRow key={r.id} repo={r} onSelect={setSelected} first={i === 0} />)}
                    </div>
                  </div>
                );
              })}
          </div>

          <PaginationBar {...pagination} />

          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted-fg)", border: "1px dashed var(--border)", borderRadius: 8 }}>
              No repos match the current filters.
            </div>
          )}
        </>
      )}

      {selected && <RepoDetail repo={selected} onClose={() => setSelected(null)} onClone={cloneRepo} onLinkExisting={setLinkingRepo} cloning={cloningId === selected.id} onPlayNetworkTools={playNetworkTools} onStopNetworkTools={stopNetworkTools} onPrepareEnv={prepareEnv} networkTools={networkTools} networkToolsBusy={networkToolsBusy} preparingEnvId={preparingEnvId} onOpenVscodeWeb={openVscodeWeb} onOpenSettings={setSettingsRepo} repoRuntime={repoRuntimes[selected.id]} playingRepoId={playingRepoId} onPlayGeneric={playGenericRepo} onStopGeneric={stopGenericRepo} />}

      {settingsRepo && <RepoSettingsModal repo={settingsRepo} onClose={() => setSettingsRepo(null)} onSave={saveRepoSettings} />}

      {linkingRepo && (
        <LinkExistingModal repo={linkingRepo} onClose={() => setLinkingRepo(null)}
          onLinked={(r) => handleLinkedRepo(linkingRepo.id, r)} />
      )}

      {browserTarget && window.AppBrowser && (
        <window.AppBrowser
          url={browserTarget.url}
          title={browserTarget.app?.name || browserTarget.label}
          appColor={browserTarget.app?.color}
          onClose={() => setBrowserTarget(null)}
        />
      )}
    </div>
  );
}

function RepoRow({ repo, onSelect, first }) {
  return (
    <div onClick={() => onSelect(repo)} style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", borderTop: first ? "none" : "1px solid var(--border)",
      cursor: "pointer",
    }}
    onMouseEnter={e => e.currentTarget.style.background = "var(--row-hover)"}
    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <div style={{ minWidth: 0, flex: "0 1 260px" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{repo.name}</span>
        <div style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{repo.path}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.description}</div>
      <LangDot lang={repo.language} />
      <span style={{ fontSize: 11, color: "var(--muted-fg)", width: 90, flexShrink: 0, fontFamily: "var(--font-mono)" }}>{repo.defaultBranch}</span>
      {repo.openMRs > 0 && <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, flexShrink: 0, width: 46 }}>{repo.openMRs} MR{repo.openMRs > 1 ? "s" : ""}</span>}
      {!repo.openMRs && <span style={{ width: 46, flexShrink: 0 }} />}
      <span style={{ fontSize: 11, color: "var(--muted-fg)", width: 90, flexShrink: 0 }}>{repo.lastCommit ? timeAgo(repo.lastCommit.when) : "—"}</span>
      <VisibilityBadge visibility={repo.visibility} />
      <ForkBadge fork={repo.fork} />
      <CloneBadge clone={repo.localClone} />
      <BranchBadge clone={repo.localClone} />
      {repo.topics?.length > 0 && (
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
          {repo.topics.slice(0, 2).map(t => <window.TagPill key={t} id={t} />)}
        </div>
      )}
      <PipelineBadge status={repo.pipelineStatus} />
    </div>
  );
}

function DensityBtn({ active, onClick, label, icon }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      height: 26, padding: "0 9px",
      background: active ? "white" : "transparent",
      border: active ? "1px solid var(--border)" : "1px solid transparent",
      boxShadow: active ? "0 1px 1px rgba(0,0,0,.04)" : "none",
      borderRadius: 5, fontSize: 12, fontFamily: "inherit",
      color: active ? "var(--fg)" : "var(--muted-fg)",
      cursor: "pointer", fontWeight: 500,
    }}>
      <span style={{ fontFamily: "var(--font-mono)" }}>{icon}</span> {label}
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

window.ReposView = ReposView;
window.ResizeHandle = ResizeHandle;
