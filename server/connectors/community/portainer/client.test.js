const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizePortainerContainer,
  portainerAuthHeaders,
  portainerFetch,
  portainerLogin,
  portainerToken,
  syncPortainer,
} = require("./client");

const API_KEY_CFG = { baseUrl: "https://portainer.test", apiKey: "ptr_secret" };
const USERPASS_CFG = { baseUrl: "https://portainer.test", username: "ana", password: "hunter2" };

test("an API key travels as a header and never mints a JWT", async () => {
  assert.deepEqual(portainerAuthHeaders(API_KEY_CFG, null), { "X-API-Key": "ptr_secret" });
  assert.deepEqual(portainerAuthHeaders(USERPASS_CFG, "jwt-123"), { Authorization: "Bearer jwt-123" });

  let loginCalls = 0;
  const token = await portainerToken(API_KEY_CFG, {
    request: async () => { loginCalls += 1; return { jwt: "should-not-happen" }; },
  });
  assert.equal(token, null, "an API key needs no token exchange");
  assert.equal(loginCalls, 0);
});

test("username/password logs in and returns the JWT", async () => {
  const seen = [];
  const token = await portainerToken(USERPASS_CFG, {
    request: async (opts) => { seen.push(opts); return { jwt: "jwt-abc" }; },
  });
  assert.equal(token, "jwt-abc");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].path, "/api/auth");
  assert.deepEqual(seen[0].body, { username: "ana", password: "hunter2" });
});

test("a login response without a JWT fails loudly", async () => {
  await assert.rejects(
    () => portainerLogin(USERPASS_CFG, { request: async () => ({ message: "ok but empty" }) }),
    /no jwt in response/,
  );
});

test("requests preserve a base URL that carries a path prefix", async () => {
  const seen = [];
  await portainerFetch(
    { baseUrl: "https://host.test/portainer", apiKey: "k" },
    "/api/endpoints",
    null,
    { request: async (opts) => { seen.push(opts); return []; } },
  );
  // The SDK joins base + path, so a reverse-proxied subpath survives. The old
  // `new URL(path, base)` form dropped it and hit /api/endpoints at the root.
  assert.equal(seen[0].baseUrl, "https://host.test/portainer");
  assert.equal(seen[0].path, "/api/endpoints");
});

test("normalizes a Docker container into the shape the UI expects", () => {
  const normalized = normalizePortainerContainer({
    Id: "abcdef0123456789",
    Names: ["/web"],
    Image: "nginx:latest",
    State: "RUNNING",
    Status: "Up 3 hours",
    Created: 1_700_000_000,
    Ports: [
      { PublicPort: 8080, PrivatePort: 80, Type: "tcp" },
      { PrivatePort: 9000, Type: "tcp" },
    ],
  });

  assert.equal(normalized.id, "abcdef012345", "the id is trimmed to 12 chars");
  assert.equal(normalized.name, "web", "the leading slash is dropped");
  assert.equal(normalized.state, "running");
  assert.deepEqual(normalized.ports, ["8080->80/tcp"], "unpublished ports are omitted");
  assert.equal(normalized.createdAt, new Date(1_700_000_000 * 1000).toISOString());
});

test("sync collects containers per endpoint and resolves each host IP", async () => {
  const fetch = async (cfg, apiPath) => {
    if (apiPath === "/api/endpoints") {
      return [
        { Id: 1, Name: "local", URL: "unix:///var/run/docker.sock" },
        { Id: 2, Name: "agent", URL: "tcp://10.0.0.1:9001" },
      ];
    }
    if (apiPath.startsWith("/api/endpoints/1/")) return [{ Id: "aaa", Names: ["/one"], State: "running" }];
    return [{ Id: "bbb", Names: ["/two"], State: "exited" }, { Id: "ccc", Names: ["/three"], State: "running" }];
  };

  const { endpoints, total } = await syncPortainer(
    { baseUrl: "https://10.0.0.1:9443", apiKey: "k" },
    { fetch, token: async () => null },
  );

  assert.equal(total, 3);
  assert.equal(endpoints[0].hostIp, "10.0.0.1", "the unix socket falls back to the Portainer host");
  assert.equal(endpoints[1].hostIp, "10.0.0.1", "an agent endpoint carries its own IP");
  assert.equal(endpoints[1].containers.length, 2);
});

test("one unreachable endpoint does not abort the whole sync", async () => {
  const fetch = async (cfg, apiPath) => {
    if (apiPath === "/api/endpoints") return [{ Id: 1, Name: "down" }, { Id: 2, Name: "up" }];
    if (apiPath.startsWith("/api/endpoints/1/")) throw new Error("connect ETIMEDOUT");
    return [{ Id: "ok", Names: ["/survivor"], State: "running" }];
  };

  const { endpoints, total } = await syncPortainer(
    { baseUrl: "https://portainer.test", apiKey: "k" },
    { fetch, token: async () => null },
  );

  assert.equal(endpoints.length, 2);
  assert.deepEqual(endpoints[0].containers, [], "the failed endpoint reports no containers");
  assert.equal(total, 1);
});
