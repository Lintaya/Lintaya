// JSON Schema validation for action input/output — AGENT-001 (ADR-011).
// Uses the 2020-12 draft, same style as the connector config.schema.json
// files, even though action schemas are unrelated to those (a connector's
// config shape is a ConnectorType concern; an action's input/output shape is
// per-action). ajv was already present transitively (see package-lock.json)
// but never a direct dependency or actually invoked anywhere — no schema in
// this codebase was validated server-side before this.
const Ajv2020 = require("ajv/dist/2020");

const ajv = new Ajv2020({ allErrors: true, strict: false });

// Returns { valid, errors } — errors is a flat array of human-readable
// strings (not raw ajv error objects), so callers can drop it straight into
// an AppError's `details` without reshaping it first. A missing/non-object
// schema is treated as "anything goes" (valid) rather than a validator bug —
// callers that always want a schema should check for one before calling this.
function validateAgainstSchema(schema, value) {
  if (!schema || typeof schema !== "object") return { valid: true, errors: [] };
  const validate = ajv.compile(schema);
  const valid = validate(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors || []).map((error) => {
    const path = error.instancePath || "(root)";
    return `${path} ${error.message}`.trim();
  });
  return { valid: false, errors };
}

module.exports = { validateAgainstSchema };
