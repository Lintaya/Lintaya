function analyze(ctx) {
  const findings = [];
  const manifestNames = /(^|\/)(pyproject\.toml|requirements\.txt|setup\.py|setup\.cfg|Pipfile)$/i;
  const manifests = ctx.files.filter((file) => manifestNames.test(file.path));
  if (!manifests.length) {
    findings.push(ctx.finding("python.manifest", "dependencies", "medium",
      "Dependencias Python no declaradas", "Se detectó código Python pero no un manifiesto de dependencias conocido.",
      "Declara dependencias en pyproject.toml o en un archivo equivalente.", null, null, "python"));
  }

  const requirementsFile = manifests.find((file) => /(^|\/)requirements\.txt$/i.test(file.path));
  if (requirementsFile) {
    const content = ctx.read(requirementsFile.path) || "";
    const unpinned = content.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index: index + 1 }))
      .filter(({ line }) => line && !line.startsWith("#") && !line.startsWith("-") && !/[<>=~!]=?/.test(line));
    if (unpinned.length) {
      findings.push(ctx.finding("python.unpinned", "dependencies", "medium",
        `${unpinned.length} dependencia(s) sin versión`, "Las instalaciones pueden producir resultados distintos con el tiempo.",
        "Fija o limita versiones y utiliza un proceso reproducible para actualizar dependencias.", requirementsFile.path, unpinned[0].index, "python"));
    }
  }

  const lintConfigured = ctx.files.some((file) => /(^|\/)(ruff\.toml|\.ruff\.toml|\.flake8|pylintrc|\.pylintrc)$/i.test(file.path))
    || manifests.filter((file) => /(^|\/)pyproject\.toml$/i.test(file.path))
      .some((file) => /\[(?:tool\.ruff|tool\.pylint|tool\.black)\]/i.test(ctx.read(file.path) || ""));
  if (!lintConfigured) {
    findings.push(ctx.finding("python.lint", "quality", "low",
      "No se detectó lint o formato para Python", "No se encontró configuración conocida de Ruff, Flake8, Pylint o Black.",
      "Configura una herramienta de lint/formato y ejecútala en CI.", null, null, "python"));
  }

  let debugFindings = 0;
  let bareExceptFindings = 0;
  for (const file of ctx.files.filter((item) => item.path.endsWith(".py") && item.size <= 512 * 1024)) {
    const content = ctx.read(file.path);
    if (content == null) continue;
    if (debugFindings < 10) {
      const debug = /\bdebug\s*=\s*True\b/.exec(content);
      if (debug) {
        const line = ctx.lineOf(content, debug.index);
        findings.push(ctx.finding(`python.debug.${file.path}.${line}`, "security", "high",
          "Modo debug habilitado", "El modo debug puede revelar información sensible o habilitar funciones peligrosas.",
          "Desactívalo por defecto y contrólalo mediante configuración segura por entorno.", file.path, line, "python"));
        debugFindings++;
      }
    }
    if (bareExceptFindings < 10) {
      const bare = /^\s*except\s*:\s*(?:#.*)?$/m.exec(content);
      if (bare) {
        const line = ctx.lineOf(content, bare.index);
        findings.push(ctx.finding(`python.bare-except.${file.path}.${line}`, "quality", "low",
          "Excepción demasiado amplia", "Un except sin tipo también captura errores que normalmente deberían detenerse.",
          "Captura excepciones específicas y registra el contexto necesario.", file.path, line, "python"));
        bareExceptFindings++;
      }
    }
  }
  return findings;
}

module.exports = { id: "python", supports: (technologies) => technologies.includes("python"), analyze };
