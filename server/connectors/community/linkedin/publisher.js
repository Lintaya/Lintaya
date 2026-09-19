// Publicar un block "linkedin-post" sin poder publicarlo dos veces.
//
// LinkedIn no acepta clave de idempotencia ni deja preguntar "¿se creó este
// post?". Así que la garantía contra duplicados tiene que salir de aquí: la
// intención se escribe ANTES de llamar a LinkedIn, y el resultado después.
// Un registro que se queda en "publishing" solo puede significar dos cosas —
// otra petición en curso (doble clic) o un proceso que murió con la llamada ya
// hecha o a medias — y en ninguno de los dos casos es seguro volver a llamar.
//
// (El plan hablaba de armar → testificar → publicar, que es como lo resuelve
// un sistema de colas en varios pasos separados. Dentro de una sola petición
// HTTP ese protocolo se reduce a lo que hay aquí: dejar la intención escrita
// antes de la llamada. Una fase intermedia más no añade ninguna garantía sin
// un bloqueo transaccional, y ese llegará con el planificador.)
//
// El estado vive en el kv de datos del conector, por block:
//   connector-data-<id> = { posts: { [blockId]: record } }
// y el contenido del post vive en el propio block (kv custom-blocks): el
// servidor lo lee de ahí, nunca del cliente, para que no se pueda publicar
// algo distinto de lo que está guardado.
const crypto = require("node:crypto");

const { AppError } = require("../../../core/errors");
const { createConnectorStore } = require("../../sdk");
const { composeCommentary, createPost, refreshAccessToken, validatePost } = require("./client");

// Los campos que nunca salen en la configuración pública. El token no está en
// config.schema.json (no lo escribe el usuario), así que hay que declararlo aquí
// para que el almacén de secretos lo cifre igual que el Client Secret.
const SECRET_FIELDS = ["clientSecret", "accessToken", "refreshToken"];

// Una petición a LinkedIn tarda segundos. Pasado este margen, un "publishing"
// ya no es un doble clic sino un intento que no terminó.
const IN_FLIGHT_MS = 2 * 60 * 1000;

function linkedinStore({ id, kvGet, kvSet }) {
  return createConnectorStore({ id, kvGet, kvSet, secretFields: SECRET_FIELDS });
}

function contentHash({ body, link }) {
  return crypto.createHash("sha256").update(JSON.stringify([body || "", link || ""])).digest("hex");
}

function findPostBlock(kvGet, blockId, connectorId) {
  const block = (kvGet("custom-blocks")?.value || []).find((b) => b.id === blockId);
  if (!block || block.kind !== "linkedin-post" || block.connectorId !== connectorId) return null;
  return block;
}

function readPosts(store) {
  return store.getData()?.posts || {};
}

function writePost(store, blockId, record) {
  const data = store.getData() || {};
  store.setData({ ...data, posts: { ...(data.posts || {}), [blockId]: record } });
}

function clearPost(store, blockId) {
  const data = store.getData() || {};
  const posts = { ...(data.posts || {}) };
  delete posts[blockId];
  store.setData({ ...data, posts });
}

function postStatus(store, block, now = Date.now) {
  const record = readPosts(store)[block.id];
  const current = contentHash({ body: block.payload?.body, link: block.payload?.link });
  if (!record) return { status: "unpublished", postUrn: null, postUrl: null, publishedAt: null, error: null, staleContent: false };
  const base = { postUrn: record.postUrn || null, postUrl: record.postUrl || null, publishedAt: record.publishedAt || null, error: record.error || null };
  if (record.phase === "published") return { ...base, status: "published", staleContent: record.contentHash !== current };
  if (record.phase === "failed") return { ...base, status: "failed", staleContent: false };
  // "publishing": en curso si es reciente, sin confirmar si ya no.
  const age = now() - Date.parse(record.startedAt || 0);
  return { ...base, status: age < IN_FLIGHT_MS ? "publishing" : "unconfirmed", staleContent: false };
}

