const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { MIN_TOKEN_LENGTH, TOKEN_FILENAME, discardStoredToken, resolveApiToken, startupRefusal, tokenWarning } = require("./token");

function tempServerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lintaya-token-"));
}

test("resolveApiToken prefers an explicit LINTAYA_TOKEN and writes nothing", () => {
  const serverDir = tempServerDir();
  const resolved = resolveApiToken({ env: { LINTAYA_TOKEN: "  from-env  " }, serverDir });

  assert.equal(resolved.token, "from-env");
  assert.equal(resolved.source, "env");
  assert.equal(fs.existsSync(path.join(serverDir, TOKEN_FILENAME)), false);
});

test("resolveApiToken generates and persists a token on a first deploy", () => {
  const serverDir = tempServerDir();
  const first = resolveApiToken({ env: {}, serverDir });

  assert.equal(first.source, "generated");
  assert.equal(first.token.length, 64);
  assert.match(first.token, /^[0-9a-f]+$/);

  // A restart reuses it instead of locking the operator out of their own install.
  const second = resolveApiToken({ env: {}, serverDir });
  assert.equal(second.source, "file");
  assert.equal(second.token, first.token);
});

test("resolveApiToken never falls back to a published credential", () => {
  const serverDir = tempServerDir();
  const { token } = resolveApiToken({ env: {}, serverDir });

  assert.notEqual(token, "dev-token");
  assert.notEqual(token, "change-me-strong-token");
});

test("tokenWarning flags documented example tokens and short ones", () => {
  assert.match(tokenWarning("dev-token"), /already knows it/);
  assert.match(tokenWarning("change-me-strong-token"), /already knows it/);
  assert.match(tokenWarning("short"), new RegExp(`${MIN_TOKEN_LENGTH} characters`));
  assert.equal(tokenWarning("a-sufficiently-long-unique-token"), "");
});

test("resolving an environment token reports the stale file but keeps it", () => {
  const serverDir = tempServerDir();
  const generated = resolveApiToken({ env: {}, serverDir });
  assert.equal(generated.source, "generated");

  // Resolution runs before the server has shown it can bind. A start that dies
  // on a busy port or a refused token must leave the operator the credential
  // every browser still holds, so nothing is deleted here.
  const fromEnv = resolveApiToken({ env: { LINTAYA_TOKEN: "env-managed-token" }, serverDir });
  assert.equal(fromEnv.source, "env");
  assert.equal(fromEnv.staleStored, true);
  assert.equal(fs.existsSync(path.join(serverDir, TOKEN_FILENAME)), true);
  assert.equal(resolveApiToken({ env: {}, serverDir }).token, generated.token);
});

test("discarding the stored token stops it from being resurrected", () => {
  const serverDir = tempServerDir();
  const generated = resolveApiToken({ env: {}, serverDir });

  // What the caller does once the replacement server is actually serving.
  assert.equal(discardStoredToken(serverDir), true);
  assert.equal(fs.existsSync(path.join(serverDir, TOKEN_FILENAME)), false);

  // So losing LINTAYA_TOKEN later mints a new token instead of re-accepting
  // the credential the operator rotated away from.
  const afterLoss = resolveApiToken({ env: {}, serverDir });
  assert.equal(afterLoss.source, "generated");
  assert.notEqual(afterLoss.token, generated.token);
});

test("a second process starting at the same time adopts the winner's token", () => {
  const serverDir = tempServerDir();
  const winner = resolveApiToken({ env: {}, serverDir });

  // Stand in for the loser of the race: the file already exists by the time it
  // tries to create one, and it must not overwrite the winner's value.
  const loser = resolveApiToken({ env: {}, serverDir });
  assert.equal(loser.token, winner.token);
  assert.equal(fs.readFileSync(path.join(serverDir, TOKEN_FILENAME), "utf8").trim(), winner.token);
});

test("startupRefusal blocks a published token on a network-facing host", () => {
  const refusal = startupRefusal("change-me-strong-token", "0.0.0.0");
  assert.match(refusal, /published in Lintaya's own repository/);
  assert.match(refusal, /HOST=127\.0\.0\.1/);
  assert.notEqual(startupRefusal("dev-token", "192.168.1.40"), "");
});

test("startupRefusal lets a local-only run through with a warning instead", () => {
  for (const host of ["127.0.0.1", "::1", "localhost", "LOCALHOST"]) {
    assert.equal(startupRefusal("dev-token", host), "", `expected ${host} to be loopback`);
  }
  // Still worth saying out loud, just not worth refusing to start over.
  assert.notEqual(tokenWarning("dev-token"), "");
});

test("startupRefusal ignores tokens that are merely weak, not published", () => {
  assert.equal(startupRefusal("short", "0.0.0.0"), "");
  assert.equal(startupRefusal("a-unique-token-nobody-published", "0.0.0.0"), "");
});

test("a token file that cannot be removed fails loudly instead of lingering", () => {
  const serverDir = tempServerDir();
  resolveApiToken({ env: {}, serverDir });

  const unlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => {
    const error = new Error("EPERM: operation not permitted");
    error.code = "EPERM";
    throw error;
  };
  try {
    assert.throws(() => discardStoredToken(serverDir), /could not be removed/);
  } finally {
    fs.unlinkSync = unlinkSync;
  }
});

test("an environment token with no stored file reports nothing to discard", () => {
  const serverDir = tempServerDir();
  const resolved = resolveApiToken({ env: { LINTAYA_TOKEN: "env-managed-token" }, serverDir });
  assert.equal(resolved.source, "env");
  assert.equal(resolved.staleStored, false);
  // Nothing to remove is not a failure.
  assert.equal(discardStoredToken(serverDir), false);
});

test("an empty or partial token file fails startup instead of authenticating on a prefix", () => {
  // A process killed mid-write leaves either nothing or a prefix behind, and
  // the prefix is the dangerous one: a shorter, guessable credential that a
  // mere "is it empty?" check would wave straight through.
  const broken = [
    "   \n",
    "a1b2c3d4",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
    "NOT-HEX-0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  ];
  for (const content of broken) {
    const serverDir = tempServerDir();
    fs.writeFileSync(path.join(serverDir, TOKEN_FILENAME), content);
    assert.throws(
      () => resolveApiToken({ env: {}, serverDir }),
      /does not hold a token Lintaya generated/,
      `expected ${JSON.stringify(content)} to be rejected`,
    );
  }
});

test("a complete generated token file is accepted on the next start", () => {
  const serverDir = tempServerDir();
  const { token } = resolveApiToken({ env: {}, serverDir });
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(resolveApiToken({ env: {}, serverDir }).token, token);
});
