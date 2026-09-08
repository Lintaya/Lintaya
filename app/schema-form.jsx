// Renderiza campos de formulario a partir de un JSON Schema de conector
// (server/connectors/*/config.schema.json — draft 2020-12, subset: object con
// properties string/object, required, default, description, format:"uri" y la
// extensión x-lintaya-secret/writeOnly para campos sensibles). Ver
// el contrato interno de formularios ("formularios generados desde
// config.schema.json").
//
// No es un formulario completo (submit, guardado, mensajes de error) — cada
// panel de configuración sigue dueño de eso, como siempre. Solo reemplaza los
// <label>/<input> repetidos a mano por conector:
//
//   const [values, setValues] = useState({});
//   <SchemaFields schema={schema} values={values}
//     onChange={(key, val) => setValues(v => ({ ...v, [key]: val }))} />
//
// Campos `x-lintaya-secret`/`writeOnly` nunca se precargan con el valor
// guardado (el backend no lo devuelve) — el placeholder lo indica y dejarlo
// vacío en el submit significa "no cambiar".
//
// Dos formas condicionales de JSON Schema, soportadas de forma acotada
// (no un intérprete genérico — solo los dos patrones que los conectores
// reales usan hoy):
//
//   allOf: [{ if: { properties: { type: { const: "server" } } },
//             then: { required: ["baseUrl"] } }]
//     -> el asterisco de "requerido" de baseUrl aparece/desaparece según el
//        valor actual de `type` (usado por Bitbucket: Cloud vs. Server).
//
//   anyOf: [{ title: "API Key", required: ["apiKey"] },
//            { title: "Usuario y contraseña", required: ["username","password"] }]
//     -> se interpreta como "grupos mutuamente excluyentes": un toggle
//        decide cuál grupo de campos se muestra y exige (usado por
//        Portainer: API key vs. usuario+contraseña). Si algún elemento del
//        array trae `properties` (un oneOf/anyOf "de verdad", con campos
//        propios por rama) no se reconoce el patrón y esos campos no se
//        agrupan — se listan igual, sin agrupar.
const { useState: useSchemaFormState } = React;

function requiredFromAllOf(allOf, values) {
  const required = new Set();
  if (!Array.isArray(allOf)) return required;
  for (const clause of allOf) {
    const ifProps = clause?.if?.properties;
    if (!ifProps) continue;
    const matches = Object.entries(ifProps).every(([key, cond]) => values?.[key] === cond?.const);
    if (matches) (clause?.then?.required || []).forEach((key) => required.add(key));
  }
  return required;
}

function isRequiredGroupChoice(anyOf) {
  return Array.isArray(anyOf) && anyOf.length > 1 &&
    anyOf.every((branch) => Array.isArray(branch?.required) && !branch.properties);
}

// Un campo que solo aparece en el `then.required` de una cláusula allOf se
// considera "condicional": se oculta salvo que esa cláusula esté activa con
// los valores actuales (p. ej. baseUrl de Bitbucket, que allOf marca
// required solo cuando type === "server" — se oculta cuando type === "cloud").
// Campos que no aparecen en ningún then.required son siempre visibles.
function hiddenFromAllOf(allOf, values) {
  const conditional = new Set();
  const visible = new Set();
  if (!Array.isArray(allOf)) return conditional; // empty = nothing conditional, nothing hidden
  for (const clause of allOf) {
    const ifProps = clause?.if?.properties;
    const thenRequired = clause?.then?.required;
    if (!ifProps || !Array.isArray(thenRequired)) continue;
    const matches = Object.entries(ifProps).every(([key, cond]) => values?.[key] === cond?.const);
    thenRequired.forEach((key) => { conditional.add(key); if (matches) visible.add(key); });
  }
  for (const key of visible) conditional.delete(key);
  return conditional; // what's left is conditional AND not currently matched -> hide
}

