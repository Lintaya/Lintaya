// Shared HTTP-level test harness for server/routes/*.test.js — drives a real
// Express app through .handle() with a minimal fake request/response pair, no
// open port needed. Extracted from server/app.test.js so each domain router
// test file doesn't repeat the same plumbing (same reasoning that produced
// connectors/sdk/test-harness.js for connector route tests).
//
// The request must be a real stream.Readable (not a bare EventEmitter) —
// body-parser's raw-body calls stream methods like pause()/removeListener()
// that only exist on an actual Readable, so a hand-rolled emit-only mock
// breaks as soon as a route reads a JSON body.
const { PassThrough, Readable } = require("node:stream");
const { EventEmitter } = require("node:events");

function request(application, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const responseEvents = new EventEmitter();
    const responseHeaders = new Map();
    const chunks = [];
    const bodyBuffer = body === undefined
      ? null
      : Buffer.isBuffer(body)
      ? body
      : Buffer.from(JSON.stringify(body));

    const req = new Readable({
      read() {
        this.push(bodyBuffer);
        this.push(null);
      },
    });
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(
      Object.entries({
        // express.json() (via type-is's hasBody()) only attempts to read the
        // body at all when content-length/transfer-encoding says there is
        // one — without this it sets req.body = {} and never reads the stream.
        ...(bodyBuffer ? {
          "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json",
          "content-length": String(bodyBuffer.length),
        } : {}),
        ...headers,
      }).map(([name, value]) => [name.toLowerCase(), value]),
    );
    // On cleanup, Node treats a Readable with a .socket property as
    // HTTP-incoming-like and internally waits on end-of-stream(this.socket) —
    // that requires a real Stream instance, not a plain object.
    const socket = new PassThrough();
    req.connection = socket;
    req.socket = socket;
    // Express reassigns the prototype of every request it handles, so this
    // Readable also inherits http.IncomingMessage.prototype — and with it an
    // _destroy that, from Node 24 on, tears down an abort signal and a socket
    // that only exist on a request Node's own HTTP server built. It throws
    // "Cannot read properties of undefined (reading 'removeListener')" the
    // moment the stream ends. Keep the plain Readable teardown instead, which
    // is all a test double needs.
    req._destroy = Readable.prototype._destroy;

    const res = {
      statusCode: 200,
      headersSent: false,
      finished: false,
      setHeader(name, value) {
        responseHeaders.set(name.toLowerCase(), value);
      },
      getHeader(name) {
        return responseHeaders.get(name.toLowerCase());
      },
      getHeaders() {
        return Object.fromEntries(responseHeaders);
      },
      removeHeader(name) {
        responseHeaders.delete(name.toLowerCase());
      },
      flushHeaders() {
        this.headersSent = true;
      },
      write(chunk) {
        this.headersSent = true;
        if (chunk) chunks.push(Buffer.from(chunk));
        return true;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        this.headersSent = true;
        this.finished = true;
        responseEvents.emit("finish");
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: this.statusCode,
          headers: Object.fromEntries(responseHeaders),
          text,
          json: () => JSON.parse(text),
        });
      },
      on: responseEvents.on.bind(responseEvents),
      once: responseEvents.once.bind(responseEvents),
      emit: responseEvents.emit.bind(responseEvents),
    };

    application.handle(req, res, reject);
  });
}

module.exports = { request };
