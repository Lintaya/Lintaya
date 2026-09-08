// Llamadas — próximas llamadas/reuniones de la semana desde el calendario de Outlook
// (vía el conector Microsoft Graph; lee /api/connectors/:id/events).
const { useState, useEffect, useCallback } = React;
const clt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

// "2026-06-18T10:00:00.0000000" → Date en hora local (la API ya devuelve hora de México)
function parseGraphDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayLabel(dateStr) {
  const d = parseGraphDate(dateStr);
  if (!d) return window.I18N.t("ui.calls.noDate", "No date");
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const key = ymd(d);
  if (key === ymd(today))    return window.I18N.t("ui.today", "Today");
  if (key === ymd(tomorrow)) return window.I18N.t("ui.tomorrow", "Tomorrow");
  return d.toLocaleDateString(window.I18N.dateLocale(), { weekday: "long", day: "numeric", month: "short" });
}
function timeRange(start, end) {
  const s = parseGraphDate(start), e = parseGraphDate(end);
  const opt = { hour: "2-digit", minute: "2-digit" };
  if (!s) return "—";
  const st = s.toLocaleTimeString(window.I18N.dateLocale(), opt);
  return e ? `${st} – ${e.toLocaleTimeString(window.I18N.dateLocale(), opt)}` : st;
}
// Duración agendada en minutos entre start y end
function durationMin(start, end) {
  const s = parseGraphDate(start), e = parseGraphDate(end);
  if (!s || !e) return 0;
  return Math.max(0, Math.round((e - s) / 60000));
}
// 90 → "1h 30m", 45 → "45m", 120 → "2h"
function fmtDur(min) {
  if (!min) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h)      return `${h}h`;
  return `${m}m`;
}
// ¿El evento está ocurriendo ahora mismo? (start ≤ ahora ≤ end)
function isNow(start, end) {
  const s = parseGraphDate(start), e = parseGraphDate(end);
  if (!s || !e) return false;
  const now = Date.now();
  return s.getTime() <= now && now <= e.getTime();
}

