const path = require("node:path");

class ConfigError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ConfigError";
    this.code = "CONFIG_INVALID";
    this.field = field;
  }
}

function integer(env, name, fallback, { min = 1, max = 65535 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`, name);
  }
  return value;
}

function oneOf(value, name, allowed) {
  if (!allowed.includes(value)) {
    throw new ConfigError(`${name} must be one of: ${allowed.join(", ")}`, name);
  }
  return value;
}

function commitIdentities(env, name) {
  const raw = (env[name] || "").trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${name} must be JSON: {"<provider>":{"name":"…","email":"…"}}`, name);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${name} must be a JSON object keyed by provider`, name);
  }
  const identities = {};
  for (const [provider, identity] of Object.entries(parsed)) {
    const person = identity && typeof identity === "object" ? identity : {};
    const person_name = typeof person.name === "string" ? person.name.trim() : "";
    const email = typeof person.email === "string" ? person.email.trim() : "";
    if (!person_name || !email) {
      throw new ConfigError(`${name}.${provider} needs a non-empty name and email`, name);
    }
    identities[provider] = { name: person_name, email };
  }
  return identities;
}

function loadConfig(env = process.env, options = {}) {
  const serverDir = options.serverDir || path.join(__dirname, "..");
  const rootDir = path.resolve(serverDir, "..");
  const nodeEnv = env.NODE_ENV || "development";
  const token = (env.HQ_TOKEN || "").trim();

  if (options.requireToken && !token) {
    throw new ConfigError("HQ_TOKEN is required", "HQ_TOKEN");
  }

  const vaultMode = oneOf(
    (env.VAULT_MODE || "bitwarden").toLowerCase(),
    "VAULT_MODE",
    ["bitwarden", "demo"],
  );
  const secretStoreMode = oneOf(
    (env.LINTAYA_SECRET_STORE || "legacy").toLowerCase(),
    "LINTAYA_SECRET_STORE",
    ["legacy", "local", "bitwarden"],
  );
  const aiProvider = oneOf(
    (env.AI_PROVIDER || "").toLowerCase(),
    "AI_PROVIDER",
    ["", "anthropic", "litellm", "openai", "opencode", "ollama", "compatible"],
  );

  return {
    nodeEnv,
    rootDir,
    serverDir,
    http: {
      host: env.HOST || "0.0.0.0",
      port: integer(env, "PORT", 3000),
      token,
    },
    database: {
      mainPath: env.LINTAYA_DB_PATH || path.join(serverDir, "personal-hq.db"),
      reposPath: env.LINTAYA_REPOS_DB_PATH || path.join(serverDir, "repos.db"),
      disableSeeds: env.LINTAYA_DISABLE_SEEDS === "1",
    },
    vault: {
      mode: vaultMode,
      idleMs: integer(env, "VAULT_IDLE_MS", 15 * 60 * 1000, {
        min: 1000,
        max: 24 * 60 * 60 * 1000,
      }),
      masterPassword: env.VAULT_MASTER_PASSWORD || (nodeEnv === "production" ? "" : "dev-master"),
      clientId: env.BW_CLIENTID || "",
      clientSecret: env.BW_CLIENTSECRET || "",
    },
    secretStore: {
      mode: secretStoreMode,
      key: env.LINTAYA_SECRET_KEY || "",
    },
    ai: {
      provider: aiProvider,
      anthropicApiKey: env.ANTHROPIC_API_KEY || "",
      litellmBaseUrl: (env.LITELLM_BASE_URL || "").trim(),
      litellmApiKey: (env.LITELLM_API_KEY || "").trim(),
    },
    networkTools: {
      host: env.NETWORK_TOOLS_HOST || "127.0.0.1",
      port: integer(env, "NETWORK_TOOLS_PORT", 5100),
      servicePython: env.NETWORK_TOOLS_PYTHON || "",
      python: env.CODEX_PYTHON || path.join(
        env.USERPROFILE || "",
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime",
        "dependencies",
        "python",
        "python.exe",
      ),
    },
    git: {
      // Per-provider committer identity for agent-driven commits, e.g.
      // GIT_COMMIT_IDENTITY={"gitlab":{"name":"Ada Lovelace","email":"ada@example.com"}}.
      // Empty by default: without it every provider commits with whatever
      // identity the machine's git config already resolves.
      commitIdentity: commitIdentities(env, "GIT_COMMIT_IDENTITY"),
    },
    vscodeWebPort: integer(env, "VSCODE_WEB_PORT", 8011),
  };
}

module.exports = { ConfigError, loadConfig };
