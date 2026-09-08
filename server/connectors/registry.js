const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIERS = new Set(["community", "enterprise", "development"]);
const LIFECYCLES = new Set(["stable", "beta", "development", "deprecated"]);
const AUTO_SYNC_GROUPS = new Set(["fast", "slow"]);

// Where a connector that does not ship with Lintaya is installed (ADR-014
// Phase 2). A folder inside the working tree would have to be gitignored, is
// lost on a re-clone, and competes with ordinary git operations; a user
// directory survives all three.
const DEFAULT_USER_CONNECTORS_DIR = path.join(os.homedir(), ".lintaya", "connectors");

function userConnectorsDir(env = process.env) {
  return env.LINTAYA_CONNECTORS_DIR || DEFAULT_USER_CONNECTORS_DIR;
}

function findManifestFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !TIERS.has(entry.name)) continue;
    const tierRoot = path.join(root, entry.name);
    for (const connector of fs.readdirSync(tierRoot, { withFileTypes: true })) {
      if (!connector.isDirectory()) continue;
      const manifestPath = path.join(tierRoot, connector.name, "manifest.json");
      if (fs.existsSync(manifestPath)) files.push(manifestPath);
    }
  }
  return files.sort();
}

// The user directory is flat: one folder per connector, no tier folders. Tiers
// describe how *this repository* organises what it ships; asking someone to
// mkdir a tier before dropping in a connector would be ceremony with nothing
// behind it. An installed connector still declares its tier in its manifest,
// which is why the folder/tier agreement check only applies in-repo.
//
// A missing directory is the normal case, not an error: most installs have no
// private connector at all.
function findUserManifestFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "manifest.json");
    if (fs.existsSync(manifestPath)) files.push(manifestPath);
  }
  return files.sort();
}

// `root` is the tier tree a shipped manifest lives under. An installed
// connector has none — it is passed `null`, which skips only the check that the
// declared tier matches its folder. Every other rule applies to both.
function validateManifest(manifest, manifestPath, root) {
  const folderTier = root === null
    ? null
    : path.relative(root, manifestPath).split(path.sep)[0];
  const requiredStrings = ["id", "displayName", "version", "tier", "lifecycle", "license"];

  if (manifest.manifestVersion !== 1) throw new Error(`${manifestPath}: unsupported manifestVersion`);
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
      throw new Error(`${manifestPath}: ${field} is required`);
    }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) throw new Error(`${manifestPath}: invalid id`);
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`${manifestPath}: invalid semantic version`);
  }
  if (!TIERS.has(manifest.tier)) throw new Error(`${manifestPath}: invalid tier`);
  if (folderTier !== null && manifest.tier !== folderTier) {
    throw new Error(`${manifestPath}: tier ${manifest.tier} does not match folder ${folderTier}`);
  }
  if (!LIFECYCLES.has(manifest.lifecycle)) throw new Error(`${manifestPath}: invalid lifecycle`);
  if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.length) {
    throw new Error(`${manifestPath}: capabilities must not be empty`);
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    throw new Error(`${manifestPath}: capabilities must be unique`);
  }
  for (const capability of manifest.capabilities) {
    if (typeof capability !== "string" || !/^[a-z][a-z0-9.-]*$/.test(capability)) {
      throw new Error(`${manifestPath}: invalid capability`);
    }
  }
  if (!manifest.implementation || !["legacy", "package"].includes(manifest.implementation.mode)) {
    throw new Error(`${manifestPath}: invalid implementation`);
  }
  if (typeof manifest.implementation.source !== "string" || !manifest.implementation.source) {
    throw new Error(`${manifestPath}: implementation.source is required`);
  }
  if (manifest.upstreamApi !== undefined) {
    const api = manifest.upstreamApi;
    if (!api || typeof api !== "object") throw new Error(`${manifestPath}: invalid upstreamApi`);
    if (typeof api.name !== "string" || !api.name.trim()) {
      throw new Error(`${manifestPath}: upstreamApi.name is required`);
    }
    if (typeof api.version !== "string" || !api.version.trim()) {
      throw new Error(`${manifestPath}: upstreamApi.version is required`);
    }
    if (api.supportedUntil !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(api.supportedUntil)) {
      throw new Error(`${manifestPath}: upstreamApi.supportedUntil must be YYYY-MM-DD`);
    }
  }
  if (manifest.blocks !== undefined) {
    if (!Array.isArray(manifest.blocks) || !manifest.blocks.length) {
      throw new Error(`${manifestPath}: blocks must be a non-empty array`);
    }
    const blockIds = new Set();
    for (const block of manifest.blocks) {
      if (!block || typeof block !== "object") throw new Error(`${manifestPath}: invalid block`);
      if (typeof block.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(block.id)) {
        throw new Error(`${manifestPath}: invalid block id`);
      }
      if (blockIds.has(block.id)) throw new Error(`${manifestPath}: duplicate block id ${block.id}`);
      blockIds.add(block.id);
      if (typeof block.title !== "string" || !block.title.trim()) {
        throw new Error(`${manifestPath}: block ${block.id} needs a title`);
      }
      if (block.type !== "list") {
        throw new Error(`${manifestPath}: block ${block.id} has unsupported type ${block.type}`);
      }
    }
  }
  if (manifest.modules !== undefined) {
    if (!Array.isArray(manifest.modules) || !manifest.modules.length) {
      throw new Error(`${manifestPath}: modules must be a non-empty array`);
    }
    const moduleIds = new Set();
    for (const module of manifest.modules) {
      if (!module || typeof module !== "object") throw new Error(`${manifestPath}: invalid module`);
      if (typeof module.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(module.id)) {
        throw new Error(`${manifestPath}: invalid module id`);
      }
      if (moduleIds.has(module.id)) throw new Error(`${manifestPath}: duplicate module id ${module.id}`);
      moduleIds.add(module.id);
      for (const field of ["label", "icon", "component"]) {
        if (typeof module[field] !== "string" || !module[field].trim()) {
          throw new Error(`${manifestPath}: module ${module.id} needs a ${field}`);
        }
      }
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(module.component)) {
        throw new Error(`${manifestPath}: invalid module component ${module.component}`);
      }
      if (module.navOrder !== undefined && (!Number.isInteger(module.navOrder) || module.navOrder < 0)) {
        throw new Error(`${manifestPath}: invalid module navOrder`);
      }
    }
  }

  if (manifest.autoSync !== undefined) {
    const autoSync = manifest.autoSync;
    if (typeof autoSync !== "object" || autoSync === null || Array.isArray(autoSync)) {
      throw new Error(`${manifestPath}: autoSync must be an object`);
    }
    if (autoSync.enabled !== undefined && typeof autoSync.enabled !== "boolean") {
      throw new Error(`${manifestPath}: autoSync.enabled must be a boolean`);
    }
    if (autoSync.group !== undefined && !AUTO_SYNC_GROUPS.has(autoSync.group)) {
      throw new Error(`${manifestPath}: autoSync.group must be fast or slow`);
    }
    if (autoSync.path !== undefined && (typeof autoSync.path !== "string" || !autoSync.path.startsWith("/api/"))) {
      throw new Error(`${manifestPath}: autoSync.path must be an /api/ route`);
    }
  }
  return manifest;
}