// Un error es "ambiguo" cuando no sabemos si LinkedIn creó el post: la red se
// cortó, respondió 5xx, o aceptó sin devolver identificador. Esos nunca se
// marcan como fallo reintentable.
function isAmbiguous(error) {
  if (error?.code === "linkedin-publish-unconfirmed") return true;
  if (error?.code === "linkedin-token-expired") return false;
  if (error?.code === "linkedin-publish-failed") return !(error.status >= 400 && error.status < 500);
  return true;
}

async function ensureAccessToken(store, { fetchImpl, now }) {
  const cfg = store.getConfig();
  if (!cfg?.accessToken || !cfg?.authorUrn) throw AppError.badRequest("linkedin-not-connected");
  const expired = cfg.expiresAt && Date.parse(cfg.expiresAt) <= now();
  if (!expired) return cfg;
  if (!cfg.refreshToken) throw AppError.badRequest("linkedin-token-expired");
  // Solo apps con el producto Advertising API reciben refresh token; el resto
  // nunca llega aquí y reautoriza a mano.
  const token = await refreshAccessToken({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken }, fetchImpl)
    .catch(() => { throw AppError.badRequest("linkedin-token-expired"); });
  const next = {
    ...cfg,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken || cfg.refreshToken,
    expiresAt: token.expiresIn ? new Date(now() + token.expiresIn * 1000).toISOString() : cfg.expiresAt,
  };
  store.setConfig(next);
  return next;
}

async function publishBlock({ store, kvGet, blockId, fetchImpl = fetch, now = Date.now }) {
  const block = findPostBlock(kvGet, blockId, store.id);
  if (!block) throw AppError.notFound("linkedin-block-not-found");

  let post;
  try { post = validatePost({ body: block.payload?.body, link: block.payload?.link }); }
  catch (error) { throw AppError.badRequest(error.code || "linkedin-invalid-post"); }
  const hash = contentHash(post);

  const status = postStatus(store, block, now);
  if (status.status === "published") {
    // El mismo contenido ya salió: devolverlo es seguro y hace que un doble
    // envío sea inofensivo. Contenido distinto sería un segundo post, y eso
    // no puede pasar por accidente.
    if (!status.staleContent) return { postUrn: status.postUrn, postUrl: status.postUrl, publishedAt: status.publishedAt };
    throw AppError.conflict("linkedin-already-published");
  }
  if (status.status === "publishing") throw AppError.conflict("linkedin-publish-in-progress");
  if (status.status === "unconfirmed") throw AppError.conflict("linkedin-publish-unconfirmed");

  const cfg = await ensureAccessToken(store, { fetchImpl, now });

  // La intención queda escrita ANTES de la llamada. Si el proceso muere desde
  // aquí, el registro se queda en "publishing" y se lee como sin confirmar.
  const startedAt = new Date(now()).toISOString();
  writePost(store, blockId, { phase: "publishing", contentHash: hash, startedAt });

  try {
    const { postUrn, postUrl } = await createPost({
      accessToken: cfg.accessToken,
      authorUrn: cfg.authorUrn,
      commentary: composeCommentary(post.body, post.link),
    }, fetchImpl);
    const publishedAt = new Date(now()).toISOString();
    writePost(store, blockId, { phase: "published", contentHash: hash, startedAt, postUrn, postUrl, publishedAt });
    return { postUrn, postUrl, publishedAt };
  } catch (error) {
    const code = error?.code || "linkedin-publish-failed";
    if (isAmbiguous(error)) {
      // Se deja en "publishing" con la marca de tiempo del inicio adelantada al
      // pasado, para que se lea ya como sin confirmar y no como en curso.
      writePost(store, blockId, { phase: "publishing", contentHash: hash, startedAt: new Date(0).toISOString(), error: code });
      throw AppError.conflict("linkedin-publish-unconfirmed");
    }
    writePost(store, blockId, { phase: "failed", contentHash: hash, startedAt, error: code });
    throw AppError.badRequest(code);
  }
}

module.exports = {
  IN_FLIGHT_MS,
  SECRET_FIELDS,
  clearPost,
  contentHash,
  findPostBlock,
  linkedinStore,
  postStatus,
  publishBlock,
  readPosts,
};
