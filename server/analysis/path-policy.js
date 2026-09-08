const GENERATED_ARTIFACT_PATH = /(^|\/)(?:data\/runs?|runtime|var\/log|logs?|tmp|temp|outputs?|artifacts?)(\/|$)/i;

function isGeneratedArtifactPath(filePath) {
  return GENERATED_ARTIFACT_PATH.test(String(filePath || "").replace(/\\/g, "/"));
}

module.exports = { isGeneratedArtifactPath };
