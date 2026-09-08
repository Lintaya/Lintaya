const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { executeSsh, oneAttemptAuth } = require("./ssh-exec");

test("oneAttemptAuth submits a password once and refuses retries", () => {
  const auth = oneAttemptAuth("ops", "secret"); const values = [];
  auth(null, false, (value) => values.push(value));
  auth(["password"], false, (value) => values.push(value));
  auth(["password"], false, (value) => values.push(value));
  assert.deepEqual(values, ["none", { type: "password", username: "ops", password: "secret" }, false]);
});

test("executeSsh returns stdout and stderr and closes the client", async () => {
  const instances = [];
  class FakeClient extends EventEmitter {
    constructor() { super(); instances.push(this); }
    connect() { queueMicrotask(() => this.emit("ready")); }
    exec(_command, callback) { const stream = new EventEmitter(); stream.stderr = new EventEmitter(); callback(null, stream); queueMicrotask(() => { stream.emit("data", "out"); stream.stderr.emit("data", "err"); stream.emit("close"); }); }
    end() { this.ended = true; }
  }
  const result = await executeSsh({ SSHClient: FakeClient, ip: "10.0.0.1", username: "ops", password: "secret", command: "uptime" });
  assert.deepEqual(result, { out: "out", err: "err" }); assert.equal(instances[0].ended, true);
});
