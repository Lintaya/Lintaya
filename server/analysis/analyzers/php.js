function analyze(ctx) {
  const findings = [];
  const composerFile = ctx.files.find((file) => file.path.toLowerCase() === "composer.json")
    || ctx.files.find((file) => /(^|\/)composer\.json$/i.test(file.path));

  if (!composerFile) {
    findings.push(ctx.finding("php.composer", "dependencies", "low",
      "No se detectó Composer", "El proyecto PHP no utiliza un manifiesto Composer detectable.",
      "Si la aplicación tiene dependencias, decláralas con Composer para hacer instalaciones reproducibles.", null, null, "php"));
  } else {
    let composer = null;
    try { composer = JSON.parse(ctx.read(composerFile.path) || ""); }
    catch (err) {
      findings.push(ctx.finding("php.composer-invalid", "quality", "high",
        "composer.json inválido", `No se pudo interpretar composer.json: ${err.message}`,
        "Corrige el JSON antes de instalar o desplegar la aplicación.", composerFile.path, null, "php"));
    }
    const rootDir = composerFile.path.includes("/") ? composerFile.path.slice(0, composerFile.path.lastIndexOf("/") + 1) : "";
    if (composer && Object.keys({ ...(composer.require || {}), ...(composer["require-dev"] || {}) }).length && !ctx.has(`${rootDir}composer.lock`)) {
      findings.push(ctx.finding("php.composer-lock", "dependencies", "medium",
        "Falta composer.lock", "Las versiones exactas de dependencias no están fijadas.",
        "Genera y versiona composer.lock para aplicaciones desplegables.", composerFile.path, null, "php"));
    }
    if (composer && !composer.require?.php && !composer.config?.platform?.php) {
      findings.push(ctx.finding("php.runtime-version", "dependencies", "medium",
        "Versión de PHP no declarada", "No es posible evaluar compatibilidad ni ciclo de vida del runtime.",
        "Declara una restricción para php en composer.json.", composerFile.path, null, "php"));
    }
  }

  let displayErrorsCount = 0;
  for (const file of ctx.files.filter((item) => item.path.endsWith(".php") && item.size <= 512 * 1024)) {
    if (displayErrorsCount >= 10) break;
    const content = ctx.read(file.path);
    if (content == null) continue;
    const match = /ini_set\s*\(\s*["']display_errors["']\s*,\s*["'](?:1|on|true)["']\s*\)/i.exec(content);
    if (!match) continue;
    const line = ctx.lineOf(content, match.index);
    findings.push(ctx.finding(`php.display-errors.${file.path}.${line}`, "security", "high",
      "Errores visibles habilitados", "La aplicación podría mostrar trazas o información sensible a los usuarios.",
      "Desactiva display_errors en producción y envía los detalles al sistema de logs.", file.path, line, "php"));
    displayErrorsCount++;
  }
  return findings;
}

module.exports = { id: "php", supports: (technologies) => technologies.includes("php"), analyze };
