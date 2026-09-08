function analyze(ctx) {
  const findings = [];
  const terraform = ctx.files.filter((file) => file.path.endsWith(".tf") && file.size <= 1024 * 1024);
  if (terraform.length) {
    if (!ctx.files.some((file) => /(^|\/)\.terraform\.lock\.hcl$/i.test(file.path))) {
      findings.push(ctx.finding("infrastructure.terraform-lock", "dependencies", "medium",
        "Falta el lockfile de Terraform", "Las versiones de providers pueden variar entre inicializaciones.",
        "Genera y versiona .terraform.lock.hcl.", null, null, "terraform"));
    }
    const combined = terraform.map((file) => ctx.read(file.path) || "").join("\n");
    if (!/required_version\s*=/.test(combined)) {
      findings.push(ctx.finding("infrastructure.terraform-version", "dependencies", "medium",
        "Versión de Terraform no declarada", "El proyecto no limita la versión de Terraform compatible.",
        "Declara required_version dentro del bloque terraform.", terraform[0].path, null, "terraform"));
    }
  }

  for (const file of ctx.files.filter((item) => /\.ya?ml$/i.test(item.path) && item.size <= 512 * 1024)) {
    const content = ctx.read(file.path);
    if (!content || !/^apiVersion:\s*\S+/m.test(content) || !/^kind:\s*\S+/m.test(content)) continue;
    const latest = /image:\s*["']?([^\s"']+):latest\b/i.exec(content);
    if (latest) findings.push(ctx.finding(`infrastructure.latest-image.${file.path}`, "dependencies", "medium",
      "Imagen de contenedor con tag latest", `La imagen ${latest[1]}:latest puede cambiar sin control.`,
      "Fija una versión concreta y, para producción, considera usar un digest.", file.path, ctx.lineOf(content, latest.index), "kubernetes"));
    const privileged = /privileged:\s*true\b/i.exec(content);
    if (privileged) findings.push(ctx.finding(`infrastructure.privileged.${file.path}`, "security", "high",
      "Contenedor privilegiado", "El manifiesto concede acceso elevado al host.",
      "Elimina privileged o documenta y restringe estrictamente la excepción.", file.path, ctx.lineOf(content, privileged.index), "kubernetes"));
  }

  for (const file of ctx.files.filter((item) => /(^|\/)Chart\.ya?ml$/i.test(item.path))) {
    const content = ctx.read(file.path) || "";
    if (!/^version:\s*\S+/m.test(content)) findings.push(ctx.finding(`infrastructure.helm-version.${file.path}`, "delivery", "medium",
      "Chart de Helm sin versión", "El chart no declara una versión empaquetable.",
      "Agrega version siguiendo versionado semántico.", file.path, null, "helm"));
  }
  return findings;
}

module.exports = {
  id: "infrastructure",
  supports: (_technologies, classification) => classification.types.some((type) => type.id === "infrastructure"),
  analyze,
};
