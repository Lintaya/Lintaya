const GITOPS_API = /(?:^|\.)argoproj\.io\/|(?:^|\.)toolkit\.fluxcd\.io\//i;
const ARGO_API = /(?:^|\.)argoproj\.io\//i;
const FLUX_API = /(?:^|\.)toolkit\.fluxcd\.io\//i;

const REMOVED_KUBERNETES_APIS = {
  "extensions/v1beta1": "Kubernetes 1.16",
  "apps/v1beta1": "Kubernetes 1.16",
  "apps/v1beta2": "Kubernetes 1.16",
  "networking.k8s.io/v1beta1": "Kubernetes 1.22",
  "apiextensions.k8s.io/v1beta1": "Kubernetes 1.22",
  "admissionregistration.k8s.io/v1beta1": "Kubernetes 1.22",
  "batch/v1beta1": "Kubernetes 1.25",
  "policy/v1beta1": "Kubernetes 1.25",
  "autoscaling/v2beta1": "Kubernetes 1.25",
  "autoscaling/v2beta2": "Kubernetes 1.26",
};

function yamlDocuments(ctx) {
  const documents = [];
  for (const file of ctx.files.filter((item) => /\.ya?ml$/i.test(item.path) && item.size <= 512 * 1024)) {
    const content = ctx.read(file.path);
    if (!content) continue;
    const separators = [...content.matchAll(/^---\s*$/gm)];
    let start = 0;
    let index = 0;
    for (const separator of [...separators, { index: content.length, 0: "" }]) {
      const end = separator.index;
      const document = content.slice(start, end);
      if (document.trim()) documents.push({ file, content, document, offset: start, index });
      start = end + String(separator[0] || "").length;
      index += 1;
    }
  }
  return documents;
}

function scalar(document, key) {
  const match = new RegExp(`^\\s*${key}:\\s*["']?([^\\s"'#]+)`, "mi").exec(document);
  return match ? match[1] : null;
}

function controller(document) {
  const apiVersion = scalar(document, "apiVersion") || "";
  const kind = scalar(document, "kind") || "";
  if (ARGO_API.test(apiVersion) && /^(?:Application|ApplicationSet)$/i.test(kind)) return "Argo CD";
  if (FLUX_API.test(apiVersion)) return "Flux";
  return null;
}

function detect(ctx) {
  return yamlDocuments(ctx).some(({ document }) => controller(document));
}

function findingLine(ctx, item, pattern) {
  const match = pattern.exec(item.document);
  return match ? ctx.lineOf(item.content, item.offset + match.index) : null;
}

function hasManifestValidation(ctx) {
  const command = /\b(?:kubeconform|kubeval|conftest|polaris|datree|yamllint)\b|helm\s+lint|kustomize\s+build|kubectl\b[^\n]*(?:--dry-run|diff)/i;
  return ctx.files.some((file) => {
    if (file.size > 512 * 1024 || !/(?:\.ya?ml|\.json|\.sh|\.ps1|\.js|\.ts|Makefile|Taskfile)$/i.test(file.path)) return false;
    return command.test(ctx.read(file.path) || "");
  });
}

