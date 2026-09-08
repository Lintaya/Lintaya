const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { ConfigError, loadConfig } = require("./config");

test("loadConfig returns safe development defaults", () => {
  const serverDir = path.resolve("fixture-server");
  const config = loadConfig({}, { serverDir });

  assert.equal(config.http.host, "0.0.0.0");
  assert.equal(config.http.port, 3000);
  assert.equal(config.http.token, "");
  assert.equal(config.database.mainPath, path.join(serverDir, "personal-hq.db"));
  assert.equal(config.database.reposPath, path.join(serverDir, "repos.db"));
  assert.equal(config.database.disableSeeds, false);
  assert.equal(config.vault.mode, "bitwarden");
  assert.equal(config.vault.masterPassword, "dev-master");
  assert.equal(config.secretStore.mode, "legacy");
});

test("loadConfig validates required authentication", () => {
  assert.throws(
    () => loadConfig({}, { requireToken: true }),
    (error) => error instanceof ConfigError
      && error.code === "CONFIG_INVALID"
      && error.field === "HQ_TOKEN",
  );
});

test("loadConfig rejects invalid ports and modes", () => {
  assert.throws(
    () => loadConfig({ PORT: "zero" }),
    (error) => error instanceof ConfigError && error.field === "PORT",
  );
  assert.throws(
    () => loadConfig({ VAULT_MODE: "unsafe" }),
    (error) => error instanceof ConfigError && error.field === "VAULT_MODE",
  );
});

test("loadConfig centralizes explicit runtime values", () => {
  const config = loadConfig({
    HQ_TOKEN: " test-token ",
    PORT: "4100",
    VAULT_MODE: "demo",
    NODE_ENV: "production",
    LINTAYA_DB_PATH: ":memory:",
    LINTAYA_REPOS_DB_PATH: "repos-test.db",
    LINTAYA_DISABLE_SEEDS: "1",
    AI_PROVIDER: "litellm",
    LITELLM_BASE_URL: " http://localhost:4000/ ",
    LINTAYA_SECRET_STORE: "local",
    LINTAYA_SECRET_KEY: "a sufficiently long local key",
  }, { requireToken: true });

  assert.equal(config.http.token, "test-token");
  assert.equal(config.http.port, 4100);
  assert.equal(config.vault.mode, "demo");
  assert.equal(config.vault.masterPassword, "");
  assert.equal(config.database.mainPath, ":memory:");
  assert.equal(config.database.reposPath, "repos-test.db");
  assert.equal(config.database.disableSeeds, true);
  assert.equal(config.ai.provider, "litellm");
  assert.equal(config.ai.litellmBaseUrl, "http://localhost:4000/");
  assert.equal(config.secretStore.mode, "local");
  assert.equal(config.secretStore.key, "a sufficiently long local key");
});

test("loadConfig accepts the bitwarden secret store mode", () => {
  const config = loadConfig({ LINTAYA_SECRET_STORE: "bitwarden" });
  assert.equal(config.secretStore.mode, "bitwarden");
});

test("loadConfig rejects an unknown secret store mode", () => {
  assert.throws(
    () => loadConfig({ LINTAYA_SECRET_STORE: "vault-99" }),
    (error) => error instanceof ConfigError && error.field === "LINTAYA_SECRET_STORE",
  );
});

test("loadConfig leaves the git committer identity empty by default", () => {
  assert.deepEqual(loadConfig({}).git.commitIdentity, {});
});

test("loadConfig parses per-provider git committer identities", () => {
  const config = loadConfig({
    GIT_COMMIT_IDENTITY: JSON.stringify({
      gitlab: { name: " Ada Lovelace ", email: " ada@example.com " },
    }),
  });

  assert.deepEqual(config.git.commitIdentity, {
    gitlab: { name: "Ada Lovelace", email: "ada@example.com" },
  });
});

test("loadConfig rejects malformed git committer identities", () => {
  for (const raw of ["{", "[]", JSON.stringify({ gitlab: { name: "Ada" } })]) {
    assert.throws(
      () => loadConfig({ GIT_COMMIT_IDENTITY: raw }),
      (error) => error instanceof ConfigError && error.field === "GIT_COMMIT_IDENTITY",
    );
  }
});
