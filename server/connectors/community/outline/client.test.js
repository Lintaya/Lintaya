const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  buildOutlineUrl,
  normalizeDocumentDetail,
  outlineRequest,
  syncOutline,
} = require("./client");

function fakeTransport(capture, responseBody = { data: { ok: true } }) {
  return {
    request(options, onResponse) {
      Object.assign(capture, { options, body: "" });
      const request = new EventEmitter();
      request.write = (chunk) => { capture.body += chunk; };
      request.destroy = () => {};
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        onResponse(response);
        response.emit("data", JSON.stringify(responseBody));
        response.emit("end");
      };
      return request;
    },
  };
}

test("preserves a self-hosted Outline base path", () => {
  assert.equal(
    buildOutlineUrl("https://example.test/outline", "/api/auth.info").href,
    "https://example.test/outline/api/auth.info",
  );
});

test("Outline requests are POST JSON with bearer authentication", async () => {
  const capture = {};
  const result = await outlineRequest(
    "https://outline.example.test",
    "outline-test-key",
    "/api/documents.info",
    { id: "document-1" },
    { transport: fakeTransport(capture) },
  );

  assert.equal(capture.options.method, "POST");
  assert.equal(capture.options.path, "/api/documents.info");
  assert.equal(capture.options.headers.Authorization, "Bearer outline-test-key");
  assert.equal(capture.body, '{"id":"document-1"}');
  assert.deepEqual(result, { data: { ok: true } });
});

test("sync paginates and maps Outline collections and documents", async () => {
  const requests = [];
  const rawCollections = Array.from({ length: 101 }, (_, index) => ({
    id: `collection-${index}`,
    name: `Collection ${index}`,
    description: index === 0 ? "Reference" : null,
    color: index === 0 ? "#123456" : null,
  }));
  const rawDocuments = [{
    id: "document-1",
    title: "Architecture",
    collectionId: "collection-0",
    url: "/doc/architecture",
    createdAt: "2026-08-16T10:00:00Z",
    updatedAt: "2026-08-16T11:00:00Z",
    updatedBy: { name: "Lintaya" },
  }];
  const request = async (baseUrl, apiKey, path, body) => {
    requests.push({ path, body });
    const source = path.includes("collections") ? rawCollections : rawDocuments;
    return { data: source.slice(body.offset, body.offset + body.limit) };
  };

  const result = await syncOutline(
    { baseUrl: "https://outline.example.test", apiKey: "test-key" },
    { request },
  );

  assert.equal(result.collections.length, 101);
  assert.equal(result.collections[0].documentCount, 1);
  assert.equal(result.collections[1].documentCount, 0);
  assert.deepEqual(result.documents[0], {
    id: "document-1",
    title: "Architecture",
    collectionId: "collection-0",
    url: "/doc/architecture",
    updatedAt: "2026-08-16T11:00:00Z",
    createdAt: "2026-08-16T10:00:00Z",
    updatedBy: "Lintaya",
  });
  assert.equal(
    requests.some(({ path, body }) => path === "/api/collections.list" && body.offset === 100),
    true,
  );
  assert.deepEqual(result.pagination["/api/collections.list"], { pages: 2, truncated: false });
  assert.deepEqual(result.pagination["/api/documents.list"], { pages: 1, truncated: false });
});

test("normalizes live document details without leaking extra API fields", () => {
  assert.deepEqual(normalizeDocumentDetail({
    id: "document-1",
    title: "Guide",
    text: "# Guide",
    collectionId: "collection-1",
    url: "/doc/guide",
    createdAt: "created",
    updatedAt: "updated",
    updatedBy: { name: "Editor" },
    createdBy: { name: "Author" },
    discardedAt: "internal-field",
  }), {
    id: "document-1",
    title: "Guide",
    text: "# Guide",
    collectionId: "collection-1",
    url: "/doc/guide",
    createdAt: "created",
    updatedAt: "updated",
    updatedBy: "Editor",
    createdBy: "Author",
  });
});
