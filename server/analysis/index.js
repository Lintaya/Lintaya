const fs = require("node:fs");
const path = require("node:path");
const { scanRepository } = require("./scanner");
const common = require("./analyzers/common");
const python = require("./analyzers/python");
const javascript = require("./analyzers/javascript");
const html = require("./analyzers/html");
const docker = require("./analyzers/docker");
const php = require("./analyzers/php");
const java = require("./analyzers/java");
const documentation = require("./analyzers/documentation");
const specification = require("./analyzers/specification");
const infrastructure = require("./analyzers/infrastructure");
const data = require("./analyzers/data");
const assets = require("./analyzers/assets");
const gitops = require("./analyzers/gitops");
const { buildInventory } = require("./inventory");
const { classifyRepository } = require("./classifier");

const ANALYZERS = [common, python, javascript, php, java, html, docker, documentation, specification, infrastructure, gitops, data, assets];
const SEVERITY_WEIGHT = { critical: 20, high: 8, medium: 3, low: 1, info: 0 };
const SEVERITY_CAP = { critical: 40, high: 32, medium: 18, low: 10, info: 0 };

function detectTechnologies(files) {
  const paths = files.map((file) => file.path.toLowerCase());
  const technologies = [];
  if (paths.some((file) => file.endsWith(".py") || /(^|\/)(pyproject\.toml|requirements\.txt|setup\.py)$/.test(file))) technologies.push("python");
  if (paths.some((file) => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(file) || file === "package.json")) technologies.push("javascript");
  if (paths.some((file) => file.endsWith(".php") || /(^|\/)composer\.(?:json|lock)$/.test(file))) technologies.push("php");
  if (paths.some((file) => file.endsWith(".java") || /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/.test(file))) technologies.push("java");
  if (paths.some((file) => /\.html?$/.test(file))) technologies.push("html");
  if (paths.some((file) => /(^|\/)dockerfile(?:\.|$)/.test(file) || /(^|\/)docker-compose\.ya?ml$/.test(file) || /(^|\/)compose\.ya?ml$/.test(file))) technologies.push("docker");
  return technologies;
}

function createContext(scan, technologies) {
  const fileByLowerPath = new Map(scan.files.map((file) => [file.path.toLowerCase(), file]));
  return {
    root: scan.root,
    files: scan.files,
    technologies,
    has(...names) {
      return names.some((name) => fileByLowerPath.has(String(name).toLowerCase()));
    },
    read(relativePath, maxBytes = 1024 * 1024) {
      if (!relativePath) return null;
      const file = fileByLowerPath.get(String(relativePath).toLowerCase());
      if (!file || file.size > maxBytes) return null;
      const absolute = path.resolve(scan.root, file.path);
      if (absolute !== scan.root && !absolute.startsWith(scan.root + path.sep)) return null;
      try {
        const buffer = fs.readFileSync(absolute);
        if (buffer.includes(0)) return null;
        return buffer.toString("utf8");
      } catch (_) {
        return null;
      }
    },
    lineOf(content, index) {
      if (index == null || index < 0) return null;
      return content.slice(0, index).split("\n").length;
    },
    finding(id, category, severity, title, message, recommendation, file = null, line = null, technology = "common") {
      return { id, category, severity, title, message, recommendation, file, line, technology };
    },
  };
}

function buildSummary(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const categoryScores = {};
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    const weight = SEVERITY_WEIGHT[finding.severity] || 0;
    categoryScores[finding.category] = Math.max(0, (categoryScores[finding.category] ?? 100) - weight);
  }
  const deduction = Object.entries(counts).reduce((total, [severity, count]) =>
    total + Math.min((SEVERITY_WEIGHT[severity] || 0) * count, SEVERITY_CAP[severity] || 0), 0);
  const score = Math.max(0, 100 - deduction);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  return { score, grade, counts, categories: categoryScores, totalFindings: findings.length };
}

function analyzeRepository(repoRoot, options = {}) {
  const startedAt = Date.now();
  const scan = scanRepository(repoRoot, options);
  const technologies = detectTechnologies(scan.files);
  const ctx = createContext(scan, technologies);
  if (gitops.detect(ctx)) technologies.push("gitops");
  const inventory = buildInventory(ctx);
  const classification = classifyRepository(ctx, inventory);
  ctx.inventory = inventory;
  ctx.classification = classification;
  const findings = [];

  for (const analyzer of ANALYZERS) {
    if (!analyzer.supports(technologies, classification)) continue;
    findings.push(...analyzer.analyze(ctx));
  }

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
    || a.category.localeCompare(b.category) || (a.file || "").localeCompare(b.file || ""));

  return {
    version: 2,
    analyzedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    repository: { path: scan.root, filesScanned: scan.files.length, truncated: scan.truncated, scope: scan.scope },
    technologies,
    classification,
    inventory,
    summary: buildSummary(findings),
    findings,
  };
}

module.exports = { analyzeRepository, detectTechnologies };
