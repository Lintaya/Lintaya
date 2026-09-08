const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", ".venv", "venv", "node_modules", "vendor",
  "dist", "build", "coverage", ".next", ".nuxt", ".cache", "__pycache__",
]);

function scanRepository(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const maxFiles = options.maxFiles || 6000;
  const maxDepth = options.maxDepth || 30;
  const files = [];
  let truncated = false;

  // Analiza archivos versionados y archivos nuevos no ignorados. Esto evita
  // mezclar .env, logs o artefactos locales cubiertos por .gitignore.
  let gitVisibleFiles = null;
  let gitVisibleDirs = null;
  if (options.respectGitIgnore !== false && fs.existsSync(path.join(root, ".git"))) {
    try {
      const gitBin = process.env.GIT_BIN || "git";
      const safeRoot = root.replace(/\\/g, "/");
      const result = spawnSync(gitBin, ["-c", `safe.directory=${safeRoot}`, "-C", root,
        "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        encoding: "utf8", timeout: 5000, windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      });
      if (result.status === 0) {
        gitVisibleFiles = new Set(String(result.stdout || "").split("\0").filter(Boolean).map((file) => file.replace(/\\/g, "/").toLowerCase()));
        gitVisibleDirs = new Set();
        for (const file of gitVisibleFiles) {
          const parts = file.split("/");
          for (let i = 1; i < parts.length; i++) gitVisibleDirs.add(parts.slice(0, i).join("/"));
        }
      }
    } catch (_) {}
  }

  function visit(dir, depth) {
    if (truncated || depth > maxDepth) return;
    // Un repositorio anidado o submódulo se analiza por separado. Esto evita
    // mezclar sus hallazgos con los del repositorio principal.
    if (depth > 0 && fs.existsSync(path.join(dir, ".git"))) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relativeDir = path.relative(root, absolute).replace(/\\/g, "/").toLowerCase();
        if (!SKIP_DIRS.has(entry.name.toLowerCase()) && (!gitVisibleDirs || gitVisibleDirs.has(relativeDir))) visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(absolute);
        const relativePath = path.relative(root, absolute).replace(/\\/g, "/");
        if (gitVisibleFiles && !gitVisibleFiles.has(relativePath.toLowerCase())) continue;
        files.push({
          path: relativePath,
          size: stat.size,
        });
      } catch (_) {}
    }
  }

  visit(root, 0);
  return { root, files, truncated, scope: gitVisibleFiles ? "git-visible" : "filesystem" };
}

module.exports = { scanRepository };
