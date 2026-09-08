function secretPresenceKey(field) {
  return `has${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

function publicConnectorConfig(config, options = {}) {
  const secretFields = new Set(options.secretFields || []);
  const result = {};
  for (const [field, value] of Object.entries(config || {})) {
    if (secretFields.has(field)) {
      result[secretPresenceKey(field)] = Boolean(value);
    } else {
      result[field] = value;
    }
  }
  return result;
}

function redactText(value, secrets, replacement = "[REDACTED]") {
  let text = String(value ?? "");
  const candidates = [...new Set((secrets || [])
    .map((secret) => String(secret || ""))
    .filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const secret of candidates) text = text.split(secret).join(replacement);
  return text;
}

module.exports = { publicConnectorConfig, redactText, secretPresenceKey };
