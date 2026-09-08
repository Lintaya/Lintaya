const assert = require("node:assert/strict");
const test = require("node:test");

const { registerPortainerRoutes } = require("./routes");
const { createRouteHarness } = require("../../sdk/test-harness");

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

const createHarness = createRouteHarness(registerPortainerRoutes, {
  setup: () => ({
    defaults: {
      now: () => NOW,
      token: async () => null,
      fetch: async () => [{ Id: 1, Name: "local" }],
      sync: async () => ({ endpoints: [{ id: 1, name: "local", containers: [] }], total: 0 }),
    },
  }),
});

test("configuration never returns the API key or the password", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-portainer", {
    baseUrl: "https://portainer.test",
    apiKey: "ptr-must-not-leak",
    username: "ana",
    password: "pass-must-not-leak",
  });

  const response = await harness.invoke("GET", "/api/connectors/portainer/config");
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(response.body.hasApiKey, true);
  assert.equal(response.body.auth, "apikey", "an API key wins over user/pass");
  assert.equal(response.body.username, "ana");
});

test("configuration reports the user/pass mode when no API key is stored", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-portainer", { baseUrl: "https://p.test", username: "ana", password: "x" });
  const response = await harness.invoke("GET", "/api/connectors/portainer/config");
  assert.equal(response.body.auth, "userpass");
  assert.equal(response.body.hasApiKey, false);
});

test("an unconfigured connector says so instead of erroring", async () => {
  const harness = createHarness();
  const response = await harness.invoke("GET", "/api/connectors/portainer/config");
  assert.deepEqual(response.body, { configured: false });
});

test("configuration requires a base URL and some form of credential", async () => {
  const harness = createHarness();

  const noUrl = await harness.invoke("POST", "/api/connectors/portainer/config", { apiKey: "k" });
  assert.equal(noUrl.status, 400);

  const noCreds = await harness.invoke("POST", "/api/connectors/portainer/config", { baseUrl: "https://p.test" });
  assert.equal(noCreds.status, 400);
  assert.match(noCreds.body.error, /API key or username\+password/);

  // A username without its password is not a usable credential either.
  const halfCreds = await harness.invoke("POST", "/api/connectors/portainer/config", { baseUrl: "https://p.test", username: "ana" });
  assert.equal(halfCreds.status, 400);
});

test("configuration strips trailing slashes from the base URL", async () => {
  const harness = createHarness();
  await harness.invoke("POST", "/api/connectors/portainer/config", { baseUrl: "https://p.test///", apiKey: "k" });
  assert.equal(harness.values.get("connector-config-portainer").baseUrl, "https://p.test");
});

test("test reports the endpoint count and records status", async () => {
  const harness = createHarness();
  harness.values.set("connector-config-portainer", { baseUrl: "https://p.test", apiKey: "k" });

  const response = await harness.invoke("POST", "/api/connectors/portainer/test");
  assert.equal(response.body.ok, true);
  assert.equal(response.body.endpoints, 1);
  assert.equal(harness.values.get("connector-status-portainer").status, "ok");
});

test("test maps a 401 to a credential hint rather than the raw HTTP error", async () => {
  const harness = createHarness({
    fetch: async () => { const error = new Error("HTTP 401: unauthorized"); error.status = 401; throw error; },
  });
  harness.values.set("connector-config-portainer", { baseUrl: "https://p.test", apiKey: "k" });

  const response = await harness.invoke("POST", "/api/connectors/portainer/test");
  assert.equal(response.status, 502);
  assert.match(response.body.error, /Credenciales inválidas/);
});

test("sync stores endpoints and reports the container count", async () => {
  const harness = createHarness({
    sync: async () => ({
      endpoints: [{ id: 1, name: "local", containers: [{ id: "a" }, { id: "b" }] }],
      total: 2,
    }),
  });
  harness.values.set("connector-config-portainer", { baseUrl: "https://p.test", apiKey: "k" });

  const response = await harness.invoke("POST", "/api/connectors/portainer/sync");
  assert.equal(response.body.ok, true);
  assert.equal(response.body.containers, 2);
  assert.equal(harness.values.get("connector-data-portainer").endpoints.length, 1);
  assert.equal(harness.values.get("connector-status-portainer").itemsSynced, 2);
  assert.match(harness.logs.at(-1).message, /1 endpoints, 2 containers/);
});

test("failures redact the stored credentials from the error", async () => {
  const harness = createHarness({
    sync: async () => { throw new Error("upstream said ptr-secret-key is bad, also hunter2"); },
  });
  harness.values.set("connector-config-portainer", {
    baseUrl: "https://p.test",
    apiKey: "ptr-secret-key",
    password: "hunter2",
  });

  const response = await harness.invoke("POST", "/api/connectors/portainer/sync");
  assert.equal(response.status, 502);
  assert.equal(response.body.error.includes("ptr-secret-key"), false);
  assert.equal(response.body.error.includes("hunter2"), false);
  assert.equal(harness.values.get("connector-status-portainer").lastError.includes("ptr-secret-key"), false);
});

test("test and sync refuse to run before the connector is configured", async () => {
  const harness = createHarness();
  assert.equal((await harness.invoke("POST", "/api/connectors/portainer/test")).status, 400);
  assert.equal((await harness.invoke("POST", "/api/connectors/portainer/sync")).status, 400);
});
