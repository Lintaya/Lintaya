// Cliente de LinkedIn — OAuth, identidad y la creación de publicaciones.
//
// Usa fetch y no el requestJson del SDK por dos motivos concretos de esta API:
// el intercambio del código por el token va como formulario (requestJson
// serializa siempre a JSON), y el identificador del post creado vuelve en la
// cabecera `x-restli-id`, no en el cuerpo (requestJson no expone cabeceras).
const AUTH_URL = "https://www.linkedin.com/oauth/v2";
const API_URL = "https://api.linkedin.com";
const API_VERSION = "202601";
const SCOPES = ["openid", "profile", "w_member_social"];
const MAX_LENGTH = 3000;

function linkedinError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  return error;
}

// Se cuenta por puntos de código, no por unidades UTF-16: un emoji es UN
// carácter para LinkedIn. El frontend (app/linkedin-block.jsx) cuenta igual,
// y si no coincidieran el contador diría que cabe algo que aquí se rechaza.
function countChars(text) {
  return [...String(text ?? "")].length;
}

// El enlace va al final del texto porque así lo publica LinkedIn: como enlace
// dentro del comentario. La vista previa lo dibuja en el mismo sitio, y el
// límite de 3000 se aplica sobre lo que de verdad se envía.
function composeCommentary(body, link) {
  const text = String(body ?? "");
  const url = link ? String(link).trim() : "";
  if (!url || text.includes(url)) return text;
  return text.trimEnd() ? `${text.trimEnd()}\n\n${url}` : url;
}

function validatePost({ body, link }) {
  const text = String(body ?? "");
  if (!text.trim()) throw linkedinError("linkedin-body-required", 400);
  if (link != null && link !== "") {
    let parsed;
    try { parsed = new URL(String(link)); } catch { throw linkedinError("linkedin-invalid-link", 400); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw linkedinError("linkedin-invalid-link", 400);
  }
  if (countChars(composeCommentary(text, link)) > MAX_LENGTH) throw linkedinError("linkedin-body-too-long", 400);
  return { body: text, link: link ? String(link).trim() : null };
}

// El campo `commentary` usa el formato "little text" de LinkedIn: estos
// caracteres tienen significado y sin contrabarra el post sale mal o se
// rechaza. Es una sola pasada, así que la contrabarra añadida no se vuelve a
// escapar.
function escapeCommentary(value) {
  return String(value).replace(/[\\<>#~_|[\]*(){}@]/g, (ch) => `\\${ch}`);
}

function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(" "),
  });
  return `${AUTH_URL}/authorization?${params}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function requestToken(form, fetchImpl) {
  const response = await fetchImpl(`${AUTH_URL}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const json = await readJson(response);
  if (!response.ok || !json?.access_token) throw linkedinError("linkedin-oauth-failed", response.status);
  return {
    accessToken: json.access_token,
    // LinkedIn solo emite refresh_token a apps con productos aprobados del
    // Marketing Developer Platform. Una app normal no lo recibe nunca.
    refreshToken: json.refresh_token || null,
    expiresIn: Number(json.expires_in) || null,
    scopes: String(json.scope || "").split(/[\s,]+/).filter(Boolean),
  };
}

function exchangeCode({ clientId, clientSecret, code, redirectUri }, fetchImpl = fetch) {
  return requestToken({
    grant_type: "authorization_code", code, redirect_uri: redirectUri,
    client_id: clientId, client_secret: clientSecret,
  }, fetchImpl);
}

function refreshAccessToken({ clientId, clientSecret, refreshToken }, fetchImpl = fetch) {
  return requestToken({
    grant_type: "refresh_token", refresh_token: refreshToken,
    client_id: clientId, client_secret: clientSecret,
  }, fetchImpl);
}

async function getUserInfo(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_URL}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) throw linkedinError("linkedin-token-expired", 401);
  const json = await readJson(response);
  if (!response.ok || !json?.sub) throw linkedinError("linkedin-request-failed", response.status);
  return { sub: json.sub, name: json.name || null, picture: json.picture || null };
}

function restHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": API_VERSION,
    "Content-Type": "application/json",
  };
}

async function createPost({ accessToken, authorUrn, commentary }, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_URL}/rest/posts`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({
      author: authorUrn,
      commentary: escapeCommentary(commentary),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (response.status === 401) throw linkedinError("linkedin-token-expired", 401);
  if (response.status !== 200 && response.status !== 201) throw linkedinError("linkedin-publish-failed", response.status);
  const postUrn = response.headers.get("x-restli-id");
  // Aceptado pero sin identificador: el post puede existir. Se trata igual que
  // una caída a mitad — nunca como un fallo que invite a reintentar.
  if (!postUrn) throw linkedinError("linkedin-publish-unconfirmed", 502);
  return { postUrn, postUrl: postUrlFor(postUrn) };
}

async function deletePost({ accessToken, postUrn }, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_URL}/rest/posts/${encodeURIComponent(postUrn)}`, {
    method: "DELETE",
    headers: restHeaders(accessToken),
  });
  if (response.status === 401) throw linkedinError("linkedin-token-expired", 401);
  if (response.status !== 204 && response.status !== 200) throw linkedinError("linkedin-delete-failed", response.status);
}

function postUrlFor(postUrn) {
  return `https://www.linkedin.com/feed/update/${postUrn}`;
}

module.exports = {
  API_URL,
  API_VERSION,
  AUTH_URL,
  MAX_LENGTH,
  SCOPES,
  buildAuthorizeUrl,
  composeCommentary,
  countChars,
  createPost,
  deletePost,
  escapeCommentary,
  exchangeCode,
  getUserInfo,
  linkedinError,
  postUrlFor,
  refreshAccessToken,
  validatePost,
};
