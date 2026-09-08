// Correo — módulo completo del conector Outlook Local (COM): redactar/enviar,
// responder/reenviar, ver Recibidos/Enviados/Agenda, y autocompletar
// destinatarios desde Contactos. Cada instancia del conector está amarrada a
// una cuenta (manifest.json: instantiable), así que aquí no hay selector de
// cuenta — el módulo entero ES esa cuenta. Solo funciona si Outlook de
// escritorio está abierto en la MISMA máquina donde corre el server (ver
// server/connectors/development/outlook-local/README.md).
const { useState, useEffect, useCallback, useRef } = React;
const mt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

const toast = (msg, kind = "ok") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, kind } }));

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(window.I18N.dateLocale(), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(window.I18N.dateLocale(), { day: "numeric", month: "short" });
}
function fmtFull(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(window.I18N.dateLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    + " · " + d.toLocaleTimeString(window.I18N.dateLocale(), { hour: "2-digit", minute: "2-digit" });
}
function fmtSize(bytes) {
  if (!bytes) return "0 KB";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function isNow(start, end) {
  const s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e)) return false;
  const now = Date.now();
  return s.getTime() <= now && now <= e.getTime();
}

// ── styled atoms (mirrors the Claude Design "Mail Module" mockup, translated
// to the app's own CSS variables instead of a parallel palette) ────────────
const pillBase = {
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 700,
  letterSpacing: .4, padding: "2px 6px", borderRadius: 4, background: "var(--muted)", flexShrink: 0,
};
function LocalPill({ error }) {
  return (
    <span
      title={error ? window.I18N.t("ui.mail.outlookClosed", "Outlook is not open on the server") : window.I18N.t("ui.mail.localHelp", "Automates desktop Outlook on this machine")}
      style={{ ...pillBase, border: `1px solid ${error ? "color-mix(in srgb,var(--err) 45%,var(--border))" : "var(--border)"}`, color: error ? "var(--err)" : "var(--muted-fg)" }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 2, background: error ? "var(--err)" : "var(--ok)" }} />
      Local
    </span>
  );
}
const iconBtnStyle = { width: 24, height: 24, border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--muted-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };
const btnGhost = { height: 30, padding: "0 12px", borderRadius: 7, border: "1px solid var(--border)", background: "none", color: "var(--fg)", fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" };
const btnPrimary = { ...btnGhost, background: "var(--accent)", borderColor: "var(--accent)", color: "white", fontWeight: 600 };

// ── recipient chips with Contacts autocomplete ──────────────────────────────
function RecipientChips({ chips, onChange, connectorId, placeholder }) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = text.trim();
    if (!q) { setSuggestions([]); return; }
    timer.current = setTimeout(() => {
      window.HQ_API.request(`/api/connectors/${connectorId}/contacts?q=${encodeURIComponent(q)}`)
        .then((r) => setSuggestions(r.items || []))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => clearTimeout(timer.current);
  }, [text, connectorId]);

  const add = (value) => {
    const v = (value || "").trim();
    if (v && !chips.includes(v)) onChange([...chips, v]);
    setText(""); setSuggestions([]);
  };
  const remove = (v) => onChange(chips.filter((c) => c !== v));
  const onKeyDown = (e) => {
    if ((e.key === "Enter" || e.key === ",") && text.trim()) { e.preventDefault(); add(text); }
    else if (e.key === "Backspace" && !text && chips.length) remove(chips[chips.length - 1]);
  };

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", padding: "6px 0" }}>
        {chips.map((c) => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px", fontSize: 11.5, fontFamily: "var(--font-mono)" }}>
            {c}
            <span onClick={() => remove(c)} style={{ cursor: "pointer", color: "var(--muted-fg)", fontSize: 12, lineHeight: 1 }}>×</span>
          </span>
        ))}
        <input
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
          onBlur={() => text.trim() && add(text)}
          placeholder={chips.length ? window.I18N.t("ui.mail.add", "Add…") : placeholder}
          style={{ border: 0, outline: "none", background: "transparent", color: "var(--fg)", font: "inherit", fontSize: 12.5, fontFamily: "var(--font-mono)", flex: 1, minWidth: 90, padding: "2px 0" }}
        />
      </div>
      {suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 30px -12px rgba(0,0,0,.25)", overflow: "hidden" }}>
          {suggestions.map((s) => (
            <div key={s.email} onMouseDown={(e) => { e.preventDefault(); add(s.email); }} style={{ padding: "7px 10px", fontSize: 12, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border)" }}>
              <span><b style={{ fontWeight: 600 }}>{s.name}</b> <span style={{ color: "var(--muted-fg)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{s.email}</span></span>
              <span style={{ color: "var(--muted-fg)", fontSize: 10.5 }}>{mt("mail.contacts", "Contactos")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── minimal rich-text body (bold/italic/list/link via execCommand) ─────────
function RichBody({ html, onChange, minHeight = 120 }) {
  const ref = useRef(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && ref.current) { ref.current.innerHTML = html || ""; initialized.current = true; }
  }, [html]);
  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
    onChange(ref.current.innerHTML);
  };
  const link = () => { const url = window.prompt(window.I18N.t("ui.mail.linkUrl", "Link URL:")); if (url) exec("createLink", url); };
  const tbBtn = { width: 26, height: 24, border: 0, borderRadius: 5, background: "transparent", color: "var(--muted-fg)", cursor: "pointer", fontSize: 12 };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "5px 8px", borderBottom: "1px solid var(--border)", background: "var(--muted)" }}>
        <button type="button" style={tbBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}><b>B</b></button>
        <button type="button" style={tbBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")}><i>I</i></button>
        <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
        <button type="button" style={tbBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}>≡</button>
        <button type="button" style={tbBtn} onMouseDown={(e) => e.preventDefault()} onClick={link}>🔗</button>
      </div>
      <div
        ref={ref} contentEditable suppressContentEditableWarning
        onInput={() => onChange(ref.current.innerHTML)}
        style={{ padding: "10px 12px", fontSize: 12.5, lineHeight: 1.6, minHeight, color: "var(--fg)", outline: "none" }}
      />
    </div>
  );
}

// ── drag & drop attachments — bytes upload to a server temp path, since
// Outlook's COM Attachments.Add() needs a filesystem path, not a browser blob
function AttachDropzone({ attachments, onAdd, onRemove, connectorId }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);

  const upload = async (file) => {
    setUploading((n) => n + 1);
    try {
      const res = await window.HQ_API.request(`/api/connectors/${connectorId}/attachments?filename=${encodeURIComponent(file.name)}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
      });
      onAdd({ name: res.name, size: res.size, tempPath: res.tempPath });
    } catch (e) {
      toast(`✕ ${e.message || window.I18N.t("ui.mail.attachFailed", "Could not attach file")}`, "error");
    } finally {
      setUploading((n) => n - 1);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); [...e.dataTransfer.files].forEach(upload); }}
      style={{
        border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, padding: 10,
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted-fg)",
        background: dragOver ? "color-mix(in srgb,var(--accent) 6%,transparent)" : "transparent",
      }}
    >
      <span style={{ flex: attachments.length ? "0 0 auto" : 1 }}>{window.I18N.t("ui.mail.dropFiles", "Drop files here or")}{" "}
        <span onClick={() => inputRef.current?.click()} style={{ color: "var(--accent)", fontWeight: 500, cursor: "pointer" }}>{mt("mail.select", "selecciona")}</span>
        {uploading > 0 && window.I18N.t("ui.mail.uploading", " · uploading…")}
      </span>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { [...e.target.files].forEach(upload); e.target.value = ""; }} />
      {attachments.map((a) => (
        <span key={a.tempPath} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 7px", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {a.name} · {fmtSize(a.size)}
          <span onClick={() => onRemove(a.tempPath)} style={{ cursor: "pointer", color: "var(--muted-fg)" }}>×</span>
        </span>
      ))}
    </div>
  );
}

// ── compose (new mail) ──────────────────────────────────────────────────────
function ComposeModal({ connectorId, accountLabel, onClose, onSent }) {
  window.I18N?.useLocale();
  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const payload = () => ({
    to: to.join(", "), cc: cc.join(", ") || undefined, bcc: bcc.join(", ") || undefined,
    subject: subject.trim(), body, isHtml: true,
    attachments: attachments.map((a) => a.tempPath),
  });

  const send = async () => {
    if (!to.length) return setError(window.I18N.t("ui.mail.recipientRequired", "A recipient (To) is required."));
    if (!subject.trim()) return setError(window.I18N.t("ui.mail.subjectRequired", "A subject is required."));
    setError(""); setSending(true);
    try {
      await window.HQ_API.request(`/api/connectors/${connectorId}/send`, { method: "POST", body: payload() });
      toast(`✓ Correo enviado a ${to.join(", ")}`, "ok");
      onSent(); onClose();
    } catch (e) {
      setError(e.message || window.I18N.t("ui.mail.sendFailed", "Could not send"));
    } finally { setSending(false); }
  };

  const saveDraft = async () => {
    setError(""); setSaving(true);
    try {
      await window.HQ_API.request(`/api/connectors/${connectorId}/draft`, { method: "POST", body: payload() });
      toast(window.I18N.t("ui.mail.draftSaved", "✓ Saved to Drafts"), "ok");
      onClose();
    } catch (e) {
      setError(e.message || window.I18N.t("ui.mail.saveFailed", "Could not save"));
    } finally { setSaving(false); }
  };

  const busy = sending || saving;
  const fld = { display: "grid", gridTemplateColumns: "52px 1fr", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "1px solid var(--border)", minHeight: 36 };
  const fk = { fontSize: 11, fontWeight: 600, color: "var(--muted-fg)" };
  const inp = { border: 0, background: "transparent", color: "var(--fg)", font: "inherit", fontSize: 12.5, padding: "8px 0", width: "100%", outline: "none" };

  return (
    <div onClick={(e) => e.target === e.currentTarget && !busy && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: 12, width: "min(580px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 15, fontWeight: 650, flex: 1 }}>{mt("mail.new", "New mail")}</span>
          <LocalPill />
          <button onClick={onClose} disabled={busy} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 18, color: "var(--muted-fg)", lineHeight: 1, padding: 2 }}>×</button>
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          <div style={fld}>
            <span style={fk}>{mt("mail.from", "Desde")}</span>
            <span style={{ fontSize: 12, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{accountLabel}</span>
          </div>
          <div style={fld}><span style={fk}>{mt("mail.to", "To")}</span><RecipientChips chips={to} onChange={setTo} connectorId={connectorId} placeholder="destinatario@ejemplo.com" /></div>
          {!showCcBcc ? (
            <div style={{ padding: "6px 14px" }}>
              <button onClick={() => setShowCcBcc(true)} style={{ background: "none", border: 0, color: "var(--accent)", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>+ CC / CCO</button>
            </div>
          ) : (
            <>
              <div style={fld}><span style={fk}>CC</span><RecipientChips chips={cc} onChange={setCc} connectorId={connectorId} placeholder={mt("mail.noRecipients", "Sin destinatarios")} /></div>
              <div style={fld}><span style={fk}>{window.I18N.t("mail.bcc", "BCC")}</span><RecipientChips chips={bcc} onChange={setBcc} connectorId={connectorId} placeholder={mt("mail.noRecipients", "Sin destinatarios")} /></div>
            </>
          )}
          <div style={fld}><span style={fk}>{mt("mail.subject", "Subject")}</span><input style={{ ...inp, fontWeight: 500 }} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>

          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <RichBody html={body} onChange={setBody} />
            <AttachDropzone attachments={attachments} onAdd={(a) => setAttachments((list) => [...list, a])} onRemove={(p) => setAttachments((list) => list.filter((a) => a.tempPath !== p))} connectorId={connectorId} />
          </div>

          {error && (
            <div style={{ margin: "0 14px 14px", fontSize: 12.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,transparent)", border: "1px solid color-mix(in srgb,var(--err) 22%,var(--border))", borderRadius: 8, padding: "9px 12px" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: "11px 14px", borderTop: "1px solid var(--border)", background: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ ...btnGhost, border: 0, color: "var(--muted-fg)" }}>{mt("mail.discard", "Descartar")}</button>
          <span style={{ flex: 1 }} />
          <button onClick={saveDraft} disabled={busy} style={{ ...btnGhost, opacity: busy ? .6 : 1 }}>{saving ? mt("mail.saving", "Guardando…") : mt("mail.saveDraft", "Guardar borrador")}</button>
          <button onClick={send} disabled={busy} style={{ ...btnPrimary, opacity: busy ? .85 : 1, cursor: busy ? "progress" : "pointer" }}>{sending ? mt("mail.sending", "Enviando…") : mt("mail.send", "Enviar")}</button>
        </div>
      </div>
    </div>
  );
}

// ── read a message, with inline Reply/Forward ───────────────────────────────
function ReadModal({ mail, connectorId, onClose, onChanged }) {
  const [mode, setMode] = useState(null); // null | "reply" | "replyAll" | "forward"
  const [body, setBody] = useState("");
  const [fwdTo, setFwdTo] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const markUnread = async () => {
    try {
      await window.HQ_API.request(`/api/connectors/${connectorId}/mail/${mail.id}/read`, { method: "POST", body: { isRead: false } });
      toast(window.I18N.t("ui.mail.unread", "Marked as unread"), "ok");
      onChanged();
    } catch (e) { toast(`✕ ${e.message}`, "error"); }
  };

  const startMode = (next) => { setMode(next); setBody(""); setFwdTo([]); setError(""); };

  const sendReply = async () => {
    setError(""); setSending(true);
    try {
      await window.HQ_API.request(`/api/connectors/${connectorId}/mail/${mail.id}/reply`, {
        method: "POST", body: { body, isHtml: true, replyAll: mode === "replyAll" },
      });
      toast("✓ Respuesta enviada", "ok");
      onClose();
    } catch (e) { setError(e.message || window.I18N.t("ui.mail.replyFailed", "Could not reply")); } finally { setSending(false); }
  };

  const sendForward = async () => {
    if (!fwdTo.length) return setError(window.I18N.t("ui.mail.addRecipient", "Add at least one recipient."));
    setError(""); setSending(true);
    try {
      await window.HQ_API.request(`/api/connectors/${connectorId}/mail/${mail.id}/forward`, {
        method: "POST", body: { to: fwdTo.join(", "), body, isHtml: true },
      });
      toast("✓ Reenviado", "ok");
      onClose();
    } catch (e) { setError(e.message || window.I18N.t("ui.mail.forwardFailed", "Could not forward")); } finally { setSending(false); }
  };

  const fld = { minHeight: 32, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "1px solid var(--border)" };
  const fk = { fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", width: 44, flexShrink: 0 };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: 12, width: "min(600px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 14.5, fontWeight: 650, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.subject}</span>
          <LocalPill />
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 18, color: "var(--muted-fg)", lineHeight: 1, padding: 2 }}>×</button>
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          <div style={fld}><span style={fk}>{window.I18N.t("ui.mail.from", "From")}</span><span style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{mail.from}{mail.fromAddress ? ` <${mail.fromAddress}>` : ""}</span></div>
          <div style={fld}><span style={fk}>{window.I18N.t("ui.mail.to", "To")}</span><span style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{mail.to}</span></div>
          <div style={fld}><span style={fk}>{window.I18N.t("ui.mail.date", "Date")}</span><span style={{ fontSize: 12 }}>{fmtFull(mail.receivedAt)}</span></div>
          <div style={{ padding: "12px 14px", fontSize: 12.5, lineHeight: 1.6, color: "var(--fg)" }}
            dangerouslySetInnerHTML={{ __html: mail.htmlBody || `<p>${(mail.body || "").replace(/\n/g, "<br/>")}</p>` }} />

          {mode && (
            <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {mode === "forward" && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", marginBottom: 4 }}>{window.I18N.t("ui.mail.to", "To")}</div>
                  <RecipientChips chips={fwdTo} onChange={setFwdTo} connectorId={connectorId} placeholder="destinatario@ejemplo.com" />
                </div>
              )}
              <RichBody html={body} onChange={setBody} minHeight={90} />
              {error && (
                <div style={{ fontSize: 12.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,transparent)", border: "1px solid color-mix(in srgb,var(--err) 22%,var(--border))", borderRadius: 8, padding: "9px 12px" }}>{error}</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setMode(null)} disabled={sending} style={{ ...btnGhost, border: 0, color: "var(--muted-fg)" }}>{mt("mail.cancel", "Cancel")}</button>
                <button onClick={mode === "forward" ? sendForward : sendReply} disabled={sending} style={{ ...btnPrimary, opacity: sending ? .85 : 1 }}>
                  {sending ? window.I18N.t("mail.sending", "Sending…") : mode === "forward" ? window.I18N.t("ui.mail.sendForward", "Forward message") : window.I18N.t("ui.mail.sendReply", "Send reply")}
                </button>
              </div>
            </div>
          )}
        </div>

        {!mode && (
          <div style={{ padding: "11px 14px", borderTop: "1px solid var(--border)", background: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={markUnread} style={{ ...btnGhost, border: 0, color: "var(--muted-fg)" }}>{window.I18N.t("ui.mail.markUnread", "Mark as unread")}</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => startMode("forward")} style={btnGhost}>{mt("mail.forward", "Reenviar")}</button>
            <button onClick={() => startMode("reply")} style={btnPrimary}>{mt("mail.reply", "Responder")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── list rows ────────────────────────────────────────────────────────────────
function MailRow({ item, onClick }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.isRead ? "transparent" : "var(--accent)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: item.isRead ? 500 : 700, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.subject}</div>
        <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.from}</div>
      </div>
      {item.isFlagged && <span style={{ color: "var(--warn)", fontSize: 11 }}>★</span>}
      <span style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{fmtWhen(item.receivedAt)}</span>
    </div>
  );
}
function SentRow({ item }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.subject}</div>
        <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.to}</div>
      </div>
      <span style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{fmtWhen(item.sentAt)}</span>
    </div>
  );
}
function AgendaRow({ item }) {
  const now = isNow(item.start, item.end);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--border)", background: now ? "color-mix(in srgb,var(--accent) 6%,transparent)" : "transparent" }}>
      <span style={{ fontSize: 10.5, color: now ? "var(--accent)" : "var(--muted-fg)", fontWeight: now ? 700 : 500, fontFamily: "var(--font-mono)", width: 40, flexShrink: 0 }}>{fmtWhen(item.start)}</span>
      <span style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: now ? "var(--accent)" : "var(--border)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: now ? 700 : 500, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.subject}</div>
        {item.location && <div style={{ fontSize: 11, color: "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.location}</div>}
      </div>
      {now && <span style={{ ...pillBase, border: "1px solid color-mix(in srgb,var(--accent) 45%,var(--border))", color: "var(--accent)" }}>{window.I18N.t("ui.now", "Now")}</span>}
    </div>
  );
}

// ── main view ────────────────────────────────────────────────────────────────
const TABS = [
  { id: "recibidos", label: "Recibidos" },
  { id: "enviados", label: "Enviados" },
  { id: "agenda", label: "Agenda" },
];

function MailView({ connectorId = "outlook-local", onNavigate }) {
  window.I18N?.useLocale();
  const [config, setConfig] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [tab, setTab] = useState("recibidos");
  const [recent, setRecent] = useState([]);
  const [sent, setSent] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [readMail, setReadMail] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [cfg, accs, r, s, a] = await Promise.all([
        window.HQ_API.request(`/api/connectors/${connectorId}/config`),
        window.HQ_API.request(`/api/connectors/${connectorId}/accounts`),
        window.HQ_API.request(`/api/connectors/${connectorId}/recent`),
        window.HQ_API.request(`/api/connectors/${connectorId}/sent`),
        window.HQ_API.request(`/api/connectors/${connectorId}/agenda`),
      ]);
      setConfig(cfg);
      setAccounts(accs.accounts || []);
      setRecent(r.items || []);
      setSent(s.items || []);
      setAgenda(a.items || []);
    } catch (e) {
      setError(e.message || window.I18N.t("ui.mail.connectFailed", "Could not connect to Outlook"));
    } finally {
      setLoading(false);
    }
  }, [connectorId]);

  useEffect(() => { load(); }, [load]);

  const openMail = async (item) => {
    try {
      const mail = await window.HQ_API.request(`/api/connectors/${connectorId}/mail/${item.id}`);
      setReadMail(mail);
      if (!item.isRead) {
        setRecent((list) => list.map((x) => (x.id === item.id ? { ...x, isRead: true } : x)));
        window.HQ_API.request(`/api/connectors/${connectorId}/mail/${item.id}/read`, { method: "POST", body: { isRead: true } }).catch(() => {});
      }
    } catch (e) {
      toast(`✕ ${e.message}`, "error");
    }
  };

  const accountLabel = accounts.find((a) => a.smtpAddress === config?.accountSmtp)?.name
    || config?.accountSmtp || window.I18N.t("ui.mail.defaultMailbox", "profile's default mailbox");
  const unread = recent.filter((x) => !x.isRead).length;

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{mt("mail.title", "Mail")}</h1>
            <LocalPill error={!!error} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-fg)", marginTop: 3, fontFamily: "var(--font-mono)" }}>{accountLabel}</div>
        </div>
        <button onClick={() => setComposeOpen(true)} disabled={!!error} style={{ ...btnPrimary, height: 32, opacity: error ? .5 : 1, cursor: error ? "not-allowed" : "pointer" }}>+ {mt("mail.new", "New mail")}</button>
      </div>

      {error ? (
        <div style={{ textAlign: "center", padding: "40px 20px", border: "1px dashed var(--border)", borderRadius: 10, background: "var(--muted)", marginTop: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{window.I18N.t("ui.mail.outlookClosed", "Outlook is not open on the server")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-fg)", maxWidth: 380, margin: "0 auto 14px", lineHeight: 1.5 }}>{error}</div>
          <button onClick={load} style={btnPrimary}>{mt("mail.retry", "Retry")}</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 14, borderBottom: "1px solid var(--border)" }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                border: 0, background: "none", font: "inherit", fontSize: 12.5, fontWeight: tab === t.id ? 650 : 500,
                color: tab === t.id ? "var(--fg)" : "var(--muted-fg)", padding: "7px 10px", cursor: "pointer",
                borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`, marginBottom: -1,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                {window.I18N.t({ recibidos: "mail.inbox", enviados: "mail.sent", agenda: "mail.agenda" }[t.id], t.label)}
                {t.id === "recibidos" && unread > 0 && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "var(--font-mono)", background: "var(--accent)", color: "white", borderRadius: 999, padding: "1px 5px" }}>{unread}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>{mt("mail.loading", "Loading…")}</div>
          ) : (
            <div>
              {tab === "recibidos" && (recent.length
                ? recent.map((item) => <MailRow key={item.id} item={item} onClick={() => openMail(item)} />)
                : <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>{mt("mail.noRecent", "No recent mail.")}</div>)}
              {tab === "enviados" && (sent.length
                ? sent.map((item) => <SentRow key={item.id} item={item} />)
                : <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>{mt("mail.noSent", "No mail sent today.")}</div>)}
              {tab === "agenda" && (agenda.length
                ? agenda.map((item) => <AgendaRow key={item.id} item={item} />)
                : <div style={{ color: "var(--muted-fg)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>{mt("mail.noAgenda", "No events today.")}</div>)}
            </div>
          )}
        </>
      )}

      {composeOpen && (
        <ComposeModal connectorId={connectorId} accountLabel={accountLabel} onClose={() => setComposeOpen(false)} onSent={load} />
      )}
      {readMail && (
        <ReadModal mail={readMail} connectorId={connectorId} onClose={() => setReadMail(null)} onChanged={load} />
      )}
    </div>
  );
}

window.MailView = MailView;
