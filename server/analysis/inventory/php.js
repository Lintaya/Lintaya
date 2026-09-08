const { safeJson, component } = require("./helpers");

const PACKAGES = {
  "laravel/framework": ["Laravel", "framework"],
  "symfony/framework-bundle": ["Symfony", "framework"],
  "codeigniter4/framework": ["CodeIgniter", "framework"],
  "slim/slim": ["Slim", "framework"],
  "cakephp/cakephp": ["CakePHP", "framework"],
  "drupal/core": ["Drupal", "cms"],
  "drupal/core-recommended": ["Drupal", "cms"],
  "phpunit/phpunit": ["PHPUnit", "testing"],
};

function detect(ctx) {
  if (!ctx.technologies.includes("php")) return [];
  const components = [];
  const composerFile = ctx.files.find((file) => file.path.toLowerCase() === "composer.json")
    || ctx.files.find((file) => /(^|\/)composer\.json$/i.test(file.path));
  if (!composerFile) return components;
  const composer = safeJson(ctx.read(composerFile.path));
  if (!composer) return components;

  const rootDir = composerFile.path.includes("/") ? composerFile.path.slice(0, composerFile.path.lastIndexOf("/") + 1) : "";
  const lockPath = `${rootDir}composer.lock`;
  const lock = safeJson(ctx.read(lockPath));
  const locked = new Map([...(lock?.packages || []), ...(lock?.["packages-dev"] || [])]
    .map((pkg) => [String(pkg.name || "").toLowerCase(), pkg.version || null]));

  const phpConstraint = composer.require?.php || composer.config?.platform?.php;
  if (phpConstraint) components.push(component("php", "PHP", null, phpConstraint, "runtime", composerFile.path, "medium"));

  const dependencies = { ...(composer.require || {}), ...(composer["require-dev"] || {}) };
  for (const [packageName, constraint] of Object.entries(dependencies)) {
    const known = PACKAGES[packageName.toLowerCase()];
    if (!known) continue;
    const exact = locked.get(packageName.toLowerCase()) || null;
    components.push(component("composer", known[0], exact, constraint, known[1], exact ? lockPath : composerFile.path, exact ? "high" : "medium"));
  }
  return components;
}

module.exports = { detect };
