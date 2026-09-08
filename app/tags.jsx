// Reusable tag components — used by Apps, Devices, Passwords, etc.
// Tags can be simple { id, label, color, description }
// or categories  { id, label, color, description, values: [{ id, label }] }
// Items store value IDs (e.g. "conn-ssh") or simple tag IDs (e.g. "infra").
const tt = (key, fallback, vars) => window.I18N?.t(key, fallback, vars) || fallback || key;

function getTag(id) {
  const tags = window.APP_DATA?.TAGS || [];
  // 1. Direct top-level match (simple tag)
  const top = tags.find(t => t.id === id);
  if (top) return top;
  // 2. Search inside category values — inherit category color
  for (const cat of tags) {
    const val = (cat.values || []).find(v => v.id === id);
    if (val) return { id: val.id, label: val.label, color: cat.color, _cat: cat.id };
  }
  return { id, label: id, color: "#78716c" };
}

function TagPill({ id, size = "sm", onClick, removable, onRemove }) {
  const t = getTag(id);
  const small = size === "sm";
  return (
    <span onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: small ? "1.5px 6px" : "3px 8px",
      fontSize: small ? 10 : 11,
      fontWeight: 600, letterSpacing: 0.3,
      borderRadius: 3,
      background: `${t.color}1a`,
      color: t.color,
      cursor: onClick ? "pointer" : "default",
      lineHeight: 1.2,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: t.color, flexShrink: 0 }} />
      {t.label}
      {removable && (
        <button onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          style={{ background: "none", border: 0, cursor: "pointer", padding: 0, marginLeft: 2, color: t.color, lineHeight: 1, fontSize: 12 }}>
          ×
        </button>
      )}
    </span>
  );
}

function TagFilter({ value = [], onChange, items }) {
  const allTags = window.APP_DATA?.TAGS || [];

  // Collect all tag IDs used in this dataset
  const usedIds = new Set();
  (items || []).forEach(it => (it.tags || []).forEach(id => usedIds.add(id)));
  if (!usedIds.size) return null;

  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);

  // Build display groups: simple tags flat, category tags grouped
  const simpleUsed = allTags.filter(t => !t.values?.length && usedIds.has(t.id));
  const catGroups  = allTags
    .filter(t => t.values?.length)
    .map(t => ({ ...t, usedValues: t.values.filter(v => usedIds.has(v.id)) }))
    .filter(t => t.usedValues.length > 0);

  if (!simpleUsed.length && !catGroups.length) return null;

  const Btn = ({ id, label, color }) => {
    const active = value.includes(id);
    return (
      <button onClick={() => toggle(id)} style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", fontSize: 10.5, fontWeight: 600,
        borderRadius: 3, border: "1px solid",
        borderColor: active ? color : "var(--border)",
        background: active ? `${color}1a` : "white",
        color: active ? color : "var(--muted-fg)",
        cursor: "pointer", fontFamily: "inherit",
      }}>
        <span style={{ width: 5, height: 5, borderRadius: 999, background: color }} />
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--muted-fg)", marginRight: 2 }}>{tt("tags.title", "Tags")}:</span>

      {simpleUsed.map(t => <Btn key={t.id} id={t.id} label={t.label} color={t.color} />)}

      {catGroups.map(cat => (
        <div key={cat.id} style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 6px", borderRadius: 4,
          background: `${cat.color}08`, border: `1px solid ${cat.color}28`,
        }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: cat.color, letterSpacing: 0.4, textTransform: "uppercase", marginRight: 1 }}>
            {cat.label}:
          </span>
          {cat.usedValues.map(v => (
            <button key={v.id} onClick={() => toggle(v.id)} style={{
              padding: "1px 7px", fontSize: 10.5, fontWeight: 600,
              borderRadius: 3, border: "1px solid",
              borderColor: value.includes(v.id) ? cat.color : "transparent",
              background: value.includes(v.id) ? `${cat.color}1a` : "transparent",
              color: value.includes(v.id) ? cat.color : "var(--muted-fg)",
              cursor: "pointer", fontFamily: "inherit",
            }}>{v.label}</button>
          ))}
        </div>
      ))}

      {value.length > 0 && (
        <button onClick={() => onChange([])} style={{
          padding: "2px 6px", fontSize: 10.5, color: "var(--muted-fg)",
          background: "none", border: 0, cursor: "pointer", textDecoration: "underline",
        }}>{tt("tags.clear", "clear")}</button>
      )}
    </div>
  );
}

