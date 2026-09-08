const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");
const { MAIN_MIGRATIONS, migrate } = require("../database");
const { AppError } = require("../errors");
const { createApprovalStore } = require("./approval-store");

function setup({ now = 1_000, ttlMs = 100 } = {}) {
  const db = new Database(":memory:");
  migrate(db, MAIN_MIGRATIONS);
  let time = now;
  const store = createApprovalStore({ db, now: () => time, ttlMs });
  return { db, store, advance(ms) { time += ms; } };
}

function request(store, input = { id: "doc-1" }, requester = "agent:codex") {
  return store.request({ connectionId: "outline", connectorTypeId: "outline", actionId: "delete-document", actionTitle: "Delete document", input, requester, requestId: "req-1" });
}

test("approval requests persist a safe public shape and append an independent event", () => {
  const { db, store } = setup();
  const approval = request(store, { id: "doc-1", nested: { label: "Architecture" } });
  assert.equal(approval.status, "pending");
  assert.deepEqual(approval.input, { id: "doc-1", nested: { label: "Architecture" } });
  assert.equal(approval.requester, "agent:codex");
  assert.equal(store.events(approval.id)[0].type, "requested");
  assert.equal(db.prepare("SELECT input_json FROM approvals WHERE id = ?").get(approval.id).input_json.includes("doc-1"), true);
  db.close();
});

test("secret-like action input is rejected before it enters the approval ledger", () => {
  const { db, store } = setup();
  assert.throws(() => request(store, { id: "doc-1", apiKey: "do-not-store" }), (err) => err instanceof AppError && err.message === "approval-input-contains-secret");
  assert.equal(store.list().length, 0);
  db.close();
});

test("approval is bound to exact input, is single-use, and records completion", () => {
  const { db, store } = setup();
  const approval = request(store);
  store.resolve(approval.id, "approve", "human:local");
  assert.throws(() => store.consume(approval.id, { connectionId: "outline", connectorTypeId: "outline", actionId: "delete-document", input: { id: "doc-2" } }), (err) => err instanceof AppError && err.message === "approval-does-not-match-action");
  store.consume(approval.id, { connectionId: "outline", connectorTypeId: "outline", actionId: "delete-document", input: { id: "doc-1" } });
  store.finish(approval.id, true);
  assert.equal(store.get(approval.id).status, "succeeded");
  assert.throws(() => store.consume(approval.id, { connectionId: "outline", connectorTypeId: "outline", actionId: "delete-document", input: { id: "doc-1" } }), (err) => err instanceof AppError && err.message === "approval-not-usable");
  db.close();
});

test("requester cannot self-approve and pending requests expire fail-closed", () => {
  const { db, store, advance } = setup();
  const approval = request(store, { id: "doc-1" }, "human:local");
  assert.throws(() => store.resolve(approval.id, "approve", "human:local"), (err) => err instanceof AppError && err.message === "approval-self-approval-forbidden");
  advance(101);
  assert.equal(store.get(approval.id).status, "expired");
  assert.throws(() => store.resolve(approval.id, "approve", "another-human"), (err) => err instanceof AppError && err.message === "approval-not-pending");
  db.close();
});
