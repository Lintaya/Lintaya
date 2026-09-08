import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `npm audit` writes its report and exits non-zero on a finding, so the
// workflow lets that exit code pass to keep the report as an artifact. This
// reads the report back and decides whether the finding should stop the build.
const blockingLevels = ["critical", "high"];
const reportPath = resolve(process.argv[2] || "npm-audit.json");

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error(`Runtime audit: no readable report at ${reportPath}. ${error.message}`);
  process.exit(1);
}

if (report.error) {
  console.error(
    `Runtime audit: npm audit did not complete.\n${JSON.stringify(report.error, null, 2)}`,
  );
  process.exit(1);
}

const counts = (report.metadata && report.metadata.vulnerabilities) || {};
const blocking = blockingLevels.filter((level) => Number(counts[level] || 0) > 0);

if (blocking.length) {
  const summary = blocking.map((level) => `${counts[level]} ${level}`).join(", ");
  const named = Object.values(report.vulnerabilities || {})
    .filter((entry) => blockingLevels.includes(entry.severity))
    .map((entry) => `  ${entry.name} (${entry.severity})`);
  console.error(`Runtime dependencies carry blocking vulnerabilities: ${summary}.`);
  if (named.length) console.error(named.join("\n"));
  process.exit(1);
}

console.log("Runtime audit: ok (no high or critical runtime vulnerabilities)");
