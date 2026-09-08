// Hosts view — vista separada de los 36 Cisco UCS
function HostsView({ onNavigate }) {
  window.I18N?.useLocale();
  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{window.I18N?.t("nav.hosts.label", "UCS Hosts") || "UCS Hosts"}</h1>
      </div>
      <HostsBrowser onNavigate={onNavigate} />
    </div>
  );
}
window.HostsView = HostsView;