// `implementation.source` is written relative to a base that differs by where
// the connector came from. A shipped manifest writes it from the repository
// root ("server/connectors/community/github/index.js") because that is what it
// has always meant and rewriting fourteen manifests would buy nothing. An
// installed connector knows nothing of this repository, so its source is
// relative to its own folder ("index.js"). Each manifest carries the base it
// resolves against, and the loader and the action bootstrap use that rather
// than assuming the repository root.
const REPO_ROOT = path.join(__dirname, "..", "..");

function loadConnectorManifests({ root = __dirname, userDir = userConnectorsDir() } = {}) {
  const manifests = new Map();

  const add = (manifestPath, tierRoot, packageRoot) => {
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      manifestPath,
      tierRoot,
    );
    const clash = manifests.get(manifest.id);
    if (clash) {
      // Shipped connectors are read first, so a clash always means an installed
      // connector claiming an id Lintaya already ships. Refusing is the whole
      // point: silently shadowing "github" with a folder someone dropped in a
      // home directory is exactly the substitution nobody would notice.
      throw new Error(
        `Duplicate connector id: ${manifest.id} (${manifestPath} collides with ${clash.manifestPath})`,
      );
    }
    manifests.set(manifest.id, Object.freeze({ ...manifest, manifestPath, packageRoot }));
  };

  for (const manifestPath of findManifestFiles(root)) add(manifestPath, root, REPO_ROOT);
  for (const manifestPath of findUserManifestFiles(userDir)) {
    add(manifestPath, null, path.dirname(manifestPath));
  }
  return manifests;
}

const connectorManifests = loadConnectorManifests();

function getConnectorManifest(id) {
  return connectorManifests.get(id) || null;
}

function connectorMetadata(id) {
  const manifest = getConnectorManifest(id);
  if (!manifest) return {};
  return {
    tier: manifest.tier,
    lifecycle: manifest.lifecycle,
    license: manifest.license,
    connectorVersion: manifest.version,
    capabilities: [...manifest.capabilities],
    ...(manifest.blocks ? { blocks: manifest.blocks.map(b => ({ ...b })) } : {}),
    ...(manifest.modules ? { modules: manifest.modules.map(m => ({ ...m })) } : {}),
  };
}

