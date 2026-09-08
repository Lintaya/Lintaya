function analyze(ctx) {
  const findings = [];
  const dockerfiles = ctx.files.filter((file) => /(^|\/)Dockerfile(?:\.[^/]+)?$/i.test(file.path));
  for (const file of dockerfiles) {
    const content = ctx.read(file.path) || "";
    if (!/^\s*USER\s+\S+/im.test(content)) {
      findings.push(ctx.finding(`docker.user.${file.path}`, "containers", "medium",
        "Contenedor sin usuario explícito", "El proceso probablemente se ejecutará como root dentro del contenedor.",
        "Crea un usuario sin privilegios y selecciónalo con USER antes del comando final.", file.path, null, "docker"));
    }
    const latest = /^\s*FROM\s+[^\s:@]+(?::latest)?\s*(?:AS\s+\S+)?$/im.exec(content);
    if (latest) {
      findings.push(ctx.finding(`docker.latest.${file.path}`, "dependencies", "low",
        "Imagen base sin versión fija", "La imagen base puede cambiar inesperadamente entre builds.",
        "Usa una etiqueta específica y, para mayor reproducibilidad, considera fijar el digest.", file.path, ctx.lineOf(content, latest.index), "docker"));
    }
  }
  if (dockerfiles.length && !ctx.has(".dockerignore")) {
    findings.push(ctx.finding("docker.ignore", "containers", "low",
      "Falta .dockerignore", "El contexto de build puede incluir secretos y archivos innecesarios.",
      "Agrega .dockerignore para excluir .git, dependencias, entornos, secretos y artefactos.", null, null, "docker"));
  }
  return findings;
}

module.exports = { id: "docker", supports: (technologies) => technologies.includes("docker"), analyze };
