// Menú de clic derecho, compartido por el sidebar y por las pestañas del
// detalle de un repositorio.
//
// El nombre lleva prefijo por lo mismo que LintayaEmptyState (ver
// empty-state.jsx): todos los <script type="text/babel"> comparten el scope
// global, y `function ContextMenu` definiría además window.ContextMenu, que es
// un nombre demasiado goloso para dejarlo tomado. Los sitios de uso lo leen de
// window.LintayaContextMenu.
//
// Existe como componente y no como dos copias porque lo que el usuario pidió
// fue "el mismo funcionamiento" en los dos sitios: con dos copias, la primera
// corrección que se aplique a una y no a la otra rompe justamente eso.
//
// Una opción es { clave, etiqueta, activa, motivo?, separar?, hacer }. Una
// opción inactiva se pinta igual pero apagada y explica en su tooltip por qué
// no se puede — esconderla dejaría al usuario preguntándose si la acción existe.
function LintayaContextMenu({ x, y, label, options = [], onClose }) {
  React.useEffect(() => {
    const alPulsar = evento => { if (evento.key === "Escape") onClose(); };
    // Al desplazar, el menú quedaría flotando lejos de lo que abrió: se cierra.
    const alDesplazar = () => onClose();
    window.addEventListener("keydown", alPulsar);
    window.addEventListener("resize", alDesplazar);
    return () => {
      window.removeEventListener("keydown", alPulsar);
      window.removeEventListener("resize", alDesplazar);
    };
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} onContextMenu={evento => { evento.preventDefault(); onClose(); }}
        style={{ position: "fixed", inset: 0, zIndex: 60 }} />
      <div role="menu" aria-label={label}
        style={{
          position: "fixed", zIndex: 61,
          // Se ancla al cursor pero sin salirse de la ventana.
          left: Math.min(x, window.innerWidth - 240),
          top: Math.min(y, window.innerHeight - 140),
          minWidth: 216, background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.14)", overflow: "hidden", padding: "4px 0",
        }}>
        {label && (
          <div style={{ padding: "6px 12px 7px", fontSize: 11, color: "var(--muted-fg)", borderBottom: "1px solid var(--border)", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        )}
        {options.map(opcion => (
          <React.Fragment key={opcion.clave}>
            {opcion.separar && <div aria-hidden="true" style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />}
            <button role="menuitem" disabled={!opcion.activa}
              title={opcion.activa ? "" : (opcion.motivo || "")}
              onClick={() => { opcion.hacer(); onClose(); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "7px 12px",
                background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5,
                color: opcion.activa ? "var(--fg)" : "var(--muted-fg)",
                cursor: opcion.activa ? "pointer" : "not-allowed",
                opacity: opcion.activa ? 1 : 0.55,
              }}
              onMouseEnter={evento => { if (opcion.activa) evento.currentTarget.style.background = "var(--row-hover)"; }}
              onMouseLeave={evento => { evento.currentTarget.style.background = "transparent"; }}>
              {opcion.etiqueta}
            </button>
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

window.LintayaContextMenu = LintayaContextMenu;