function CallsView({ connectorId = "outlook", onNavigate }) {
  window.I18N?.useLocale();
  const [events,   setEvents]   = useState([]);
  const [syncedAt, setSyncedAt] = useState(null);
  const [status,   setStatus]   = useState(null); // { configured, connected }
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [error,    setError]    = useState("");

  const loadEvents = useCallback(async () => {
    const data = await window.HQ_API.request(`/api/connectors/${connectorId}/events`);
    setEvents(Array.isArray(data.events) ? data.events : []);
    setSyncedAt(data.syncedAt || null);
  }, [connectorId]);

  useEffect(() => {
    Promise.all([
      window.HQ_API.request(`/api/connectors/${connectorId}/config`).catch(() => ({ configured: false, connected: false })),
      loadEvents().catch(() => {}),
    ]).then(([cfg]) => setStatus(cfg))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [connectorId, loadEvents]);

  const sync = useCallback(async () => {
    setSyncing(true); setError("");
    try {
      const r = await window.HQ_API.request(`/api/connectors/${connectorId}/sync`, { method: "POST" });
      await loadEvents();
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `⟳ ${r.count} eventos esta semana`, kind: "ok" } }));
    } catch (e) {
      setError(e.message || window.I18N.t("ui.calls.syncFailed", "Sync failed"));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: `✕ Outlook: ${e.message || window.I18N.t("ui.calls.syncFailedShort", "sync failed")}`, kind: "error" } }));
    } finally { setSyncing(false); }
  }, [connectorId, loadEvents]);

  // Agrupar por día, en orden cronológico
  const groups = [];
  const byDay = {};
  for (const ev of events) {
    const key = ev.start ? ev.start.slice(0, 10) : "zzz";
    if (!byDay[key]) { byDay[key] = { key, label: dayLabel(ev.start), items: [] }; groups.push(byDay[key]); }
    byDay[key].items.push(ev);
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  for (const g of groups) g.totalMin = g.items.reduce((s, ev) => s + durationMin(ev.start, ev.end), 0);
  const weekTotalMin = events.reduce((s, ev) => s + durationMin(ev.start, ev.end), 0);

  const wrap = { padding: 20, maxWidth: 1480, margin: "0 auto" };
  const notConnected = status && (!status.configured || !status.connected);

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{clt("calls.title", "Calls")}</h1>
          <div style={{ fontSize: 12, color: "var(--muted-fg)", marginTop: 3 }}>{window.I18N.t("calls.subtitle", "Upcoming calls and meetings this week")} {syncedAt && <> {window.I18N.t("ui.synced", "· synced")} {new Date(syncedAt).toLocaleString(window.I18N.dateLocale())}</>}
          </div>
        </div>
        <button onClick={sync} disabled={syncing || notConnected} style={{
          height: 32, padding: "0 14px", background: "#0078d4", color: "white", border: 0, borderRadius: 6,
          fontSize: 12.5, fontWeight: 600, cursor: (syncing || notConnected) ? "not-allowed" : "pointer",
          fontFamily: "inherit", opacity: (syncing || notConnected) ? .6 : 1, display: "flex", alignItems: "center", gap: 6,
        }}>
          {syncing ? window.I18N.t("passwords.syncing", "Syncing…") : "⟳ Sincronizar"}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 22%,var(--border))", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>{window.I18N.t("settings.loading", "Loading…")}</div>
      ) : notConnected ? (
        <EmptyState
          title={window.I18N.t("calls.notConnected", "Outlook is not connected")}
          body={window.I18N.t("ui.calls.connectHelp", "Connect your account in Connectors → Outlook Calendar to see this week's calls.")}
          action={window.I18N.t("ui.goConnectors", "Go to Connectors")}
          onAction={() => onNavigate && onNavigate("connectors")}
        />
      ) : events.length === 0 ? (
        <EmptyState
          title={window.I18N.t("calls.emptyTitle", "No calls this week")}
          body={window.I18N.t("ui.calls.emptyDescription", "No events in the next 7 days, or you have not synchronized yet.")}
          action={window.I18N.t("connectors.card.syncNow", "Sync now")}
          onAction={sync}
        />
      ) : (
        <>
          {/* Resumen de tiempo de la semana */}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18, padding: "12px 16px", background: "var(--muted)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <Stat label={clt("calls.totalTime", "Total time in calls")} value={fmtDur(weekTotalMin)} />
            <Stat label={clt("calls.thisWeek", "Calls this week")} value={String(events.length)} />
            <Stat label={clt("calls.average", "Average per call")} value={fmtDur(events.length ? Math.round(weekTotalMin / events.length) : 0)} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {groups.map(g => (
              <div key={g.key}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted-fg)", textTransform: "capitalize", letterSpacing: 0.3 }}>{g.label}</span>
                  <span style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>· {fmtDur(g.totalMin)} · {g.items.length} {g.items.length === 1 ? "llamada" : "llamadas"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.items.map(ev => <CallCard key={ev.id} ev={ev} />)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CallCard({ ev }) {
  const now = isNow(ev.start, ev.end);
  const mins = durationMin(ev.start, ev.end);
  return (
    <div style={{
      background: now ? "color-mix(in srgb,var(--ok) 6%,white)" : "white",
      border: `1px solid ${now ? "color-mix(in srgb,var(--ok) 30%,var(--border))" : "var(--border)"}`,
      borderLeft: `3px solid ${now ? "var(--ok)" : "#0078d4"}`,
      borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 14,
    }}>
      <div style={{ minWidth: 116, flexShrink: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--fg)" }}>
          {timeRange(ev.start, ev.end)}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 1 }}>{fmtDur(mins)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.subject}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ev.organizer && <span>👤 {ev.organizer}</span>}
          {ev.location && <span>📍 {ev.location}</span>}
          {ev.attendeesCount > 0 && <span>· {ev.attendeesCount} {window.I18N.t("calls.attendees", "attendees")}</span>}
        </div>
      </div>
      {now && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4, background: "color-mix(in srgb,var(--ok) 16%,white)", color: "var(--ok)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{window.I18N.t("ui.calls.now", "● NOW")}</span>
      )}
      {ev.isOnline && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4, background: "color-mix(in srgb,#0078d4 14%,white)", color: "#0078d4", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{clt("calls.online", "ONLINE")}</span>
      )}
      {ev.joinUrl && (
        <a href={ev.joinUrl} target="_blank" rel="noreferrer" style={{
          height: 28, padding: "0 12px", display: "inline-flex", alignItems: "center", background: "#0078d4", color: "white",
          borderRadius: 5, fontSize: 12, fontWeight: 600, textDecoration: "none", flexShrink: 0,
        }}>{clt("calls.join", "Unirse")}</a>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--fg)", fontFamily: "var(--font-mono)", letterSpacing: -0.5 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function EmptyState({ title, body, action, onAction }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border)", borderRadius: 10, background: "var(--muted)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted-fg)", maxWidth: 380, margin: "0 auto 14px", lineHeight: 1.5 }}>{body}</div>
      {action && (
        <button onClick={onAction} style={{ height: 32, padding: "0 16px", background: "var(--accent)", color: "white", border: 0, borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{action}</button>
      )}
    </div>
  );
}

window.CallsView = CallsView;