// Selector de etiquetas — el mismo control para Boards, Dashboards, Blocks y
// Devices, en vez de una copia por editor. Elegir es siempre opcional: no hay
// nada preseleccionado, ninguna vista exige una, y no seleccionar nada devuelve
// una lista vacía, que es lo que el servidor interpreta como "sin etiquetas".
//
// Un campo con búsqueda y no una rejilla de chips ni un <select>: la rejilla
// mostraba las ~26 opciones a la vez y se comía media columna del editor, y el
// desplegable las escondía todas detrás de un scroll donde hay que reconocer el
// nombre exacto. Así ocupa una línea, la lista solo aparece mientras se escribe
// o mientras el campo tiene el foco, y se filtra tanto por el nombre de la
// etiqueta como por el de su categoría — buscar "prod" o "environment" llega al
// mismo sitio.
function TagPicker({ value = [], onChange, disabled = false }) {
  window.I18N?.useLocale();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const all = window.APP_DATA?.TAGS || [];

  // Cada opción lleva su categoría para poder buscarla por ahí y para mostrar
  // de dónde sale: "Prod" solo dice poco, "Environment · Prod" ubica.
  const options = [];
  for (const tag of all) {
    if (tag.values?.length) {
      for (const val of tag.values) options.push({ id: val.id, label: val.label, group: tag.label, color: tag.color });
    } else {
      options.push({ id: tag.id, label: tag.label, group: null, color: tag.color });
    }
  }

  // Sin recortar: la lista ya tiene su propio scroll, y un tope escondía
  // etiquetas que sí existen sin decirlo en ninguna parte.
  const term = query.trim().toLowerCase();
  const matches = options
    .filter(option => !value.includes(option.id))
    .filter(option => !term
      || option.label.toLowerCase().includes(term)
      || (option.group || "").toLowerCase().includes(term));

  const add = option => {
    if (!option) return;
    onChange([...value, option.id]);
    setQuery("");
    setCursor(0);
  };

  const onKeyDown = event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setCursor(current => {
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        return Math.max(0, Math.min(matches.length - 1, next));
      });
      return;
    }
    if (event.key === "Enter") { event.preventDefault(); add(matches[cursor]); return; }
    if (event.key === "Escape") { setOpen(false); setQuery(""); }
  };

  if (!all.length) {
    return <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{tt("tags.noneYet", "No tags yet — create one in Tags.")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ position: "relative" }}>
        <input
          value={query} disabled={disabled}
          placeholder={tt("tags.search", "Search tags…")}
          aria-label={tt("tags.search", "Search tags…")}
          role="combobox" aria-expanded={open && matches.length > 0} aria-autocomplete="list"
          onChange={event => { setQuery(event.target.value); setCursor(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          // El blur va diferido: un clic en una opción dispara blur antes que
          // el click, y sin la espera la lista desaparece antes de elegir.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          style={{
            height: 30, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6,
            fontSize: 12, fontFamily: "inherit", background: "white", color: "var(--fg)",
            width: "100%", boxSizing: "border-box", outline: "none",
          }}
        />
        {open && matches.length > 0 && (
          <ul role="listbox" style={{
            position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 30,
            margin: 0, padding: 4, listStyle: "none", maxHeight: 210, overflowY: "auto",
            background: "white", border: "1px solid var(--border)", borderRadius: 6,
            boxShadow: "0 8px 24px -10px rgba(0,0,0,.35)",
          }}>
            {matches.map((option, index) => (
              <li key={option.id} role="option" aria-selected={index === cursor}
                onMouseDown={event => { event.preventDefault(); add(option); }}
                onMouseEnter={() => setCursor(index)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 7px",
                  borderRadius: 4, cursor: "pointer", fontSize: 12,
                  background: index === cursor ? "var(--muted)" : "transparent",
                }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: option.color, flexShrink: 0 }} />
                <span style={{ color: "var(--fg)" }}>{option.label}</span>
                {option.group && <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted-fg)" }}>{option.group}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {value.map(id => (
            <TagPill key={id} id={id} removable={!disabled} onRemove={() => onChange(value.filter(x => x !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}

// Opciones para el filtro por etiqueta de un catálogo, con la forma que espera
// FilterChip: [[valor, texto], …]. Solo devuelve etiquetas que alguna fila de
// esa lista usa de verdad, y una lista vacía cuando no hay ninguna — de ahí
// sale que el filtro no se dibuje en un catálogo sin etiquetar, en vez de
// ofrecer un desplegable con "Todas" y nada más.
//
// La categoría va en el propio texto ("Purpose · Code") porque un <option> no
// se puede agrupar dentro de FilterChip, y "Code" a secas no dice de dónde
// sale cuando dos categorías tienen valores parecidos.
function tagFilterOptions(items) {
  const used = new Set();
  for (const item of items || []) for (const id of item?.tags || []) used.add(id);
  if (!used.size) return [];

  const options = [];
  for (const tag of window.APP_DATA?.TAGS || []) {
    if (tag.values?.length) {
      for (const value of tag.values) {
        if (used.has(value.id)) { options.push([value.id, `${tag.label} · ${value.label}`]); used.delete(value.id); }
      }
    } else if (used.has(tag.id)) {
      options.push([tag.id, tag.label]);
      used.delete(tag.id);
    }
  }
  // Lo que quede es una etiqueta borrada del catálogo que algún registro
  // todavía nombra. Se ofrece igual, con su id crudo: si no, esas filas no
  // habría forma de encontrarlas.
  for (const id of used) options.push([id, id]);
  return options;
}

window.TagPill   = TagPill;
window.TagFilter = TagFilter;
window.tagFilterOptions = tagFilterOptions;
window.TagPicker = TagPicker;
window.getTag    = getTag;

// ── Tags manager (CRUD) ──────────────────────────────────────────────────────
const { useState, useMemo, useEffect } = React;

const TAG_COLORS = [
  "#2563eb","#0891b2","#0ea5e9","#4f46e5","#7c3aed","#9333ea",
  "#ec4899","#e11d48","#dc2626","#ea580c","#d97706","#ca8a04",
  "#16a34a","#059669","#14b8a6","#64748b","#be123c","#a16207",
];

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {TAG_COLORS.map(c => (
        <button key={c} onClick={() => onChange(c)} title={c} style={{
          width: 22, height: 22, borderRadius: 5, background: c, border: "none",
          cursor: "pointer",
          outline: value === c ? `3px solid ${c}` : "none",
          outlineOffset: 2,
          transform: value === c ? "scale(1.2)" : "scale(1)",
          transition: "transform .1s",
        }} />
      ))}
    </div>
  );
}

// Inline form used for both create and edit
function TagForm({ initial, onSave, onCancel }) {
  const isCategory = !!(initial?.values);
  const [label, setLabel]   = useState(initial?.label || "");
  const [color, setColor]   = useState(initial?.color || TAG_COLORS[0]);
  const [desc,  setDesc]    = useState(initial?.description || "");
  const [hasValues, setHasValues] = useState(isCategory);
  const [values, setValues] = useState(initial?.values ? [...initial.values] : []);
  const [newVal, setNewVal] = useState("");

  const valid = label.trim().length > 0;

  const addValue = () => {
    const v = newVal.trim();
    if (!v) return;
    const vid = (initial?.id || "cat") + "-" + v.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    setValues(prev => [...prev, { id: vid, label: v }]);
    setNewVal("");
  };

  const removeValue = (vid) => setValues(prev => prev.filter(v => v.id !== vid));

  const handleSave = () => {
    if (!valid) return;
    onSave({ label: label.trim(), color, description: desc.trim(), values: hasValues ? values : undefined });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Label */}
      <div>
        <div style={fieldLabel}>{tt("tags.label", "Label")}</div>
        <input
          autoFocus
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && valid) handleSave(); if (e.key === "Escape") onCancel(); }}
          placeholder="e.g. Connection, Region, Infra…"
          style={input}
        />
      </div>

      {/* Description */}
      <div>
        <div style={fieldLabel}>{tt("tags.description", "Description")}</div>
        <input
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="What does this tag mean?"
          style={input}
        />
      </div>

      {/* Color */}
      <div>
        <div style={fieldLabel}>{tt("tags.color", "Color")}</div>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {/* Type toggle */}
      {!initial && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, color: "var(--fg)" }}>
            <input type="checkbox" checked={hasValues} onChange={e => setHasValues(e.target.checked)}
              style={{ width: 14, height: 14, cursor: "pointer" }} />
            This tag has selectable values (e.g. SSH / RDP)
          </label>
        </div>
      )}

      {/* Values management */}
      {hasValues && (
        <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
          <div style={{ ...fieldLabel, marginBottom: 6 }}>{tt("tags.values", "Values")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {values.map(v => (
              <span key={v.id} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 4,
                background: `${color}18`, color,
                fontSize: 11.5, fontWeight: 600,
              }}>
                {v.label}
                <button onClick={() => removeValue(v.id)} style={{
                  background: "none", border: 0, cursor: "pointer",
                  color, padding: 0, fontSize: 13, lineHeight: 1,
                }}>×</button>
              </span>
            ))}
            {values.length === 0 && <span style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{tt("tags.noValues", "No values yet")}</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newVal}
              onChange={e => setNewVal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addValue(); }}
              placeholder="Add a value…"
              style={{ ...input, flex: 1, height: 28 }}
            />
            <button onClick={addValue} style={{
              height: 28, padding: "0 10px", borderRadius: 5,
              background: "var(--muted)", border: "1px solid var(--border)",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>+ Add</button>
          </div>
        </div>
      )}

      {/* Preview */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{tt("tags.preview", "Preview")}:</span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", fontSize: 11, fontWeight: 600, borderRadius: 4,
          background: `${color}18`, color,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
          {label || "label"}
        </span>
        {hasValues && values[0] && (
          <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>→ values: {values.map(v => v.label).join(", ")}</span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6 }}>
        <button disabled={!valid} onClick={handleSave} style={{
          height: 30, padding: "0 14px", borderRadius: 5, border: "none",
          background: valid ? "var(--accent)" : "var(--muted)",
          color: valid ? "white" : "var(--muted-fg)",
          fontSize: 12.5, fontWeight: 600, cursor: valid ? "pointer" : "default", fontFamily: "inherit",
        }}>{tt("tags.save", "Save")}</button>
        <button onClick={onCancel} style={{
          height: 30, padding: "0 12px", borderRadius: 5, border: "1px solid var(--border)",
          background: "white", color: "var(--fg)", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
        }}>{tt("tags.cancel", "Cancel")}</button>
      </div>
    </div>
  );
}

