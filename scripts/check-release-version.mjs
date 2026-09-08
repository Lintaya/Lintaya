import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = readFileSync(join(root, "VERSION"), "utf8").trim();
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!semver.test(version)) {
  console.error("VERSION must be a valid Semantic Version, received '" + version + "'.");
  process.exit(1);
}

const packages = ["server/package.json"];
const mismatches = packages
  .map(file => ({ file, version: JSON.parse(readFileSync(join(root, file), "utf8")).version }))
  .filter(entry => entry.version !== version);

if (mismatches.length) {
  for (const entry of mismatches) {
    console.error(entry.file + " is " + entry.version + "; expected " + version + " from VERSION.");
  }
  process.exit(1);
}

const cliVersion = JSON.parse(readFileSync(join(root, "cli/package.json"), "utf8")).version;
if (!semver.test(cliVersion)) {
  console.error("cli/package.json must declare a valid Semantic Version, received '" + cliVersion + "'.");
  process.exit(1);
}

console.log("Release version: " + version + " · CLI version: " + cliVersion);
