const { redactText } = require("./secrets");

function redactMeta(value, secrets) {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactMeta(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactMeta(item, secrets)]));
  }
  return value;
}

function createConnectorLogger(options = {}) {
  const { id, write, getSecrets = () => [] } = options;
  if (!id || typeof write !== "function") {
    throw new TypeError("createConnectorLogger requires id and write");
  }
  // meta is optional structured detail for the entry (e.g. which endpoint(s)
  // the call hit) — surfaced in the UI behind an expand toggle so the one-line
  // message can stay short. Caller-supplied; redact anything secret before
  // passing it in, same as the message.
  return (level, message, meta) => {
    const secrets = getSecrets();
    const safeMessage = redactText(message, secrets);
    return write(id, level, safeMessage, redactMeta(meta, secrets));
  };
}

module.exports = { createConnectorLogger, redactMeta };
