// Approval Center — SEC-003's small, dedicated human-control surface.
// It deliberately renders only data returned by the redacted approval API;
// raw action input and connector secrets never enter this view.
const { useState, useEffect, useCallback } = React;
const apt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

function ApprovalCenterView() {
  window.I18N?.useLocale();
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await window.HQ_API.request("/api/approvals?status=pending");
      setApprovals(Array.isArray(rows) ? rows : []);
      setError("");
      setAuthRequired(false);
    } catch (err) {
      setError(err.message || window.I18N.t("ui.approvals.loadFailed", "Could not load Approval Center."));
      setAuthRequired(err.status === 401);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function resolve(id, decision) {
    setBusyId(id); setError(""); setNotice("");
    try {
      const result = await window.HQ_API.request(`/api/approvals/${encodeURIComponent(id)}/${decision}`, { method: "POST", body: {} });
      const status = result.approval?.status || (decision === "approve" ? "succeeded" : "rejected");
      setNotice(decision === "approve" ? window.I18N.t("ui.approvals.executed", "Action executed: {0}.", { 0: status }) : window.I18N.t("ui.approvals.rejected", "Request rejected."));
      await load();
      // The shell owns the navigation badge. Update it immediately instead of
      // waiting for its next background poll after a human resolution.
      window.dispatchEvent(new Event("hq:approvals-changed"));
    } catch (err) {
      setError(err.message || window.I18N.t("ui.approvals.resolveFailed", "Could not resolve the request."));
    } finally { setBusyId(""); }
  }

  async function reconnect(event) {
    event.preventDefault();
    if (!accessToken.trim()) { setError(window.I18N.t("ui.approvals.enterToken", "Enter your Lintaya access token.")); return; }
    window.HQ_API.setToken(accessToken.trim());
    setAccessToken("");
    setLoading(true);
    await load();
  }

  return (
    <section data-lintaya-surface="approval-center" aria-labelledby="approval-center-title" style={{ maxWidth: 1480, margin: "0 auto", padding: 20, width: "100%", boxSizing: "border-box" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 id="approval-center-title" style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{apt("approvals.title", "Approval Center")}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
            {approvals.length === 1 ? window.I18N.t("ui.approvals.onePending", "1 action requires human confirmation before it can run.") : window.I18N.t("ui.approvals.manyPending", "{count} actions require human confirmation before they can run.", { count: approvals.length })}
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "white", cursor: loading ? "wait" : "pointer", font: "inherit", fontSize: 12.5, color: "var(--fg)" }}>{window.I18N.t("containers.refreshLogs", "↻ Refresh")}</button>
      </header>

      <div aria-live="polite" style={{ minHeight: error || notice ? 30 : 0, fontSize: 12.5, color: error ? "#b91c1c" : "#166534", marginBottom: error || notice ? 12 : 0 }}>{error || notice}</div>

      {authRequired ? <form onSubmit={reconnect} style={{ maxWidth: 520, border: "1px solid var(--border)", borderRadius: 8, padding: 16, background: "white" }}>
        <strong style={{ fontSize: 13.5 }}>{window.I18N.t("ui.approvals.reconnect", "Reconnect this session")}</strong>
        <p style={{ margin: "6px 0 12px", color: "var(--muted-fg)", fontSize: 12.5 }}>{window.I18N.t("ui.approvals.tokenHelp", "The token is stored only in this browser. You do not need to unlock the vault to review approvals.")}</p>
        <label htmlFor="approval-access-token" style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "var(--muted-fg)", letterSpacing: 0.3, textTransform: "uppercase" }}>{window.I18N.t("ui.approvals.token", "Lintaya access token")}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="approval-access-token" type="password" autoComplete="current-password" value={accessToken} onChange={event => setAccessToken(event.target.value)} placeholder="HQ access token" style={{ flex: 1, minWidth: 0, height: 32, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 6, font: "inherit", fontSize: 12.5 }} />
          <button type="submit" style={{ height: 32, border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "white", padding: "0 12px", cursor: "pointer", font: "inherit", fontWeight: 600, fontSize: 12.5 }}>{window.I18N.t("ui.connect", "Connect")}</button>
        </div>
      </form> : loading ? <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", padding: "28px 14px", color: "var(--muted-fg)", textAlign: "center", fontSize: 12.5 }}>{apt("approvals.loading", "Loading requests…")}</div> : approvals.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 8, background: "white", padding: "30px 24px", color: "var(--muted-fg)", textAlign: "center", fontSize: 12.5 }}>{window.I18N.t("ui.approvals.empty", "There are no actions pending approval.")} </div>
      ) : <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", overflowX: "auto" }}>
        <div role="list" aria-label={window.I18N.t("ui.approvals.pending", "Pending requests")} style={{ minWidth: 860 }}>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.35fr) minmax(120px, .7fr) minmax(180px, 1fr) minmax(160px, .8fr) auto", gap: 14, alignItems: "center", padding: "8px 12px", background: "var(--muted)", color: "var(--muted-fg)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>
            <span>{apt("approvals.action", "Action")}</span><span>{apt("approvals.connection", "Connection")}</span><span>{apt("approvals.requestedBy", "Requested by")}</span><span>{apt("approvals.expires", "Expires")}</span><span>{apt("approvals.actions", "Actions")}</span>
          </div>
          {approvals.map(approval => {
            const busy = busyId === approval.id;
            // Assistant write-tool proposals (create_board/create_content_block/
            // add_connector_block/create_dashboard) share this same ledger with
            // connector destructive actions, but they aren't destructive — they're
            // ordinary writes the model can't run without a human clicking
            // through. Blue "proposal" framing instead of amber "danger" framing
            // keeps that distinction visible instead of implying the assistant
            // did something risky.
            const isAssistant = approval.connectorTypeId === "assistant";
            const dotColor = isAssistant ? "#2563eb" : "#d97706";
            const badgeFg = isAssistant ? "#1d4ed8" : "#92400e";
            const badgeBg = isAssistant ? "#dbeafe" : "#fef3c7";
            const badgeText = isAssistant ? window.I18N.t("ui.approvals.proposal", "ASSISTANT PROPOSAL") : window.I18N.t("ui.approvals.required", "APPROVAL REQUIRED");
            const approveBorder = isAssistant ? "#1d4ed8" : "#b45309";
            const approveBg = isAssistant ? "#2563eb" : "#d97706";
            const approveLabel = isAssistant ? window.I18N.t("ui.approvals.create", "Approve and create") : window.I18N.t("ui.approvals.execute", "Approve and execute");
            return <article key={approval.id} role="listitem" style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.35fr) minmax(120px, .7fr) minmax(180px, 1fr) minmax(160px, .8fr) auto", gap: 14, alignItems: "center", padding: "13px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600, fontSize: 13.5 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dotColor, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{approval.actionTitle}</span>
                </div>
                <span style={{ display: "inline-block", marginTop: 5, color: badgeFg, background: badgeBg, borderRadius: 999, padding: "2px 7px", fontSize: 10, fontWeight: 700 }}>{badgeText}</span>
              </div>
              <strong style={{ fontWeight: 600 }}>{isAssistant ? window.I18N.t("settings.pane.ai", "AI Assistant") : approval.connectionId}</strong>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted-fg)" }}>{approval.requester}</span>
              <span style={{ color: "var(--muted-fg)", fontSize: 11.5 }}>{new Date(approval.expiresAt).toLocaleString()}</span>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => resolve(approval.id, "reject")} style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 5, background: "white", cursor: busy ? "wait" : "pointer", font: "inherit", fontSize: 11.5 }}>{window.I18N.t("ui.approvals.reject", "Reject")}</button>
                <button type="button" disabled={busy} onClick={() => resolve(approval.id, "approve")} style={{ height: 28, padding: "0 10px", border: `1px solid ${approveBorder}`, borderRadius: 5, background: approveBg, color: "white", cursor: busy ? "wait" : "pointer", font: "inherit", fontSize: 11.5, fontWeight: 700 }}>{busy ? window.I18N.t("connectors.card.working", "Working…") : approveLabel}</button>
              </div>
              <details style={{ gridColumn: "1 / -1", marginTop: -3 }}>
                <summary style={{ display: "inline-block", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "var(--muted-fg)" }}>{apt("approvals.scope", "View scope and parameters")}</summary>
                <pre style={{ margin: "8px 0 0", padding: 10, borderRadius: 6, overflowX: "auto", background: "var(--muted)", fontSize: 11.5 }}>{JSON.stringify(approval.input, null, 2)}</pre>
                <div style={{ color: "var(--muted-fg)", fontSize: 11, marginTop: 7 }}>{window.I18N.t("ui.approvals.fingerprint", "Request fingerprint:")} {approval.inputHash.slice(0, 12)}…</div>
              </details>
            </article>;
          })}
        </div>
      </div>}
    </section>
  );
}

window.ApprovalCenterView = ApprovalCenterView;