function TagsView({ tweaks }) {
  window.I18N?.useLocale();
  const [tags, setTags]   = useState(() => [...(window.APP_DATA?.TAGS || [])]);
  const [mode, setMode]   = useState(null); // "new" | { edit: id } | { del: id }
  const density = tweaks?.tagsDensity || "cards"; // "table" | "cards" | "grid"

  // Quién usa cada etiqueta, contando ids sueltos y valores de categoría.
  //
  // Antes esto recorría APP_DATA.PASSWORDS y APP_DATA.DEVICES, que son los
  // arrays de ejemplo del cliente y están vacíos en cualquier instalación real:
  // la vista informaba cero usos por muchos dispositivos que hubiera. Ahora
  // pregunta a las mismas APIs que sirven cada cosa.
  const [tagged, setTagged] = useState([]);
  useEffect(() => {
    let live = true;
    const ask = url => window.HQ_API.request(url).then(r => Array.isArray(r) ? r : []).catch(() => []);
    Promise.all([
      ask("/api/devices"),
      ask("/api/vault/items"),
      ask("/api/module-pages"),
      ask("/api/dashboards"),
      ask("/api/home/custom-blocks"),
    ]).then(lists => { if (live) setTagged(lists.flat()); });
    return () => { live = false; };
  }, []);

  const usageCounts = useMemo(() => {
    const counts = {};
    for (const item of tagged) {
      for (const id of item?.tags || []) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [tagged]);

  // For a tag entry, sum its own count + all its values' counts
  const tagUses = (tag) => {
    let n = usageCounts[tag.id] || 0;
    (tag.values || []).forEach(v => { n += usageCounts[v.id] || 0; });
    return n;
  };

  // El servidor es el dueño del catálogo (ADR-015). APP_DATA.TAGS se mantiene
  // al día porque getTag(), passwords.jsx y devices.jsx lo leen de ahí; ya no
  // es donde vive el dato, solo la copia que el resto de la app consulta.
  const adopt = next => {
    setTags(next);
    window.APP_DATA.TAGS = next;
    window.dispatchEvent(new CustomEvent("hq:tags-changed"));
  };

  const toast = (msg, kind) => window.dispatchEvent(new CustomEvent("toast", { detail: { msg, kind } }));
  const failed = error => toast(tt("ui.saveFailed", "Could not save: {0}", { 0: error.message }), "error");

  useEffect(() => {
    let live = true;
    window.HQ_API.request("/api/tags").then(async list => {
      if (!live || !Array.isArray(list)) return;
      // Migración de una sola vez: un catálogo que alguien editó en este
      // navegador se sube mientras la instancia no tenga uno guardado. El
      // servidor responde 409 si ya lo tiene, y entonces gana el suyo.
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem("hq_tags") || "null"); } catch (_) {}
      if (Array.isArray(stored) && stored.length) {
        try {
          const adopted = await window.HQ_API.request("/api/tags/adopt", { method: "POST", body: { tags: stored } });
          localStorage.removeItem("hq_tags");
          if (live) adopt(adopted);
          return;
        } catch (_) {
          localStorage.removeItem("hq_tags");
        }
      }
      if (live) adopt(list);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const handleCreate = async ({ label, color, description, values }) => {
    try {
      const tag = await window.HQ_API.request("/api/tags", { method: "POST", body: { label, color, description, values } });
      adopt([...tags, tag]);
      setMode(null);
      toast(`Tag "${tag.label}" created`, "ok");
    } catch (error) { failed(error); }
  };

  const handleEdit = async (tagId, { label, color, description, values }) => {
    try {
      const updated = await window.HQ_API.request(`/api/tags/${encodeURIComponent(tagId)}`, {
        method: "PUT", body: { label, color, description, values: values ?? [] },
      });
      adopt(tags.map(t => t.id === tagId ? updated : t));
      setMode(null);
      toast(`Tag "${updated.label}" updated`, "ok");
    } catch (error) { failed(error); }
  };

  const handleDelete = async tagId => {
    const t = tags.find(tag => tag.id === tagId);
    try {
      await window.HQ_API.request(`/api/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
      adopt(tags.filter(tag => tag.id !== tagId));
      setMode(null);
      toast(`Tag "${t?.label}" deleted`, "ok");
    } catch (error) { failed(error); }
  };

  const simpleTags   = tags.filter(t => !t.values?.length);
  const categoryTags = tags.filter(t => t.values?.length > 0);
  const totalUses    = tags.reduce((sum, t) => sum + tagUses(t), 0);

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{tt("tags.title", "Tags")}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
            {tt("tags.summary", "{simple} simple · {categories} categories · {uses} uses across Devices, Passwords, Boards, Dashboards and Blocks", { simple: simpleTags.length, categories: categoryTags.length, uses: totalUses })}
          </p>
        </div>
        {mode !== "new" && (
          <button onClick={() => setMode("new")} style={{
            height: 32, padding: "0 12px", border: "1px solid var(--accent)",
            background: "var(--accent)", color: "white", borderRadius: 6,
            fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", fontWeight: 600,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>+ {tt("tags.new", "New tag")}</button>
        )}
      </div>

      {/* Density switcher — same Table/Cards/Grid pattern as VMs */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--muted)", borderRadius: 7 }}>
          <TagDensityBtn active={density === "table"} onClick={() => window.setTweak("tagsDensity", "table")} label="Table" icon="≡" />
          <TagDensityBtn active={density === "cards"} onClick={() => window.setTweak("tagsDensity", "cards")} label="Cards" icon="▦" />
          <TagDensityBtn active={density === "grid"}  onClick={() => window.setTweak("tagsDensity", "grid")}  label="Grid"  icon="⋮⋮" />
        </div>
      </div>

      {/* New tag form */}
      {mode === "new" && (
        <div style={{ marginBottom: 22, padding: 18, border: "1px solid var(--accent)", borderRadius: 10, background: "color-mix(in srgb, var(--accent) 4%, white)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 14, letterSpacing: 0.5, textTransform: "uppercase" }}>{tt("tags.newTitle", "New tag")}</div>
          <TagForm onSave={handleCreate} onCancel={() => setMode(null)} />
        </div>
      )}

      {/* ── Category tags ─────────────────────────────────────────────────── */}
      {categoryTags.length > 0 && (
        <TagGroup title="Category tags" subtitle="Items pick a value from these groups"
          tags={categoryTags} density={density} mode={mode} setMode={setMode}
          usageCounts={usageCounts} tagUses={tagUses}
          onSave={handleEdit} onDelete={handleDelete} />
      )}

      {/* ── Simple tags ───────────────────────────────────────────────────── */}
      {simpleTags.length > 0 && (
        <TagGroup title="Simple tags" subtitle="Applied directly to items"
          tags={simpleTags} density={density} mode={mode} setMode={setMode}
          usageCounts={usageCounts} tagUses={tagUses}
          onSave={handleEdit} onDelete={handleDelete} />
      )}

      {tags.length === 0 && mode !== "new" && (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--muted-fg)" }}>
          No tags yet. Create your first one above.
        </div>
      )}
    </div>
  );
}

function TagDensityBtn({ active, onClick, label, icon }) {
  const label2 = label === "Table" ? tt("tweaks.table", label) : label === "Cards" ? tt("tweaks.cards", label) : label === "Grid" ? tt("tweaks.grid", label) : label;
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 9px",
      background: active ? "white" : "transparent",
      border: active ? "1px solid var(--border)" : "1px solid transparent",
      boxShadow: active ? "0 1px 1px rgba(0,0,0,.04)" : "none",
      borderRadius: 5, fontSize: 12, fontFamily: "inherit",
      color: active ? "var(--fg)" : "var(--muted-fg)", cursor: "pointer", fontWeight: 500,
    }}>
      <span style={{ fontFamily: "var(--font-mono)" }}>{icon}</span> {label2}
    </button>
  );
}

// One section ("Category tags" / "Simple tags") rendered at whatever density
// the user picked — table/cards/grid all share the same edit-in-place and
// delete-confirm interaction, just laid out differently.
function TagGroup({ title, subtitle, tags, density, mode, setMode, usageCounts, tagUses, onSave, onDelete }) {
  return (
    <TagSection title={title} subtitle={subtitle}>
      {density === "table" ? (
        <TagTable tags={tags} mode={mode} setMode={setMode} usageCounts={usageCounts} tagUses={tagUses} onSave={onSave} onDelete={onDelete} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${density === "grid" ? 180 : 260}px, 1fr))`, gap: 10 }}>
          {tags.map(tag => {
            const uses = tagUses(tag);
            if (mode?.edit === tag.id) return (
              <div key={tag.id} style={editCard(tag.color)}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: tag.color, marginBottom: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>Edit — {tag.label}</div>
                <TagForm initial={tag} onSave={p => onSave(tag.id, p)} onCancel={() => setMode(null)} />
              </div>
            );
            const shared = {
              key: tag.id, tag, uses, usageCounts,
              isDeleting: mode?.del === tag.id,
              onEdit: () => setMode({ edit: tag.id }),
              onDelete: () => setMode({ del: tag.id }),
              onDeleteConfirm: () => onDelete(tag.id),
              onCancel: () => setMode(null),
            };
            return density === "grid" ? <TagGridCard {...shared} /> : <TagCard {...shared} />;
          })}
        </div>
      )}
    </TagSection>
  );
}

const tagTh = { textAlign: "left", padding: "8px 12px", fontWeight: 600 };

function TagTable({ tags, mode, setMode, usageCounts, tagUses, onSave, onDelete }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "var(--muted)", color: "var(--muted-fg)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase" }}>
            <th style={tagTh}>Tag</th>
            <th style={tagTh}>Description</th>
            <th style={tagTh}>Values</th>
            <th style={{ ...tagTh, width: 90 }}>Uses</th>
            <th style={{ ...tagTh, width: 150 }}>id</th>
            <th style={{ ...tagTh, width: 150, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.map(tag => {
            const uses = tagUses(tag);
            const isCategory = tag.values?.length > 0;
            if (mode?.edit === tag.id) return (
              <tr key={tag.id}>
                <td colSpan={6} style={{ padding: 0 }}>
                  <div style={editCard(tag.color)}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: tag.color, marginBottom: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>Edit — {tag.label}</div>
                    <TagForm initial={tag} onSave={p => onSave(tag.id, p)} onCancel={() => setMode(null)} />
                  </div>
                </td>
              </tr>
            );
            if (mode?.del === tag.id) return (
              <tr key={tag.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td colSpan={6} style={{ padding: "10px 12px", background: "color-mix(in srgb, var(--err) 6%, white)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--err)", fontWeight: 600 }}>
                      {uses > 0 ? `Used ${uses} time${uses !== 1 ? "s" : ""} — delete anyway?` : "Delete this tag?"}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => onDelete(tag.id)} style={{ height: 26, padding: "0 10px", borderRadius: 4, border: "none", background: "var(--err)", color: "white", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.delete", "Delete")}</button>
                      <button onClick={() => setMode(null)} style={{ height: 26, padding: "0 10px", borderRadius: 4, border: "1px solid var(--border)", background: "white", color: "var(--fg)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.cancel", "Cancel")}</button>
                    </div>
                  </div>
                </td>
              </tr>
            );
            return (
              <tr key={tag.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 5, background: `${tag.color}18`, color: tag.color, fontWeight: 700 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: tag.color, flexShrink: 0 }} />
                    {tag.label}
                  </span>
                </td>
                <td style={{ padding: "8px 12px", color: "var(--muted-fg)" }}>{tag.description || "—"}</td>
                <td style={{ padding: "8px 12px" }}>
                  {isCategory ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {tag.values.map(v => (
                        <span key={v.id} style={{ padding: "1.5px 7px", borderRadius: 4, background: `${tag.color}12`, color: tag.color, fontSize: 11, fontWeight: 600, border: `1px solid ${tag.color}28` }}>
                          {v.label}
                        </span>
                      ))}
                    </div>
                  ) : "—"}
                </td>
                <td style={{ padding: "8px 12px", color: uses > 0 ? "var(--fg)" : "var(--muted-fg)" }}>{uses > 0 ? uses : "unused"}</td>
                <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", color: "var(--muted-fg)", fontSize: 11 }}>{tag.id}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => setMode({ edit: tag.id })} style={{ height: 26, padding: "0 8px", borderRadius: 5, border: "1px solid var(--border)", background: "white", color: "var(--fg)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", marginRight: 6 }}>{tt("tags.edit", "Edit")}</button>
                  <button onClick={() => setMode({ del: tag.id })} style={{ height: 26, padding: "0 8px", borderRadius: 5, border: "1px solid color-mix(in srgb, var(--err) 30%, var(--border))", background: "white", color: "var(--err)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.delete", "Delete")}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Denser variant of TagCard for the "Grid" density — no description, values
// collapsed to a single count instead of a chip row, so more tags fit per
// screen at a glance (same idea as VMs' Grid/mini density).
function TagGridCard({ tag, uses, isDeleting, onEdit, onDelete, onDeleteConfirm, onCancel }) {
  const isCategory = tag.values?.length > 0;
  return (
    <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, background: "white", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5,
          background: `${tag.color}18`, color: tag.color, fontWeight: 700, fontSize: 12, minWidth: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: tag.color, flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag.label}</span>
        </span>
        <span style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted-fg)", flexShrink: 0 }}>
          {uses > 0 ? uses : "—"}{isCategory ? ` · ${tag.values.length}v` : ""}
        </span>
      </div>
      {isDeleting ? (
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onDeleteConfirm} style={{ flex: 1, height: 22, borderRadius: 4, border: "none", background: "var(--err)", color: "white", fontSize: 10.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.delete", "Delete")}</button>
          <button onClick={onCancel} style={{ flex: 1, height: 22, borderRadius: 4, border: "1px solid var(--border)", background: "white", color: "var(--fg)", fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.cancel", "Cancel")}</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onEdit} style={{ flex: 1, height: 22, borderRadius: 4, border: "1px solid var(--border)", background: "white", color: "var(--fg)", fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.edit", "Edit")}</button>
          <button onClick={onDelete} style={{ height: 22, padding: "0 6px", borderRadius: 4, border: "1px solid color-mix(in srgb, var(--err) 30%, var(--border))", background: "white", color: "var(--err)", fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}>×</button>
        </div>
      )}
    </div>
  );
}

function TagSection({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--muted-fg)", textTransform: "uppercase" }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11.5, color: "var(--muted-fg)", marginLeft: 8 }}>— {subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function TagCard({ tag, uses, usageCounts, isDeleting, onEdit, onDelete, onDeleteConfirm, onCancel }) {
  const isCategory = tag.values?.length > 0;
  return (
    <div style={{
      padding: 14, border: "1px solid var(--border)", borderRadius: 10,
      background: "white", display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 10px", borderRadius: 5,
          background: `${tag.color}18`, color: tag.color,
          fontWeight: 700, fontSize: 13, flexShrink: 0,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: tag.color }} />
          {tag.label}
        </span>
        <span style={{
          fontSize: 10.5, fontWeight: 600, flexShrink: 0,
          color: uses > 0 ? "var(--fg)" : "var(--muted-fg)",
          background: uses > 0 ? "var(--muted)" : "transparent",
          padding: uses > 0 ? "2px 6px" : 0, borderRadius: 4,
        }}>
          {uses > 0 ? `${uses} use${uses !== 1 ? "s" : ""}` : "unused"}
        </span>
      </div>

      {/* Description */}
      {tag.description && (
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.5 }}>{tag.description}</p>
      )}

      {/* Values (category tags) */}
      {isCategory && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {tag.values.map(v => {
            const n = usageCounts?.[v.id] || 0;
            return (
              <span key={v.id} title={`${n} use${n !== 1 ? "s" : ""}`} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 4,
                background: `${tag.color}12`, color: tag.color,
                fontSize: 11.5, fontWeight: 600, border: `1px solid ${tag.color}28`,
              }}>
                {v.label}
                {n > 0 && <span style={{ fontSize: 9.5, opacity: 0.7 }}>·{n}</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* ID */}
      <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--muted-fg)" }}>id: {tag.id}</div>

      {/* Delete confirmation */}
      {isDeleting ? (
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "color-mix(in srgb, var(--err) 8%, white)", border: "1px solid color-mix(in srgb, var(--err) 25%, var(--border))" }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--err)", fontWeight: 600 }}>
            {uses > 0 ? `Used ${uses} time${uses !== 1 ? "s" : ""} — delete anyway?` : "Delete this tag?"}
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onDeleteConfirm} style={{ height: 26, padding: "0 10px", borderRadius: 4, border: "none", background: "var(--err)", color: "white", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.delete", "Delete")}</button>
            <button onClick={onCancel}        style={{ height: 26, padding: "0 10px", borderRadius: 4, border: "1px solid var(--border)", background: "white", color: "var(--fg)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.cancel", "Cancel")}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
          <button onClick={onEdit}   style={{ flex: 1, height: 28, borderRadius: 5, border: "1px solid var(--border)", background: "white", color: "var(--fg)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>{tt("tags.edit", "Edit")}</button>
          <button onClick={onDelete} style={{ height: 28, padding: "0 10px", borderRadius: 5, border: "1px solid color-mix(in srgb, var(--err) 30%, var(--border))", background: "white", color: "var(--err)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>{tt("tags.delete", "Delete")}</button>
        </div>
      )}
    </div>
  );
}

const editCard = color => ({
  padding: 16, border: `1px solid ${color}`, borderRadius: 10,
  background: `${color}06`,
});

const fieldLabel = { fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", marginBottom: 4, letterSpacing: 0.4, textTransform: "uppercase" };
const input = { width: "100%", height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

window.TagsView  = TagsView;