function labelizeKey(key) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const schemaFieldEye = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const schemaFieldEyeOff = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const schemaFieldStyles = {
  label: { fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", display: "block", marginBottom: 4 },
  input: {
    height: 32, padding: "0 10px", fontSize: 12.5, border: "1px solid var(--border)",
    borderRadius: 5, outline: 0, fontFamily: "var(--font-mono)", width: "100%",
    background: "white", color: "var(--fg)", boxSizing: "border-box",
  },
  desc: { fontSize: 10.5, color: "var(--muted-fg)", marginTop: 3 },
  group: { border: "1px solid var(--border)", borderRadius: 6, padding: 10 },
  groupLabel: { fontSize: 11, fontWeight: 700, color: "var(--fg)" },
};

function SchemaField({ name, prop, required, value, onChange, secretPlaceholder, connectorId }) {
  const locale = window.I18N.useLocale();
  const isSecret = Boolean(prop["x-lintaya-secret"] || prop.writeOnly);
  const [showSecret, setShowSecret] = useSchemaFormState(false);
  const label = prop.title || labelizeKey(name);
  const description = window.I18N.tSchemaText(connectorId, name, prop.description);

  if (prop.type === "object" && prop.properties) {
    const nestedRequired = new Set(prop.required || []);
    return (
      <div style={schemaFieldStyles.group}>
        <div style={schemaFieldStyles.groupLabel}>{label}{required && " *"}</div>
        {description && <div style={schemaFieldStyles.desc}>{description}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {Object.entries(prop.properties).map(([subKey, subProp]) => (
            <SchemaField
              key={subKey}
              name={subKey}
              prop={subProp}
              required={nestedRequired.has(subKey)}
              value={value?.[subKey]}
              onChange={(v) => onChange({ ...(value || {}), [subKey]: v })}
              secretPlaceholder={secretPlaceholder}
              connectorId={connectorId}
            />
          ))}
        </div>
      </div>
    );
  }

  if (Array.isArray(prop.enum)) {
    const isNumeric = prop.type === "integer" || prop.type === "number";
    return (
      <div>
        <label style={schemaFieldStyles.label}>{label}{required && " *"}</label>
        <select
          style={schemaFieldStyles.input}
          value={value ?? prop.default ?? ""}
          onChange={(e) => onChange(isNumeric ? Number(e.target.value) : e.target.value)}
        >
          {prop.enum.map((opt) => <option key={opt} value={opt}>{window.I18N.tSchemaEnumLabel(connectorId, name, opt, prop["x-enum-labels"]?.[opt] || opt)}</option>)}
        </select>
        {description && <div style={schemaFieldStyles.desc}>{description}</div>}
      </div>
    );
  }

  if (prop.type === "integer" || prop.type === "number") {
    return (
      <div>
        <label style={schemaFieldStyles.label}>{label}{required && " *"}</label>
        <input
          type="number"
          style={schemaFieldStyles.input}
          min={prop.minimum ?? (prop.exclusiveMinimum != null ? prop.exclusiveMinimum + (prop.type === "integer" ? 1 : 0) : undefined)}
          max={prop.maximum}
          step={prop.type === "integer" ? 1 : "any"}
          placeholder={prop.default ?? ""}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        {description && <div style={schemaFieldStyles.desc}>{description}</div>}
      </div>
    );
  }

  return (
    <div>
      <label style={schemaFieldStyles.label}>{label}{required && " *"}</label>
      {isSecret ? (
        <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 5, background: "white", overflow: "hidden" }}>
          <input
            type={showSecret ? "text" : "password"}
            style={{ ...schemaFieldStyles.input, flex: 1, border: 0, borderRadius: 0 }}
            placeholder={secretPlaceholder}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button" onClick={() => setShowSecret(v => !v)}
            title={showSecret ? "Hide" : "Show"}
            style={{ height: 32, width: 32, border: 0, background: "none", cursor: "pointer", color: "var(--muted-fg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            {showSecret ? schemaFieldEyeOff : schemaFieldEye}
          </button>
        </div>
      ) : (
        <input
          type={prop.format === "uri" ? "url" : prop.format === "email" ? "email" : "text"}
          style={schemaFieldStyles.input}
          placeholder={prop.default ?? ""}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {description && <div style={schemaFieldStyles.desc}>{description}</div>}
    </div>
  );
}

const groupToggleStyles = {
  row: { display: "flex", gap: 6 },
  btn: (active) => ({
    flex: 1, height: 28, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "color-mix(in srgb,var(--accent) 8%,white)" : "white",
    color: active ? "var(--accent)" : "var(--muted-fg)",
  }),
};

// Toggle entre grupos de campos mutuamente excluyentes (ver isRequiredGroupChoice).
// Arranca en el grupo cuyos campos ya tengan valor (al editar una config
// existente); si ninguno, en el primero.
function RequiredGroupFields({ schema, groups, values, onChange, secretPlaceholder, connectorId }) {
  const locale = window.I18N.useLocale();
  const groupedKeys = new Set(groups.flatMap((g) => g.required));
  const sharedKeys = Object.keys(schema.properties).filter((key) => !groupedKeys.has(key));
  const [active, setActive] = useSchemaFormState(() => {
    const idx = groups.findIndex((g) => g.required.every((key) => values[key]));
    return idx >= 0 ? idx : 0;
  });

  return (
    <>
      {sharedKeys.map((key) => (
        <SchemaField
          key={key}
          name={key}
          prop={schema.properties[key]}
          required={(schema.required || []).includes(key)}
          value={values[key]}
          onChange={(v) => onChange(key, v)}
          secretPlaceholder={secretPlaceholder}
          connectorId={connectorId}
        />
      ))}
      <div style={groupToggleStyles.row}>
        {groups.map((g, i) => (
          <button key={i} type="button" onClick={() => setActive(i)} style={groupToggleStyles.btn(active === i)}>
            {g.title ? window.I18N.tSchemaGroupTitle(connectorId, g.title) : g.required.map(labelizeKey).join(" + ")}
          </button>
        ))}
      </div>
      {groups[active].required.map((key) => (
        <SchemaField
          key={key}
          name={key}
          prop={schema.properties[key]}
          required
          value={values[key]}
          onChange={(v) => onChange(key, v)}
          secretPlaceholder={secretPlaceholder}
          connectorId={connectorId}
        />
      ))}
    </>
  );
}

function SchemaFields({ schema, values = {}, onChange, secretPlaceholder = window.I18N.t("connectors.secretPlaceholder"), connectorId }) {
  if (!schema?.properties) return null;

  if (isRequiredGroupChoice(schema.anyOf)) {
    return (
      <RequiredGroupFields
        schema={schema}
        groups={schema.anyOf}
        values={values}
        onChange={onChange}
        secretPlaceholder={secretPlaceholder}
        connectorId={connectorId}
      />
    );
  }

  const required = new Set(schema.required || []);
  requiredFromAllOf(schema.allOf, values).forEach((key) => required.add(key));
  const hidden = hiddenFromAllOf(schema.allOf, values);

  return (
    <>
      {Object.entries(schema.properties).filter(([key]) => !hidden.has(key)).map(([key, prop]) => (
        <SchemaField
          key={key}
          name={key}
          prop={prop}
          required={required.has(key)}
          value={values[key]}
          onChange={(v) => onChange(key, v)}
          secretPlaceholder={secretPlaceholder}
          connectorId={connectorId}
        />
      ))}
    </>
  );
}

window.SchemaFields = SchemaFields;
