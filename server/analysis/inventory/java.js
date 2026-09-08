const { component } = require("./helpers");

function xmlValue(xml, tag) {
  const match = new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, "i").exec(xml || "");
  return match?.[1]?.trim() || null;
}

function dependencyVersion(xml, groupId, artifactId) {
  const blocks = String(xml || "").match(/<dependency>[\s\S]*?<\/dependency>/gi) || [];
  const block = blocks.find((item) => item.includes(`<groupId>${groupId}</groupId>`) && item.includes(`<artifactId>${artifactId}</artifactId>`));
  return block ? xmlValue(block, "version") : null;
}

function detect(ctx) {
  if (!ctx.technologies.includes("java")) return [];
  const components = [];
  const pom = ctx.files.find((file) => /(^|\/)pom\.xml$/i.test(file.path));
  const gradle = ctx.files.find((file) => /(^|\/)build\.gradle(?:\.kts)?$/i.test(file.path));

  if (pom) {
    const xml = ctx.read(pom.path) || "";
    const javaVersion = xmlValue(xml, "java.version") || xmlValue(xml, "maven.compiler.release")
      || xmlValue(xml, "maven.compiler.source") || xmlValue(xml, "source");
    if (javaVersion && !javaVersion.startsWith("${")) components.push(component("java", "Java", javaVersion, null, "runtime", pom.path, "medium"));

    const springParent = /<parent>[\s\S]*?<groupId>org\.springframework\.boot<\/groupId>[\s\S]*?<artifactId>spring-boot-starter-parent<\/artifactId>[\s\S]*?<version>\s*([^<]+)\s*<\/version>[\s\S]*?<\/parent>/i.exec(xml)?.[1];
    const springVersion = springParent || xmlValue(xml, "spring-boot.version") || dependencyVersion(xml, "org.springframework.boot", "spring-boot-starter-web");
    if (/org\.springframework\.boot|spring-boot-starter/i.test(xml)) components.push(component("maven", "Spring Boot", springVersion, springVersion ? null : "unresolved", "framework", pom.path, springVersion ? "high" : "low"));

    const quarkusVersion = xmlValue(xml, "quarkus.platform.version") || dependencyVersion(xml, "io.quarkus", "quarkus-bom");
    if (/io\.quarkus/i.test(xml)) components.push(component("maven", "Quarkus", quarkusVersion, quarkusVersion ? null : "unresolved", "framework", pom.path, quarkusVersion ? "high" : "low"));

    const micronautVersion = xmlValue(xml, "micronaut.version");
    if (/io\.micronaut/i.test(xml)) components.push(component("maven", "Micronaut", micronautVersion, micronautVersion ? null : "unresolved", "framework", pom.path, micronautVersion ? "high" : "low"));
  }

  if (gradle) {
    const text = ctx.read(gradle.path) || "";
    const javaVersion = /JavaLanguageVersion\.of\((\d+)\)|sourceCompatibility\s*=\s*["']?(?:JavaVersion\.VERSION_)?([\d_]+)/.exec(text);
    const normalized = (javaVersion?.[1] || javaVersion?.[2] || "").replace(/_/g, ".");
    if (normalized) components.push(component("java", "Java", normalized, null, "runtime", gradle.path, "medium"));
    const spring = /id\s*[\("']+org\.springframework\.boot["']?\)?\s*version\s*["']([^"']+)/i.exec(text)?.[1];
    if (/org\.springframework\.boot|spring-boot-starter/i.test(text)) components.push(component("gradle", "Spring Boot", spring, spring ? null : "unresolved", "framework", gradle.path, spring ? "high" : "low"));
    const quarkus = /id\s*[\("']+io\.quarkus["']?\)?\s*version\s*["']([^"']+)/i.exec(text)?.[1];
    if (/io\.quarkus/i.test(text)) components.push(component("gradle", "Quarkus", quarkus, quarkus ? null : "unresolved", "framework", gradle.path, quarkus ? "high" : "low"));
  }
  return components;
}

module.exports = { detect };
