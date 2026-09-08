const path = require("node:path");

const DOC_FILE = /\.(?:md|mdx|rst|adoc|asciidoc)$/i;

function analyze(ctx) {
  const findings = [];
  const fileSet = new Set(ctx.files.map((file) => file.path.toLowerCase()));
  const docs = ctx.files.filter((file) => DOC_FILE.test(file.path) && file.size <= 1024 * 1024);
  let brokenCount = 0;
  let structureCount = 0;

  function targetExists(sourcePath, rawTarget) {
    let target = rawTarget.trim().replace(/^<|>$/g, "");
    if (!target || target.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return true;
    target = target.split("#")[0].split("?")[0];
    try { target = decodeURIComponent(target); } catch (_) {}
    const base = target.startsWith("/") ? target.slice(1) : path.posix.join(path.posix.dirname(sourcePath), target);
    const normalized = path.posix.normalize(base).replace(/^\.\//, "").toLowerCase();
    if (normalized.startsWith("../")) return false;
    return fileSet.has(normalized)
      || fileSet.has(`${normalized}/readme.md`)
      || fileSet.has(`${normalized}/readme.mdx`)
      || fileSet.has(`${normalized}/index.md`)
      || fileSet.has(`${normalized}/index.mdx`)
      || fileSet.has(`${normalized}.md`)
      || fileSet.has(`${normalized}.mdx`);
  }

  for (const file of docs) {
    const content = ctx.read(file.path);
    if (content == null) continue;

    const lines = content.split(/\r?\n/);
    let linkFence = false;
    for (let index = 0; index < lines.length; index++) {
      const lineText = lines[index];
      if (/^\s*```/.test(lineText)) { linkFence = !linkFence; continue; }
      if (linkFence) continue;
      const searchableLine = lineText.replace(/(`+)[^`]*\1/g, "");
      const linkRegex = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
      let link;
      while (brokenCount < 30 && (link = linkRegex.exec(searchableLine))) {
        if (targetExists(file.path, link[1])) continue;
        findings.push(ctx.finding(`documentation.broken-link.${file.path}.${index + 1}.${brokenCount}`, "documentation", "medium",
          "Enlace local roto", `El destino "${link[1]}" no existe dentro del repositorio.`,
          "Corrige la ruta o agrega el documento/recurso faltante.", file.path, index + 1, "documentation"));
        brokenCount++;
      }
      if (/!\[\s*\]\([^)]+\)/.test(searchableLine) && structureCount < 20) {
        findings.push(ctx.finding(`documentation.image-alt.${file.path}.${index + 1}`, "accessibility", "low",
          "Imagen sin texto alternativo", "Una imagen Markdown no proporciona una descripción accesible.",
          "Agrega texto alternativo significativo o marca claramente la imagen como decorativa.", file.path, index + 1, "documentation"));
        structureCount++;
      }
    }

    let inFence = false;
    let previousHeading = 0;
    const headings = new Set();
    for (let index = 0; index < lines.length; index++) {
      const lineText = lines[index];
      if (/^\s*```/.test(lineText)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lineText);
      if (!heading) continue;
      const level = heading[1].length;
      if (previousHeading && level > previousHeading + 1 && structureCount < 20) {
        findings.push(ctx.finding(`documentation.heading-jump.${file.path}.${index + 1}`, "documentation", "low",
          "Salto en la jerarquía de encabezados", `El documento pasa de nivel H${previousHeading} a H${level}.`,
          "Mantén una jerarquía consecutiva para facilitar navegación y accesibilidad.", file.path, index + 1, "documentation"));
        structureCount++;
      }
      const normalized = heading[2].toLowerCase().replace(/[`*_]/g, "").trim();
      if (headings.has(normalized) && structureCount < 20) {
        findings.push(ctx.finding(`documentation.duplicate-heading.${file.path}.${index + 1}`, "documentation", "low",
          "Encabezado duplicado", `El encabezado "${heading[2]}" se repite y puede generar anchors ambiguos.`,
          "Usa títulos únicos o agrega contexto al encabezado.", file.path, index + 1, "documentation"));
        structureCount++;
      }
      headings.add(normalized);
      previousHeading = level;
    }
  }

  const hasDocsDir = ctx.files.some((file) => file.path.toLowerCase().startsWith("docs/"));
  const hasDocsIndex = ctx.files.some((file) => /^docs\/(?:readme|index)(?:\.|$)/i.test(file.path));
  if (hasDocsDir && docs.length > 2 && !hasDocsIndex) {
    findings.push(ctx.finding("documentation.docs-index", "documentation", "low",
      "La carpeta docs no tiene índice", "No se encontró docs/README o docs/index para orientar al lector.",
      "Agrega una página inicial con navegación hacia las secciones principales.", "docs", null, "documentation"));
  }
  return findings;
}

module.exports = {
  id: "documentation",
  supports: (_technologies, classification) => classification.types.some((type) => type.id === "documentation"),
  analyze,
};
