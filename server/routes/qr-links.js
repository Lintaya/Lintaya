const { randomBytes } = require("node:crypto");

const MAX_DESTINATION_LENGTH = 2048;
const CODE_LENGTH = 16;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const INTERNAL_SUFFIXES = [".localhost", ".localdomain", ".internal", ".lan", ".home.arpa"];

function ipv4Number(host) {
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    const value = Number(host); return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff ? value : null;
  }
  const parts = host.split("."); if (parts.length !== 4 || parts.some(part => !/^(0x[0-9a-f]+|0[0-7]*|\d+)$/i.test(part))) return null;
  const values = parts.map(part => Number(/^0x/i.test(part) ? parseInt(part, 16) : /^0/.test(part) && part !== "0" ? parseInt(part, 8) : parseInt(part, 10)));
  return values.every((value, index) => Number.isInteger(value) && value >= 0 && value <= 255 && (index < 3 || value <= 255)) ? values.reduce((out, value) => out * 256 + value, 0) : null;
}

function ipv6Number(host) {
  const normalized = host.toLowerCase();
  const halves = normalized.split("::"); if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : []; const right = halves[1] ? halves[1].split(":") : [];
  const expand = values => values.flatMap(value => value.includes(".") ? (() => { const n = ipv4Number(value); return n === null ? [] : [(n >>> 16).toString(16), (n & 0xffff).toString(16)]; })() : [value]);
  const parts = [...expand(left), ...expand(right)]; if (halves.length === 1 ? parts.length !== 8 : parts.length > 8) return null;
  const full = halves.length === 2 ? [...expand(left), ...Array(8 - parts.length).fill("0"), ...expand(right)] : parts;
  if (full.length !== 8 || full.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return full.reduce((out, part) => (out << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function isBlockedHost(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const v4 = ipv4Number(host);
  if (v4 !== null) return v4 === 0 || (v4 >= 0x0a000000 && v4 <= 0x0affffff) || (v4 >= 0x7f000000 && v4 <= 0x7fffffff) || (v4 >= 0xa9fe0000 && v4 <= 0xa9feffff) || (v4 >= 0xac100000 && v4 <= 0xac1fffff) || (v4 >= 0xc0a80000 && v4 <= 0xc0a8ffff) || (v4 >= 0x64400000 && v4 <= 0x647fffff);
  const v6 = ipv6Number(host);
  if (v6 !== null) {
    const mapped = Number(v6 & 0xffffffffn); if ((v6 >> 32n) === 0xffffn) return isBlockedHost([(mapped >>> 24) & 255, (mapped >>> 16) & 255, (mapped >>> 8) & 255, mapped & 255].join("."));
    return v6 === 0n || v6 === 1n || (v6 >= 0xfc000000000000000000000000000000n && v6 <= 0xfdffffffffffffffffffffffffffffffn) || (v6 >= 0xfe800000000000000000000000000000n && v6 <= 0xfebfffffffffffffffffffffffffffffn);
  }
  return host === "localhost" || INTERNAL_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function validateDestination(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_DESTINATION_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("invalid-destination");
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid-destination"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isBlockedHost(url.hostname)) throw new Error("invalid-destination");
  // IDNs are accepted in their URL-normalized Unicode form; callers should
  // display the exact destination before saving so homographs are reviewable.
  return value;
}

function generateCode() { return randomBytes(CODE_LENGTH).toString("base64url"); }
function rowShape(row) { return row && { code: row.code, destination: row.destination, active: !!row.active, createdAt: row.created_at, updatedAt: row.updated_at, scanCount: row.scan_count, lastScannedAt: row.last_scanned_at }; }

function registerQrLinksRoutes({ app, db, kvGet, kvSet, requireAuth, auditActivity, AppError, sendAppError, log = console, now = () => new Date().toISOString(), clock = () => Date.now(), codeFactory = generateCode, rateLimit = RATE_LIMIT, rateWindowMs = RATE_WINDOW_MS }) {
  const list = db.prepare("SELECT * FROM qr_links ORDER BY created_at DESC");
  const get = db.prepare("SELECT * FROM qr_links WHERE code = ?");
  const insert = db.prepare("INSERT INTO qr_links (code, destination, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)");
  const update = db.prepare("UPDATE qr_links SET destination = ?, updated_at = ? WHERE code = ?");
  const toggle = db.prepare("UPDATE qr_links SET active = ?, updated_at = ? WHERE code = ?");
  const remove = db.prepare("DELETE FROM qr_links WHERE code = ?");
  const scan = db.prepare("UPDATE qr_links SET scan_count = scan_count + 1, last_scanned_at = ? WHERE code = ? AND active = 1");
  const hits = new Map();
  const limited = req => { const key = req.ip || req.socket?.remoteAddress || "unknown"; const nowMs = clock(); for (const [address, entry] of hits) if (nowMs - entry.started >= rateWindowMs) hits.delete(address); const old = hits.get(key); if (!old) { hits.set(key, { started: nowMs, count: 1 }); return false; } old.count++; return old.count > rateLimit; };

  app.get("/api/qr-links", requireAuth, (req, res) => res.json(list.all().map(rowShape)));
  app.get("/api/qr-links/:code", requireAuth, (req, res) => { const row = get.get(req.params.code); if (!row) return sendAppError(res, AppError.notFound("not-found"), req); res.json(rowShape(row)); });
  app.get("/api/settings/qr-base-url", requireAuth, (req, res) => res.json({ baseUrl: kvGet("qr-base-url")?.value || `${req.protocol}://${req.get("host")}` }));
  app.put("/api/settings/qr-base-url", requireAuth, auditActivity({ provider: "settings", action: "Cambiar base URL de QR" }), (req, res) => {
    try { const value = new URL(String(req.body?.baseUrl || "")); if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.pathname !== "/" || value.search || value.hash) throw new Error("invalid-base-url"); const baseUrl = value.origin; kvSet("qr-base-url", baseUrl); res.locals.auditMessage = "Cambiar base URL de QR"; res.json({ baseUrl }); } catch (error) { return sendAppError(res, AppError.badRequest(error.message), req); }
  });
  app.post("/api/qr-links", requireAuth, auditActivity({ provider: "qr-links", action: "Crear enlace QR" }), (req, res) => {
    try {
      const destination = validateDestination(req.body?.destination); const createdAt = now(); let row;
      for (let attempt = 0; attempt < 5; attempt++) { const code = codeFactory(); try { insert.run(code, destination, createdAt, createdAt); row = get.get(code); break; } catch (error) { if (!String(error.message).includes("UNIQUE")) throw error; } }
      if (!row) throw new Error("code-generation-failed");
      res.locals.auditMessage = `Crear enlace QR ${row.code}`; res.json(rowShape(row));
    } catch (error) { return sendAppError(res, AppError.badRequest(error.message), req); }
  });
  app.put("/api/qr-links/:code", requireAuth, auditActivity({ provider: "qr-links", action: "Editar enlace QR" }), (req, res) => {
    const old = get.get(req.params.code); if (!old) return sendAppError(res, AppError.notFound("not-found"), req);
    try { const destination = validateDestination(req.body?.destination); update.run(destination, now(), old.code); res.locals.auditMessage = `Editar enlace QR ${old.code}`; res.locals.auditMeta = { oldDestination: old.destination, newDestination: destination }; res.json(rowShape(get.get(old.code))); } catch (error) { return sendAppError(res, AppError.badRequest(error.message), req); }
  });
  app.post("/api/qr-links/:code/disable", requireAuth, auditActivity({ provider: "qr-links", action: "Desactivar enlace QR" }), (req, res) => { const old = get.get(req.params.code); if (!old) return sendAppError(res, AppError.notFound("not-found"), req); toggle.run(0, now(), old.code); res.locals.auditMessage = `Desactivar enlace QR ${old.code}`; res.json(rowShape(get.get(old.code))); });
  app.post("/api/qr-links/:code/enable", requireAuth, auditActivity({ provider: "qr-links", action: "Activar enlace QR" }), (req, res) => { const old = get.get(req.params.code); if (!old) return sendAppError(res, AppError.notFound("not-found"), req); toggle.run(1, now(), old.code); res.locals.auditMessage = `Activar enlace QR ${old.code}`; res.json(rowShape(get.get(old.code))); });
  app.delete("/api/qr-links/:code", requireAuth, auditActivity({ provider: "qr-links", action: "Eliminar enlace QR" }), (req, res) => { if (!get.get(req.params.code)) return sendAppError(res, AppError.notFound("not-found"), req); remove.run(req.params.code); res.json({ ok: true }); });

  app.get("/r/:code", (req, res) => {
    const tooFast = limited(req); const row = get.get(req.params.code); const active = row?.active;
    if (tooFast || !row || !active) { if (tooFast) log.warn?.("QR redirect rate limit", { ip: req.ip || req.socket?.remoteAddress || "unknown" }); res.set({ "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" }); return res.status(404).end(); }
    if (req.method !== "HEAD") scan.run(now(), row.code); res.set({ "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" }); res.redirect(302, row.destination);
  });
  return { validateDestination, rateStateSize: () => hits.size };
}

module.exports = { registerQrLinksRoutes, validateDestination, generateCode };
