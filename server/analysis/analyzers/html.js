const { isGeneratedArtifactPath } = require("../path-policy");

function analyze(ctx) {
  const findings = [];
  const htmlFiles = ctx.files.filter((file) => !isGeneratedArtifactPath(file.path) && /\.html?$/i.test(file.path) && file.size <= 1024 * 1024).slice(0, 30);
  for (const file of htmlFiles) {
    const content = ctx.read(file.path);
    if (content == null || !/<html\b/i.test(content)) continue;
    if (!/<html\b[^>]*\blang\s*=/i.test(content)) {
      findings.push(ctx.finding(`html.lang.${file.path}`, "accessibility", "low",
        "Documento sin idioma", "El elemento html no declara el atributo lang.",
        "Agrega el idioma principal, por ejemplo <html lang=\"es\">.", file.path, ctx.lineOf(content, content.search(/<html\b/i)), "html"));
    }
    if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(content)) {
      findings.push(ctx.finding(`html.viewport.${file.path}`, "quality", "low",
        "Falta meta viewport", "La página puede no adaptarse correctamente a dispositivos móviles.",
        "Agrega una etiqueta meta viewport apropiada.", file.path, null, "html"));
    }
    if (!/<title\b[^>]*>\s*[^<]+\s*<\/title>/i.test(content)) {
      findings.push(ctx.finding(`html.title.${file.path}`, "accessibility", "low",
        "Página sin título descriptivo", "No se encontró un elemento title con contenido.",
        "Agrega un título único y descriptivo para la página.", file.path, null, "html"));
    }
  }
  return findings;
}

module.exports = { id: "html", supports: (technologies) => technologies.includes("html"), analyze };
