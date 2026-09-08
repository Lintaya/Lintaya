const express = require("express");
const { AppError, requestContext, sendAppError } = require("./core/errors");

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const expectedToken = req.app?.locals?.lintaya?.token || "";
  if (!expectedToken || auth !== `Bearer ${expectedToken}`) {
    sendAppError(res, AppError.unauthorized("unauthorized"), req);
    return;
  }
  next();
}

function createApp(options = {}) {
  const application = express();
  application.locals.lintaya = {
    token: options.token || "",
    version: options.version || null,
  };

  application.use(requestContext());
  application.use(express.json());
  
  // Public health check
  application.get("/api/health", (req, res) => {
    res.json({ ok: true, ts: Date.now(), version: application.locals.lintaya.version });
  });

  // Safe, public build metadata used by the About pane and remote peers.
  // Credentials, hostnames and connector configuration never belong here.
  application.get("/api/about", (req, res) => {
    res.json({
      name: "Lintaya",
      version: application.locals.lintaya.version,
      a2a: { protocol: "a2a", connector: "lintaya-remote", phase: "read-only" },
    });
  });

  return application;
}

module.exports = { createApp, requireAuth };
