// RFC 9457 Problem Details for HTTP APIs, with Lintaya extensions:
// { type, title, status, detail, instance, code, details, requestId }.
//
// `sendAppError` is the canonical formatter — call it directly from a route/
// middleware (e.g. requireAuth, which must format its own response without
// depending on error-middleware registration order) or let it flow through
// `errorMiddleware` via `next(err)`. Both paths produce the same shape.
const crypto = require("node:crypto");

class AppError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = options.code || "INTERNAL_ERROR";
    this.status = options.status || 500;
    this.details = options.details ?? null;
    // Whether message/details are safe to show a client. Internal errors
    // default to a generic message so stack-trace-adjacent details never leak.
    this.expose = options.expose !== false;
  }

  static badRequest(message, details) {
    return new AppError(message, { code: "BAD_REQUEST", status: 400, details });
  }
  static unauthorized(message = "Unauthorized") {
    return new AppError(message, { code: "UNAUTHORIZED", status: 401 });
  }
  static forbidden(message = "Forbidden") {
    return new AppError(message, { code: "FORBIDDEN", status: 403 });
  }
  static notFound(message = "Not found") {
    return new AppError(message, { code: "NOT_FOUND", status: 404 });
  }
  static conflict(message, details) {
    return new AppError(message, { code: "CONFLICT", status: 409, details });
  }
  static unprocessable(message, options = {}) {
    return new AppError(message, {
      ...options,
      code: options.code || "UNPROCESSABLE_CONTENT",
      status: 422,
    });
  }
  static badGateway(message = "Bad gateway", options = {}) {
    return new AppError(message, {
      ...options,
      code: options.code || "UPSTREAM_ERROR",
      status: 502,
    });
  }
  static unavailable(message = "Service unavailable", options = {}) {
    return new AppError(message, {
      ...options,
      code: options.code || "SERVICE_UNAVAILABLE",
      status: 503,
    });
  }
  static internal(message = "Internal error", options = {}) {
    return new AppError(message, { ...options, code: options.code || "INTERNAL_ERROR", status: options.status || 500, expose: false });
  }
}

function newRequestId() {
  return crypto.randomUUID();
}

const PROBLEM_TITLES = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Content",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function problemType(code) {
  return `urn:lintaya:problem:${String(code || "INTERNAL_ERROR").toLowerCase().replace(/_/g, "-")}`;
}

function problemInstance(requestId) {
  return `urn:lintaya:request:${encodeURIComponent(requestId)}`;
}

// Assigns req.id from an inbound X-Request-Id (trusted upstream/proxy) or a
// fresh UUID, and echoes it back on the response so a client can correlate
// its own logs with the server's.
function requestContext() {
  return (req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && incoming.trim()
      ? incoming.trim().slice(0, 100)
      : newRequestId();
    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  return new AppError(err?.message || "Internal error", {
    code: "INTERNAL_ERROR",
    status: 500,
    cause: err,
    expose: false,
  });
}

// Formats and sends an AppError (or any thrown value) as RFC 9457 Problem
// Details. `code`, `details`, and `requestId` are documented extensions used
// by the Lintaya UI; clients that do not recognize them can still consume the
// standard members. Safe to call directly from a handler — does not require
// the global error middleware to be registered.
function sendAppError(res, err, req) {
  const appErr = toAppError(err);
  const requestId = req?.id || newRequestId();
  const detail = appErr.expose ? appErr.message : "Internal server error";
  const problem = {
    type: problemType(appErr.code),
    title: PROBLEM_TITLES[appErr.status] || "Error",
    status: appErr.status,
    detail,
    instance: problemInstance(requestId),
    code: appErr.code,
    details: appErr.expose ? appErr.details : null,
    requestId,
  };
  // RFC 9457 registers this media type. Some lightweight route-test response
  // doubles do not implement setHeader, so keep the formatter usable there.
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/problem+json");
  }
  res.status(appErr.status).json(problem);
  return appErr;
}

// Express 4-arg error middleware — the safety net for anything that reaches
// next(err) instead of formatting its own response. Register this LAST, after
// every route (including the catch-all), so it sits after everything that
// might throw. Logs at warn (4xx) or error (5xx) via the shared logger.
function errorMiddleware(log) {
  const sink = log || console;
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const appErr = sendAppError(res, err, req);
    const meta = {
      requestId: req?.id,
      code: appErr.code,
      status: appErr.status,
      method: req?.method,
      path: req?.originalUrl || req?.path,
    };
    if (appErr.status >= 500) {
      sink.error(appErr.expose ? appErr.message : (err?.message || appErr.message), { ...meta, stack: err?.stack });
    } else {
      sink.warn(appErr.message, meta);
    }
  };
}

module.exports = { AppError, requestContext, sendAppError, errorMiddleware, toAppError };