// Every Home block declared by any connector, flattened for the catalog the
// dashboard consumes. The instance id (`gitlab.recent-commits`) is what the
// Home layout persists, so it must stay stable once a block ships.
function listConnectorBlocks(manifests = connectorManifests) {
  const blocks = [];
  for (const manifest of manifests.values()) {
    for (const block of manifest.blocks || []) {
      blocks.push({
        id: `${manifest.id}.${block.id}`,
        connectorId: manifest.id,
        blockId: block.id,
        title: block.title,
        icon: block.icon || null,
        type: block.type,
      });
    }
  }
  return blocks;
}

// Modules are full connector-owned views, unlike Home blocks.  The frontend
// receives only declarative navigation metadata and resolves `component`
// against components it has already loaded; a manifest never ships executable
// UI through this API.
function listConnectorModules(manifests = connectorManifests) {
  const modules = [];
  for (const manifest of manifests.values()) {
    for (const module of manifest.modules || []) {
      modules.push({
        connectorId: manifest.id,
        moduleId: module.id,
        label: module.label,
        icon: module.icon,
        component: module.component,
        navOrder: module.navOrder ?? 100,
      });
    }
  }
  return modules.sort((left, right) => left.navOrder - right.navOrder || left.label.localeCompare(right.label));
}

// Convention over configuration: every connector keeps its `config.schema.json`
// right next to `manifest.json` (see the folder layout in DEVELOPMENT_GUIDE.md),
// so this is discovered by location instead of requiring every manifest to
// declare a redundant `configSchema` path.
function readConnectorConfigSchema(manifest) {
  if (!manifest) return null;
  const schemaPath = path.join(path.dirname(manifest.manifestPath), "config.schema.json");
  if (!fs.existsSync(schemaPath)) return null;
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function getConnectorConfigSchema(id) {
  return readConnectorConfigSchema(getConnectorManifest(id));
}

// Public, presentation-safe catalog for the New connection picker.  The
// manifest remains the source of identity and capabilities; the schema adds
// only enough information for the UI to explain the configuration it will
// request.  Neither configs nor secret values are read here.
function listConnectorCatalog(manifests = connectorManifests) {
  return [...manifests.values()]
    .map((manifest) => {
      const schema = readConnectorConfigSchema(manifest);
      const required = new Set(schema?.required || []);
      return {
        id: manifest.id,
        displayName: manifest.displayName,
        tier: manifest.tier,
        lifecycle: manifest.lifecycle,
        capabilities: [...manifest.capabilities],
        instantiable: Boolean(manifest.instantiable),
        config: schema ? {
          title: schema.title || manifest.displayName,
          description: schema.description || "",
          fields: Object.entries(schema.properties || {}).map(([id, property]) => ({
            id,
            label: property.title || id.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
            required: required.has(id),
            secret: Boolean(property["x-lintaya-secret"] || property.writeOnly),
          })),
        } : null,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

// Scheduled-sync targets, derived from the manifests instead of listed in
// server.js. Every connector exposes POST /api/connectors/<id>/sync, so the
// common case needs no manifest field at all; a connector that is too slow to
// share the fast cadence, or whose sync route is shaped differently, says so
// with `autoSync`. The hand-kept list this replaces had already drifted —
// lintaya-remote and outlook-local were never scheduled — and it made core
// name connectors that a given build may not even ship.
// Whether this machine can run the connector at all. A manifest may name the
// platforms it works on — outlook-local drives the Outlook desktop app through
// PowerShell and COM, so it is Windows and nothing else. Until now the field
// was declared and never read: on Linux or macOS that connector loaded, mounted
// its routes and appeared configurable, then failed at the first call with a
// COM error that says nothing about the real reason.
function isSupportedHere(manifest, platform = process.platform) {
  const declared = manifest?.os;
  if (!Array.isArray(declared) || declared.length === 0) return true;
  return declared.includes(platform);
}

function listAutoSyncTargets(manifests = connectorManifests) {
  const targets = [];
  for (const manifest of manifests.values()) {
    const autoSync = manifest.autoSync || {};
    if (autoSync.enabled === false) continue;
    // Scheduling a connector this machine cannot run means a failure every
    // cycle, for a reason no log line explains.
    if (!isSupportedHere(manifest)) continue;
    targets.push({
      id: manifest.id,
      path: autoSync.path || `/api/connectors/${manifest.id}/sync`,
      group: autoSync.group || "fast",
    });
  }
  return targets.sort((left, right) => left.id.localeCompare(right.id));
}

module.exports = {
  connectorManifests,
  isSupportedHere,
  listAutoSyncTargets,
  connectorMetadata,
  findManifestFiles,
  findUserManifestFiles,
  getConnectorConfigSchema,
  getConnectorManifest,
  listConnectorBlocks,
  listConnectorCatalog,
  listConnectorModules,
  loadConnectorManifests,
  userConnectorsDir,
  validateManifest,
};
