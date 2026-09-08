// Cache key for the service worker.
//
// The tracked sw.js ships a placeholder version so that no development
// workflow has to rewrite a tracked file just to bust the browser cache — that
// left every clean clone with a spurious diff. The server substitutes the real
// key when it serves /sw.js: the release version in production, so publishing a
// release retires the old caches, and a fingerprint of the client sources in
// development, so editing a JSX file retires them on the next load.

const nodeFs = require("node:fs");
const path = require("node:path");

const VERSION_LINE = /^const VERSION = "[^"]*";$/m;

// Client sources the shell loads directly. An edit to any of them must produce
// a new cache key; vendor bundles and icons are pinned and change with a
// release, which the version already covers.
const FINGERPRINT_ENTRIES = ["app", "Lintaya.html"];

function newestMtimeMs(rootDir, fs) {
  let newest = 0;
  const seen = (file) => {
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      // A missing or unreadable entry just does not contribute to the key.
    }
  };

  for (const entry of FINGERPRINT_ENTRIES) {
    const target = path.join(rootDir, entry);
    let names = null;
    try {
      names = fs.statSync(target).isDirectory() ? fs.readdirSync(target) : null;
    } catch {
      continue;
    }
    if (names === null) {
      seen(target);
      continue;
    }
    for (const name of names) seen(path.join(target, name));
  }

  return newest;
}

function serviceWorkerVersion({ appVersion, nodeEnv, rootDir, fs = nodeFs }) {
  if (nodeEnv === "production") return `v${appVersion}`;
  const fingerprint = Math.floor(newestMtimeMs(rootDir, fs)).toString(36);
  return `v${appVersion}-dev.${fingerprint}`;
}

// Leaves the source untouched when the placeholder is missing, so a hand-edited
// sw.js still serves rather than failing the request.
function injectServiceWorkerVersion(source, version) {
  return source.replace(VERSION_LINE, () => `const VERSION = ${JSON.stringify(version)};`);
}

module.exports = { serviceWorkerVersion, injectServiceWorkerVersion };
