// SEC-003 — local, fail-closed approval ledger for destructive actions.
// The store never exposes raw input: it retains it only long enough to resume
// the exact approved action, while API/audit views receive a recursively
// redacted representation plus a SHA-256 fingerprint.
const crypto = require("node:crypto");
const { AppError } = require("../errors");

const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|credential)/i;
const PENDING = "pending";
const FINAL = new Set(["rejected", "expired", "succeeded", "failed"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(input) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(input ?? {}))).digest("hex");
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redact(child)]));
  }
  return value;
}

function containsSecretKey(value) {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => SECRET_KEY.test(key) || containsSecretKey(child));
}

function publicApproval(row) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectorTypeId: row.connector_type_id,
    actionId: row.action_id,
    actionTitle: row.action_title,
    input: redact(JSON.parse(row.input_json)),
    inputHash: row.input_hash,
    requester: row.requester,
    requestId: row.request_id,
    status: row.status,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    completedAt: row.completed_at,
    failureReason: row.failure_reason,
  };
}

function createApprovalStore({ db, now = Date.now, ttlMs = 10 * 60 * 1000, newId = crypto.randomUUID }) {
  if (!db) throw new TypeError("createApprovalStore requires db");
  const getRow = db.prepare("SELECT * FROM approvals WHERE id = ?");
  const insert = db.prepare(`INSERT INTO approvals
    (id, connection_id, connector_type_id, action_id, action_title, input_json, input_hash, requester, request_id, status, requested_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const expire = db.prepare("UPDATE approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND expires_at <= ?");
  const list = db.prepare("SELECT * FROM approvals WHERE (? IS NULL OR status = ?) ORDER BY requested_at DESC");
  const addEvent = db.prepare("INSERT INTO approval_events (id, approval_id, type, actor, created_at, meta_json) VALUES (?, ?, ?, ?, ?, ?)");
  const approve = db.prepare("UPDATE approvals SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pending' AND expires_at > ?");
  const reject = db.prepare("UPDATE approvals SET status = 'rejected', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pending'");
  const consumeApproval = db.prepare("UPDATE approvals SET status = 'executing' WHERE id = ? AND status = 'approved' AND expires_at > ?");
  const complete = db.prepare("UPDATE approvals SET status = ?, completed_at = ?, failure_reason = ? WHERE id = ? AND status = 'executing'");

  function event(approvalId, type, actor, meta = {}) {
    addEvent.run(newId(), approvalId, type, actor || null, now(), JSON.stringify(redact(meta)));
  }
  function expirePending() { expire.run(now(), now()); }
  function get(id) { expirePending(); return publicApproval(getRow.get(id)); }

  function request({ connectionId, connectorTypeId, actionId, actionTitle, input, requester, requestId }) {
    if (containsSecretKey(input)) throw AppError.badRequest("approval-input-contains-secret");
    const id = newId();
    const requestedAt = now();
    const row = {
      id, connectionId, connectorTypeId, actionId, actionTitle,
      input: input ?? {}, inputHash: fingerprint(input ?? {}), requester: requester || "human:local", requestId: requestId || null,
      requestedAt, expiresAt: requestedAt + ttlMs,
    };
    insert.run(id, row.connectionId, row.connectorTypeId, row.actionId, row.actionTitle, JSON.stringify(row.input), row.inputHash, row.requester, row.requestId, PENDING, row.requestedAt, row.expiresAt);
    event(id, "requested", row.requester, { actionId, connectionId, inputHash: row.inputHash });
    return get(id);
  }

  function listPending(status = null) { expirePending(); return list.all(status, status).map(publicApproval); }

  function resolve(id, decision, approver) {
    expirePending();
    const row = getRow.get(id);
    if (!row) throw AppError.notFound("approval-not-found");
    if (row.status !== PENDING) throw AppError.conflict("approval-not-pending", { status: row.status });
    if (!approver || approver.startsWith("agent:")) throw AppError.forbidden("approval-requires-human");
    if (row.requester === approver) throw AppError.forbidden("approval-self-approval-forbidden");
    const changed = decision === "approve"
      ? approve.run(now(), approver, id, now()).changes
      : reject.run(now(), approver, id).changes;
    if (!changed) throw AppError.conflict("approval-not-pending");
    event(id, decision === "approve" ? "approved" : "rejected", approver, { requester: row.requester });
    return { row: getRow.get(id), approval: get(id) };
  }

  // Atomically turns an approved request into the only in-flight execution.
  // It binds all identity and parameters again; an approval is never a general
  // permission for another action or changed input.
  function consume(id, { connectionId, connectorTypeId, actionId, input }) {
    expirePending();
    const row = getRow.get(id);
    if (!row) throw AppError.notFound("approval-not-found");
    if (row.connection_id !== connectionId || row.connector_type_id !== connectorTypeId || row.action_id !== actionId || row.input_hash !== fingerprint(input ?? {})) {
      throw AppError.forbidden("approval-does-not-match-action");
    }
    if (!consumeApproval.run(id, now()).changes) throw AppError.conflict("approval-not-usable", { status: row.status });
    event(id, "executing", row.resolved_by, { actionId, connectionId });
    return row;
  }

  function finish(id, ok, failureReason = null) {
    const status = ok ? "succeeded" : "failed";
    if (complete.run(status, now(), failureReason, id).changes) event(id, status, null, {});
    return get(id);
  }

  function events(id) {
    if (!getRow.get(id)) throw AppError.notFound("approval-not-found");
    return db.prepare("SELECT id, type, actor, created_at, meta_json FROM approval_events WHERE approval_id = ? ORDER BY created_at ASC").all(id)
      .map((row) => ({ id: row.id, type: row.type, actor: row.actor, createdAt: row.created_at, meta: JSON.parse(row.meta_json) }));
  }

  return { request, list: listPending, get, resolve, consume, finish, events, fingerprint, redact, FINAL };
}

module.exports = { createApprovalStore, fingerprint, redact, containsSecretKey };
