const { component } = require("./helpers");

function detect(ctx) {
  if (!ctx.technologies.includes("gitops")) return [];
  const components = [];
  for (const file of ctx.files.filter((item) => /\.ya?ml$/i.test(item.path) && item.size <= 512 * 1024)) {
    const content = ctx.read(file.path) || "";
    if (/apiVersion:\s*argoproj\.io\//i.test(content) && /kind:\s*(?:Application|ApplicationSet)\b/i.test(content)) {
      components.push(component("gitops", "Argo CD", null, null, "reconciliation-controller", file.path, "high"));
    }
    if (/apiVersion:\s*\S*toolkit\.fluxcd\.io\//i.test(content)) {
      components.push(component("gitops", "Flux", null, null, "reconciliation-controller", file.path, "high"));
    }
  }
  return components;
}

module.exports = { detect };
