function analyze(ctx) {
  const findings = [];
  const packageFile = ctx.files.find((file) => file.path.toLowerCase() === "package.json")
    || ctx.files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  const packagePath = packageFile?.path || null;
  const packageText = packagePath ? ctx.read(packagePath) : null;
  let pkg = null;
  const jsFiles = ctx.files.filter((file) => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(file.path) && file.size <= 512 * 1024);
  const needsPackage = jsFiles.some((file) => /\.(?:jsx|ts|tsx|mjs|cjs)$/i.test(file.path))
    || jsFiles.slice(0, 100).some((file) => /\b(?:require\s*\(|module\.exports\b|import\s+.+?\s+from\s+["'][^./])/m.test(ctx.read(file.path) || ""));

  if (packageText != null) {
    try {
      pkg = JSON.parse(packageText);
    } catch (err) {
      findings.push(ctx.finding("javascript.package-json", "quality", "high",
        "package.json inválido", `No se pudo interpretar package.json: ${err.message}`,
        "Corrige el JSON antes de instalar o ejecutar el proyecto.", packagePath, null, "javascript"));
    }
  } else if (needsPackage) {
    findings.push(ctx.finding("javascript.package-json-missing", "dependencies", "medium",
      "Falta package.json", "Se detectó JavaScript o TypeScript sin un manifiesto de paquete en la raíz.",
      "Agrega package.json si el código forma parte de una aplicación o paquete Node.js.", null, null, "javascript"));
  }

  if (pkg) {
    if (!pkg.scripts?.test || /no test specified/i.test(pkg.scripts.test)) {
      findings.push(ctx.finding("javascript.test-script", "testing", "medium",
        "Falta un script de pruebas", "package.json no define un comando de pruebas utilizable.",
        "Agrega un script test que pueda ejecutarse localmente y en CI.", packagePath, null, "javascript"));
    }
    if (!pkg.scripts?.lint) {
      findings.push(ctx.finding("javascript.lint-script", "quality", "low",
        "Falta un script de lint", "package.json no define el script lint.",
        "Configura ESLint u otra herramienta y expónla mediante npm run lint.", packagePath, null, "javascript"));
    }
  }

  const deployable = (ctx.classification?.types || []).some((type) => ["web-app", "api-backend", "cli-desktop"].includes(type.id));
  const hasDependencies = pkg && Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) }).length > 0;
  if (pkg && deployable && hasDependencies && !ctx.files.some((file) => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i.test(file.path))) {
    findings.push(ctx.finding("javascript.lockfile", "dependencies", "medium",
      "Falta un lockfile", "Las versiones transitivas no están fijadas de forma reproducible.",
      "Genera y versiona el lockfile correspondiente al gestor de paquetes utilizado.", null, null, "javascript"));
  }

  return findings;
}

module.exports = { id: "javascript", supports: (technologies) => technologies.includes("javascript"), analyze };
