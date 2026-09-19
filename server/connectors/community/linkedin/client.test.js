const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAuthorizeUrl, composeCommentary, countChars, createPost,
  escapeCommentary, exchangeCode, getUserInfo, validatePost,
} = require("./client");

function fakeResponse({ status = 200, json = null, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => (json == null ? "" : JSON.stringify(json)),
  };
}

test("escapeCommentary backslash-escapes every little-text character exactly once", () => {
  assert.equal(escapeCommentary("a_b #tag (x) [y] {z} <w> @me ~|*"), "a\\_b \\#tag \\(x\\) \\[y\\] \\{z\\} \\<w\\> \\@me \\~\\|\\*");
  // La contrabarra se escapa en la misma pasada: no se duplica.
  assert.equal(escapeCommentary("C:\\temp"), "C:\\\\temp");
  assert.equal(escapeCommentary("sin nada raro"), "sin nada raro");
});

test("countChars counts code points, so an emoji is one character", () => {
  assert.equal(countChars("🚀"), 1);
  assert.equal("🚀".length, 2);
  assert.equal(countChars("hola 👋🏽"), 7);
});

test("validatePost measures the text that is actually published, link included", () => {
  assert.throws(() => validatePost({ body: "   " }), { code: "linkedin-body-required" });
  assert.throws(() => validatePost({ body: "ok", link: "notaurl" }), { code: "linkedin-invalid-link" });
  assert.throws(() => validatePost({ body: "ok", link: "ftp://example.test/x" }), { code: "linkedin-invalid-link" });

  // 3000 emojis caben (son 3000 caracteres para LinkedIn, 6000 unidades UTF-16).
  assert.doesNotThrow(() => validatePost({ body: "🚀".repeat(3000) }));
  assert.throws(() => validatePost({ body: "🚀".repeat(3001) }), { code: "linkedin-body-too-long" });

  // El enlace se añade al final, así que cuenta para el límite.
  const link = "https://example.test/post";
  assert.throws(() => validatePost({ body: "x".repeat(2990), link }), { code: "linkedin-body-too-long" });
});

test("composeCommentary appends the link once, and not when the text already has it", () => {
  const link = "https://example.test/a";
  assert.equal(composeCommentary("Hola", link), `Hola\n\n${link}`);
  assert.equal(composeCommentary(`Mira ${link}`, link), `Mira ${link}`);
  assert.equal(composeCommentary("Hola", null), "Hola");
});

test("buildAuthorizeUrl asks only for the self-serve scopes", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "cid", redirectUri: "http://localhost:3000/cb", state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://www.linkedin.com/oauth/v2/authorization");
  assert.equal(url.searchParams.get("scope"), "openid profile w_member_social");
  assert.equal(url.searchParams.get("state"), "s1");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/cb");
});

test("exchangeCode posts a form, not JSON, and tolerates a missing refresh token", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return fakeResponse({ json: { access_token: "tok", expires_in: 5184000, scope: "openid,profile,w_member_social" } }); };
  const token = await exchangeCode({ clientId: "cid", clientSecret: "sec", code: "c", redirectUri: "http://localhost:3000/cb" }, fetchImpl);
  assert.equal(seen.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(seen.init.body, /grant_type=authorization_code/);
  assert.equal(token.accessToken, "tok");
  assert.equal(token.refreshToken, null);
  assert.deepEqual(token.scopes, ["openid", "profile", "w_member_social"]);
});

test("createPost reads the post id from the x-restli-id header and escapes the text", async () => {
  let body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return fakeResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:123" } }); };
  const result = await createPost({ accessToken: "tok", authorUrn: "urn:li:person:abc", commentary: "#hola" }, fetchImpl);
  assert.equal(result.postUrn, "urn:li:share:123");
  assert.equal(result.postUrl, "https://www.linkedin.com/feed/update/urn:li:share:123");
  assert.equal(body.commentary, "\\#hola");
  assert.equal(body.author, "urn:li:person:abc");
  assert.equal(body.lifecycleState, "PUBLISHED");
});

test("createPost: accepted without an id is unconfirmed, never a retryable failure", async () => {
  const fetchImpl = async () => fakeResponse({ status: 201 });
  await assert.rejects(createPost({ accessToken: "t", authorUrn: "u", commentary: "x" }, fetchImpl), { code: "linkedin-publish-unconfirmed" });
});

test("a 401 from LinkedIn becomes linkedin-token-expired", async () => {
  const fetchImpl = async () => fakeResponse({ status: 401 });
  await assert.rejects(createPost({ accessToken: "t", authorUrn: "u", commentary: "x" }, fetchImpl), { code: "linkedin-token-expired" });
  await assert.rejects(getUserInfo("t", fetchImpl), { code: "linkedin-token-expired" });
});
