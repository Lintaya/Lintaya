// Pantalla de "aquí todavía no hay nada", compartida por todas las vistas.
//
// El nombre de la función lleva prefijo a propósito: calls.jsx y containers.jsx
// ya declaran cada uno su propio `function EmptyState` en el scope global que
// comparten todos los <script type="text/babel">, así que un tercero con ese
// nombre pisaría al que gane la carrera de carga. Los sitios de uso la toman de
// window.LintayaEmptyState: una declaración `function EmptyState` en el scope
// global define además window.EmptyState, así que la propiedad corta tampoco
// estaba libre. Mismo patrón que window.DashboardCatalogView y compañía.
//
// `compact` es para los vacíos que viven DENTRO de una tarjeta (las de Home):
// mismo lenguaje visual, sin el borde punteado ni el botón, que ahí desbordarían
// el widget en vez de acompañarlo.
function LintayaEmptyState({ icon, title, body, action, onAction, compact = false }) {
  if (compact) {
    return (
      <div style={{ padding: "20px 12px", textAlign: "center", color: "var(--muted-fg)" }}>
        {icon && <div style={{ fontSize: 20, marginBottom: 6, lineHeight: 1 }}>{icon}</div>}
        {title && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 3 }}>{title}</div>}
        {body && <div style={{ fontSize: 12, lineHeight: 1.5 }}>{body}</div>}
      </div>
    );
  }
  return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--muted-fg)", border: "1px dashed var(--border)", borderRadius: 8 }}>
      {icon && <div style={{ fontSize: 32, marginBottom: 12, lineHeight: 1 }}>{icon}</div>}
      {title && <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{title}</div>}
      {body && (
        <div style={{ fontSize: 13, maxWidth: 420, margin: "0 auto", marginBottom: action ? 20 : 0, lineHeight: 1.5 }}>{body}</div>
      )}
      {action && (
        <button onClick={onAction} style={{
          height: 34, padding: "0 18px", background: "var(--accent)", color: "white", border: "none",
          borderRadius: 7, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>{action}</button>
      )}
    </div>
  );
}

window.LintayaEmptyState = LintayaEmptyState;
