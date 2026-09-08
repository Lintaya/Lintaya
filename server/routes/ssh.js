// Interactive SSH sessions, persistent logs and the terminal WebSocket.  The
// container/fabric one-command helpers live separately in core/services.
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const { SSH_ALGORITHMS } = require("../core/services/ssh-exec");

const REPLAY_MAX = 64 * 1024;
const SESSION_TTL = 10 * 60 * 1000;

function registerSshRoutes({
  app, httpServer, requireAuth, kvGet, log, token, serverDir,
  SSHClient, lookupVaultPassword, AppError, sendAppError,
}) {
  const sshPool = new Map();
  const logsDir = path.join(serverDir, "ssh-logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const sessionId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const send = (ws, payload) => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); };
  const broadcast = (entry, payload) => entry.clients.forEach((ws) => send(ws, payload));
  const closeEntry = (id, entry = sshPool.get(id)) => {
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    sshPool.delete(id);
    try { entry.stream?.end(); entry.ssh?.end(); entry.jumpSsh?.end(); } catch {}
  };
  const appendReplay = (entry, data) => {
    entry.replayBuffer = Buffer.concat([entry.replayBuffer, Buffer.from(data)]);
    if (entry.replayBuffer.length > REPLAY_MAX) entry.replayBuffer = entry.replayBuffer.slice(entry.replayBuffer.length - REPLAY_MAX);
  };
  const appendLog = (entry, data) => {
    try { fs.appendFileSync(entry.logPath, Buffer.from(data).toString("utf8").replace(/\x1b\[[0-9;]*[mGKHFJ]/g, "")); } catch {}
  };
  const scheduleIdle = (id) => {
    const entry = sshPool.get(id);
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    entry.timeoutId = setTimeout(() => {
      const current = sshPool.get(id);
      if (current && current.clients.size === 0) {
        closeEntry(id, current);
        log.info("[SSH] session closed", { sessionId: id, idleMinutes: SESSION_TTL / 60000 });
      }
    }, SESSION_TTL);
    entry.timeoutId.unref?.();
  };
  const emitError = (id, entry, message) => {
    entry.status = "error";
    entry.error = message;
    broadcast(entry, { type: "error", msg: message });
    closeEntry(id, entry);
  };
  const friendlyTargetError = (error, ip, port) => {
    const message = error.message || "SSH error";
    if (/Authentication|auth|password/i.test(message)) return "Authentication failed — check your credentials. Connection attempt aborted to protect your account.";
    if (message.includes("ECONNREFUSED")) return `Connection refused — ${ip}:${port} is not reachable or SSH is not running.`;
    if (message.includes("ETIMEDOUT") || message.includes("Timed out")) return `Connection timed out — ${ip} did not respond within 12 seconds.`;
    return message;
  };
  const makeAuthHandler = (username, password) => {
    let attempted = false;
    return (methodsLeft, _partial, next) => {
      if (methodsLeft === null) return next("none");
      if (attempted) return next(false);
      attempted = true;
      if (password && methodsLeft.includes("password")) return next({ type: "password", username, password });
      if (methodsLeft.includes("keyboard-interactive")) {
        return next({ type: "keyboard-interactive", username,
          prompt(_name, _instructions, _lang, prompts, finish) {
            finish(prompts.map((prompt) => password && (prompt.prompt || "").toLowerCase().includes("pass") ? password : ""));
          },
        });
      }
      next(false);
    };
  };

  app.get("/api/ssh/logs", requireAuth, (req, res) => {
    try {
      const files = fs.readdirSync(logsDir)
        .filter((file) => file.endsWith(".log"))
        .map((file) => ({ file, size: fs.statSync(path.join(logsDir, file)).size, mtime: fs.statSync(path.join(logsDir, file)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      res.json(files);
    } catch (error) { sendAppError(res, AppError.internal("Unable to list SSH logs", { cause: error }), req); }
  });

  app.get("/api/ssh/logs/:filename", requireAuth, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(logsDir, filename);
    if (!fs.existsSync(filePath)) return sendAppError(res, AppError.notFound("Log not found"), req);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(filePath);
  });

  app.post("/api/ssh/session", requireAuth, async (req, res) => {
    let { ip, username = "root", port = 22, vaultItemId, password: directPassword, cols = 120, rows = 30, vmId, execCommand, jump } = req.body || {};
    if (!ip) return sendAppError(res, AppError.badRequest("ip required"), req);

    if (!directPassword && !vaultItemId && vmId) {
      const mapped = (kvGet("vm-vault-map")?.value || {})[vmId];
      if (mapped) {
        vaultItemId = typeof mapped === "object" ? mapped.vaultItemId : mapped;
        let mappedUser = typeof mapped === "object" ? mapped.sshUser : null;
        if (!mappedUser && vaultItemId) mappedUser = (kvGet("vault-items")?.value || []).find((item) => item.id === vaultItemId)?.user;
        if (mappedUser) username = mappedUser;
        if (typeof mapped === "object" && mapped.sshPort) port = mapped.sshPort;
        if (!jump && typeof mapped === "object" && mapped.jump?.host) jump = mapped.jump;
      }
    }

    if (!directPassword) {
      for (const [id, entry] of sshPool) {
        if (entry.ip === ip && entry.username === username && ["connected", "connecting"].includes(entry.status) && entry.stream && !entry.stream.destroyed) {
          return res.json({ sessionId: id, reattach: true });
        }
      }
    }

    let password = directPassword || null;
    if (!password && vaultItemId) {
      try { password = await lookupVaultPassword(vaultItemId); }
      catch (error) {
        if (error.code === "vault-locked") return sendAppError(res, AppError.unauthorized("Vault is locked — unlock it in the Passwords tab first, then retry."), req);
        throw error;
      }
      // lookupVaultPassword returns null (instead of throwing) when the vault
      // backend call itself failed for a non-"locked" reason (e.g. a transient
      // `bw get password` hiccup) — proceeding would silently attempt a
      // passwordless SSH connect that fails with the same generic auth error
      // as an actually-wrong password, misleading the user into thinking their
      // stored credential is bad when the vault lookup just needs a retry.
      if (!password) return sendAppError(res, AppError.badGateway(
        "Could not fetch the stored password from the vault (Bitwarden lookup failed) — this is not a wrong password, retry the connection."), req);
    }
    const useJump = Boolean(jump?.host);
    let jumpPassword = null;
    if (useJump && jump.vaultItemId) {
      try { jumpPassword = await lookupVaultPassword(jump.vaultItemId); }
      catch (error) {
        if (error.code === "vault-locked") return sendAppError(res, AppError.unauthorized("Vault is locked — unlock it in the Passwords tab first, then retry."), req);
        throw error;
      }
      if (!jumpPassword) return sendAppError(res, AppError.badGateway(
        "Could not fetch the jump host's stored password from the vault (Bitwarden lookup failed) — this is not a wrong password, retry the connection."), req);
    }

    const id = sessionId();
    const safeIp = String(ip).replace(/[^0-9a-zA-Z.\-]/g, "_");
    const safeUser = String(username).replace(/[^0-9a-zA-Z.\-]/g, "_");
    const logPath = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}_${safeIp}_${safeUser}_${id}.log`);
    fs.writeFileSync(logPath, `# SSH log — ${username}@${ip}:${port} — ${new Date().toISOString()}\n\n`);
    const entry = { sessionId: id, ip, username, port: parseInt(port, 10), ssh: null, stream: null, jumpSsh: null, replayBuffer: Buffer.alloc(0), clients: new Set(), status: "connecting", error: null, timeoutId: null, createdAt: Date.now(), logPath };
    sshPool.set(id, entry);
    const ssh = new SSHClient();
    entry.ssh = ssh;

    ssh.on("ready", () => ssh.shell({ term: "xterm-256color", cols: parseInt(cols, 10), rows: parseInt(rows, 10) }, (error, stream) => {
      if (error) return emitError(id, entry, error.message);
      entry.stream = stream;
      entry.status = "connected";
      if (execCommand) setTimeout(() => { try { stream.write(execCommand + "\n"); } catch {} }, 1000);
      broadcast(entry, { type: "status", msg: "connected" });
      const forward = (data) => {
        appendReplay(entry, data);
        appendLog(entry, data);
        broadcast(entry, { type: "data", data: Buffer.from(data).toString("base64") });
      };
      stream.on("data", forward);
      stream.stderr.on("data", forward);
      stream.on("close", () => {
        entry.clients.forEach((client) => { send(client, { type: "status", msg: "closed" }); client.close(); });
        closeEntry(id, entry);
      });
    }));
    ssh.on("error", (error) => emitError(id, entry, friendlyTargetError(error, ip, port)));

    const connectTarget = (sock) => {
      const base = { username, readyTimeout: 12000, hostVerifier: () => true, keepaliveInterval: 15000, keepaliveCountMax: 4, algorithms: SSH_ALGORITHMS, authHandler: makeAuthHandler(username, password) };
      ssh.connect(sock ? { ...base, sock } : { ...base, host: ip, port: parseInt(port, 10) });
    };
    if (useJump) {
      const jumpHost = jump.host;
      const jumpPort = parseInt(jump.port, 10) || 22;
      const jumpUser = jump.user || username;
      const jumpClient = new SSHClient();
      entry.jumpSsh = jumpClient;
      const failJump = (message) => { try { jumpClient.end(); } catch {} emitError(id, entry, message); };
      jumpClient.on("ready", () => jumpClient.forwardOut("127.0.0.1", 0, ip, parseInt(port, 10), (error, stream) => error ? failJump(`Jump host conectado, pero no pudo abrir túnel a ${ip}:${port} — ${error.message}`) : connectTarget(stream)));
      jumpClient.on("error", (error) => {
        const message = error.message || "SSH error";
        if (/Authentication|auth|password/i.test(message)) return failJump(`Autenticación fallida en el jump host ${jumpHost} — revisa su credencial.`);
        if (message.includes("ECONNREFUSED")) return failJump(`Jump host rechazó la conexión — ${jumpHost}:${jumpPort} no acepta SSH.`);
        if (message.includes("ETIMEDOUT") || message.includes("Timed out")) return failJump(`Jump host ${jumpHost} no respondió en 12 segundos.`);
        failJump(`Jump host ${jumpHost}: ${message}`);
      });
      jumpClient.connect({ host: jumpHost, port: jumpPort, username: jumpUser, password: jumpPassword || undefined, readyTimeout: 12000, hostVerifier: () => true, keepaliveInterval: 15000, keepaliveCountMax: 4, algorithms: SSH_ALGORITHMS, authHandler: makeAuthHandler(jumpUser, jumpPassword) });
    } else {
      connectTarget(null);
    }
    scheduleIdle(id);
    res.json({ sessionId: id, reattach: false });
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/ssh/terminal") return socket.destroy();
    if (url.searchParams.get("token") !== token) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws, req) => {
    const id = new URL(req.url, "http://localhost").searchParams.get("sessionId");
    if (!id || !sshPool.has(id)) { send(ws, { type: "error", msg: "SSH session not found — please reconnect." }); ws.close(); return; }
    const entry = sshPool.get(id);
    if (entry.timeoutId) { clearTimeout(entry.timeoutId); entry.timeoutId = null; }
    entry.clients.add(ws);
    if (entry.status === "connected") {
      send(ws, { type: "status", msg: "connected" });
      if (entry.replayBuffer.length) send(ws, { type: "data", data: entry.replayBuffer.toString("base64") });
    } else if (entry.status === "error") {
      send(ws, { type: "error", msg: entry.error || "SSH error" });
      entry.clients.delete(ws);
      return;
    }
    ws.on("message", (message) => {
      try {
        const payload = JSON.parse(message);
        if (!entry.stream) return;
        if (payload.type === "data") entry.stream.write(Buffer.from(payload.data, "base64"));
        if (payload.type === "resize") entry.stream.setWindow(payload.rows, payload.cols, 0, 0);
      } catch {}
    });
    ws.on("close", () => { entry.clients.delete(ws); if (entry.clients.size === 0) scheduleIdle(id); });
  });

  return { sshPool, logsDir };
}

module.exports = { registerSshRoutes };
