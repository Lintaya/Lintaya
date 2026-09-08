const http = require("node:http");
const https = require("node:https");

const DEFAULT_TIMEOUT_MS = 12000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

class ConnectorHttpError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ConnectorHttpError";
    this.code = options.code || "CONNECTOR_HTTP_ERROR";
    this.status = options.status || null;
    this.method = options.method || null;
    this.url = options.url || null;
    this.retryAfter = options.retryAfter || null;
  }
}

function buildHttpUrl(baseUrl, apiPath = "") {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const suffix = String(apiPath || "").replace(/^\/+/, "");
  let url;
  try {
    url = new URL(`${base}/${suffix}`);
  } catch (cause) {
    throw new ConnectorHttpError("Invalid connector URL", {
      code: "CONNECTOR_URL_INVALID",
      cause,
    });
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ConnectorHttpError(`Unsupported connector protocol: ${url.protocol}`, {
      code: "CONNECTOR_URL_INVALID",
      url: `${url.protocol}//${url.host}${url.pathname}`,
    });
  }
  if (url.username || url.password) {
    throw new ConnectorHttpError("Connector URL must not contain credentials", {
      code: "CONNECTOR_URL_INVALID",
      url: `${url.origin}${url.pathname}`,
    });
  }
  return url;
}

function errorCodeForStatus(status) {
  if (status === 401 || status === 403) return "CONNECTOR_AUTH_FAILED";
  if (status === 429) return "CONNECTOR_RATE_LIMITED";
  return "CONNECTOR_HTTP_ERROR";
}

function requestJson(options = {}) {
  const {
    baseUrl,
    path = "",
    method = "GET",
    body = null,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxErrorBody = 200,
    transport: injectedTransport,
    requestOptions = {},
    signal,
    responseType = "json",
  } = options;

  if (!new Set(["json", "text", "buffer"]).has(responseType)) {
    return Promise.reject(new TypeError("responseType must be json, text or buffer"));
  }

  let url;
  try {
    url = buildHttpUrl(baseUrl, path);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const upperMethod = String(method || "GET").toUpperCase();
    const isHttps = url.protocol === "https:";
    const transport = injectedTransport || (isHttps ? https : http);
    const bodyString = body == null ? null : JSON.stringify(body);
    const safeUrl = `${url.origin}${url.pathname}`;
    let settled = false;
    let abortHandler = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
      callback(value);
    };

    const outgoingHeaders = { ...headers };
    if (bodyString != null) {
      outgoingHeaders["Content-Type"] = outgoingHeaders["Content-Type"] || "application/json";
      outgoingHeaders["Content-Length"] = Buffer.byteLength(bodyString);
    }

    const request = transport.request({
      ...requestOptions,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: upperMethod,
      headers: outgoingHeaders,
      timeout: timeoutMs,
    }, (response) => {
      // Buffer mode keeps raw chunks and concatenates once at the end — string
      // concatenation (`body += chunk`) coerces each chunk through UTF-8
      // immediately, which corrupts binary content (images, etc.) whether or
      // not a single multi-byte sequence happens to span a chunk boundary.
      const chunks = [];
      // Real http/https responses always emit Buffer chunks; some callers'
      // injected test transports emit plain strings — normalize either way,
      // Buffer.concat() only accepts actual Buffer/Uint8Array instances.
      response.on("data", (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
      response.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        if (response.statusCode >= 400) {
          const retryAfter = response.headers?.["retry-after"] || null;
          finish(reject, new ConnectorHttpError(
            `HTTP ${response.statusCode}: ${bodyBuffer.toString("utf8").slice(0, maxErrorBody)}`,
            {
              code: errorCodeForStatus(response.statusCode),
              status: response.statusCode,
              method: upperMethod,
              url: safeUrl,
              retryAfter,
            },
          ));
          return;
        }
        if (responseType === "buffer") {
          finish(resolve, bodyBuffer);
          return;
        }
        const responseBody = bodyBuffer.toString("utf8");
        if (responseType === "text") {
          finish(resolve, responseBody);
          return;
        }
        try { finish(resolve, JSON.parse(responseBody)); }
        catch { finish(resolve, responseBody); }
      });
    });

    request.on("timeout", () => {
      request.destroy();
      finish(reject, new ConnectorHttpError("Request timed out", {
        code: "CONNECTOR_TIMEOUT",
        method: upperMethod,
        url: safeUrl,
      }));
    });
    request.on("error", (error) => {
      finish(reject, new ConnectorHttpError(error.message, {
        code: "CONNECTOR_NETWORK_ERROR",
        method: upperMethod,
        url: safeUrl,
        cause: error,
      }));
    });
    abortHandler = () => {
      request.destroy();
      finish(reject, new ConnectorHttpError("Request canceled", {
        code: "CONNECTOR_ABORTED",
        method: upperMethod,
        url: safeUrl,
      }));
    };
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });
    if (bodyString != null) request.write(bodyString);
    request.end();
  });
}

module.exports = {
  ALLOWED_PROTOCOLS,
  ConnectorHttpError,
  DEFAULT_TIMEOUT_MS,
  buildHttpUrl,
  errorCodeForStatus,
  requestJson,
};
