// Tags — el catálogo, no las asignaciones. Vive en kv bajo "tags", igual que
// Dashboards y Boards, para que entre en el respaldo y sea el mismo en todos
// los navegadores apuntados a una instancia. Ver ADR-015.
//
// Quién lleva una etiqueta puesta es otra cosa y sigue donde estaba:
// vault_items.tags para Passwords, el campo tags de la API de Devices. Blocks,
// Boards y Dashboards todavía no tienen dónde guardarla.

const TAG_SCHEMA_VERSION = 1;

// Las mismas cinco que hasta ahora eran una constante del cliente en
// app/public-data.js. Se siembran en la primera lectura, para que una
// instalación existente y una nueva acaben con el mismo catálogo.
const DEFAULT_TAGS = [
  // Primera a propósito: es la que aplica a lo que más se etiqueta —  Blocks,
  // Boards y Dashboards — y el catálogo se ofrece en este orden, así que la
  // categoría más usada no debería quedar al final de una lista con scroll.
  // Los cuatro valores salen de lo que un Lintaya real acaba conteniendo:
  // actividad de repositorios, documentación, operación y notas sueltas.
  {
    id: "purpose", label: "Purpose", color: "#d97706",
    description: "What this block, Board or Dashboard is for",
    values: [
      { id: "code", label: "Code" }, { id: "documentation", label: "Documentation" },
      { id: "operations", label: "Operations" }, { id: "notes", label: "Notes" },
    ],
  },
  {
    id: "connection", label: "Connection", color: "#0ea5e9",
    description: "Access protocol used to connect to this resource",
    values: [
      { id: "conn-ssh", label: "SSH" }, { id: "conn-rdp", label: "RDP" },
      { id: "conn-https", label: "HTTPS" }, { id: "conn-telnet", label: "Telnet" },
    ],
  },
  {
    id: "environment", label: "Environment", color: "#10b981",
    description: "Deployment stage this resource belongs to",
    values: [
      { id: "env-prod", label: "Prod" }, { id: "env-staging", label: "Staging" },
      { id: "env-dev", label: "Dev" }, { id: "env-lab", label: "Lab" },
    ],
  },
  {
    id: "criticality", label: "Criticality", color: "#64748b",
    description: "How much impact an outage or issue here would have",
    values: [
      { id: "crit-critical", label: "Critical" }, { id: "crit-high", label: "High" },
      { id: "crit-medium", label: "Medium" }, { id: "crit-low", label: "Low" },
    ],
  },
  {
    id: "ownership", label: "Ownership", color: "#7c3aed",
    description: "Who is responsible for this resource",
    values: [
      { id: "owner-infra", label: "Infra" }, { id: "owner-network", label: "Network" },
      { id: "owner-security", label: "Security" }, { id: "owner-personal", label: "Personal" },
    ],
  },
  {
    id: "device-type", label: "Device Type", color: "#0891b2",
    description: "What kind of equipment this is",
    values: [
      { id: "switch-core", label: "Core Switch" }, { id: "switch-access", label: "Access Switch" },
      { id: "router", label: "Router" }, { id: "firewall", label: "Firewall" },
      { id: "wlc", label: "WLAN Ctrl" }, { id: "loadbalancer", label: "Load Balancer" },
      { id: "server", label: "Server" }, { id: "storage", label: "Storage" },
      { id: "ups", label: "UPS" }, { id: "other", label: "Other" },
    ],
  },
];

