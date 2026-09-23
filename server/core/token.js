// core/token.js — resolve the API bearer token this install authenticates with.
//
// A first deploy must not come up holding a credential that is published in
// this repository: anyone who can reach the port would already know it. So when
// LINTAYA_TOKEN is unset we mint a random token and keep it in a gitignored
// file next to the database — stable across restarts and never committed.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN_FILENAME = ".lintaya-token";
const MIN_TOKEN_LENGTH = 16;

// Values that shipped as examples or dev defaults. They still work — an install
// that deliberately sets one keeps running — but the operator has to hear that
// the credential is public.
const PUBLIC_TOKENS = new Set(["dev-token", "change-me-strong-token", "your-token"]);

function tokenPath(serverDir) {
  return path.join(serverDir, TOKEN_FILENAME);
}

// Exactly what generateToken() produces. Creating the file and filling it are
// two steps, so a process killed mid-write leaves a prefix behind — and a
// prefix is a shorter, guessable credential that "not empty" would wave
// through. Anything that is not the whole thing is not a token.
const GENERATED_TOKEN_BYTES = 32;
const GENERATED_TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${GENERATED_TOKEN_BYTES * 2}}$`);

function generateToken() {
  return crypto.randomBytes(GENERATED_TOKEN_BYTES).toString("hex");
}

function isGeneratedToken(value) {
  return GENERATED_TOKEN_PATTERN.test(value || "");
}

function readStoredToken(serverDir) {
  try {
    return fs.readFileSync(tokenPath(serverDir), "utf8").trim();
  } catch {
    return "";
  }
}

// The loser of a creation race may look at the file in the window between the
// winner creating it and filling it. Startup is the only caller and it has
// nothing else to do meanwhile, so it simply waits the window out.
function readStoredTokenWhenReady(serverDir, { attempts = 20, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = readStoredToken(serverDir);
    if (isGeneratedToken(token)) return token;
    // Synchronous on purpose: resolution happens before anything is listening,
    // and making it async would spread through every caller for no gain.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }
  return "";
}

// Creates the file or fails: the "wx" flag is what stops two processes starting
// at once from each minting a token and overwriting the other's, which would
// leave one of them authenticating with a value the file no longer holds.
function createStoredToken(serverDir, token) {
  const file = tokenPath(serverDir);
  fs.writeFileSync(file, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return file;
}

// Called once the replacement server is serving: an install that moved to an
// environment-managed token must not be able to drift back onto the generated
// one it used before, because losing LINTAYA_TOKEN in a later deploy would
// silently re-accept a credential the operator may have rotated away on
// purpose. Fails closed — swallowing a failed unlink would leave that token on
// disk while reporting the rotation as done. Only "it was already gone" counts.
function discardStoredToken(serverDir) {
  const file = tokenPath(serverDir);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error(
      `LINTAYA_TOKEN is set but the previously generated token in ${file} could not be removed `
      + `(${error.code || error.message}). Delete that file, or the old token would be accepted `
      + "again the next time LINTAYA_TOKEN is missing.",
    );
  }
}

function unusableStoredToken(serverDir) {
  return `${tokenPath(serverDir)} does not hold a token Lintaya generated `
    + `(expected ${GENERATED_TOKEN_BYTES * 2} hexadecimal characters). A process may have been `
    + "killed while writing it. Delete the file to have a new token generated, or set "
    + "LINTAYA_TOKEN to use a token of your own.";
}

// Returns { token, source, file?, staleStored? }, where source is
// "env" | "file" | "generated". Resolution never deletes anything: it runs at
// module load, long before the server has shown it can bind, and a start that
// dies on a busy port or a refused token would otherwise have destroyed the
// credential the operator needs to roll back to. The caller rotates the old
// token away once the replacement is actually serving.
function resolveApiToken({ env = process.env, serverDir } = {}) {
  const fromEnv = (env.LINTAYA_TOKEN || "").trim();
  if (fromEnv) {
    return { token: fromEnv, source: "env", staleStored: Boolean(readStoredToken(serverDir)) };
  }

  const stored = readStoredToken(serverDir);
  if (stored) {
    if (!isGeneratedToken(stored)) throw new Error(unusableStoredToken(serverDir));
    return { token: stored, source: "file", file: tokenPath(serverDir) };
  }

  const generated = generateToken();
  try {
    return { token: generated, source: "generated", file: createStoredToken(serverDir, generated) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Another process claimed the name first. Creating it and filling it are
    // two steps, so the winner's file can still be empty at this instant —
    // reading it now and starting with "" would authenticate nothing while the
    // log claimed a stored token was in use. Wait for the content instead.
    const winner = readStoredTokenWhenReady(serverDir);
    if (!winner) throw new Error(unusableStoredToken(serverDir));
    return { token: winner, source: "file", file: tokenPath(serverDir) };
  }
}

// A host that only the machine itself can reach. Anywhere else, a published
// token is reachable by whoever else is on the network.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || "").trim().toLowerCase());
}

function isPublicToken(token) {
  return PUBLIC_TOKENS.has((token || "").trim());
}

// Why the server must not come up, or "" when it may. Dropping the published
// defaults from this repository does nothing for an install that already
// copied one into its own gitignored start-dev.js, so the check is on the
// value in hand, not on where it came from. Loopback still only warns: there
// the credential is reachable by nobody the machine's own user isn't.
function startupRefusal(token, host) {
  if (!isPublicToken(token) || isLoopbackHost(host)) return "";
  return [
    `LINTAYA_TOKEN is "${(token || "").trim()}", a value published in Lintaya's own repository,`,
    `and the server is about to listen on ${host} where the rest of the network can reach it.`,
    "Set a unique LINTAYA_TOKEN, or bind to HOST=127.0.0.1 if this really is a local-only run.",
  ].join(" ");
}

// Empty string when the token is fine; otherwise the line to log at startup.
function tokenWarning(token) {
  const value = (token || "").trim();
  if (PUBLIC_TOKENS.has(value)) {
    return `LINTAYA_TOKEN is "${value}", a documented example value — anyone who can reach this port already knows it. Set a unique token before exposing Lintaya on a LAN or VPN.`;
  }
  if (value && value.length < MIN_TOKEN_LENGTH) {
    return `LINTAYA_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters and is guessable. Set a longer, unique token before exposing Lintaya on a LAN or VPN.`;
  }
  return "";
}

module.exports = {
  MIN_TOKEN_LENGTH,
  PUBLIC_TOKENS,
  TOKEN_FILENAME,
  discardStoredToken,
  isLoopbackHost,
  isPublicToken,
  resolveApiToken,
  startupRefusal,
  tokenWarning,
};
