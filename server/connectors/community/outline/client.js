const {
  buildHttpUrl,
  collectPages,
  requestJson,
} = require("../../sdk");

const MAX_PAGES = 10;
const PAGE_SIZE = 100;

function buildOutlineUrl(baseUrl, apiPath) {
  return buildHttpUrl(baseUrl, apiPath);
}

function outlineRequest(baseUrl, apiKey, apiPath, body = null, options = {}) {
  return requestJson({
    baseUrl,
    path: apiPath,
    method: "POST",
    body: body || {},
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "lintaya",
    },
    transport: options.transport,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    // Preserves compatibility with existing self-hosted installations using
    // private certificates. This must become explicit before stable lifecycle.
    requestOptions: { rejectUnauthorized: false, ...(options.requestOptions || {}) },
  });
}

function normalizeCollection(collection) {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description || "",
    color: collection.color || null,
    documentCount: 0,
  };
}

function normalizeDocument(document) {
  return {
    id: document.id,
    title: document.title,
    collectionId: document.collectionId,
    url: document.url,
    updatedAt: document.updatedAt,
    createdAt: document.createdAt,
    updatedBy: document.updatedBy?.name || null,
  };
}

function normalizeDocumentDetail(document) {
  return {
    id: document.id,
    title: document.title,
    text: document.text || "",
    collectionId: document.collectionId,
    url: document.url,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy?.name || null,
    createdBy: document.createdBy?.name || null,
  };
}

async function listOutlineResources(cfg, apiPath, options = {}) {
  const request = options.request || outlineRequest;
  const result = await collectPages({
    maxPages: MAX_PAGES,
    initialCursor: 0,
    fetchPage: page => request(cfg.baseUrl, cfg.apiKey, apiPath, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    getItems: response => Array.isArray(response?.data) ? response.data : [],
    getNext: (_response, batch, page) => batch.length === PAGE_SIZE ? page + 1 : null,
  });
  if (options.pagination) options.pagination[apiPath] = { pages: result.pageCount, truncated: result.truncated };
  return result.items;
}

async function syncOutline(cfg, options = {}) {
  const request = options.request || outlineRequest;
  const pagination = {};
  const [rawCollections, rawDocuments] = await Promise.all([
    listOutlineResources(cfg, "/api/collections.list", { request, pagination }),
    listOutlineResources(cfg, "/api/documents.list", { request, pagination }),
  ]);
  const collections = rawCollections.map(normalizeCollection);
  const documents = rawDocuments.map(normalizeDocument);

  const countByCollection = new Map();
  for (const document of documents) {
    countByCollection.set(
      document.collectionId,
      (countByCollection.get(document.collectionId) || 0) + 1,
    );
  }
  for (const collection of collections) {
    collection.documentCount = countByCollection.get(collection.id) || 0;
  }

  return { collections, documents, pagination };
}

module.exports = {
  MAX_PAGES,
  PAGE_SIZE,
  buildOutlineUrl,
  listOutlineResources,
  normalizeCollection,
  normalizeDocument,
  normalizeDocumentDetail,
  outlineRequest,
  syncOutline,
};
