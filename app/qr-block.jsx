(function () {
  const ALIGNMENT = [[], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50], [6,30,54], [6,32,58], [6,34,62], [6,26,46,66], [6,26,48,70], [6,26,50,74], [6,30,54,78], [6,30,56,82], [6,30,58,86], [6,34,62,90], [6,28,50,72,94], [6,26,50,74,98], [6,30,54,78,102], [6,28,54,80,106], [6,32,58,84,110], [6,30,58,86,114], [6,34,62,90,118], [6,26,50,74,98,122], [6,30,54,78,102,126], [6,26,52,78,104,130], [6,30,56,82,108,134], [6,34,60,86,112,138], [6,30,58,86,114,142], [6,34,62,90,118,146], [6,30,54,78,102,126,150], [6,24,50,76,102,128,154], [6,28,54,80,106,132,158], [6,32,58,84,110,136,162], [6,26,54,82,110,138,166], [6,30,58,86,114,142,170]];
  if (window.qrcode?.stringToBytesFuncs?.["UTF-8"]) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];

  function protectedModule(row, col, n) {
    const version = Math.round((n - 17) / 4);
    const f = (r, c) => row >= r - 1 && row < r + 8 && col >= c - 1 && col < c + 8;
    if (f(0, 0) || f(0, n - 7) || f(n - 7, 0) || row === 6 || col === 6) return true;
    const positions = ALIGNMENT[version - 1] || [];
    for (const r of positions) for (const c of positions) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
    }
    return false;
  }

  // Techo de superficie que el logo puede tapar, por nivel de corrección.
  //
  // El titular del estándar (L 7% / M 15% / Q 25% / H 30%) es la fracción
  // recuperable cuando se sabe DÓNDE está el daño. Un lector no sabe dónde
  // está el logo: para él son errores de posición desconocida, y Reed-Solomon
  // corrige la mitad de esos que de borrones localizados. El techo utilizable
  // es por tanto la mitad del titular.
  //
  // Sin este tope, logoRect devolvía el mayor rectángulo que cupiera sin pisar
  // un patrón de función — 8 módulos en un símbolo de 25, o sea una placa de
  // 10x10 = 16% — por encima del 12,5% real de Q. El código dejaba de escanear
  // en cuanto se ponía el logo, y sin logo funcionaba.
  const EC_BUDGET = { L: 0.035, M: 0.075, Q: 0.125, H: 0.15 };

  function logoRect(n, wanted = 9, ecLevel = "Q") {
    const budget = EC_BUDGET[ecLevel] || EC_BUDGET.Q;
    for (let side = Math.min(9, wanted); side >= 1; side--) {
      // La placa opaca lleva un módulo de margen por lado: lo que cuenta para
      // el presupuesto es la placa, no el logo.
      if (((side + 2) * (side + 2)) / (n * n) > budget) continue;
      const start = Math.floor((n - side) / 2);
      let safe = true;
      for (let row = start; row < start + side && safe; row++) for (let col = start; col < start + side; col++) if (protectedModule(row, col, n)) safe = false;
      if (safe) return { x: start, y: start, w: side, h: side };
    }
    return null;
  }

  // El nivel de corrección lo decide la app, no el usuario. L/M/Q/H no le dicen
  // nada a nadie que no conozca el formato, y elegir mal rompe el código en
  // silencio (L con logo no escanea). La app tiene los datos para acertar:
  //
  //  - Con logo: H. La placa se come parte del presupuesto (ver EC_BUDGET) y H
  //    es el techo más alto, así que deja el logo más grande y aguanta impresión.
  //  - Sin logo: el nivel más alto que NO agrande el símbolo. Subir de M a Q es
  //    gratis en URLs cortas — mismos módulos, el doble de tolerancia — y solo
  //    se queda en M cuando subir costaría densidad.
  //
  // Lo que la app no puede deducir es si el código acabará impreso. Con logo da
  // igual, porque H ya es el máximo; sin logo un impreso se queda en M o Q. Si
  // algún día eso molesta, la pregunta que hay que hacer es "¿pantalla o
  // impresión?", nunca "¿L, M, Q o H?".
  function autoEcLevel(value, hasLogo) {
    if (hasLogo) return "H";
    const encoder = window.qrcode;
    if (!encoder || !String(value || "").trim()) return "M";
    const moduleCount = level => { const qr = encoder(0, level); qr.addData(String(value)); qr.make(); return qr.getModuleCount(); };
    try {
      const base = moduleCount("M");
      for (const level of ["H", "Q"]) if (moduleCount(level) === base) return level;
    } catch (error) { return "M"; }
    return "M";
  }

  // La marca de assets/brand es de 1298x1298 y en el símbolo se dibuja a unos
  // 54 px en pantalla y ~110 px en el PNG exportado. Incrustarla tal cual metía
  // 491 KB de base64 en cada SVG — el fichero salía de 508 KB cuando el código
  // en sí son 17 KB — y ese string se quedaba vivo en memoria por cada bloque
  // QR en pantalla. Se reescala una vez a LOGO_PX y se cachea ya reescalada.
  // 256 deja margen sobre el tamaño de exportación actual sin volver a inflar.
  const LOGO_PX = 256;
  const logoCache = new Map();

  function useLogoData(variant, enabled) {
    const [data, setData] = React.useState(() => logoCache.get(variant) || null);
    React.useEffect(() => {
      if (!enabled) { setData(null); return; }
      if (logoCache.has(variant)) { setData(logoCache.get(variant)); return; }
      let cancelled = false;
      fetch(`assets/brand/lintaya-mark-${variant}.png`)
        .then(response => response.blob())
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          const canvas = document.createElement("canvas");
          canvas.width = LOGO_PX; canvas.height = LOGO_PX;
          const context = canvas.getContext("2d");
          context.imageSmoothingQuality = "high";
          context.drawImage(bitmap, 0, 0, LOGO_PX, LOGO_PX);
          if (bitmap.close) bitmap.close();
          const value = canvas.toDataURL("image/png");
          logoCache.set(variant, value);
          if (!cancelled) setData(value);
        })
        .catch(() => { if (!cancelled) setData(null); });
      return () => { cancelled = true; };
    }, [variant, enabled]);
    return data;
  }

  // Íconos para el centro del QR (logo.source "icon"). Trazos propios en una
  // grilla de 24, sin relleno: se dibujan en vector con el color de los
  // módulos, así que no hay imagen que cargar, el SVG exportado sigue siendo
  // autocontenido y combinan con cualquier color que se elija para el código.
  // Solo formas genéricas — nada de marcas de terceros.
  const QR_LOGO_ICONS = [
    // El faro del símbolo de carta náutica (U+26EF): el foco y sus rayos
    // mandan, y la torre queda como un trazo fino que los sostiene.
    { key: "lighthouse", label: "Lighthouse",  d: "M14 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0M12 2.4v1.3M7.8 3.5l1 1.2M16.2 3.5l-1 1.2M5.6 6.4l1.4.4M18.4 6.4l-1.4.4M10.4 8.7L8.8 19M13.6 8.7L15.2 19M7.4 19h9.2" },
    // Realidad aumentada: un cubo dentro de las esquinas de un visor.
    { key: "ar",         label: "AR",          d: "M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M12 7l5 2.5v5L12 17l-5-2.5v-5zM7 9.5l5 2.5 5-2.5M12 12v5" },
    { key: "heart",     label: "Heart",       d: "M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z" },
    { key: "restaurant", label: "Restaurant",  d: "M7 3v6a2 2 0 0 0 4 0V3M9 3v18M17 21V3c-2 1.5-3 4-3 7v3h3" },
    { key: "coffee",     label: "Coffee",      d: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3" },
    { key: "menu",       label: "Menu",        d: "M6 3h9l4 4v14H6zM9 7h3M9 11h7M9 15h7" },
    { key: "wifi",       label: "Wi-Fi",       d: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 20h.01" },
    { key: "location",   label: "Location",    d: "M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
    { key: "phone",      label: "Phone",       d: "M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z" },
    { key: "mail",       label: "Email",       d: "M3 6h18v12H3zM3 6l9 7 9-7" },
    { key: "link",       label: "Link",        d: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" },
    { key: "user",       label: "Contact",     d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" },
    { key: "shop",       label: "Shop",        d: "M3 4h2l2.5 11h11L21 7H6.5M9 20h.01M18 20h.01" },
    { key: "star",       label: "Review",      d: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" },
    { key: "calendar",   label: "Event",       d: "M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" },
    { key: "ticket",     label: "Ticket",      d: "M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10" },
    { key: "music",      label: "Music",       d: "M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" },
    { key: "play",       label: "Video",       d: "M6 4l13 8-13 8z" },
    { key: "gift",       label: "Gift",        d: "M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0" },
    { key: "home",       label: "Home",        d: "M3 11l9-8 9 8M5 9.5V21h14V9.5" },
    { key: "info",       label: "Info",        d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" },
    { key: "payment",    label: "Payment",     d: "M3 6h18v12H3zM3 10h18M7 15h3" },
  ];
  const QR_LOGO_ICON_BY_KEY = Object.fromEntries(QR_LOGO_ICONS.map(icon => [icon.key, icon]));

  // ¿Este logo tapa módulos? Un "icon" con una clave que ya no existe se
  // trata como sin logo, para no recortar una placa vacía en el código.
  function qrHasLogo(logo) {
    return logo?.source === "brand" || (logo?.source === "icon" && !!QR_LOGO_ICON_BY_KEY[logo.icon]);
  }

  function QRLogoIconGlyph({ iconKey, color, size = 18 }) {
    const icon = QR_LOGO_ICON_BY_KEY[iconKey];
    if (!icon) return null;
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon.d}/></svg>;
  }

  function QRCodeSvg({ value, style = {}, logo = { source: "none" }, size = 220 }) {
    const encoder = window.qrcode;
    const logoVariant = logo.variant === "dark" ? "dark" : "light";
    const logoData = useLogoData(logoVariant, logo.source === "brand");
    const logoIcon = logo.source === "icon" ? QR_LOGO_ICON_BY_KEY[logo.icon] : null;
    if (!encoder) return <div role="alert">{window.I18N.t("ui.blocks.qrUnavailable", "QR encoder unavailable")}</div>;
    const qr = encoder(0, style.ecLevel || "M"); qr.addData(String(value || "")); qr.make();
    const n = qr.getModuleCount(); const quiet = 4; const total = n + quiet * 2; const fg = style.fgColor || "#000000"; const bg = style.bgColor || "#ffffff";
    let path = "";
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    const knockout = qrHasLogo(logo) ? logoRect(n, style.logoModules || 9, style.ecLevel || "M") : null;
    return <svg role="img" aria-label={window.I18N.t("ui.blocks.qrAria", "QR code")} viewBox={`0 0 ${total} ${total}`} width={size} height={size} shapeRendering="crispEdges" style={{ background: bg, display: "block"}}><rect width={total} height={total} fill={bg}/><path d={path} fill={fg}/>{knockout && <><rect x={knockout.x + quiet - 1} y={knockout.y + quiet - 1} width={knockout.w + 2} height={knockout.h + 2} fill={bg}/>{logoData && <image href={logoData} x={knockout.x + quiet} y={knockout.y + quiet} width={knockout.w} height={knockout.h}/>}{logoIcon && <svg x={knockout.x + quiet} y={knockout.y + quiet} width={knockout.w} height={knockout.h} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision"><path d={logoIcon.d}/></svg>}</>}</svg>;
  }

  function QRBlockPanel({ block, panelProps = {} }) {
    const Panel = window.Panel;
    const [dynamicUrl, setDynamicUrl] = React.useState("");
    React.useEffect(() => {
      if (block?.payload?.mode !== "dynamic") { setDynamicUrl(""); return; }
      Promise.all([window.HQ_API.request(`/api/qr-links/${block.payload.linkId}`), window.HQ_API.request("/api/settings/qr-base-url")]).then(([link, settings]) => setDynamicUrl(`${settings.baseUrl}/r/${link.code}`)).catch(() => setDynamicUrl(""));
    }, [block?.payload?.mode, block?.payload?.linkId]);
    const payload = block?.payload?.mode === "dynamic" ? dynamicUrl : (block?.payload?.value || "");
    const download = type => {
      const svg = document.querySelector(`[data-qr-block="${block.id}"] svg`); if (!svg) return;
      const source = new XMLSerializer().serializeToString(svg); const name = block.title || "qr";
      if (type === "svg") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" })); a.download = `${name}.svg`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); return; }
      const image = new Image(); const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      image.onload = () => { const canvas = document.createElement("canvas"); canvas.width = svg.viewBox.baseVal.width * 12; canvas.height = canvas.width; canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); try { const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = `${name}.png`; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0); } catch (error) { window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.blocks.pngDownloadFailed", "PNG download failed"), kind: "error" } })); } }; image.onerror = () => { URL.revokeObjectURL(url); window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.blocks.pngDownloadFailed", "PNG download failed"), kind: "error" } })); }; image.src = url;
    };
    // Las descargas van en la cabecera, en titleExtra, que es la ranura que ya
    // usan los otros blocks para sus controles (ver PlaneTasksPanel) — mismos
    // 22 px de alto, mismo borde y radio 4. Antes eran dos <button> crudos en
    // el cuerpo, sin estilo. El stopPropagation es obligatorio acá: la cabecera
    // del Panel es el asa de arrastre, y sin él pulsar descargar inicia un drag.
    const chipStyle = {
      height: 22, padding: "0 8px", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
      border: "1px solid var(--border)", borderRadius: 4, background: "white",
      color: "var(--fg)", cursor: "pointer", textTransform: "none", letterSpacing: "normal",
    };
    return (
      <Panel
        title={`${block.icon ? block.icon + " " : ""}${block.title}`}
        titleExtra={
          <>
            <button type="button" style={chipStyle} title={window.I18N.t("ui.blocks.downloadSvg", "Download SVG")}
              aria-label={window.I18N.t("ui.blocks.downloadSvg", "Download SVG")}
              onClick={e => { e.stopPropagation(); download("svg"); }}>SVG</button>
            <button type="button" style={chipStyle} title={window.I18N.t("ui.blocks.downloadPng", "Download PNG")}
              aria-label={window.I18N.t("ui.blocks.downloadPng", "Download PNG")}
              onClick={e => { e.stopPropagation(); download("png"); }}>PNG</button>
          </>
        }
        {...panelProps}>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div data-qr-block={block.id} style={{ lineHeight: 0 }}>
            <QRCodeSvg value={payload} style={block.style} logo={block.logo} size={220}/>
          </div>
          <div style={{ width: "100%", fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "center" }}>{payload}</div>
        </div>
      </Panel>
    );
  }
  window.QRCodeSvg = QRCodeSvg; window.QRBlockPanel = QRBlockPanel; window.QRLogoRect = logoRect; window.QRProtectedModule = protectedModule; window.QRAutoEcLevel = autoEcLevel;
  window.QR_LOGO_ICONS = QR_LOGO_ICONS; window.QRHasLogo = qrHasLogo; window.QRLogoIconGlyph = QRLogoIconGlyph;
})();
