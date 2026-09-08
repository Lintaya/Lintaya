const { isGeneratedArtifactPath } = require("./path-policy");

const LABELS = {
  "web-app": "Aplicación web",
  "api-backend": "API / backend",
  "static-site": "Sitio estático",
  "web-library": "Librería web",
  "cli-desktop": "CLI / escritorio",
  documentation: "Documentación",
  specification: "Especificación / contrato",
  infrastructure: "Infraestructura como código",
  "data-notebook": "Datos / notebooks",
  "template-example": "Plantilla / ejemplo",
  community: "Comunidad / gobernanza",
  assets: "Assets / localización",
  unknown: "Tipo desconocido",
};

const TRAIT_LABELS = {
  monorepo: "Monorepo",
  mixed: "Proyecto mixto",
};

function classifyRepository(ctx, components) {
  const scores = new Map();
  const signals = new Map();
  const add = (type, points, signal) => {
    scores.set(type, (scores.get(type) || 0) + points);
    if (!signals.has(type)) signals.set(type, []);
    if (signal && !signals.get(type).includes(signal)) signals.get(type).push(signal);
  };
  const componentNames = new Set(components.map((item) => item.name.toLowerCase()));
  const paths = ctx.files.map((file) => file.path.toLowerCase());
  const codePattern = /\.(?:py|js|jsx|ts|tsx|mjs|cjs|php|java|kt|kts|go|rs|rb|cs|fs|swift|dart|c|cc|cpp|h|hpp|tf)$/;
  const prosePattern = /\.(?:md|mdx|rst|adoc|asciidoc|txt)$/;
  const governancePattern = /(^|\/)(readme|license|licence|copying|contributing|code_of_conduct|security|support|governance|changelog)(\.|$)/;
  const codeCount = paths.filter((file) => codePattern.test(file)).length;
  const proseFiles = paths.filter((file) => prosePattern.test(file) && !governancePattern.test(file));

  const backendFrameworks = ["laravel", "symfony", "codeigniter", "slim", "cakephp", "spring boot", "quarkus", "micronaut", "django", "flask", "fastapi", "express", "fastify", "nestjs"];
  const appFrameworks = ["next.js", "nuxt", "angular", "vue", "svelte", "react"];
  const staticGenerators = ["astro", "eleventy"];
  const cliComponents = ["electron", "typer", "click"];

  if (backendFrameworks.some((name) => componentNames.has(name))) add("api-backend", 7, "framework backend detectado");
  if (appFrameworks.some((name) => componentNames.has(name))) add("web-app", 5, "framework frontend detectado");
  if (staticGenerators.some((name) => componentNames.has(name))) add("static-site", 7, "generador de sitio estático detectado");
  if (cliComponents.some((name) => componentNames.has(name))) add("cli-desktop", 7, "framework CLI/escritorio detectado");

  if (paths.some((file) => /(^|\/)(openapi|swagger)(\.|\/)/.test(file))) add("api-backend", 6, "contrato OpenAPI/Swagger");
  if (paths.some((file) => /(^|\/)(controllers?|routes?|api)(\/|$)/.test(file))) add("api-backend", 3, "estructura de rutas/controladores");
  if (paths.some((file) => /(^|\/)(pages|views|templates)(\/|$)/.test(file))) add("web-app", 3, "estructura de páginas/vistas");
  if (paths.some((file) => /(^|\/)public\/index\.html$/.test(file))) add("web-app", 3, "entrypoint web público");
  if (paths.some((file) => /\.(?:jsx|tsx)$/.test(file))) add("web-app", 5, "componentes de interfaz JSX/TSX");
  if (paths.some((file) => /(^|\/)manifest\.webmanifest$/.test(file))) add("web-app", 4, "manifiesto PWA");

  const docsGenerator = paths.some((file) => /^(?:mkdocs\.ya?ml|antora-playbook\.ya?ml|book\.toml|_config\.ya?ml)$/.test(file)
    || /(^|\/)(docusaurus\.config\.(?:js|ts)|\.vitepress\/config\.(?:js|ts)|docs\/conf\.py|conf\.py)$/.test(file));
  if (docsGenerator) add("documentation", 9, "generador de documentación detectado");
  if (proseFiles.length && codeCount === 0) add("documentation", Math.min(9, 7 + Math.min(2, proseFiles.length)), "contenido de prosa sin código ejecutable");
  else if (proseFiles.length >= 3 && proseFiles.length / Math.max(1, paths.length) >= 0.5) add("documentation", 5, "documentación predominante");

  const specificationFiles = paths.filter((file) => /(^|\/)(openapi|swagger|asyncapi)(\.|\/)|\.(?:proto|graphql|graphqls)$|(^|\/)(rfcs?|adrs?|specs?|schemas?)(\/|$)/.test(file));
  if (specificationFiles.length) add("specification", Math.min(10, 6 + specificationFiles.length), "contratos, esquemas o especificaciones detectados");

  const terraformCount = paths.filter((file) => file.endsWith(".tf")).length;
  if (terraformCount) add("infrastructure", Math.min(10, 7 + terraformCount), "Terraform detectado");
  if (paths.some((file) => /(^|\/)chart\.ya?ml$|(^|\/)helmfile\.ya?ml$/.test(file))) add("infrastructure", 8, "Helm detectado");
  if (paths.some((file) => /^(?:pulumi\.ya?ml|ansible\.cfg)$|(^|\/)(playbooks?|roles)(\/|$)/.test(file))) add("infrastructure", 7, "automatización de infraestructura detectada");
  if (ctx.technologies.includes("gitops")) add("infrastructure", 10, "controlador de reconciliación GitOps detectado");
  const yamlSamples = ctx.files.filter((file) => /\.ya?ml$/i.test(file.path) && file.size <= 256 * 1024).slice(0, 100)
    .map((file) => ctx.read(file.path) || "");
  if (yamlSamples.some((text) => /^apiVersion:\s*\S+/m.test(text) && /^kind:\s*(?:Deployment|StatefulSet|DaemonSet|Service|Ingress|Job|CronJob|ConfigMap|Secret)\b/m.test(text))) {
    add("infrastructure", 8, "manifiestos Kubernetes detectados");
  }

  const notebooks = paths.filter((file) => !isGeneratedArtifactPath(file) && file.endsWith(".ipynb")).length;
  const dataFiles = paths.filter((file) => !isGeneratedArtifactPath(file) && /\.(?:csv|tsv|parquet|arrow|feather|geojson|topojson|ndjson)$/i.test(file)).length;
  const modelFiles = paths.filter((file) => !isGeneratedArtifactPath(file) && /\.(?:onnx|pt|pth|safetensors|h5|pb)$/i.test(file)).length;
  if (notebooks) add("data-notebook", Math.min(10, 7 + notebooks), "notebooks Jupyter detectados");
  if (dataFiles) add("data-notebook", Math.min(9, 5 + dataFiles), "archivos de datos detectados");
  if (modelFiles) add("data-notebook", Math.min(9, 6 + modelFiles), "artefactos de modelos detectados");

  if (paths.some((file) => /^(?:cookiecutter\.json|copier\.ya?ml|template\.ya?ml|skeleton\.json)$/.test(file))) {
    add("template-example", 9, "configuración de plantilla detectada");
  } else if (paths.some((file) => /(^|\/)(examples?|samples?|tutorials?)(\/|$)/.test(file))) {
    add("template-example", 5, "ejemplos o tutoriales detectados");
  }

  const communityFiles = paths.filter((file) => /(^|\/)(code_of_conduct|contributing|governance|support|security|funding|issue_template|pull_request_template)(\.|\/|$)/.test(file));
  if (communityFiles.length >= 2 && codeCount === 0) add("community", Math.min(9, 6 + communityFiles.length), "archivos comunitarios y de gobernanza");

  const assetFiles = paths.filter((file) => /\.(?:png|jpe?g|gif|webp|svg|ico|psd|ai|sketch|fig|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf|po|pot|mo)$/i.test(file)).length;
  if (assetFiles >= 2 && assetFiles / Math.max(1, paths.length) >= 0.4) add("assets", Math.min(9, 5 + assetFiles), "recursos visuales, multimedia o localización predominantes");

  const htmlCount = paths.filter((file) => /\.html?$/.test(file)).length;
  const hasBackend = (scores.get("api-backend") || 0) > 0;
  if (htmlCount && !hasBackend) add("static-site", Math.min(6, 2 + htmlCount), "documentos HTML sin backend detectado");
  if (paths.some((file) => /^(?:_config\.yml|hugo\.toml|config\.toml)$/.test(file))) add("static-site", 6, "configuración de generador estático");

  const packageFile = ctx.files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  if (packageFile) {
    try {
      const pkg = JSON.parse(ctx.read(packageFile.path) || "{}");
      if (pkg.bin) add("cli-desktop", 7, "comando bin en package.json");
      if ((pkg.main || pkg.module || pkg.exports) && !pkg.private && !hasBackend) add("web-library", 5, "paquete JavaScript publicable");
    } catch (_) {}
  }
  const composerFile = ctx.files.find((file) => /(^|\/)composer\.json$/i.test(file.path));
  if (composerFile) {
    try {
      const composer = JSON.parse(ctx.read(composerFile.path) || "{}");
      if (composer.type === "library") add("web-library", 7, "paquete Composer de tipo library");
      if (composer.bin) add("cli-desktop", 6, "comando bin en composer.json");
    } catch (_) {}
  }
  if (paths.some((file) => /(^|\/)src\/main\/java\/.+\.java$/.test(file)) && !hasBackend) add("web-library", 3, "módulo Java sin servidor web identificado");
  if (paths.some((file) => /(^|\/)(main|cli|manage)\.py$/.test(file))) add("cli-desktop", 2, "entrypoint ejecutable");
  const pyprojectFile = ctx.files.find((file) => /(^|\/)pyproject\.toml$/i.test(file.path));
  if (pyprojectFile) {
    const pyproject = ctx.read(pyprojectFile.path) || "";
    if (/\[project\.scripts\]|console_scripts/i.test(pyproject)) add("cli-desktop", 6, "entrypoint CLI de Python");
    else if (/\[(?:project|tool\.poetry)\]/i.test(pyproject) && !hasBackend) add("web-library", 3, "paquete Python sin servidor web identificado");
  }
  const javaSamples = ctx.files.filter((file) => file.path.endsWith(".java") && file.size <= 256 * 1024).slice(0, 100)
    .map((file) => ctx.read(file.path) || "").join("\n");
  if (/picocli\.CommandLine|javafx\.application\.Application|javax?\.swing\.|public\s+static\s+void\s+main\s*\(/i.test(javaSamples)) {
    add("cli-desktop", 6, "entrypoint o framework de escritorio Java");
  }

  let types = Array.from(scores.entries())
    .filter(([, score]) => score >= 3)
    .map(([id, score]) => ({ id, label: LABELS[id], score, confidence: score >= 7 ? "high" : score >= 4 ? "medium" : "low", signals: signals.get(id) || [] }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (!types.length) types = [{ id: "unknown", label: LABELS.unknown, score: 0, confidence: "low", signals: ["evidencia insuficiente"] }];

  const manifestPattern = /(^|\/)(package\.json|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|pyproject\.toml|go\.mod|cargo\.toml)$/;
  const manifestRoots = new Set(paths.filter((file) => manifestPattern.test(file)).map((file) => file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "."));
  const workspaceFiles = paths.some((file) => /^(?:pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/.test(file));
  const traits = [];
  if (manifestRoots.size >= 2 || workspaceFiles) traits.push({ id: "monorepo", label: TRAIT_LABELS.monorepo, confidence: workspaceFiles || manifestRoots.size >= 3 ? "high" : "medium", evidence: `${manifestRoots.size} raíces de proyecto` });
  const strongTypes = types.filter((type) => type.id !== "unknown" && type.score >= 5);
  if (strongTypes.length >= 2) traits.push({ id: "mixed", label: TRAIT_LABELS.mixed, confidence: "medium", evidence: strongTypes.map((type) => type.label).join(" + ") });

  return { primary: types[0].id, label: types[0].label, confidence: types[0].confidence, types, traits };
}

module.exports = { classifyRepository, LABELS, TRAIT_LABELS };
