const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { defaultConfigPath, emptyConfig, normalizeUrl, readConfig, writeConfig } = require("../src/config");

test("normalizes supported profile URLs", () => {
  assert.equal(normalizeUrl("https://lintaya.example/"), "https://lintaya.example");
  assert.throws(() => normalizeUrl("https://user:secret@lintaya.example"), /without credentials/);
  assert.throws(() => normalizeUrl("file:///tmp/lintaya"), /HTTP/);
});

test("uses the native configuration location per platform", () => {
  const portable = (value) => value.split(path.sep).join("/");
  assert.match(portable(defaultConfigPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32")), /Lintaya\/config\.json$/);
  assert.match(portable(defaultConfigPath({ XDG_CONFIG_HOME: "/tmp/config" }, "linux")), /lintaya\/config\.json$/);
});

test("writes and reads a profile atomically", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lintaya-cli-"));
  const configPath = path.join(directory, "config.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = emptyConfig();
  config.activeProfile = "local";
  config.profiles.local = { url: "http://localhost:3000", token: "test-token" };
  await writeConfig(config, configPath);
  assert.deepEqual(await readConfig(configPath), config);
});
