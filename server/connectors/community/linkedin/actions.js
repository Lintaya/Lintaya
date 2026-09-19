// Acciones del conector de LinkedIn (Action Registry, ADR-011).
//
//   publish-post  (write)       — publica un block "linkedin-post".
//   delete-post   (destructive) — borra un post ya publicado. Pasa siempre por
//                                 el Approval Center: la primera petición queda
//                                 pendiente y no toca LinkedIn.
//
// El servicio `store` que entrega el ejecutor no sabe que el token es secreto
// (no está en config.schema.json), así que con el almacén cifrado activo no lo
// vería. Por eso cada handler construye su propio store con SECRET_FIELDS.
const { AppError } = require("../../../core/errors");
const { deletePost } = require("./client");
const { clearPost, linkedinStore, publishBlock, readPosts } = require("./publisher");

const POST_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["postUrn", "postUrl", "publishedAt"],
  properties: {
    postUrn: { type: "string" },
    postUrl: { type: "string" },
    publishedAt: { type: "string" },
  },
};

function registerLinkedinActions({ registry, fetchImpl = fetch, now = Date.now } = {}) {
  if (!registry) throw new TypeError("registerLinkedinActions requires registry");

  registry.registerAction({
    id: "publish-post",
    connectorTypeId: "linkedin",
    title: "Publish a LinkedIn post block",
    effect: "write",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["blockId"],
      properties: { blockId: { type: "string", minLength: 1 } },
    },
    outputSchema: POST_OUTPUT,
    handler: async ({ connection, input, services }) => {
      const store = linkedinStore({ id: connection.id, kvGet: services.kvGet, kvSet: services.kvSet });
      return publishBlock({ store, kvGet: services.kvGet, blockId: input.blockId, fetchImpl, now });
    },
  });

  registry.registerAction({
    id: "delete-post",
    connectorTypeId: "linkedin",
    title: "Delete a published LinkedIn post",
    effect: "destructive",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["blockId"],
      properties: { blockId: { type: "string", minLength: 1 } },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    },
    handler: async ({ connection, input, services }) => {
      const store = linkedinStore({ id: connection.id, kvGet: services.kvGet, kvSet: services.kvSet });
      const record = readPosts(store)[input.blockId];
      if (record?.phase !== "published" || !record.postUrn) throw AppError.notFound("linkedin-post-not-published");
      const cfg = store.getConfig();
      if (!cfg?.accessToken) throw AppError.badRequest("linkedin-not-connected");
      try {
        await deletePost({ accessToken: cfg.accessToken, postUrn: record.postUrn }, fetchImpl);
      } catch (error) {
        throw AppError.badRequest(error?.code || "linkedin-delete-failed");
      }
      clearPost(store, input.blockId);
      return { ok: true };
    },
  });
}

module.exports = { registerLinkedinActions };
