const http = require("node:http");
const https = require("node:https");

const { buildHttpUrl, requestJson } = require("../../sdk");

const DEFAULT_TIMEOUT_MS = 12000;
// Container logs stream more slowly than the JSON endpoints.
const LOG_TIMEOUT_MS = 15000;

function portainerBaseUrl(cfg) {
  return String(cfg?.baseUrl || "").replace(/\/+$/, "");
}

// Portainer accepts either a long-lived API key or a JWT minted from
// username/password. The key wins when both are stored.
function portainerAuthHeaders(cfg, token) {
  return token
    ? { Authorization: `Bearer ${token}` }
    : { "X-API-Key": cfg?.apiKey || "" };
}

async function portainerLogin(cfg, options = {}) {
  const request = options.request || requestJson;
  const data = await request({
    baseUrl: portainerBaseUrl(cfg),
    path: "/api/auth",
    method: "POST",
    body: { username: cfg.username, password: cfg.password },
    headers: { Accept: "application/json", "User-Agent": "lintaya" },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    // Self-hosted Portainer commonly runs behind a self-signed certificate.
    requestOptions: { rejectUnauthorized: false },
  });
  if (!data?.jwt) throw new Error("auth: no jwt in response");
  return data.jwt;
}

// Resolves auth for a request: a JWT when using user/pass, or null when an API
// key is configured (the key travels as a header instead).
function portainerToken(cfg, options = {}) {
  return cfg?.apiKey ? Promise.resolve(null) : portainerLogin(cfg, options);
}

function portainerFetch(cfg, apiPath, token, options = {}) {
  const request = options.request || requestJson;
  return request({
    baseUrl: portainerBaseUrl(cfg),
    path: apiPath,
    headers: { ...portainerAuthHeaders(cfg, token), Accept: "application/json", "User-Agent": "lintaya" },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    requestOptions: { rejectUnauthorized: false },
  });
}

// Docker multiplexes container logs into framed binary chunks, so this one
// cannot go through the SDK's JSON/text helpers — the caller needs raw bytes.
function portainerFetchBuffer(cfg, apiPath, token, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = buildHttpUrl(portainerBaseUrl(cfg), apiPath);
    } catch (error) {
      reject(error);
      return;
    }
    const isHttps = url.protocol === "https:";
    const transport = options.transport || (isHttps ? https : http);
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      headers: portainerAuthHeaders(cfg, token),
      rejectUnauthorized: false,
      timeout: options.timeoutMs || LOG_TIMEOUT_MS,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        if (response.statusCode >= 400) {
          const error = new Error(`HTTP ${response.statusCode}: ${body.toString("utf8").slice(0, 150)}`);
          error.status = response.statusCode;
          reject(error);
          return;
        }
        resolve(body);
      });
    });
    request.on("timeout", () => { request.destroy(); reject(new Error("Request timed out")); });
    request.on("error", reject);
    request.end();
  });
}

function normalizePortainerContainer(container) {
  return {
    id: (container.Id || "").slice(0, 12),
    name: (container.Names?.[0] || "").replace(/^\//, ""),
    image: container.Image || "",
    state: (container.State || "").toLowerCase(),
    status: container.Status || "",
    ports: (container.Ports || [])
      .filter((port) => port.PublicPort)
      .map((port) => `${port.PublicPort}->${port.PrivatePort}/${port.Type}`),
    createdAt: container.Created ? new Date(container.Created * 1000).toISOString() : null,
    cpuPct: null,
    memUsage: null,
  };
}

async function syncPortainer(cfg, options = {}) {
  const fetch = options.fetch || portainerFetch;
  const resolveToken = options.token || portainerToken;

  const token = await resolveToken(cfg, options);
  const rawEndpoints = await fetch(cfg, "/api/endpoints", token, options);

  // The "local" endpoint talks to a unix socket and carries no IP of its own —
  // it is the Portainer host, so fall back to the base URL's hostname.
  let baseHostIp = null;
  try { baseHostIp = new URL(portainerBaseUrl(cfg)).hostname; } catch { /* left null */ }

  const endpoints = [];
  let total = 0;

  for (const endpoint of Array.isArray(rawEndpoints) ? rawEndpoints : []) {
    let containers = [];
    try {
      const raw = await fetch(cfg, `/api/endpoints/${endpoint.Id}/docker/containers/json?all=1`, token, options);
      containers = (Array.isArray(raw) ? raw : []).map(normalizePortainerContainer);
    } catch {
      // One unreachable endpoint must not abort the whole sync.
    }
    total += containers.length;
    // Agent endpoints carry the host IP (tcp://10.x:9001); the local socket does not.
    const hostIp = (endpoint.URL || "").match(/(\d{1,3}(?:\.\d{1,3}){3})/)?.[1] || baseHostIp;
    endpoints.push({ id: endpoint.Id, name: endpoint.Name, hostIp, vmId: null, containers });
  }

  return { endpoints, total };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  LOG_TIMEOUT_MS,
  normalizePortainerContainer,
  portainerAuthHeaders,
  portainerBaseUrl,
  portainerFetch,
  portainerFetchBuffer,
  portainerLogin,
  portainerToken,
  syncPortainer,
};
