const path = require("node:path");

const TEXT_FILE = /(?:^|\/)(?:Dockerfile|Makefile|Jenkinsfile)$|\.(?:py|js|jsx|ts|tsx|mjs|cjs|html?|css|scss|json|ya?ml|toml|ini|cfg|conf|env|sh|ps1|md|txt|xml|properties)$/i;

function analyze(ctx) {
  const findings = [];
  const rootFiles = ctx.files.filter((file) => !file.path.includes("/"));
  const typeIds = new Set((ctx.classification?.types || []).map((type) => type.id));
  const executableTypes = ["web-app", "api-backend", "web-library", "cli-desktop"];
  const hasProjectManifest = ctx.files.some((file) => /(^|\/)(package\.json|composer\.json|pyproject\.toml|requirements[^/]*\.txt|pom\.xml|build\.gradle(?:\.kts)?)$/i.test(file.path));
  const hasExecutableStack = (ctx.inventory || []).some((item) => ["runtime", "framework", "ui-library", "cli", "desktop"].includes(item.role));
  const requiresTests = executableTypes.some((type) => typeIds.has(type)) && (hasProjectManifest || hasExecutableStack);
  const requiresCi = requiresTests || typeIds.has("infrastructure");
  const requiresGitignore = ctx.technologies.some((technology) => technology !== "html")
    || typeIds.has("infrastructure")
    || ctx.files.some((file) => file.path.endsWith(".ipynb"));

  if (!ctx.files.some((file) => /^(?:(?:\.github|docs)\/)?readme(?:\.|$)/i.test(file.path))) {
    findings.push(ctx.finding("common.readme", "documentation", "medium",
      "Falta un README", "El repositorio no tiene documentación principal en una ubicación reconocida.",
      "Agrega un README con propósito, instalación, uso, pruebas y contribución."));
  }
  if (!rootFiles.some((file) => /^(?:licen[cs]e|copying)(?:\.|$)/i.test(file.path))) {
    findings.push(ctx.finding("common.license", "documentation", "medium",
      "Falta una licencia", "No se encontró un archivo LICENSE o COPYING en la raíz.",
      "Define una licencia compatible con la forma en que deseas distribuir el proyecto."));
  }
  if (requiresGitignore && !ctx.has(".gitignore")) {
    findings.push(ctx.finding("common.gitignore", "quality", "low",
      "Falta .gitignore", "El repositorio puede incorporar artefactos locales accidentalmente.",
      "Agrega un .gitignore apropiado para las tecnologías detectadas."));
  }

  const hasCi = ctx.files.some((file) =>
    /^\.github\/workflows\/.*\.ya?ml$/i.test(file.path)
    || /^\.gitlab-ci\.ya?ml$/i.test(file.path)
    || /^bitbucket-pipelines\.ya?ml$/i.test(file.path)
    || /^Jenkinsfile$/i.test(file.path));
  if (requiresCi && !hasCi) {
    findings.push(ctx.finding("common.ci", "delivery", "low",
      "No se detectó integración continua", "No hay una configuración conocida de CI en el repositorio.",
      "Ejecuta al menos lint y pruebas en cada cambio mediante GitHub Actions, GitLab CI o Bitbucket Pipelines."));
  }

  const hasTests = ctx.files.some((file) =>
    /(^|\/)(tests?|__tests__)(\/|$)/i.test(file.path)
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/i.test(file.path));
  if (requiresTests && !hasTests) {
    findings.push(ctx.finding("common.tests", "testing", "medium",
      "No se detectaron pruebas", "No se encontraron directorios o archivos de pruebas con nombres convencionales.",
      "Agrega pruebas automatizadas para los flujos críticos y ejecútalas en CI."));
  }

  for (const file of ctx.files) {
    const base = path.posix.basename(file.path).toLowerCase();
    if (/^\.env(?:\.|$)/.test(base) && !/(?:example|sample|template|dist)/.test(base)) {
      findings.push(ctx.finding(`common.env.${file.path}`, "security", "high",
        "Archivo de entorno presente", "Los archivos .env suelen contener credenciales o configuración sensible.",
        "No lo versiones; publica únicamente una plantilla sin secretos.", file.path));
    }
  }

  const secretPatterns = [
    { id: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, title: "Posible clave privada expuesta", severity: "critical" },
    { id: "github-token", regex: /\b(?:gh[opusr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/, title: "Posible token de GitHub expuesto", severity: "critical" },
    { id: "aws-key", regex: /\bAKIA[0-9A-Z]{16}\b/, title: "Posible access key de AWS expuesta", severity: "critical" },
    { id: "generic-secret", regex: /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["']([A-Za-z0-9_./+=-]{12,})["']/i, title: "Posible secreto hardcodeado", severity: "high", ignore: (match) => /example|sample|change|replace|dummy|your|xxxx|test|demo|placeholder/i.test(match[1] || "") },
  ];
  let secretCount = 0;
  for (const file of ctx.files) {
    if (secretCount >= 50 || file.size > 512 * 1024 || !TEXT_FILE.test(file.path)) continue;
    const content = ctx.read(file.path);
    if (content == null) continue;
    for (const pattern of secretPatterns) {
      const match = pattern.regex.exec(content);
      if (!match) continue;
      if (pattern.ignore?.(match)) continue;
      const line = ctx.lineOf(content, match.index);
      findings.push(ctx.finding(`common.${pattern.id}.${file.path}.${line}`, "security", pattern.severity,
        pattern.title, "El contenido coincide con un patrón habitual de credencial.",
        "Verifica el hallazgo, revoca el secreto si es real y usa un almacén de secretos o variables de entorno.", file.path, line));
      secretCount++;
    }
  }

  return findings;
}

module.exports = { id: "common", supports: () => true, analyze };
