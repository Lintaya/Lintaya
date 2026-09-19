// Custom Home blocks — connector, content, and static QR blocks.
// (module-builder.jsx merges both into its catalog the same way):
//   - kind:"connector" (default, backward-compatible with every block
//     created before `kind` existed): an instance of an existing connector
//     block (GitLab commits, Plane my-issues, etc.) parameterized with a
//     scope/limit via Block Builder (app/block-builder.jsx).
//   - kind:"content": no connector involved — the block's markdown/HTML is
//     pasted by hand into Block Builder and stored here verbatim; nothing to
//     fetch or sync, ConnectorBlockPanel (app/home.jsx) just renders it.
// Deliberately a separate KV array from `home-layout`/`home-notes`
// (server/routes/home.js): those only ever knew a fixed set of ids (the 5
// built-in blocks + notes), while a custom block needs its own record.
// El cliente (block-builder.jsx) ya exige que imágenes/video en un block
// "content" sean URL http(s), nunca data:/blob: — este límite es la
// contraparte server-side: aunque alguien pegue el content vía /api directo
// (sin pasar por esa validación), un blob inline no puede inflar el registro
// del kv-store. 200 KB es generoso para Markdown/HTML de texto real.
const { randomUUID } = require("node:crypto");
const { normalizeAssignedTags, applyAssignedTags } = require("./tags");

