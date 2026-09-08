function analyze(ctx) {
  const findings = [];
  const candidates = ctx.files.filter((file) => /(^|\/)(openapi|swagger|asyncapi)[^/]*\.(?:json|ya?ml)$/i.test(file.path) && file.size <= 2 * 1024 * 1024);

  for (const file of candidates) {
    const content = ctx.read(file.path, 2 * 1024 * 1024) || "";
    let document = null;
    if (file.path.endsWith(".json")) {
      try { document = JSON.parse(content); }
      catch (err) {
        findings.push(ctx.finding(`specification.invalid-json.${file.path}`, "quality", "high",
          "Especificación JSON inválida", `No se pudo interpretar el archivo: ${err.message}`,
          "Corrige la sintaxis JSON antes de publicar o generar clientes.", file.path, null, "specification"));
        continue;
      }
    }

    const isAsync = /asyncapi/i.test(file.path) || document?.asyncapi || /^asyncapi\s*:/m.test(content);
    const hasVersion = isAsync
      ? !!(document?.asyncapi || /^asyncapi\s*:\s*\S+/m.test(content))
      : !!(document?.openapi || document?.swagger || /^(?:openapi|swagger)\s*:\s*\S+/m.test(content));
    const hasInfo = document ? !!document.info : /^info\s*:/m.test(content);
    const hasOperations = isAsync
      ? (document ? !!document.channels : /^channels\s*:/m.test(content))
      : (document ? !!document.paths : /^paths\s*:/m.test(content));

    if (!hasVersion) findings.push(ctx.finding(`specification.version.${file.path}`, "quality", "high",
      "Falta versión del estándar", "No se encontró openapi, swagger o asyncapi con una versión reconocible.",
      "Declara explícitamente la versión de la especificación.", file.path, null, "specification"));
    if (!hasInfo) findings.push(ctx.finding(`specification.info.${file.path}`, "documentation", "medium",
      "Falta metadata info", "La especificación no contiene título y versión de la API.",
      "Agrega info.title, info.version y una descripción útil.", file.path, null, "specification"));
    if (!hasOperations) findings.push(ctx.finding(`specification.operations.${file.path}`, "documentation", "medium",
      isAsync ? "Faltan canales" : "Faltan rutas", "No se detectaron operaciones públicas en el contrato.",
      isAsync ? "Declara los canales y mensajes disponibles." : "Declara las rutas y operaciones disponibles.", file.path, null, "specification"));
  }
  return findings;
}

module.exports = {
  id: "specification",
  supports: (_technologies, classification) => classification.types.some((type) => type.id === "specification"),
  analyze,
};
