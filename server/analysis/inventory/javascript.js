const { safeJson, component } = require("./helpers");

const PACKAGES = {
  next: ["Next.js", "framework"], nuxt: ["Nuxt", "framework"], "@angular/core": ["Angular", "framework"],
  react: ["React", "ui-library"], vue: ["Vue", "framework"], svelte: ["Svelte", "framework"],
  express: ["Express", "framework"], fastify: ["Fastify", "framework"], "@nestjs/core": ["NestJS", "framework"],
  electron: ["Electron", "desktop"], astro: ["Astro", "static-site-generator"], "@11ty/eleventy": ["Eleventy", "static-site-generator"],
};

function detect(ctx) {
  if (!ctx.technologies.includes("javascript")) return [];
  const components = [];
  const packageFile = ctx.files.find((file) => file.path.toLowerCase() === "package.json")
    || ctx.files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  if (!packageFile) return components;
  const pkg = safeJson(ctx.read(packageFile.path));
  if (!pkg) return components;
  const rootDir = packageFile.path.includes("/") ? packageFile.path.slice(0, packageFile.path.lastIndexOf("/") + 1) : "";
  const lockPath = `${rootDir}package-lock.json`;
  const lock = safeJson(ctx.read(lockPath));
  if (pkg.engines?.node) components.push(component("node", "Node.js", null, pkg.engines.node, "runtime", packageFile.path, "medium"));

  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [packageName, constraint] of Object.entries(dependencies)) {
    const known = PACKAGES[packageName];
    if (!known) continue;
    const exact = lock?.packages?.[`node_modules/${packageName}`]?.version || lock?.dependencies?.[packageName]?.version || null;
    components.push(component("npm", known[0], exact, constraint, known[1], exact ? lockPath : packageFile.path, exact ? "high" : "medium"));
  }
  return components;
}

module.exports = { detect };
