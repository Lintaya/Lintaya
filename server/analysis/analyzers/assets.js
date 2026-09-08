function analyze(ctx) {
  const findings = [];
  for (const file of ctx.files.filter((item) => item.path.endsWith(".svg") && item.size <= 1024 * 1024)) {
    const content = ctx.read(file.path);
    if (!content) continue;
    const script = /<script\b|\bon(?:load|error|click)\s*=/i.exec(content);
    if (script) findings.push(ctx.finding(`assets.active-svg.${file.path}`, "security", "high",
      "SVG con contenido activo", "El recurso contiene scripts o manejadores de eventos que pueden ejecutarse al embeberlo.",
      "Elimina el contenido activo o sanitiza el SVG antes de publicarlo.", file.path, ctx.lineOf(content, script.index), "assets"));
  }
  return findings;
}

module.exports = {
  id: "assets",
  supports: (_technologies, classification) => classification.types.some((type) => type.id === "assets"),
  analyze,
};
