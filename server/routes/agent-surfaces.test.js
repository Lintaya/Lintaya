const assert = require("node:assert/strict");
const test = require("node:test");
const { join } = require("node:path");
const { registerAgentSurfaceRoutes } = require("./agent-surfaces");

test("agent surface routes serve the English and Spanish llms indexes as plain text", () => {
  const routes = new Map();
  registerAgentSurfaceRoutes({
    app: { get(route, handler) { routes.set(route, handler); } },
    rootDir: "C:/lintaya",
  });

  for (const [route, file] of [["/llms.txt", "llms.txt"], ["/llms.es.txt", "llms.es.txt"]]) {
    const calls = [];
    routes.get(route)({}, {
      type(value) { calls.push(["type", value]); return this; },
      sendFile(value) { calls.push(["sendFile", value]); },
    });
    assert.deepEqual(calls, [["type", "text/plain"], ["sendFile", join("C:/lintaya", file)]]);
  }
});
