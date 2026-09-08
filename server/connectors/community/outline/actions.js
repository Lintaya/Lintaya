// AGENT-001 (ADR-011): Outline's actions — three, matching the plan's own
// effect table exactly ("Editar documento en Outline → write",
// "Eliminar documento → destructive"):
//
// - `list-documents` (read) answers from `store.getData()` — same cached
//   documents the "recent-docs" Home block already reads, no network call.
// - `create-document` (write) calls the same `/api/documents.create` RPC
//   `POST /:id/documents` already does.
// - `delete-document` (destructive) calls the same `/api/documents.delete`
//   RPC `POST /:id/documents/:id/delete` already does — but per
//   execute.js/registry.js, this never actually reaches that call in
//   AGENT-001: a destructive action returns `pending-approval` before the
//   handler runs. The handler exists and is fully wired so SEC-003 has
//   nothing left to build here beyond the approval gate itself.
const { outlineRequest } = require("./client");

const LIST_DOCUMENTS_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    collectionId: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
};

const DOCUMENT_ITEM_SCHEMA = {
  type: "object",
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    collectionId: { type: ["string", "null"] },
    url: { type: ["string", "null"] },
    updatedAt: { type: ["string", "null"] },
    updatedBy: { type: ["string", "null"] },
  },
};

const LIST_DOCUMENTS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["total", "documents"],
  properties: {
    total: { type: "integer", minimum: 0 },
    syncedAt: { type: ["string", "null"] },
    documents: { type: "array", items: DOCUMENT_ITEM_SCHEMA },
  },
};

const CREATE_DOCUMENT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["collectionId", "title"],
  properties: {
    collectionId: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    text: { type: "string" },
    parentDocumentId: { type: "string" },
  },
};

const DOCUMENT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    url: { type: ["string", "null"] },
  },
};

const DELETE_DOCUMENT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
};

const DELETE_DOCUMENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
  },
};

function registerOutlineActions({ registry, request = outlineRequest }) {
  registry.registerAction({
    id: "list-documents",
    connectorTypeId: "outline",
    title: "List cached documents",
    effect: "read",
    inputSchema: LIST_DOCUMENTS_INPUT_SCHEMA,
    outputSchema: LIST_DOCUMENTS_OUTPUT_SCHEMA,
    handler: async ({ input, services }) => {
      const data = services.store.getData();
      let documents = [...(data?.documents || [])].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      if (input.collectionId) documents = documents.filter((doc) => doc.collectionId === input.collectionId);
      documents = documents.slice(0, input.limit || 30);
      return { total: documents.length, syncedAt: data?.syncedAt || null, documents };
    },
  });

  registry.registerAction({
    id: "create-document",
    connectorTypeId: "outline",
    title: "Create a document in a collection",
    effect: "write",
    inputSchema: CREATE_DOCUMENT_INPUT_SCHEMA,
    outputSchema: DOCUMENT_RESULT_SCHEMA,
    handler: async ({ input, services }) => {
      const cfg = services.store.getConfig();
      const body = { collectionId: input.collectionId, title: input.title, text: input.text || "", publish: true };
      if (input.parentDocumentId) body.parentDocumentId = input.parentDocumentId;
      const response = await request(cfg.baseUrl, cfg.apiKey, "/api/documents.create", body);
      const document = response?.data;
      return { id: document?.id || null, title: document?.title || null, url: document?.url || null };
    },
  });

  registry.registerAction({
    id: "delete-document",
    connectorTypeId: "outline",
    title: "Delete a document",
    effect: "destructive",
    inputSchema: DELETE_DOCUMENT_INPUT_SCHEMA,
    outputSchema: DELETE_DOCUMENT_OUTPUT_SCHEMA,
    handler: async ({ input, services }) => {
      const cfg = services.store.getConfig();
      await request(cfg.baseUrl, cfg.apiKey, "/api/documents.delete", { id: input.id });
      return { ok: true };
    },
  });
}

module.exports = { registerOutlineActions };