const MAX_CONTENT_LENGTH = 200_000;
const BLOCK_KINDS = new Set(["connector", "content", "qr", "linkedin-post"]);
// Mismo limite y mismo conteo (puntos de codigo) que el conector de LinkedIn
// al publicar y que el contador del Block Builder: si cualquiera de los tres
// contara distinto, se podria guardar un post que luego no se puede publicar.
const LINKEDIN_MAX_LENGTH = 3000;
const QR_EC_LEVELS = new Set(["L", "M", "Q", "H"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function validateKind(kind) {
  const value = kind === undefined || kind === null || kind === "" ? "connector" : String(kind);
  if (!BLOCK_KINDS.has(value)) throw new Error("invalid-kind");
  return value;
}

function validateQrConfig(record) {
  const { payload, logo, style } = record;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("qr-payload-required");
  if (!["manual", "dynamic"].includes(payload.mode)) throw new Error("qr-payload-mode-not-supported");
  if (payload.mode === "manual" && (typeof payload.value !== "string" || !payload.value.trim())) throw new Error("qr-payload-value-required");
  if (payload.mode === "dynamic" && (typeof payload.linkId !== "string" || !payload.linkId.trim())) throw new Error("qr-link-id-required");
  if (!logo || typeof logo !== "object" || !["brand", "icon", "upload", "none"].includes(logo.source)) throw new Error("invalid-qr-logo");
  if (logo.source === "brand" && typeof logo.variant !== "string") throw new Error("invalid-qr-logo");
  // Solo el formato de la clave: el catálogo de íconos vive en el cliente
  // (app/qr-block.jsx) y una clave desconocida ahí se dibuja como sin logo.
  if (logo.source === "icon" && (typeof logo.icon !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(logo.icon))) throw new Error("invalid-qr-logo");
  if (logo.source === "upload" && typeof logo.assetId !== "string") throw new Error("invalid-qr-logo");
  if (!style || typeof style !== "object" || !QR_EC_LEVELS.has(style.ecLevel) || style.pattern !== "square" || style.corners !== "square" || !HEX_COLOR.test(style.fgColor) || !HEX_COLOR.test(style.bgColor)) throw new Error("invalid-qr-style");
}

// Un block "linkedin-post" ES la publicacion: su texto y su enlace viven en
// `payload`, igual que el valor de un QR. El estado de publicacion no vive aqui
// sino en el conector (server/connectors/community/linkedin/publisher.js).
function validateLinkedinPost(record) {
  const { payload } = record;
  if (!record.connectorId || !String(record.connectorId).trim()) throw new Error("linkedin-connector-required");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("linkedin-body-required");
  if (typeof payload.body !== "string" || !payload.body.trim()) throw new Error("linkedin-body-required");
  const link = payload.link == null || payload.link === "" ? null : String(payload.link).trim();
  if (link) {
    let parsed;
    try { parsed = new URL(link); } catch { throw new Error("linkedin-invalid-link"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("linkedin-invalid-link");
  }
  // El enlace se publica al final del texto, asi que cuenta para el limite.
  const published = link && !payload.body.includes(link) ? `${payload.body.trimEnd()}\n\n${link}` : payload.body;
  if ([...published].length > LINKEDIN_MAX_LENGTH) throw new Error("linkedin-body-too-long");
  if (payload.linkAsFirstComment !== undefined && typeof payload.linkAsFirstComment !== "boolean") throw new Error("linkedin-invalid-post");
}

function validateCompleteBlock(record) {
  const kind = validateKind(record.kind);
  if (!record.title || !String(record.title).trim()) throw new Error("title-required");
  if (kind === "connector" && (!record.connectorId || !record.blockId)) throw new Error("connectorId-and-blockId-required");
  if (kind === "content" && (!record.content || !String(record.content).trim())) throw new Error("content-required");
  if (kind === "content" && String(record.content).length > MAX_CONTENT_LENGTH) throw new Error("content-too-large");
  if (kind === "qr") validateQrConfig(record);
  if (kind === "linkedin-post") validateLinkedinPost(record);
  return kind;
}

// Extraída para que la ruta REST y el ejecutor de tools del Asistente
// (server/core/assistant-tools.js) creen un Block exactamente igual.
function createCustomBlockRecord({ kvGet, kvSet }, { kind, connectorId, blockId, title, scope, limit, description, icon, active, format, content, prompt, rules, tags, payload, logo, style }) {
  const blockKind = validateKind(kind);
  if (blockKind === "qr" && payload?.mode === "dynamic" && kvGet("builder-settings")?.value?.qr?.dynamicEnabled !== true) throw new Error("builder-dynamic-qr-disabled");
  validateCompleteBlock({ kind: blockKind, title, connectorId, blockId, content, payload, logo, style });
  // Etiquetar es opcional; solo se rechaza lo que no es una lista de ids.
  const assigned = normalizeAssignedTags(tags);
  if (assigned === null) throw new Error("invalid-tags");
  const blocks = kvGet("custom-blocks")?.value || [];
  const shared = {
    id: `custom-${randomUUID()}`,
    kind: blockKind,
    title: String(title),
    description: description ? String(description) : null,
    icon: icon ? String(icon) : null,
    active: active !== false,
    createdAt: new Date().toISOString(),
  };
  // `prompt` es la instrucción que generó `content` — con nuestro generador
  // (Prompt + Generar) o con una IA externa pegada a mano — se guarda solo
  // como contexto para una futura regeneración, nunca se re-ejecuta sola.
  // `rules` es opcional: null usa la plantilla por defecto según `format`
  // (BB_MD_RULES/BB_HTML_RULES en block-builder.jsx) — solo se guarda acá
  // cuando el usuario la personalizó para este block puntual.
  const block = blockKind === "content"
    ? { ...shared, format: format === "html" ? "html" : "md", content: String(content), prompt: prompt ? String(prompt) : null, rules: rules ? String(rules) : null }
    : blockKind === "qr" ? {
        ...shared, payload, logo, style,
      } : blockKind === "linkedin-post" ? {
        ...shared,
        connectorId: String(connectorId),
        payload: {
          body: String(payload.body),
          link: payload.link ? String(payload.link).trim() : null,
          linkAsFirstComment: payload.linkAsFirstComment === true,
        },
      } : {
        ...shared,
        connectorId: String(connectorId),
        blockId: String(blockId),
        scope: scope ? String(scope) : null,
        limit: Number(limit) || 10,
      };
  applyAssignedTags(block, assigned);
  kvSet("custom-blocks", [...blocks, block]);
  return block;
}

function registerCustomBlocksRoutes({ app, db, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError }) {
  app.get("/api/home/custom-blocks", requireAuth, (req, res) => {
    res.json(kvGet("custom-blocks")?.value || []);
  });

  app.post("/api/home/custom-blocks", requireAuth, auditActivity({ provider: "home", action: "Crear block personalizado" }), (req, res) => {
    let block;
    try {
      block = createCustomBlockRecord({ kvGet, kvSet }, req.body || {});
    } catch (err) {
      if (err.message === "builder-dynamic-qr-disabled") return res.status(400).json({ error: err.message, errorCode: "builder.dynamicQrDisabled", errorParams: {} });
      return sendAppError(res, AppError.badRequest(err.message), req);
    }
    res.locals.auditMessage = `Crear block "${block.title}"${block.kind === "connector" ? ` (${block.connectorId}.${block.blockId})` : block.kind === "linkedin-post" ? ` (publicacion de ${block.connectorId})` : " (contenido)"}`;
    res.json(block);
  });

  app.put("/api/home/custom-blocks/:id", requireAuth, auditActivity({ provider: "home", action: "Editar block personalizado" }), (req, res) => {
    const blocks = kvGet("custom-blocks")?.value || [];
    const existing = blocks.find(b => b.id === req.params.id);
    if (!existing) return sendAppError(res, AppError.notFound("not-found"), req);
    const { kind, connectorId, blockId, title, scope, limit, description, icon, active, format, content, prompt, rules, tags, payload, logo, style } = req.body || {};
    if (content !== undefined && String(content).length > MAX_CONTENT_LENGTH) {
      return sendAppError(res, AppError.badRequest("content-too-large"), req);
    }
    if (kind !== undefined) { try { validateKind(kind); } catch (err) { return sendAppError(res, AppError.badRequest(err.message), req); } }
    const updated = {
      ...existing,
      ...(kind !== undefined ? { kind: validateKind(kind) } : {}),
      ...(connectorId !== undefined ? { connectorId: String(connectorId) } : {}),
      ...(blockId !== undefined ? { blockId: String(blockId) } : {}),
      ...(title !== undefined ? { title: String(title) } : {}),
      ...(description !== undefined ? { description: description ? String(description) : null } : {}),
      ...(icon !== undefined ? { icon: icon ? String(icon) : null } : {}),
      ...(active !== undefined ? { active: active !== false } : {}),
      ...(scope !== undefined ? { scope: scope ? String(scope) : null } : {}),
      ...(limit !== undefined ? { limit: Number(limit) || 10 } : {}),
      ...(format !== undefined ? { format: format === "html" ? "html" : "md" } : {}),
      ...(content !== undefined ? { content: String(content) } : {}),
      ...(prompt !== undefined ? { prompt: prompt ? String(prompt) : null } : {}),
      ...(rules !== undefined ? { rules: rules ? String(rules) : null } : {}),
      ...(payload !== undefined ? { payload } : {}),
      ...(logo !== undefined ? { logo } : {}),
      ...(style !== undefined ? { style } : {}),
    };
    if (updated.kind === "qr") {
      delete updated.connectorId; delete updated.blockId; delete updated.scope; delete updated.limit;
      delete updated.content; delete updated.format; delete updated.prompt; delete updated.rules;
    } else if (updated.kind === "content") {
      delete updated.connectorId; delete updated.blockId; delete updated.scope; delete updated.limit;
      delete updated.payload; delete updated.logo; delete updated.style;
    } else if (updated.kind === "linkedin-post") {
      delete updated.blockId; delete updated.scope; delete updated.limit;
      delete updated.content; delete updated.format; delete updated.prompt; delete updated.rules;
      delete updated.logo; delete updated.style;
      if (updated.payload && typeof updated.payload === "object") {
        updated.payload = {
          body: String(updated.payload.body ?? ""),
          link: updated.payload.link ? String(updated.payload.link).trim() : null,
          linkAsFirstComment: updated.payload.linkAsFirstComment === true,
        };
      }
    } else if (updated.kind === "connector") {
      delete updated.content; delete updated.format; delete updated.prompt; delete updated.rules;
      delete updated.payload; delete updated.logo; delete updated.style;
    }
    if (existing.kind === "qr" && existing.payload?.mode !== "dynamic" && updated.kind === "qr" && updated.payload?.mode === "dynamic" && kvGet("builder-settings")?.value?.qr?.dynamicEnabled !== true) {
      return res.status(400).json({ error: "builder-dynamic-qr-disabled", errorCode: "builder.dynamicQrDisabled", errorParams: {} });
    }
    try { validateCompleteBlock(updated); } catch (err) { return sendAppError(res, AppError.badRequest(err.message), req); }
    const assigned = normalizeAssignedTags(tags);
    if (assigned === null) return sendAppError(res, AppError.badRequest("invalid-tags"), req);
    applyAssignedTags(updated, assigned);
    kvSet("custom-blocks", blocks.map(b => b.id === req.params.id ? updated : b));
    res.locals.auditMessage = `Editar block "${updated.title}"`;
    res.json(updated);
  });

  app.delete("/api/home/custom-blocks/:id", requireAuth, auditActivity({ provider: "home", action: "Borrar block personalizado" }), (req, res) => {
    const all = kvGet("custom-blocks")?.value || [];
    const removed = all.find(b => b.id === req.params.id);
    if (!removed) return sendAppError(res, AppError.notFound("not-found"), req);
    kvSet("custom-blocks", all.filter(b => b.id !== req.params.id));
    if (removed.kind === "qr" && removed.payload?.mode === "dynamic" && removed.payload.linkId && db) {
      db.prepare("DELETE FROM qr_links WHERE code = ?").run(removed.payload.linkId);
    }
    // Igual que al borrar una nota (home.js) — no dejar la referencia colgando
    // si el block llegó a agregarse al layout.
    const layout = kvGet("home-layout")?.value || { left: [], right: [] };
    kvSet("home-layout", {
      left: layout.left.filter(id => id !== req.params.id),
      right: layout.right.filter(id => id !== req.params.id),
    });
    res.locals.auditMessage = `Borrar block "${removed.title}"`;
    res.json({ ok: true });
  });
}

module.exports = { registerCustomBlocksRoutes, createCustomBlockRecord };
