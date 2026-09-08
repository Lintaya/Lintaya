function apiUrl(baseUrl, requestPath) {
  if (!requestPath.startsWith("/api/")) throw new Error("path must start with /api/");
  const origin = new URL(baseUrl);
  const target = new URL(requestPath, `${origin.origin}/`);
  if (target.origin !== origin.origin) throw new Error("path cannot switch to another server");
  return target;
}

async function getJson({ baseUrl, token, requestPath, actor, fetchImpl = fetch }) {
  const headers = { Accept: "application/json", "User-Agent": "lintaya-cli/0.1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (actor) headers["X-Actor"] = actor;
  const target = apiUrl(baseUrl, requestPath);
  let response;
  try {
    response = await fetchImpl(target, { method: "GET", headers });
  } catch (error) {
    const cause = error.cause?.code || error.cause?.message;
    throw new Error(`could not connect to ${target.origin}. Check that Lintaya is still running and use a plain URL, for example http://localhost:3001.${cause ? ` (${cause})` : ""}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = body && typeof body === "object" ? body.detail || body.title : body;
    throw new Error(`GET ${requestPath} failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return body;
}

// Escritura. getJson se queda aparte y sin tocar: es el camino de lectura que
// usa todo lo demas, y no tiene por que aprender sobre cuerpos ni verbos.
async function sendJson({ baseUrl, token, requestPath, method, body, actor, fetchImpl = fetch }) {
  const headers = { Accept: "application/json", "User-Agent": "lintaya-cli/0.1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (actor) headers["X-Actor"] = actor;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const target = apiUrl(baseUrl, requestPath);
  let response;
  try {
    response = await fetchImpl(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    const cause = error.cause?.code || error.cause?.message;
    throw new Error(`could not connect to ${target.origin}. Check that Lintaya is still running and use a plain URL, for example http://localhost:3001.${cause ? ` (${cause})` : ""}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? payload.detail || payload.title : payload;
    throw new Error(`${method} ${requestPath} failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return payload;
}

module.exports = { apiUrl, getJson, sendJson };
