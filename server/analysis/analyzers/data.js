const { isGeneratedArtifactPath } = require("../path-policy");

function analyze(ctx) {
  const findings = [];
  const dataFiles = ctx.files.filter((file) => !isGeneratedArtifactPath(file.path) && /\.(?:csv|tsv|parquet|arrow|feather|geojson|topojson|ndjson)$/i.test(file.path));
  const notebooks = ctx.files.filter((file) => !isGeneratedArtifactPath(file.path) && file.path.endsWith(".ipynb"));
  const modelFiles = ctx.files.filter((file) => !isGeneratedArtifactPath(file.path) && /\.(?:onnx|pt|pth|safetensors|h5|pb)$/i.test(file.path));

  for (const file of [...dataFiles, ...notebooks, ...modelFiles]) {
    if (file.size > 100 * 1024 * 1024) findings.push(ctx.finding(`data.large-file.${file.path}`, "quality", "high",
      "Archivo demasiado grande para Git", `El archivo ocupa ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      "Usa Git LFS, almacenamiento de objetos o publica una muestra pequeña en el repositorio.", file.path, null, "data"));
  }

  if (dataFiles.length && !ctx.files.some((file) => /(^|\/)(schema|data[_-]?dictionary|metadata|datapackage)\.(?:json|ya?ml|csv|md)$/i.test(file.path))) {
    findings.push(ctx.finding("data.schema", "documentation", "medium",
      "Dataset sin esquema o diccionario", "No se encontró documentación estructurada de columnas, tipos o significado.",
      "Agrega un esquema, data dictionary o datapackage.json.", dataFiles[0].path, null, "data"));
  }

  for (const file of notebooks.filter((item) => item.size <= 5 * 1024 * 1024)) {
    const content = ctx.read(file.path, 5 * 1024 * 1024);
    if (content == null) continue;
    let notebook;
    try { notebook = JSON.parse(content); }
    catch (err) {
      findings.push(ctx.finding(`data.invalid-notebook.${file.path}`, "quality", "high",
        "Notebook inválido", `El archivo no contiene JSON válido: ${err.message}`,
        "Repara o vuelve a guardar el notebook antes de publicarlo.", file.path, null, "jupyter"));
      continue;
    }
    const outputSize = (notebook.cells || []).reduce((total, cell) => total + JSON.stringify(cell.outputs || []).length, 0);
    if (outputSize > 1024 * 1024) findings.push(ctx.finding(`data.notebook-outputs.${file.path}`, "quality", "low",
      "Notebook con outputs voluminosos", "Los resultados embebidos superan 1 MB y dificultan revisión y diffs.",
      "Limpia outputs antes del commit o conserva únicamente resultados esenciales.", file.path, null, "jupyter"));
  }

  if (notebooks.length && !ctx.files.some((file) => /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|environment\.ya?ml|Pipfile|poetry\.lock|uv\.lock)$/i.test(file.path))) {
    findings.push(ctx.finding("data.environment", "dependencies", "medium",
      "Entorno del notebook no reproducible", "No se encontró una declaración de dependencias o ambiente.",
      "Agrega requirements, pyproject.toml o environment.yml con versiones compatibles.", notebooks[0].path, null, "jupyter"));
  }
  if (modelFiles.length && !ctx.files.some((file) => /(^|\/)(model[_-]?card|models?\/readme)(\.|$)/i.test(file.path))) {
    findings.push(ctx.finding("data.model-card", "documentation", "medium",
      "Modelo sin model card", "No se encontró documentación sobre propósito, datos, métricas o limitaciones del modelo.",
      "Agrega una model card con uso previsto, evaluación, riesgos y licencia.", modelFiles[0].path, null, "machine-learning"));
  }
  return findings;
}

module.exports = {
  id: "data",
  supports: (_technologies, classification) => classification.types.some((type) => type.id === "data-notebook"),
  analyze,
};
