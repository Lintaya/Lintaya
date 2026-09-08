// Express reassigns the prototype of every request it handles, so the Readable
// this harness hands it ends up inheriting http.IncomingMessage — including a
// _destroy that, from Node 24 on, tears down an abort signal and a socket that
// only a request built by Node's own HTTP server has. The harness keeps the
// plain Readable teardown instead; this test proves it, on any Node version,
// by watching whether IncomingMessage's own _destroy ever runs.
const assert = require("node:assert/strict");
const test = require("node:test");
const { IncomingMessage } = require("node:http");

const { createApp } = require("../app");
const { request } = require("./test-http-harness");

test("the request double never falls into IncomingMessage's own teardown", async () => {
  const application = createApp({ token: "test-token" });
  application.post("/echo", (req, res) => res.end(JSON.stringify(req.body)));

  const original = IncomingMessage.prototype._destroy;
  let ran = false;
  IncomingMessage.prototype._destroy = function watched(err, cb) {
    ran = true;
    return original.call(this, err, cb);
  };

  try {
    const response = await request(application, "POST", "/echo", { body: { hello: "world" } });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.text), { hello: "world" });
    // The stream tears down on a later tick than the response.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ran, false, "the double used IncomingMessage._destroy");
  } finally {
    IncomingMessage.prototype._destroy = original;
  }
});
