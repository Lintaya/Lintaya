const assert = require("node:assert/strict");
const { test } = require("node:test");

const { classifyVaultUnlockFailure } = require("./vault-errors");

// The text the CLI and the fetch layer actually produced, so the patterns are
// checked against real output rather than a paraphrase of it. The unreachable
// sample is the one this session captured from a stopped vault server.
const SAMPLES = {
  VAULT_SERVER_UNREACHABLE: "Unable to fetch ServerConfig from https://localhost:8443/api FetchError: request to https://localhost:8443/identity/connect/token failed, reason: \n  errno: 'ECONNREFUSED',\n  code: 'ECONNREFUSED'",
  BW_CLI_NOT_INSTALLED: "spawn bw ENOENT",
  VAULT_SERVER_TLS_REJECTED: "request to https://vault.example:8443/api failed, reason: self-signed certificate in certificate chain",
  VAULT_CLI_NOT_LOGGED_IN: "You are not logged in.",
  WRONG_MASTER_PASSWORD: "Invalid master password.",
};

test("each failure the CLI can produce maps to its own code", () => {
  for (const [code, text] of Object.entries(SAMPLES)) {
    const result = classifyVaultUnlockFailure(new Error(text));
    assert.equal(result.code, code, `expected ${code} for: ${text.slice(0, 60)}`);
  }
});

test("a stopped vault server is a 503 that says so, not a rejected password", () => {
  const result = classifyVaultUnlockFailure(new Error(SAMPLES.VAULT_SERVER_UNREACHABLE), {
    serverUrl: "https://localhost:8443",
  });

  assert.equal(result.status, 503);
  assert.equal(result.code, "VAULT_SERVER_UNREACHABLE");
  assert.match(result.message, /https:\/\/localhost:8443/);
  assert.match(result.message, /start it/i);
  // The whole point: the person must not go looking for a typo.
  assert.match(result.message, /not a wrong master password/i);
});

test("the address is read out of the failure when the caller does not know it", () => {
  const result = classifyVaultUnlockFailure(new Error(SAMPLES.VAULT_SERVER_UNREACHABLE));

  assert.match(result.message, /https:\/\/localhost:8443/);
});

test("a failure that names no address still produces a usable message", () => {
  const result = classifyVaultUnlockFailure(new Error("connect ECONNREFUSED 127.0.0.1:8443"));

  assert.equal(result.code, "VAULT_SERVER_UNREACHABLE");
  assert.match(result.message, /the configured Bitwarden server/);
});

test("a genuinely wrong password is still a 401", () => {
  const result = classifyVaultUnlockFailure(new Error(SAMPLES.WRONG_MASTER_PASSWORD));

  assert.equal(result.status, 401);
  assert.equal(result.code, "WRONG_MASTER_PASSWORD");
});

test("an empty or missing error is treated as a rejected password, not a crash", () => {
  for (const input of [null, undefined, new Error(""), "" ]) {
    assert.equal(classifyVaultUnlockFailure(input).code, "WRONG_MASTER_PASSWORD");
  }
});

test("a transport failure is not mistaken for a missing CLI", () => {
  // Both used to be reachable through the word "not found"; only ENOENT and a
  // 127 exit mean the binary is absent.
  const result = classifyVaultUnlockFailure(new Error("getaddrinfo ENOTFOUND vault.example"));

  assert.equal(result.code, "VAULT_SERVER_UNREACHABLE");
});
