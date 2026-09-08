function safeJson(content) {
  if (!content) return null;
  try { return JSON.parse(content); } catch (_) { return null; }
}

function component(ecosystem, name, version, constraint, role, sourceFile, confidence = "medium") {
  return {
    ecosystem,
    name,
    version: version || null,
    constraint: constraint || null,
    role,
    sourceFile,
    confidence,
  };
}

function uniqueComponents(components) {
  const seen = new Set();
  return components.filter((item) => {
    const key = `${item.ecosystem}:${item.name}:${item.version || item.constraint || "unknown"}:${item.sourceFile}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { safeJson, component, uniqueComponents };
