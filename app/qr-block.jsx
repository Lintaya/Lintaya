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

  function QRCodeSvg({ value, style = {}, logo = { source: "none" }, size = 220 }) {
    const encoder = window.qrcode;
    const logoVariant = logo.variant === "dark" ? "dark" : "light";
    const logoData = useLogoData(logoVariant, logo.source === "brand");
    if (!encoder) return <div role="alert">{window.I18N.t("ui.blocks.qrUnavailable", "QR encoder unavailable")}</div>;
    const qr = encoder(0, style.ecLevel || "M"); qr.addData(String(value || "")); qr.make();
    const n = qr.getModuleCount(); const quiet = 4; const total = n + quiet * 2; const fg = style.fgColor || "#000000"; const bg = style.bgColor || "#ffffff";
    let path = "";
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    const knockout = logo.source === "brand" ? logoRect(n, style.logoModules || 9, style.ecLevel || "M") : null;
    return <svg role="img" aria-label={window.I18N.t("ui.blocks.qrAria", "QR code")} viewBox={`0 0 ${total} ${total}`} width={size} height={size} shapeRendering="crispEdges" style={{ background: bg, display: "block"}}><rect width={total} height={total} fill={bg}/><path d={path} fill={fg}/>{knockout && <><rect x={knockout.x + quiet - 1} y={knockout.y + quiet - 1} width={knockout.w + 2} height={knockout.h + 2} fill={bg}/>{logoData && <image href={logoData} x={knockout.x + quiet} y={knockout.y + quiet} width={knockout.w} height={knockout.h}/>}</>}</svg>;
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
})();
