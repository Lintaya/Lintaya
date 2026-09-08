// Structured logger shared across the backend. Replaces ad hoc `console.*`
// calls with a consistent `timestamp LEVEL [component] message {meta}` line,
// plus `.child(bindings)` to carry a requestId/component through a call chain
// without threading it through every function signature.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CONSOLE_METHOD = { debug: "log", info: "log", warn: "warn", error: "error" };

function serializeMeta(meta) {
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  try {
    return ` ${JSON.stringify(Object.fromEntries(entries))}`;
  } catch {
    return "";
  }
}

function createLogger(bindings = {}, options = {}) {
  const minLevel = LEVELS[options.minLevel] ?? LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

  function write(level, message, meta) {
    if (LEVELS[level] < minLevel) return;
    const tag = bindings.component ? `[${bindings.component}] ` : "";
    const rest = { ...bindings, ...meta };
    delete rest.component;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${tag}${message}${serializeMeta(rest)}`;
    // eslint-disable-next-line no-console
    console[CONSOLE_METHOD[level]](line);
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child(extra = {}) {
      return createLogger({ ...bindings, ...extra }, options);
    },
  };
}

const logger = createLogger();

module.exports = { createLogger, logger };
