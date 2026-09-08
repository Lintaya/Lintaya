import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = [
  "manifest.webmanifest",
  "server/package.json",
  "server/package-lock.json",
];

function collectJsonFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(relative(root, fullPath));
    }
  }
  return result;
}

files.push(...collectJsonFiles(resolve(root, "server", "connectors")));

let failed = false;
for (const file of files) {
  try {
    JSON.parse(readFileSync(resolve(root, file), "utf8"));
    console.log(`JSON: ok — ${file}`);
  } catch (error) {
    failed = true;
    console.error(`JSON: invalid — ${file}: ${error.message}`);
  }
}

if (failed) process.exit(1);
