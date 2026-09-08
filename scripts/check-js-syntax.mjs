import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const serverRoot = join(root, "server");
const ignored = new Set(["node_modules", "gitlab-clones", "docs-files", "ssh-logs"]);

function collect(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...collect(path));
    else if (extname(path) === ".js") files.push(path);
  }
  return files;
}

const failures = [];
const files = collect(serverRoot);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(`${relative(root, file)}\n${result.stderr || result.stdout}`);
  }
}

if (failures.length) {
  console.error(`JavaScript syntax errors:\n\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`JavaScript syntax: ok (${files.length} files)`);

