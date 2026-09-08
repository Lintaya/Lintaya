const { component } = require("./helpers");

const PACKAGES = { django: ["Django", "framework"], flask: ["Flask", "framework"], fastapi: ["FastAPI", "framework"], typer: ["Typer", "cli"], click: ["Click", "cli"] };

function detect(ctx) {
  if (!ctx.technologies.includes("python")) return [];
  const components = [];
  for (const file of ctx.files.filter((item) => /(^|\/)requirements(?:[-_.][^/]*)?\.txt$/i.test(item.path))) {
    const lines = (ctx.read(file.path) || "").split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*([A-Za-z0-9_.-]+)\s*([<>=~!].+)?$/.exec(line.replace(/\s+#.*$/, ""));
      if (!match) continue;
      const known = PACKAGES[match[1].toLowerCase()];
      if (!known) continue;
      const constraint = match[2]?.trim() || null;
      const exact = /^==\s*([^;\s]+)/.exec(constraint || "")?.[1] || null;
      components.push(component("python", known[0], exact, constraint, known[1], file.path, exact ? "high" : "medium"));
    }
  }
  const pyproject = ctx.files.find((file) => /(^|\/)pyproject\.toml$/i.test(file.path));
  if (pyproject) {
    const text = ctx.read(pyproject.path) || "";
    const pythonConstraint = /requires-python\s*=\s*["']([^"']+)/i.exec(text)?.[1];
    if (pythonConstraint) components.push(component("python", "Python", null, pythonConstraint, "runtime", pyproject.path, "medium"));
    for (const [packageName, known] of Object.entries(PACKAGES)) {
      const match = new RegExp(`["']?${packageName}["']?\\s*(?:[=~^<>!]+|["']\\s*:\\s*["'])\\s*([^"',\\]\\s]+)`, "i").exec(text);
      if (match) components.push(component("python", known[0], null, match[1], known[1], pyproject.path, "medium"));
    }
  }
  return components;
}

module.exports = { detect };
