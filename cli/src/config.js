const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const CONFIG_VERSION = 1;
const ALIAS_KINDS = ["connectors", "blocks", "boards"];

function defaultConfigPath(env = process.env, platform = process.platform) {
  if (env.LINTAYA_CONFIG_PATH) return path.resolve(env.LINTAYA_CONFIG_PATH);
  const home = os.homedir();
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Lintaya", "config.json");
  }
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Lintaya", "config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "lintaya", "config.json");
}

function emptyConfig() {
  return { version: CONFIG_VERSION, activeProfile: null, profiles: {} };
}

function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--url must be a valid URL, for example http://localhost:3000");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("--url must use HTTP(S), without credentials or a path");
  }
  return url.toString().replace(/\/$/, "");
}

function validateProfileName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name || "")) {
    throw new Error("profile name must contain 1-64 letters, numbers, hyphens, or underscores");
  }
  return name;
}

function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== CONFIG_VERSION || !value.profiles || typeof value.profiles !== "object" || Array.isArray(value.profiles)) {
    throw new Error("Lintaya configuration file has an unsupported format");
  }
  for (const [name, profile] of Object.entries(value.profiles)) {
    validateProfileName(name);
    if (!profile || typeof profile !== "object" || typeof profile.url !== "string" || typeof profile.token !== "string") {
      throw new Error(`profile ${name} has an invalid format`);
    }
    normalizeUrl(profile.url);
    if (profile.aliases !== undefined) validateAliases(profile.aliases, name);
  }
  if (value.activeProfile !== null && !Object.hasOwn(value.profiles, value.activeProfile)) {
    throw new Error("active profile does not exist in the configuration");
  }
  return value;
}

function validateAliases(aliases, profileName) {
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) throw new Error(`profile ${profileName} has invalid CLI aliases`);
  for (const kind of ALIAS_KINDS) {
    const group = aliases[kind];
    if (group === undefined) continue;
    if (!group || typeof group !== "object" || Array.isArray(group) || !Number.isInteger(group.next) || group.next < 1 || !group.items || typeof group.items !== "object" || Array.isArray(group.items)) {
      throw new Error(`profile ${profileName} has invalid ${kind} aliases`);
    }
    for (const number of Object.values(group.items)) {
      if (!Number.isInteger(number) || number < 1) throw new Error(`profile ${profileName} has invalid ${kind} alias numbers`);
    }
  }
}

async function readConfig(configPath = defaultConfigPath()) {
  try {
    return validateConfig(JSON.parse(await fs.readFile(configPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return emptyConfig();
    if (error instanceof SyntaxError) throw new Error("Lintaya configuration file does not contain valid JSON");
    throw error;
  }
}

async function writeConfig(config, configPath = defaultConfigPath()) {
  validateConfig(config);
  const directory = path.dirname(configPath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, configPath);
}

module.exports = { CONFIG_VERSION, ALIAS_KINDS, defaultConfigPath, emptyConfig, normalizeUrl, validateProfileName, readConfig, writeConfig };
