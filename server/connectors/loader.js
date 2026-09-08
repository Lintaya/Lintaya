const path = require("node:path");

const { connectorManifests, isSupportedHere } = require("./registry");

// `implementation.source` is written relative to the repository root for a
// shipped connector, and to its own folder for one installed under
// LINTAYA_CONNECTORS_DIR (ADR-014 Phase 2). The registry records which base each
// manifest resolves against, so this is only the fallback for a manifest built
// by hand in a test.
const REPO_ROOT = path.join(__dirname, "..", "..");

// Every package connector must export this, taking the shared context and
// wiring its own routes. It is deliberately one convention rather than a
// per-connector name: the registry cannot guess `registerBitwardenRoutes` from
// the id `bw`.
const REGISTER_EXPORT = "register";

/**
 * Requires each package connector declared in the manifests and lets it register
 * its own routes.
 *
 * Until now the registry validated `implementation.source` but never loaded it,
 * so adding a connector meant hand-writing a require and a register call in
 * server.js — the reason Phase 2's exit criterion ("add a provider without
 * editing server.js") stayed unmet while all 12 connectors were already
 * packages.
 *
 * `context` carries every service any connector might need. Each one
 * destructures what it uses and ignores the rest, so a connector with extra
 * dependencies (Bitwarden's CLI runner, Outlook's kvDelete) needs no special
 * case here.
 */
function loadConnectorModule(manifest, root, load) {
  const modulePath = path.join(manifest.packageRoot || root, manifest.implementation.source);
  let connector;
  try {
    connector = load(modulePath);
  } catch (cause) {
    throw new Error(`Connector "${manifest.id}" could not be loaded from ${manifest.implementation.source}: ${cause.message}`, { cause });
  }
  const register = connector?.[REGISTER_EXPORT];
  if (typeof register !== "function") {
    throw new Error(`Connector "${manifest.id}" must export ${REGISTER_EXPORT}() from ${manifest.implementation.source}`);
  }
  return register;
}

function registerConnectors(options = {}) {
  const {
    context,
    manifests = connectorManifests,
    root = REPO_ROOT,
    load = require,
  } = options;

  if (!context) throw new TypeError("registerConnectors requires a context");

  const registered = [];
  const unsupported = [];
  for (const manifest of manifests.values()) {
    // Legacy connectors still wire themselves inside server.js.
    if (manifest.implementation.mode !== "package") continue;
    // A connector that names its platforms and does not name this one keeps
    // its manifest — the catalog still lists it, and routes/connectors.js
    // reports why it cannot run — but nothing of it is mounted. Registering
    // routes that can only fail is what made this look like a broken
    // connector rather than the wrong machine for it.
    if (!isSupportedHere(manifest)) { unsupported.push(manifest.id); continue; }

    const register = loadConnectorModule(manifest, root, load);

    try {
      register(context);
    } catch (cause) {
      // A connector that throws while registering would otherwise surface as an
      // anonymous startup failure with no hint of which one is at fault.
      throw new Error(`Connector "${manifest.id}" failed to register: ${cause.message}`, { cause });
    }
    registered.push(manifest.id);

    // Conectores "instantiable" (ver ADR-008/CONN-017 en
    // el roadmap interno): además de la instancia base, registrar
    // cada instancia extra ya conocida bajo su propio id — mismo manifest,
    // mismo módulo, solo cambia el id con el que registra sus rutas.
    if (manifest.instantiable && typeof context.kvGet === "function") {
      const extraIds = (context.kvGet("connector-instances")?.value || {})[manifest.id] || [];
      for (const extraId of extraIds) {
        try {
          register(context, extraId);
        } catch (cause) {
          throw new Error(`Connector instance "${extraId}" (tipo "${manifest.id}") failed to register: ${cause.message}`, { cause });
        }
        registered.push(extraId);
      }
    }
  }
  // Silence here would be the same trap the platform field already was: a
  // connector that is simply absent, with nothing anywhere saying why.
  if (unsupported.length && context.log?.info) {
    context.log.info(`[connectors] not mounted on ${process.platform}: ${unsupported.join(", ")}`);
  }
  return registered;
}

// Registra en caliente una instancia nueva de un conector "instantiable" (POST
// /api/connectors/:typeId/instances la llama justo después de crearla — ver
// server.js). No repite todo `registerConnectors()`; Express permite montar
// rutas después de `listen()`, así que esto basta para dejarla operativa sin
// reiniciar el proceso.
function registerConnectorInstance({ typeId, instanceId, context, manifests = connectorManifests, root = REPO_ROOT, load = require }) {
  const manifest = manifests.get(typeId);
  if (!manifest) throw new Error(`Unknown connector type "${typeId}"`);
  if (!manifest.instantiable) throw new Error(`Connector "${typeId}" is not instantiable`);
  const register = loadConnectorModule(manifest, root, load);
  register(context, instanceId);
}

module.exports = {
  REGISTER_EXPORT,
  REPO_ROOT,
  registerConnectorInstance,
  registerConnectors,
};