function analyze(ctx) {
  const findings = [];
  const documents = yamlDocuments(ctx);
  const gitopsDocuments = documents.filter(({ document }) => controller(document));
  const systems = [...new Set(gitopsDocuments.map(({ document }) => controller(document)).filter(Boolean))];

  findings.push(ctx.finding("gitops.detected", "delivery", "info",
    "Implementación GitOps detectada", `Se detectó ${systems.join(" y ")} como mecanismo de entrega declarativa.`,
    "Mantén documentados el bootstrap, la reconciliación, el rollback y la recuperación ante desastres.",
    gitopsDocuments[0]?.file.path || null, null, "gitops"));

  if (!ctx.files.some((file) => /(^|\/)CODEOWNERS$/i.test(file.path))) {
    findings.push(ctx.finding("gitops.codeowners", "governance", "medium",
      "Cambios GitOps sin CODEOWNERS", "No se encontró una política de revisores para archivos que pueden modificar entornos.",
      "Agrega CODEOWNERS para manifiestos, clusters y entornos, y exige su revisión en la rama protegida.", null, null, "gitops"));
  }

  if (!hasManifestValidation(ctx)) {
    findings.push(ctx.finding("gitops.manifest-validation", "testing", "medium",
      "No se detectó validación de manifiestos", "El repositorio no muestra validación automatizada de YAML, esquemas Kubernetes, Helm o políticas.",
      "Ejecuta en CI herramientas como kubeconform, helm lint, kustomize build y, cuando aplique, conftest.", null, null, "gitops"));
  }

  const readme = ctx.files.find((file) => /(^|\/)README\.md$/i.test(file.path));
  const readmeContent = readme ? (ctx.read(readme.path) || "") : "";
  if (!/gitops|argo\s*cd|flux|reconcil|rollback|bootstrap/i.test(readmeContent)) {
    findings.push(ctx.finding("gitops.operations-docs", "documentation", "low",
      "Operación GitOps no documentada", "El README no explica el controlador, reconciliación, bootstrap o rollback.",
      "Documenta el flujo de promoción, reconciliación, rollback, secretos y recuperación.", readme?.path || null, null, "gitops"));
  }

  for (const item of gitopsDocuments) {
    const { document, file, index } = item;
    const apiVersion = scalar(document, "apiVersion") || "";
    const kind = scalar(document, "kind") || "recurso";
    const system = controller(document);
    const suffix = `${file.path}.${index}`;

    const insecureUrl = /(?:repoURL|url):\s*["']?(http:\/\/[^\s"']+)/i.exec(document);
    if (insecureUrl) findings.push(ctx.finding(`gitops.insecure-source.${suffix}`, "security", "high",
      "Fuente GitOps sin TLS", `El recurso ${kind} usa ${insecureUrl[1]} como origen.`,
      "Usa HTTPS o SSH y valida la identidad del servidor remoto.", file.path,
      ctx.lineOf(item.content, item.offset + insecureUrl.index), "gitops"));

    if (system === "Argo CD") {
      if (!/^\s*automated:\s*(?:\{|$)/mi.test(document)) {
        findings.push(ctx.finding(`gitops.argo-automated.${suffix}`, "delivery", "medium",
          "Sin sincronización automática en Argo CD", `${kind} no declara syncPolicy.automated; el estado puede depender de una acción manual.`,
          "Activa la sincronización automática cuando el modelo operativo permita reconciliación continua.", file.path, null, "gitops"));
      } else {
        if (!/^\s*selfHeal:\s*true\b/mi.test(document)) findings.push(ctx.finding(`gitops.argo-self-heal.${suffix}`, "delivery", "medium",
          "Argo CD no corrige drift automáticamente", `${kind} tiene sincronización automática, pero no declara selfHeal: true.`,
          "Activa selfHeal para reconciliar cambios realizados fuera del repositorio.", file.path, null, "gitops"));
        if (!/^\s*prune:\s*true\b/mi.test(document)) findings.push(ctx.finding(`gitops.argo-prune.${suffix}`, "delivery", "low",
          "Argo CD no elimina recursos obsoletos", `${kind} no declara prune: true.`,
          "Activa prune si los recursos eliminados del repositorio también deben retirarse del entorno.", file.path, null, "gitops"));
      }
      const targetRevision = scalar(document, "targetRevision");
      if (targetRevision && /^(?:HEAD|main|master)$/i.test(targetRevision)) findings.push(ctx.finding(`gitops.mutable-revision.${suffix}`, "dependencies", "low",
        "Referencia mutable en Argo CD", `${kind} sigue targetRevision: ${targetRevision}; el contenido efectivo cambia con la rama.`,
        "Para promociones controladas, considera tags, commits o una rama de entorno protegida con trazabilidad.", file.path,
        findingLine(ctx, item, /^\s*targetRevision:/mi), "gitops"));
    }

    if (system === "Flux") {
      if (/^\s*suspend:\s*true\b/mi.test(document)) findings.push(ctx.finding(`gitops.flux-suspended.${suffix}`, "delivery", "medium",
        "Reconciliación de Flux suspendida", `${kind} declara suspend: true y no reconciliará cambios mientras siga suspendido.`,
        "Reanuda la reconciliación o documenta la excepción temporal y su responsable.", file.path,
        findingLine(ctx, item, /^\s*suspend:\s*true/mi), "gitops"));
      if (/^(?:GitRepository|OCIRepository|HelmRepository|Kustomization|HelmRelease)$/i.test(kind)
          && !/^\s*interval:\s*\S+/mi.test(document)) {
        findings.push(ctx.finding(`gitops.flux-interval.${suffix}`, "delivery", "medium",
          "Intervalo de reconciliación no declarado", `${kind} no contiene spec.interval en el manifiesto analizado.`,
          "Declara un intervalo explícito y coherente con el tiempo objetivo de despliegue.", file.path, null, "gitops"));
      }
    }

    if (GITOPS_API.test(apiVersion) && /password|token|secretKey/i.test(document)
        && !/valueFrom:|secretKeyRef:|sops:|ENC\[AES256_GCM/i.test(document)) {
      findings.push(ctx.finding(`gitops.inline-credential.${suffix}`, "security", "high",
        "Posible credencial dentro de configuración GitOps", `${kind} contiene un campo sensible sin referencia visible a un Secret o cifrado SOPS.`,
        "Usa SecretKeyRef, External Secrets, Sealed Secrets o SOPS; no guardes credenciales en texto plano.", file.path, null, "gitops"));
    }
  }

  for (const item of documents) {
    const apiVersion = scalar(item.document, "apiVersion") || "";
    const kind = scalar(item.document, "kind") || "recurso";
    const removedIn = REMOVED_KUBERNETES_APIS[apiVersion];
    if (removedIn) findings.push(ctx.finding(`gitops.removed-api.${item.file.path}.${item.index}`, "eol", "high",
      "API de Kubernetes eliminada", `${kind} usa ${apiVersion}, eliminada desde ${removedIn}.`,
      "Migra el manifiesto a una apiVersion vigente y valida todos los entornos antes de actualizar el cluster.", item.file.path,
      findingLine(ctx, item, /^\s*apiVersion:/mi), "kubernetes"));

    if (/^Secret$/i.test(kind) && /^\s*(?:data|stringData):\s*(?:$|\{)/mi.test(item.document)
        && !/sops:|ENC\[AES256_GCM|sealedsecrets\.bitnami\.com/i.test(item.document)) {
      findings.push(ctx.finding(`gitops.plain-secret.${item.file.path}.${item.index}`, "security", "high",
        "Secret de Kubernetes almacenado sin cifrado detectable", "Un repositorio GitOps conserva historial; eliminar el archivo después no elimina el secreto del historial.",
        "Cifra con SOPS, usa Sealed Secrets o referencia un gestor externo; rota cualquier valor que ya se haya publicado.", item.file.path,
        findingLine(ctx, item, /^\s*(?:data|stringData):/mi), "kubernetes"));
    }
  }

  return findings;
}

module.exports = {
  id: "gitops",
  detect,
  supports: (technologies) => technologies.includes("gitops"),
  analyze,
};
