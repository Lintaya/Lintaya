const http = require("node:http");
const https = require("node:https");
const { spawn: nodeSpawn } = require("node:child_process");

const DEFAULT_SERVER_URL = "https://localhost:8443";
const HEALTH_TIMEOUT_MS = 5000;

// GET /alive on the Bitwarden server. Never rejects: an unreachable server is a
// status to report, not an exception for the caller to handle.
function bwHealthCheck(serverUrl, options = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(serverUrl);
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    const isHttps = parsed.protocol === "https:";
    const transport = options.transport || (isHttps ? https : http);
    try {
      const request = transport.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: "/alive",
        method: "GET",
        // Self-hosted Bitwarden commonly runs behind a self-signed certificate.
        rejectUnauthorized: false,
        timeout: options.timeoutMs || HEALTH_TIMEOUT_MS,
      }, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({
          ok: response.statusCode < 400,
          statusCode: response.statusCode,
          body: body.trim(),
        }));
      });
      request.on("timeout", () => { request.destroy(); resolve({ ok: false, error: "timeout" }); });
      request.on("error", (error) => resolve({ ok: false, error: error.message }));
      request.end();
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

// `bw status` output, or a usable stand-in when the CLI cannot be reached.
async function readCliStatus(runBw, fallbackStatus = "error") {
  try {
    return JSON.parse(await runBw(["status"]));
  } catch (error) {
    return { status: fallbackStatus, error: error.message };
  }
}

// API-key login bypasses `bw()` on purpose: the credentials go in as one-shot
// environment variables rather than argv, so they never appear in a process
// listing or in the connector's own logs.
function bwApiKeyLogin(cfg, options = {}) {
  const spawn = options.spawn || nodeSpawn;
  const binary = options.binary;
  if (!binary?.bin) return Promise.reject(new Error("bw-binary-unavailable"));

  return new Promise((resolve, reject) => {
    const env = {
      ...(options.env || process.env),
      BW_CLIENTID: cfg.clientId,
      BW_CLIENTSECRET: cfg.clientSecret,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    };
    const args = ["login", "--apikey", "--nointeraction"];
    const child = spawn(binary.bin, binary.script ? [binary.script, ...args] : args, { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `exit ${code}`));
    });
    child.on("error", reject);
  });
}

function hasApiKey(cfg) {
  return !!(cfg?.clientId && cfg?.clientSecret);
}

function serverUrlOf(cfg) {
  return cfg?.serverUrl || DEFAULT_SERVER_URL;
}

// Shapes the record the UI reads, from the two independent signals: the server's
// own health and what the CLI reports about its session.
function buildStatusRecord({ ok, latency, at, health, cliStatus, serverUrl, itemCount = null }) {
  const record = {
    status: ok ? "ok" : "error",
    latency,
    serverHealth: health.ok,
    serverUrl: cliStatus?.serverUrl || serverUrl,
    bwCliStatus: cliStatus?.status || null,
    userEmail: cliStatus?.userEmail || null,
    lastError: ok ? null : (health.error || "server unreachable"),
  };
  if (itemCount != null) record.itemsSynced = itemCount;
  return record;
}

module.exports = {
  DEFAULT_SERVER_URL,
  HEALTH_TIMEOUT_MS,
  buildStatusRecord,
  bwApiKeyLogin,
  bwHealthCheck,
  hasApiKey,
  readCliStatus,
  serverUrlOf,
};