// El mismo slug que ya usaba tags.jsx al crear. No se toca: los ids del
// catálogo están referenciados por filas guardadas de vault_items.tags, y
// cambiar el esquema dejaría huérfana toda asignación existente.
function slugify(label) {
  return String(label).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function normalizeValues(rawValues, existing = []) {
  if (rawValues === undefined) return existing;
  if (!Array.isArray(rawValues)) return null;
  const byLabel = new Map(existing.map(value => [value.label, value.id]));
  const taken = new Set(existing.map(value => value.id));
  const values = [];
  for (const raw of rawValues) {
    const label = typeof raw === "string" ? raw : raw?.label;
    if (!label || !String(label).trim()) return null;
    const clean = String(label).trim();
    // Un valor que ya existía conserva su id aunque se reordene la lista, por
    // la misma razón que los ids del catálogo no se regeneran.
    const id = (typeof raw === "object" && raw?.id) || byLabel.get(clean) || uniqueId(slugify(clean), taken);
    if (!id) return null;
    taken.add(id);
    values.push({ id: String(id), label: clean });
  }
  if (new Set(values.map(value => value.id)).size !== values.length) return null;
  return values;
}

function readTags(kvGet) {
  const stored = kvGet("tags")?.value;
  return Array.isArray(stored) ? stored : DEFAULT_TAGS;
}

// Las asignaciones son opcionales en todo: un Board, Dashboard, Block o Device
// sin etiquetas es lo normal, no un registro a medio llenar. `undefined` es "no
// lo toques", una lista vacía es "quítalas todas", y `null` es la única forma
// de decir que lo que llegó no era una lista de ids.
//
// No se valida contra el catálogo a propósito. Borrar una etiqueta no limpia
// las asignaciones que la nombran (ver la ruta DELETE), así que un id que ya no
// resuelve es un estado esperado y TagPill sabe pintarlo. Validar aquí volvería
// invisible ese estado rechazando el guardado de un registro intacto.
function normalizeAssignedTags(value) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Aplica el resultado a un registro: la clave está presente solo cuando hay
// algo, para que "nunca tuvo etiquetas" y "se las quitaron todas" se lean igual
// al leer el registro después.
function applyAssignedTags(record, tags) {
  if (tags === undefined) return record;
  if (tags.length) record.tags = tags;
  else delete record.tags;
  return record;
}

function registerTagsRoutes({ app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError }) {
  app.get("/api/tags", requireAuth, (req, res) => {
    res.json(readTags(kvGet));
  });

  // Sube el catálogo que un navegador tenga en localStorage["hq_tags"], y solo
  // mientras no haya ninguno guardado: es la migración de una sola vez descrita
  // en el ADR, no una forma de reemplazar el catálogo de todos.
  app.post("/api/tags/adopt", requireAuth, auditActivity({ provider: "tags", action: "Adoptar etiquetas del navegador" }), (req, res) => {
    if (Array.isArray(kvGet("tags")?.value)) {
      return sendAppError(res, AppError.conflict("tags-already-stored"), req);
    }
    const incoming = req.body?.tags;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return sendAppError(res, AppError.badRequest("tags-array-required"), req);
    }
    const taken = new Set();
    const tags = [];
    for (const raw of incoming) {
      const label = raw?.label;
      if (!label || !String(label).trim()) return sendAppError(res, AppError.badRequest("label-required"), req);
      const id = raw?.id ? String(raw.id) : uniqueId(slugify(label), taken);
      if (taken.has(id)) return sendAppError(res, AppError.badRequest("duplicate-tag-id"), req);
      taken.add(id);
      const values = normalizeValues(raw?.values, []);
      if (values === null) return sendAppError(res, AppError.badRequest("invalid-tag-values"), req);
      tags.push({
        schemaVersion: TAG_SCHEMA_VERSION,
        id,
        label: String(label).trim(),
        color: raw?.color ? String(raw.color) : "#64748b",
        description: raw?.description ? String(raw.description) : "",
        ...(values.length ? { values } : {}),
      });
    }
    kvSet("tags", tags);
    res.locals.auditMessage = `Adoptar ${tags.length} etiquetas del navegador`;
    res.json(tags);
  });

  // El catálogo es una lista ordenada y crear siempre añade al final, así que
  // sin esto la etiqueta más útil acaba abajo del todo y no hay forma de
  // subirla. Recibe todos los ids en el orden deseado: una permutación exacta,
  // ni más ni menos, para que reordenar no pueda perder ni inventar etiquetas.
  app.put("/api/tags/order", requireAuth, auditActivity({ provider: "tags", action: "Reordenar etiquetas" }), (req, res) => {
    const tags = readTags(kvGet);
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) return sendAppError(res, AppError.badRequest("ids-array-required"), req);
    const wanted = ids.map(String);
    if (new Set(wanted).size !== wanted.length) {
      return sendAppError(res, AppError.badRequest("duplicate-tag-id"), req);
    }
    const known = new Set(tags.map(tag => tag.id));
    if (wanted.length !== tags.length || wanted.some(id => !known.has(id))) {
      return sendAppError(res, AppError.badRequest("ids-must-be-every-existing-tag"), req);
    }
    const byId = new Map(tags.map(tag => [tag.id, tag]));
    const ordered = wanted.map(id => byId.get(id));
    kvSet("tags", ordered);
    res.locals.auditMessage = `Reordenar ${ordered.length} etiquetas`;
    res.json(ordered);
  });

  app.post("/api/tags", requireAuth, auditActivity({ provider: "tags", action: "Crear etiqueta" }), (req, res) => {
    const { label, color, description } = req.body || {};
    if (!label || !String(label).trim()) {
      return sendAppError(res, AppError.badRequest("label-required"), req);
    }
    const tags = readTags(kvGet);
    const values = normalizeValues(req.body?.values, []);
    if (values === null) return sendAppError(res, AppError.badRequest("invalid-tag-values"), req);

    const id = uniqueId(slugify(label), new Set(tags.map(tag => tag.id)));
    if (!id) return sendAppError(res, AppError.badRequest("label-has-no-usable-id"), req);

    const tag = {
      schemaVersion: TAG_SCHEMA_VERSION,
      id,
      label: String(label).trim(),
      color: color ? String(color) : "#64748b",
      description: description ? String(description) : "",
      ...(values.length ? { values } : {}),
    };
    kvSet("tags", [...tags, tag]);
    res.locals.auditMessage = `Crear etiqueta "${tag.label}"`;
    res.json(tag);
  });

  app.put("/api/tags/:id", requireAuth, auditActivity({ provider: "tags", action: "Editar etiqueta" }), (req, res) => {
    const tags = readTags(kvGet);
    const existing = tags.find(tag => tag.id === req.params.id);
    if (!existing) return sendAppError(res, AppError.notFound("not-found"), req);

    const { label, color, description } = req.body || {};
    if (label !== undefined && !String(label).trim()) {
      return sendAppError(res, AppError.badRequest("label-required"), req);
    }
    const values = normalizeValues(req.body?.values, existing.values || []);
    if (values === null) return sendAppError(res, AppError.badRequest("invalid-tag-values"), req);

    // El id no se recalcula al renombrar: lo tienen guardado las asignaciones.
    const updated = {
      ...existing,
      schemaVersion: TAG_SCHEMA_VERSION,
      ...(label !== undefined ? { label: String(label).trim() } : {}),
      ...(color !== undefined ? { color: String(color) } : {}),
      ...(description !== undefined ? { description: String(description) } : {}),
      ...(values.length ? { values } : {}),
    };
    if (!values.length) delete updated.values;
    kvSet("tags", tags.map(tag => tag.id === req.params.id ? updated : tag));
    res.locals.auditMessage = `Editar etiqueta "${updated.label}"`;
    res.json(updated);
  });

  app.delete("/api/tags/:id", requireAuth, auditActivity({ provider: "tags", action: "Borrar etiqueta" }), (req, res) => {
    const tags = readTags(kvGet);
    const existing = tags.find(tag => tag.id === req.params.id);
    if (!existing) return sendAppError(res, AppError.notFound("not-found"), req);
    // Las asignaciones que apunten a esta etiqueta no se limpian aquí: viven en
    // otras tablas y TagPill ya sabe pintar un id que no resuelve. Borrarlas en
    // cascada desde el catálogo sería una edición silenciosa del vault.
    kvSet("tags", tags.filter(tag => tag.id !== req.params.id));
    res.locals.auditMessage = `Borrar etiqueta "${existing.label}"`;
    res.json({ ok: true, id: existing.id });
  });
}

module.exports = {
  registerTagsRoutes, DEFAULT_TAGS, TAG_SCHEMA_VERSION,
  slugify, normalizeValues, readTags,
  normalizeAssignedTags, applyAssignedTags,
};
