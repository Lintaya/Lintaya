import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const git = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
);
if (git.status !== 0) {
  console.error(git.stderr || "Unable to list tracked files.");
  process.exit(1);
}

const candidates = git.stdout.split("\0").filter(Boolean);
const allowedExample = /(?:\.example|\.sample|\.template)(?:\.[^/]+)?$/i;
const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/i,
  /^server\/vault-seed\.js$/i,
  /^server\/start-dev\.js$/i,
  /^bitwarden\/settings\.env$/i,
  /\.(?:pem|p12|pfx|key)$/i,
  /(?:^|\/)(?:id_rsa|id_ed25519)$/i,
];

const pathViolations = candidates.filter(
  (file) => !allowedExample.test(file) && forbiddenPaths.some((rule) => rule.test(file)),
);

const textExtensions = new Set([
  "", ".cjs", ".css", ".html", ".ini", ".js", ".json", ".jsx", ".md",
  ".mjs", ".ps1", ".py", ".sh", ".toml", ".txt", ".yaml", ".yml",
]);
const excludedFiles = new Set(["scripts/check-secrets.mjs"]);
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,255}/g],
  ["GitLab token", /glpat-[A-Za-z0-9_-]{20,}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/g],
];

const findings = [];
for (const file of candidates) {
  if (excludedFiles.has(file) || !textExtensions.has(extname(file).toLowerCase())) continue;
  let content;
  try {
    content = readFileSync(resolve(root, file), "utf8");
  } catch {
    continue;
  }
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} — possible ${label}`);
    }
  }
}

if (pathViolations.length || findings.length) {
  if (pathViolations.length) {
    console.error(`Sensitive paths are tracked:\n${pathViolations.map((p) => `- ${p}`).join("\n")}`);
  }
  if (findings.length) {
    console.error(`Possible secrets detected:\n${findings.map((f) => `- ${f}`).join("\n")}`);
  }
  console.error("Remove the secret from the change and rotate it if it was real.");
  process.exit(1);
}

console.log(`Secret baseline: ok (${candidates.length} versionable files checked)`);
