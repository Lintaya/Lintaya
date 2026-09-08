// Confirmación de acciones destructivas, compartida por Blocks, Boards y
// Dashboards (window.ConfirmModal — este repo no comparte componentes entre
// .jsx sin pasar por window.*).
//
// Modal propio y no window.confirm() por lo mismo que TextPromptModal en
// repos.jsx: Chrome suprime los diálogos nativos en display-mode:standalone,
// así que instalada como PWA la app se quedaba sin confirmación — y con un
// `if (!confirm(...)) return;` eso no deja pasar el borrado, lo cancela
// siempre en silencio.
const { useState: useConfirmState, useEffect: useConfirmEffect, useRef: useConfirmRef } = React;

function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }) {
  const [busy, setBusy] = useConfirmState(false);
  const cancelRef = useConfirmRef(null);
  // El foco arranca en Cancelar: es la acción segura, así que un Enter de más
  // sobre un diálogo recién abierto no borra nada.
  useConfirmEffect(() => { cancelRef.current?.focus(); }, []);

  const close = () => { if (!busy) onClose(); };

  const confirm = async () => {
    if (busy) return; // el borrado es una llamada de red: evita el doble click
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const btn = {
    height: 30, padding: "0 12px", border: "1px solid var(--border)", background: "white",
    borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", color: "var(--fg)",
  };

  return (
    <div onClick={close} onKeyDown={e => { if (e.key === "Escape") close(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 600,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        style={{
          width: 400, maxWidth: "100%", background: "white", borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,.22)", border: "1px solid var(--border)",
        }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ padding: 16, fontSize: 12.5, color: "var(--fg)", lineHeight: 1.5 }}>{message}</div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button ref={cancelRef} onClick={close} disabled={busy} style={btn}>
            {window.I18N.t("connectors.cancel", "Cancel")}
          </button>
          <button onClick={confirm} disabled={busy}
            style={{ ...btn, background: "var(--err)", color: "white", borderColor: "var(--err)", opacity: busy ? 0.6 : 1 }}>
            {busy
              ? window.I18N.t("ui.confirm.deleting", "Deleting…")
              : (confirmLabel || window.I18N.t("ui.confirm.delete", "Delete"))}
          </button>
        </div>
      </div>
    </div>
  );
}

window.ConfirmModal = ConfirmModal;
