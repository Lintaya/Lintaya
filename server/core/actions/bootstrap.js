// Registers every pilot connector's actions (ADR-011) onto a fresh registry.
// Shared by server.js (HTTP) and mcp-server.js (AGENT-002's MCP adapter) so
// the two callers can never drift on which types/actions exist between them —
// the whole point of "one registry, several thin callers".
//
// "GitLab CICD" (id gitlab2) needs no separate registration — it's an extra
// Connection of the "gitlab" ConnectorType (CORE-003), not its own type, so
// registerGitlabActions() already covers it. vCenter, UCS Manager, Bitwarden
// and Anthropic aren't "instantiable" (ADR-009 — single-instance only), which
// has no bearing on whether their type can have actions; it only means there
// will only ever be one Connection of each.
const path = require("node:path");

const { connectorManifests } = require("../../connectors/registry");
const { requireOptional } = require("../services/optional-package");

// `implementation.source` resolves against the base the registry recorded on
// the manifest: the repository root for a shipped connector, its own folder for
// one installed under LINTAYA_CONNECTORS_DIR. Same convention
// connectors/loader.js follows, and the repository root is likewise only the
// fallback for a manifest built by hand in a test.
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

// Each actions.js exports exactly one registrar, named for its connector
// (registerGitlabActions, registerVcenterActions…). The registry cannot guess
// that name from an id, so the module is matched by shape instead.
const ACTIONS_EXPORT = /^register[A-Za-z0-9]*Actions$/;

function connectorActionsRegistrar(manifest, load) {
  const packageDir = path.dirname(path.join(manifest.packageRoot || REPO_ROOT, manifest.implementation.source));
  // Optional twice over: a connector need not declare actions at all
  // (lintaya-remote does not), and a tier that is not installed has no
  // manifest here to begin with.
  const actions = requireOptional(path.join(packageDir, "actions"), load);
  if (!actions) return null;
  const found = Object.entries(actions)
    .find(([name, value]) => typeof value === "function" && ACTIONS_EXPORT.test(name));
  if (!found) {
    throw new Error(`Connector "${manifest.id}" has an actions module that exports no register*Actions function`);
  }
  return found[1];
}

// `bitwarden` carries runBw/readVaultItems/binary — registerBitwardenActions'
// own required params with no sensible default (see that file's file-level
// comment): they live in the vault service, not this connector package. They
// are handed to every registrar rather than to that one by id, the same way
// connectors/loader.js passes one context to every connector and lets each
// destructure what it uses.
function registerAllActions(registry, { bitwarden = {} } = {}, { manifests = connectorManifests, load = require } = {}) {
  for (const manifest of manifests.values()) {
    const register = connectorActionsRegistrar(manifest, load);
    if (register) register({ registry, ...bitwarden });
  }
}
module.exports = { registerAllActions };
