const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createConnectorLog } = require("./connector-log");

function makeKv(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    kvGet: (key) => (rows.has(key) ? { value: rows.get(key) } : null),
    kvSet: (key, value) => rows.set(key, value),
    rows,
  };
}

test("writes a new entry under connector-log-<id> with t/ts/level/msg", () => {
  const { kvGet, kvSet } = makeKv();
  const connectorLog = createConnectorLog({ kvGet, kvSet });
  connectorLog("gitlab", "ok", "gitlab.sync · 42ms");
  const log = kvGet("connector-log-gitlab").value;
  assert.equal(log.length, 1);
  assert.equal(log[0].level, "ok");
  assert.equal(log[0].msg, "gitlab.sync · 42ms");
  assert.equal(typeof log[0].t, "string");
  assert.equal(typeof log[0].ts, "number");
  assert.equal(log[0].meta, undefined);
});

test("prepends new entries (newest first) and caps at 30", () => {
  const { kvGet, kvSet } = makeKv();
  const connectorLog = createConnectorLog({ kvGet, kvSet });
  for (let i = 0; i < 35; i++) connectorLog("gitlab", "ok", `entry ${i}`);
  const log = kvGet("connector-log-gitlab").value;
  assert.equal(log.length, 30);
  assert.equal(log[0].msg, "entry 34");
});

test("attaches meta only when it has keys", () => {
  const { kvGet, kvSet } = makeKv();
  const connectorLog = createConnectorLog({ kvGet, kvSet });
  connectorLog("gitlab", "err", "boom", { actionId: "sync" });
  connectorLog("gitlab", "ok", "fine", {});
  const log = kvGet("connector-log-gitlab").value;
  assert.equal(log[0].msg, "fine");
  assert.equal(log[0].meta, undefined); // empty object -> omitted
  assert.deepEqual(log[1].meta, { actionId: "sync" });
});

test("keys logs per connector id, never mixing two connections' entries", () => {
  const { kvGet, kvSet } = makeKv();
  const connectorLog = createConnectorLog({ kvGet, kvSet });
  connectorLog("gitlab", "ok", "a");
  connectorLog("gitlab2", "ok", "b");
  assert.equal(kvGet("connector-log-gitlab").value.length, 1);
  assert.equal(kvGet("connector-log-gitlab2").value.length, 1);
  assert.equal(kvGet("connector-log-gitlab").value[0].msg, "a");
  assert.equal(kvGet("connector-log-gitlab2").value[0].msg, "b");
});
