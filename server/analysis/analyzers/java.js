function analyze(ctx) {
  const findings = [];
  const pom = ctx.files.find((file) => /(^|\/)pom\.xml$/i.test(file.path));
  const gradle = ctx.files.find((file) => /(^|\/)build\.gradle(?:\.kts)?$/i.test(file.path));

  if (!pom && !gradle) {
    findings.push(ctx.finding("java.build-tool", "dependencies", "medium",
      "No se detectó Maven o Gradle", "El código Java no tiene un archivo de construcción reconocido.",
      "Declara dependencias y construcción mediante Maven o Gradle.", null, null, "java"));
  }
  if (pom && !ctx.files.some((file) => /(^|\/)mvnw(?:\.cmd)?$/i.test(file.path))) {
    findings.push(ctx.finding("java.maven-wrapper", "delivery", "low",
      "Falta Maven Wrapper", "La versión de Maven puede variar entre desarrolladores y CI.",
      "Incluye mvnw, mvnw.cmd y .mvn/wrapper para una construcción reproducible.", pom.path, null, "java"));
  }
  if (gradle && !ctx.files.some((file) => /(^|\/)gradlew(?:\.bat)?$/i.test(file.path))) {
    findings.push(ctx.finding("java.gradle-wrapper", "delivery", "low",
      "Falta Gradle Wrapper", "La versión de Gradle puede variar entre desarrolladores y CI.",
      "Incluye gradlew, gradlew.bat y gradle/wrapper para una construcción reproducible.", gradle.path, null, "java"));
  }

  const buildText = [pom, gradle].filter(Boolean).map((file) => ctx.read(file.path) || "").join("\n");
  if (buildText && !/(?:java\.version|maven\.compiler\.(?:release|source)|sourceCompatibility|JavaLanguageVersion\.of)/i.test(buildText)) {
    findings.push(ctx.finding("java.runtime-version", "dependencies", "medium",
      "Versión de Java no declarada", "No es posible determinar de forma confiable el runtime objetivo.",
      "Configura Java toolchains, maven.compiler.release o sourceCompatibility.", (pom || gradle)?.path, null, "java"));
  }

  for (const file of ctx.files.filter((item) => /(^|\/)(application|bootstrap)\.(?:properties|ya?ml)$/i.test(item.path) && item.size <= 256 * 1024)) {
    const content = ctx.read(file.path) || "";
    const match = /management\.endpoints\.web\.exposure\.include\s*[:=]\s*["']?\*["']?/i.exec(content);
    if (!match) continue;
    findings.push(ctx.finding(`java.actuator-exposure.${file.path}`, "security", "high",
      "Todos los endpoints Actuator están expuestos", "La configuración incluye el comodín de endpoints de administración.",
      "Expón únicamente los endpoints necesarios y protégelos con autenticación y una red restringida.", file.path, ctx.lineOf(content, match.index), "java"));
  }
  return findings;
}

module.exports = { id: "java", supports: (technologies) => technologies.includes("java"), analyze };
