const assert = require("node:assert/strict");
const test = require("node:test");
const { demuxDockerLog, deriveContainerState, normalizeInspect, parseDockerPs } = require("./containers");

test("container helpers normalize older Docker states and ps rows", () => {
  assert.equal(deriveContainerState("", "Up 2 hours (healthy)"), "running");
  assert.equal(deriveContainerState("", "Exited (0) 3 minutes ago"), "exited");
  const [container] = parseDockerPs('{"ID":"0123456789abcdef","Names":"api","Image":"example/api","Status":"Up 1 minute","Ports":"80/tcp, 443/tcp"}');
  assert.deepEqual(container, { id: "0123456789ab", name: "api", image: "example/api", state: "running", status: "Up 1 minute", ports: ["80/tcp", "443/tcp"], createdAt: null, cpuPct: null, memUsage: null });
});

test("Docker log demultiplexer accepts plain and framed streams", () => {
  assert.equal(demuxDockerLog("plain"), "plain");
  const payload = Buffer.from("hello"); const frame = Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0, 0, payload.length]), payload]);
  assert.equal(demuxDockerLog(frame), "hello");
});

test("inspect normalization does not expose implementation-only fields", () => {
  const value = normalizeInspect({ Id: "abcdef0123456789", Name: "/api", Config: { Image: "example/api", Env: ["PORT=80"] }, State: { Status: "running" }, NetworkSettings: { Networks: { default: { IPAddress: "172.17.0.2" } }, Ports: { "80/tcp": [] } } });
  assert.equal(value.name, "api"); assert.deepEqual(value.networks, [{ name: "default", ip: "172.17.0.2" }]); assert.deepEqual(value.ports, ["80/tcp"]);
});
