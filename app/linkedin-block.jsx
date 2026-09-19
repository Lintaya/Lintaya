// Bloque de publicación de LinkedIn.
//
// Un bloque de kind "linkedin-post" ES la publicación: se crea desde el Block
// Builder como se crea un QR, su contenido vive en el propio registro del
// bloque, y el panel lo dibuja igual que saldría en el feed. El estado de
// publicación (si ya salió, con qué enlace) no vive en el bloque sino en el
// conector, que es quien habló con LinkedIn.
//
// Expone en window:
//   LinkedInPostCard      — la tarjeta, pura, sin estado; la usa también el
//                           Block Builder para su vista previa en vivo.
//   LinkedInPostPanel     — el panel para Home/boards.
//   linkedInLoadProfile   — lee el perfil conectado (nombre, foto, cabecera).
//   LINKEDIN_FEED_BG      — el gris del feed, para que el panel que enmarque la
//                           tarjeta use exactamente el mismo fondo.
(function () {
  const { useState, useEffect, useCallback } = React;

  const MAX_LENGTH  = 3000;  // límite duro de LinkedIn para el cuerpo del post
  const SEE_MORE_AT = 210;   // dónde corta el feed antes de "…ver más"

  // Paleta y tipografía de LinkedIn, a propósito fuera de las variables del
  // tema: esto es una imitación de otra interfaz, y tiene que verse igual
  // aunque Lintaya cambie de colores. Al fijar fondo Y texto a la vez, el
  // contraste queda garantizado sin depender del tema activo.
  const LI = {
    feed:    "#f4f2ee",
    card:    "#ffffff",
    border:  "rgba(0,0,0,.08)",
    text:    "rgba(0,0,0,.9)",
    muted:   "rgba(0,0,0,.6)",
    link:    "#0a66c2",
  };
  // La pila exacta que usa el feed de linkedin.com, medida con getComputedStyle
  // sobre publicaciones reales (sept. 2026). Source Sans es la letra de su marca
  // y de sus sitios de marketing, no la del feed. El orden importa: empieza por
  // system-ui, que en Windows 11 es Segoe UI Variable; poner "Segoe UI" antes
  // daba otro corte de letra y se notaba.
  const LI_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, Oxygen, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"';

  // El feed corta por líneas renderizadas, no por caracteres: 210 es la
  // aproximación que usa todo el mundo y basta para avisar de que la primera
  // frase es lo único que se lee sin hacer clic.
  const cutForPreview = (text) => {
    if (text.length <= SEE_MORE_AT) return text;
    const slice = text.slice(0, SEE_MORE_AT);
    const space = slice.lastIndexOf(" ");
    return slice.slice(0, space > SEE_MORE_AT - 40 ? space : SEE_MORE_AT);
  };

  // Hashtags y enlaces salen en azul en el feed; el grupo de captura hace que
  // split() los conserve como piezas propias.
  const HIGHLIGHT_RE = /(https?:\/\/\S+|#[\p{L}\p{N}_]+)/gu;

  // Se cuenta por puntos de codigo, no por unidades UTF-16: un emoji es UN
  // caracter para LinkedIn, y el servidor valida con este mismo criterio. Con
  // .length un post de emojis se marcaria como pasado de largo sin estarlo.
  const countChars = (text) => [...String(text || "")].length;

  // El enlace no sale como tarjeta: LinkedIn lo publica al final del texto
  // (server/connectors/community/linkedin/client.js, composeCommentary). La vista
  // previa y el contador usan exactamente esta composición, para enseñar y medir
  // lo mismo que se va a enviar.
  const composeText = (body, link) => {
    const text = String(body || "");
    const url = link ? String(link).trim() : "";
    if (!url || text.includes(url)) return text;
    return text.trimEnd() ? `${text.trimEnd()}\n\n${url}` : url;
  };

  const t = (key, fallback, params) => window.I18N.t(key, fallback, params);

  const linkedInLoadProfile = (connectorId) =>
    window.HQ_API.request(`/api/connectors/${connectorId}/profile`).catch(() => null);

  // Iconos de trazo en lugar de emoji: los emoji salen en color y con la
  // métrica de cada sistema, y rompían el parecido con la barra real.
  function Glyph({ d, size = 18, fill = false }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
        fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        {Array.isArray(d) ? d.map((part, i) => <path key={i} d={part} />) : <path d={d} />}
      </svg>
    );
  }

  const ICON = {
    like:    "M7 10.5v9H4.6A1.6 1.6 0 0 1 3 17.9v-5.8a1.6 1.6 0 0 1 1.6-1.6H7zm0 0 3.7-6.9a1.9 1.9 0 0 1 2.8 1.7v3.6h4.9a1.8 1.8 0 0 1 1.78 2.1l-1.05 6A1.8 1.8 0 0 1 17.35 19.5H7z",
    comment: "M20.5 11.6a7.6 7.6 0 0 1-11.2 6.7L4 20l1.75-5.1A7.6 7.6 0 1 1 20.5 11.6z",
    repost:  ["M16.5 2.5 20.5 6.5l-4 4", "M3.5 12.5v-2.5a4 4 0 0 1 4-4h13", "M7.5 21.5l-4-4 4-4", "M20.5 11.5v2.5a4 4 0 0 1-4 4h-13"],
    send:    ["M21.5 2.5 10.5 13.5", "M21.5 2.5 14.5 21.5l-3.5-8-8-3.5 18.5-7.5z"],
    globe:   ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3.2 12h17.6", "M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z"],
  };

  // Hashtags y enlaces en azul de LinkedIn, igual que en el feed: es la
  // diferencia visual que hace que un borrador "parezca" el post final.
  function BodyText({ text }) {
    const parts = String(text).split(HIGHLIGHT_RE);
    return (
      <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {parts.map((part, i) => part.startsWith("#") || /^https?:\/\//.test(part)
          ? <span key={i} style={{ color: LI.link, fontWeight: 600 }}>{part}</span>
          : <React.Fragment key={i}>{part}</React.Fragment>)}
      </span>
    );
  }

  function Avatar({ picture, name }) {
    const initials = (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    const base = { width: 48, height: 48, borderRadius: "50%", flexShrink: 0 };
    if (picture) return <img src={picture} alt="" style={{ ...base, objectFit: "cover" }} />;
    return (
      <div aria-hidden="true" style={{
        ...base, background: "#e9e5df", color: LI.muted,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, fontWeight: 700,
      }}>{initials}</div>
    );
  }

  // Sin estado propio salvo el "ver más": así sirve igual en la vista previa del
  // Block Builder, que redibuja en cada tecla, que en el panel ya guardado.
  //
  // Lo que NO lleva, a propósito: contador de reacciones ni de comentarios. Una
  // publicación sin publicar no tiene ninguno, y LinkedIn tampoco da esas cifras
  // para un perfil personal — inventarlas para que la tarjeta luzca más llena
  // sería enseñar un dato falso.
  function LinkedInPostCard({ profile, body, link, timeLabel, framed = true }) {
    const [expanded, setExpanded] = useState(false);
    const text = composeText(body, link);
    const clipped = !expanded && text.length > SEE_MORE_AT;
    const shown = clipped ? cutForPreview(text) : text;

    const action = {
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "10px 4px", color: LI.muted, fontSize: 13.5, fontWeight: 600,
    };

    const card = (
      <div style={{
        background: LI.card, border: `1px solid ${LI.border}`, borderRadius: 8,
        fontFamily: LI_FONT, color: LI.text, overflow: "hidden",
      }}>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px 0", alignItems: "flex-start" }}>
          <Avatar picture={profile?.picture} name={profile?.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: "20px" }}>
              {profile?.name || t("ui.linkedin.yourName", "Your name")}
            </div>
            <div style={{ fontSize: 12, color: LI.muted, lineHeight: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {profile?.headline || <em>{t("ui.linkedin.headlineMissing", "Add your headline in the connector settings")}</em>}
            </div>
            <div style={{ fontSize: 12, color: LI.muted, lineHeight: "16px", display: "flex", alignItems: "center", gap: 4 }}>
              <span>{timeLabel || t("ui.linkedin.now", "Now")}</span>
              <span aria-hidden="true">·</span>
              <Glyph d={ICON.globe} size={13} />
            </div>
          </div>
          <div aria-hidden="true" style={{ color: LI.muted, fontSize: 18, lineHeight: "18px", letterSpacing: 1, padding: "0 2px" }}>···</div>
        </div>

        <div style={{ padding: "10px 16px 12px", fontSize: 14, lineHeight: "20px" }}>
          {text
            ? <>
                <BodyText text={shown} />
                {clipped && <>
                  <span style={{ color: LI.muted }}> </span>
                  <button type="button" onClick={() => setExpanded(true)}
                    style={{ background: "none", border: 0, padding: 0, font: "inherit", color: LI.muted, cursor: "pointer" }}>
                    …{t("ui.linkedin.seeMore", "more")}
                  </button>
                </>}
              </>
            : <span style={{ color: LI.muted }}>{t("ui.linkedin.emptyPreview", "Your post will appear here")}</span>}
        </div>

        {/* Barra decorativa: no hace nada, pero sin ella la tarjeta no se lee
            como una publicación de LinkedIn, que es justo lo que se pidió. */}
        <div aria-hidden="true" style={{ display: "flex", borderTop: `1px solid ${LI.border}`, padding: "2px 8px" }}>
          <div style={action}><Glyph d={ICON.like} /> {t("ui.linkedin.like", "Like")}</div>
          <div style={action}><Glyph d={ICON.comment} /> {t("ui.linkedin.comment", "Comment")}</div>
          <div style={action}><Glyph d={ICON.repost} /> {t("ui.linkedin.repost", "Repost")}</div>
          <div style={action}><Glyph d={ICON.send} /> {t("ui.linkedin.send", "Send")}</div>
        </div>
      </div>
    );

    if (!framed) return card;
    // En el feed la tarjeta no se estira: se queda en unos 555 px. Dejarla
    // crecer hasta el ancho del panel deformaba el corte de las líneas, que es
    // justo lo que esta vista previa sirve para juzgar.
    return (
      <div style={{ background: LI.feed, padding: 12, borderRadius: 10 }}>
        <div style={{ maxWidth: 555 }}>{card}</div>
      </div>
    );
  }

  function LinkedInPostPanel({ block, panelProps = {} }) {
    window.I18N.useLocale();
    const Panel = window.Panel;
    const connectorId = block.connectorId || "linkedin";
    const body = block.payload?.body || "";
    const link = block.payload?.link || "";

    const [profile, setProfile] = useState(null);
    const [status, setStatus]   = useState(null);
    const [busy, setBusy]       = useState(false);
    const [error, setError]     = useState(null);

    // El servidor responde con un código estable (linkedin-…) en el mensaje;
    // `err.code` es la categoría genérica del error HTTP y no sirve para esto.
    const codeOf = (value) => [value?.message, value?.code, value]
      .find(c => typeof c === "string" && c.startsWith("linkedin-"));
    const message = (err) => {
      const code = codeOf(err);
      return code ? t(`ui.linkedin.error.${code}`, code) : (err?.message || String(err));
    };

    const loadStatus = useCallback(() =>
      window.HQ_API.request(`/api/connectors/${connectorId}/posts/${block.id}`)
        .then(setStatus)
        .catch(() => setStatus(null)), [connectorId, block.id]);

    useEffect(() => {
      linkedInLoadProfile(connectorId).then(setProfile);
      loadStatus();
      // El titular se edita en la configuracion del conector: al guardarla, la
      // tarjeta tiene que enterarse sin recargar la pagina.
      const onChanged = (e) => {
        if (!e.detail?.id || e.detail.id === connectorId) linkedInLoadProfile(connectorId).then(setProfile);
      };
      window.addEventListener("hq:connector-config-changed", onChanged);
      return () => window.removeEventListener("hq:connector-config-changed", onChanged);
    }, [connectorId, loadStatus]);

    const publish = async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.HQ_API.request(
          `/api/connectors/${connectorId}/posts/${block.id}/publish`, { method: "POST" });
        setStatus(result);
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("ui.linkedin.publishedToast", "Published on LinkedIn"), kind: "ok" } }));
      } catch (e) {
        setError(message(e));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: message(e), kind: "error" } }));
        loadStatus();
      } finally { setBusy(false); }
    };

    // Solo el usuario puede comprobar en su perfil si el post llegó a salir.
    // Si dice que no, se libera el bloque; si salió, lo correcto es no tocarlo.
    // Borrado a mano en LinkedIn: Lintaya no puede comprobarlo, asi que lo dice
    // el usuario. Solo se olvida el registro local; LinkedIn no se toca.
    const forgetPublished = async () => {
      if (!window.confirm(t("ui.linkedin.forgetConfirm", "Mark this post as deleted on LinkedIn? The block becomes a draft again and you can publish it once more. Nothing is sent to LinkedIn."))) return;
      setBusy(true);
      try {
        const next = await window.HQ_API.request(
          `/api/connectors/${connectorId}/posts/${block.id}/forget-published`, { method: "POST" });
        setStatus(next);
        setError(null);
      } catch (e) { setError(message(e)); }
      finally { setBusy(false); }
    };

    const dismissUnconfirmed = async () => {
      setBusy(true);
      try {
        const next = await window.HQ_API.request(
          `/api/connectors/${connectorId}/posts/${block.id}/dismiss-unconfirmed`, { method: "POST" });
        setStatus(next);
        setError(null);
      } catch (e) { setError(message(e)); }
      finally { setBusy(false); }
    };

    const state = status?.status || "unpublished";
    const published = state === "published";
    const blocked = state === "unconfirmed" || state === "publishing";
    const length = countChars(composeText(body, link));
    const canPublish = profile?.connected && body.trim() && length <= MAX_LENGTH && !busy && !published && !blocked;

    const btn = {
      height: 28, padding: "0 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
      border: "1px solid var(--border)", borderRadius: 5, background: "white", color: "var(--fg)", cursor: "pointer",
    };

    return (
      <Panel title={`${block.icon ? block.icon + " " : ""}${block.title}`} {...panelProps}>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <LinkedInPostCard
            profile={profile}
            body={body}
            link={link}
            timeLabel={published && status?.publishedAt ? window.I18N.formatWhen(status.publishedAt) : null} />

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: length > MAX_LENGTH ? "var(--err)" : "var(--muted-fg)" }}>
              {length}/{MAX_LENGTH}
            </span>

            {published ? (
              <a href={status.postUrl} target="_blank" rel="noreferrer"
                style={{ ...btn, marginLeft: "auto", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                {t("ui.linkedin.viewOnLinkedIn", "View on LinkedIn")}
              </a>
            ) : (
              <button type="button" disabled={!canPublish} onClick={publish}
                style={{ ...btn, marginLeft: "auto", opacity: canPublish ? 1 : .5, cursor: canPublish ? "pointer" : "default" }}>
                {busy || state === "publishing" ? t("ui.linkedin.publishing", "Publishing…") : t("ui.linkedin.publish", "Publish")}
              </button>
            )}
          </div>

          {published && (
            <button type="button" onClick={forgetPublished} disabled={busy}
              style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, font: "inherit", fontSize: 11.5, color: "var(--muted-fg)", textDecoration: "underline", cursor: "pointer" }}>
              {t("ui.linkedin.forgetPublished", "I deleted it on LinkedIn")}
            </button>
          )}

          {/* Editar el bloque después de publicarlo no cambia lo que ya salió:
              decirlo evita creer que LinkedIn se actualizó solo. */}
          {published && status?.staleContent && (
            <div style={{ fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.5 }}>
              {t("ui.linkedin.staleContent", "This block was edited after publishing. LinkedIn still shows the original text.")}
            </div>
          )}

          {state === "unconfirmed" && (
            <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11.5, color: "var(--err)", lineHeight: 1.5 }}>
              {t("ui.linkedin.error.linkedin-publish-unconfirmed", "A publish attempt was interrupted. Check your LinkedIn profile before trying again to avoid a duplicate.")}
              <button type="button" onClick={dismissUnconfirmed} disabled={busy}
                style={{ ...btn, alignSelf: "flex-start", height: 26, fontSize: 11.5 }}>
                {t("ui.linkedin.dismissUnconfirmed", "I checked: it was not published")}
              </button>
            </div>
          )}

          {/* Un rechazo claro de LinkedIn (no una caída) se puede reintentar. */}
          {state === "failed" && status?.error && !error && (
            <div role="alert" style={{ fontSize: 11.5, color: "var(--err)", lineHeight: 1.5 }}>
              {message(status.error)}
            </div>
          )}

          {!profile?.connected && (
            <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>
              {t("ui.linkedin.notConnected", "Connect the LinkedIn connector to publish this post.")}
            </div>
          )}

          {!published && !!link && (
            <div style={{ fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.5 }}>
              {t("ui.linkedin.linkWarning", "LinkedIn shows posts with external links to fewer people. Consider putting the link in the first comment instead.")}
            </div>
          )}

          {profile?.connected && profile.expiresInDays != null && profile.expiresInDays <= 10 && (
            <div style={{ fontSize: 11.5, color: "var(--err)" }}>
              {t("ui.linkedin.expiresIn", "The LinkedIn authorization expires in {days} day(s). Reconnect to keep publishing.", { days: profile.expiresInDays })}
            </div>
          )}

          {error && <div role="alert" style={{ fontSize: 12, color: "var(--err)" }}>{error}</div>}
        </div>
      </Panel>
    );
  }

  window.LinkedInPostCard = LinkedInPostCard;
  window.LinkedInPostPanel = LinkedInPostPanel;
  window.linkedInLoadProfile = linkedInLoadProfile;
  window.LINKEDIN_MAX_LENGTH = MAX_LENGTH;
  window.linkedInCountChars = countChars;
  window.linkedInComposeText = composeText;
  window.LINKEDIN_FEED_BG = LI.feed;
})();
