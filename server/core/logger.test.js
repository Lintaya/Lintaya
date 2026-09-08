const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createLogger } = require("./logger");

function captureConsole(fn) {
  const calls = { log: [], warn: [], error: [] };
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (line) => calls.log.push(line);
  console.warn = (line) => calls.warn.push(line);
  console.error = (line) => calls.error.push(line);
  try {
    fn();
  } finally {
    Object.assign(console, original);
  }
  return calls;
}

test("info/debug write to console.log, warn/error to their own methods", () => {
  const log = createLogger({}, { minLevel: "debug" });
  const calls = captureConsole(() => {
    log.debug("debug msg");
    log.info("info msg");
    log.warn("warn msg");
    log.error("error msg");
  });
  assert.equal(calls.log.length, 2);
  assert.equal(calls.warn.length, 1);
  assert.equal(calls.error.length, 1);
  assert.match(calls.log[1], /INFO .*info msg/);
});

test("messages below minLevel are dropped", () => {
  const log = createLogger({}, { minLevel: "warn" });
  const calls = captureConsole(() => {
    log.info("should be dropped");
    log.warn("should appear");
  });
  assert.equal(calls.log.length, 0);
  assert.equal(calls.warn.length, 1);
});

test("bindings and per-call meta are serialized and merged", () => {
  const log = createLogger({ component: "vault" }, { minLevel: "debug" });
  const calls = captureConsole(() => {
    log.warn("locked", { reason: "idle-timeout" });
  });
  assert.equal(calls.warn.length, 1);
  assert.match(calls.warn[0], /^\S+ WARN \[vault\] locked /);
  assert.match(calls.warn[0], /"reason":"idle-timeout"/);
});

test("child() merges bindings without mutating the parent", () => {
  const parent = createLogger({ component: "core" }, { minLevel: "debug" });
  const child = parent.child({ requestId: "req-1" });
  const calls = captureConsole(() => {
    parent.info("parent line");
    child.info("child line");
  });
  assert.doesNotMatch(calls.log[0], /requestId/);
  assert.match(calls.log[1], /"requestId":"req-1"/);
});
