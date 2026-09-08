const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { serviceWorkerVersion, injectServiceWorkerVersion } = require("./sw-version");

const ROOT = path.join("/", "srv", "lintaya");

// Minimal stand-in for the parts of node:fs the fingerprint reads, so the test
// controls mtimes instead of touching real files.
function fakeFs(mtimes) {
  return {
    statSync(target) {
      const key = path.relative(ROOT, target).split(path.sep).join("/");
      if (key === "app") return { isDirectory: () => true, mtimeMs: 0 };
      if (!(key in mtimes)) throw new Error(`ENOENT: ${key}`);
      return { isDirectory: () => false, mtimeMs: mtimes[key] };
    },
    readdirSync() {
      return ["app.jsx", "home.jsx"];
    },
  };
}

const MTIMES = { "app/app.jsx": 1000, "app/home.jsx": 2000, "Lintaya.html": 1500 };

test("a production build keys the cache on the release version alone", () => {
  const version = serviceWorkerVersion({
    appVersion: "0.1.0-beta.1",
    nodeEnv: "production",
    rootDir: ROOT,
    fs: fakeFs(MTIMES),
  });

  assert.equal(version, "v0.1.0-beta.1");
});

test("development keys the cache on the newest client source, not on server restarts", () => {
  const fs = fakeFs(MTIMES);
  const args = { appVersion: "0.1.0-beta.1", nodeEnv: "development", rootDir: ROOT, fs };

  const first = serviceWorkerVersion(args);
  const second = serviceWorkerVersion(args);

  // Restarting the server must not invalidate the cache on its own.
  assert.equal(first, second);
  assert.equal(first, `v0.1.0-beta.1-dev.${(2000).toString(36)}`);
});

test("editing a client source produces a new cache key", () => {
  const before = serviceWorkerVersion({
    appVersion: "0.1.0-beta.1", nodeEnv: "development", rootDir: ROOT, fs: fakeFs(MTIMES),
  });

  const after = serviceWorkerVersion({
    appVersion: "0.1.0-beta.1",
    nodeEnv: "development",
    rootDir: ROOT,
    fs: fakeFs({ ...MTIMES, "app/home.jsx": 9000 }),
  });

  assert.notEqual(before, after);
});

test("an unreadable source is skipped instead of failing the request", () => {
  const version = serviceWorkerVersion({
    appVersion: "0.1.0-beta.1",
    nodeEnv: "development",
    rootDir: ROOT,
    fs: fakeFs({ "app/app.jsx": 1000 }), // home.jsx and Lintaya.html are missing
  });

  assert.equal(version, `v0.1.0-beta.1-dev.${(1000).toString(36)}`);
});

test("the placeholder in the tracked worker is replaced with the real key", () => {
  const source = 'const VERSION = "dev";\nconst STATIC_CACHE = `static-${VERSION}`;\n';

  const served = injectServiceWorkerVersion(source, "v0.1.0-beta.1");

  assert.match(served, /^const VERSION = "v0\.1\.0-beta\.1";$/m);
  assert.ok(!served.includes('"dev"'));
});

test("a version carrying regex replacement syntax is written literally", () => {
  const served = injectServiceWorkerVersion('const VERSION = "dev";', "v1$&2");

  assert.equal(served, 'const VERSION = "v1$&2";');
});

test("a worker without the placeholder is served unchanged", () => {
  const source = "const OTHER = 1;\n";

  assert.equal(injectServiceWorkerVersion(source, "v1"), source);
});
