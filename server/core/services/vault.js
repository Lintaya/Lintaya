// Vault session lifecycle, Bitwarden CLI runner and demo-mode SQLite storage.
// Owns the single vaultSession instance shared by /api/vault/* (routes/vault.js)
// and every other domain that resolves a stored credential (SSH, container
// collection, fabric correlation, the Bitwarden connector) — those callers
// receive the pieces they need (lookupVaultPassword, vaultSession, bw, …)
// rather than importing this module directly, so there is exactly one session
// per process no matter how many routers are registered.
const fs = require("node:fs");
const path = require("node:path");
const { spawn: defaultSpawn } = require("node:child_process");
const { getConnectorConfig } = require("./connector-store");

function detectBwBin(serverDir) {
  // Prefer the locally-installed bw CLI (ships with the project) over a global
  // one. Run `node bw.js` directly to avoid issues with paths containing
  // special chars (e.g. &).
  const localJs = path.join(serverDir, "node_modules", "@bitwarden", "cli", "build", "bw.js");
  if (fs.existsSync(localJs)) return { bin: process.execPath, script: localJs };
  return { bin: "bw", script: null };
}

function loadVaultSeed(serverDir, disableSeeds) {
  if (disableSeeds) return [];
  const seedPath = path.join(serverDir, "vault-seed.js");
  return fs.existsSync(seedPath) ? require(seedPath) : [];
}

function createVaultService({ config, db, kvGet, kvSet, log, spawn = defaultSpawn }) {
  const VAULT_MODE = config.vault.mode;
  const VAULT_IDLE_MS = config.vault.idleMs;
  const VAULT_MASTER_PASSWORD = config.vault.masterPassword;
  const BW_BIN = detectBwBin(config.serverDir);
  const VAULT_SEED = loadVaultSeed(config.serverDir, config.database.disableSeeds);

  const countVaultItems = db.prepare("SELECT COUNT(*) AS count FROM vault_items");
  const selectVaultItems = db.prepare(`
    SELECT id, service, username, tags, url, notes, strength, last_used
    FROM vault_items
    ORDER BY service COLLATE NOCASE
  `);
  const selectVaultSecret = db.prepare("SELECT secret FROM vault_items WHERE id = ?");
  const insertVaultItem = db.prepare(`
    INSERT INTO vault_items (
      id, service, username, secret, tags, url, notes, strength, last_used, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function seedDemoVault() {
    const existing = countVaultItems.get();
    if ((existing && existing.count) > 0) return;

    const now = Date.now();
    const tx = db.transaction((items) => {
      for (const item of items) {
        insertVaultItem.run(
          String(item.id),
          item.service,
          item.user,
          item.secret,
          JSON.stringify(item.tags || []),
          item.url || "",
          item.notes || "",
          item.strength || "medium",
          item.lastUsed || "",
          now
        );
      }
    });

    tx(VAULT_SEED);
  }

  const vaultSession = {
    unlocked: false,
    mode: null,
    bwSession: null,
    timeout: null,
  };

  function clearVaultTimer() {
    if (vaultSession.timeout) {
      clearTimeout(vaultSession.timeout);
      vaultSession.timeout = null;
    }
  }

  async function lockVaultSession() {
    clearVaultTimer();
    const shouldLockBitwarden = vaultSession.mode === "bitwarden" && vaultSession.bwSession;

    vaultSession.unlocked = false;
    vaultSession.mode = null;
    vaultSession.bwSession = null;

    if (shouldLockBitwarden) {
      await bw(["lock"]).catch(() => {});
    }
  }

  function armVaultTimer() {
    clearVaultTimer();
    vaultSession.timeout = setTimeout(() => {
      lockVaultSession().catch(() => {});
    }, VAULT_IDLE_MS);
  }

  function markVaultUnlocked(mode, bwSession = null) {
    vaultSession.unlocked = true;
    vaultSession.mode = mode;
    vaultSession.bwSession = bwSession;
    armVaultTimer();
  }

  function bw(args, session) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (session) env.BW_SESSION = session;
      // Allow self-signed certs on self-hosted Bitwarden instances
      env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

      const spawnArgs = BW_BIN.script ? [BW_BIN.script, ...args] : args;
      const child = spawn(BW_BIN.bin, spawnArgs, { env });
      let out = "";
      let err = "";

      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      child.on("close", (code) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(err.trim() || `exit ${code}`));
      });
    });
  }

  async function bwEnsureServerAuth() {
    // If API key is configured in the BW connector (or env vars from start-dev.js), use it to
    // re-authenticate with the server before sync so bw sync actually pulls fresh data.
    const cfg = getConnectorConfig("bw", { kvGet, kvSet });
    const clientId     = cfg?.clientId     || config.vault.clientId;
    const clientSecret = cfg?.clientSecret || config.vault.clientSecret;
    if (!clientId || !clientSecret) return; // no API key anywhere → skip
    log.info("[bw] bwEnsureServerAuth", { source: cfg?.clientId ? "KV config" : "env vars" });

    const rawStatus = await bw(["status"]).catch(() => '{"status":"locked"}');
    let statusObj;
    try { statusObj = JSON.parse(rawStatus); } catch { statusObj = { status: "unknown" }; }
    log.info("[bw] pre-sync status", { status: statusObj.status });

    // login --apikey — refreshes the server session token so bw sync pulls real data.
    // NOTE: do NOT logout first — that would invalidate the active BW_SESSION used by list/sync.
    const bwEnv = {
      ...process.env,
      BW_CLIENTID: clientId,
      BW_CLIENTSECRET: clientSecret,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    };

    await new Promise((resolve) => {
      const loginArgs = BW_BIN.script
        ? [BW_BIN.script, "login", "--apikey", "--nointeraction"]
        : ["login", "--apikey", "--nointeraction"];
      const child = spawn(BW_BIN.bin, loginArgs, { env: bwEnv });
      let out = "", err = "";
      child.stdout.on("data", c => out += c);
      child.stderr.on("data", c => err += c);
      child.on("close", code => {
        const msg = (out + err).trim();
        if (code === 0) {
          log.info("[bw] re-auth with API key succeeded");
        } else if (msg.includes("already logged in") || msg.includes("You are already")) {
          log.info("[bw] already logged in — server session still valid");
        } else {
          log.warn("[bw] re-auth failed", { exitCode: code, message: msg.slice(0, 200) });
        }
        resolve(); // always non-fatal
      });
    });
  }

  async function syncBitwardenItems(session) {
    // Re-authenticate with Bitwarden server if API key is configured (fixes stale server sessions)
    await bwEnsureServerAuth();

    // Pull latest from the server first, then fetch folders + items in parallel
    const syncOut = await bw(["sync"], session);
    log.info("[bw] sync output", { preview: syncOut.slice(0, 100) });

    const [rawItems, rawFolders] = await Promise.all([
      bw(["list", "items", "--nointeraction"], session),
      bw(["list", "folders", "--nointeraction"], session),
    ]);

    let items, folders;
    try { items   = JSON.parse(rawItems);   } catch { throw new Error("bw list items returned invalid JSON"); }
    try {
      folders = JSON.parse(rawFolders);
    } catch (e) {
      log.warn("[vault] bw list folders parse error", { message: e.message, raw: rawFolders.slice(0, 200) });
      folders = [];
    }

    // Log every folder returned by the CLI so we can diagnose missing ones
    log.info("[vault] bw folders raw", { folders: folders.map(f => `${f.id ?? "null"} = ${f.name}`).join(", ") });

    // Build folder id → name map (includes null key for "No Folder" items)
    const folderMap = {};
    for (const f of folders) folderMap[f.id] = f.name;

    // Map Bitwarden item shape → app vault shape
    const mapped = items
      .filter((it) => it.type === 1) // type 1 = login
      .map((it) => {
        // Read app tags from custom field "hq_tags" (comma-separated tag IDs)
        const hqTagsField = (it.fields || []).find(f => f.name === "hq_tags");
        const tags = hqTagsField?.value ? hqTagsField.value.split(",").map(t => t.trim()).filter(Boolean) : [];
        return {
          id: it.id,
          service: it.name,
          user: it.login?.username || "",
          folder: it.folderId ? (folderMap[it.folderId] || "") : "",
          folderId: it.folderId || null,
          tags,
          url: it.login?.uris?.[0]?.uri || "",
          notes: it.notes || "",
          strength: "medium",
          revisionDate: it.revisionDate || "",
          lastUsed: "",
        };
      });

    // Filter out Bitwarden's built-in "No Folder" entry (id: null) — we handle that in the UI
    const realFolders = folders.filter(f => f.id != null && f.id !== "").map(f => ({ id: f.id, name: f.name }));
    kvSet("vault-items", mapped);
    kvSet("vault-folders", realFolders);
    log.info("[vault] synced", { items: mapped.length, folders: realFolders.map(f => f.name).join(", ") });
    return mapped.length;
  }

  // Resolve a vault item's password (Bitwarden CLI or demo SQLite).
  // Throws an Error with code "vault-locked" if the Bitwarden vault is locked.
  async function lookupVaultPassword(vaultItemId) {
    if (!vaultItemId) return null;
    if (VAULT_MODE === "bitwarden") {
      if (!vaultSession.unlocked || !vaultSession.bwSession) {
        const error = new Error("vault-locked"); error.code = "vault-locked"; throw error;
      }
      try {
        const password = await bw(["get", "password", String(vaultItemId)], vaultSession.bwSession);
        armVaultTimer();
        return password;
      } catch (error) {
        log.warn("[vault] bw get password failed", { message: error.message });
        return null;
      }
    }
    return selectVaultSecret.get(String(vaultItemId))?.secret || null;
  }

  function getDemoVaultItems() {
    return selectVaultItems.all().map((item) => ({
      id: item.id,
      service: item.service,
      user: item.username,
      tags: JSON.parse(item.tags || "[]"),
      url: item.url || "",
      notes: item.notes || "",
      strength: item.strength || "medium",
      lastUsed: item.last_used || "",
    }));
  }

  function timeAgo(isoString) {
    if (!isoString) return "";
    const diff = Date.now() - new Date(isoString).getTime();
    if (isNaN(diff) || diff < 0) return "";
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)    return "just now";
    if (mins < 60)   return `${mins}m ago`;
    if (hours < 24)  return `${hours}h ago`;
    if (days < 30)   return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  function getVaultUsageCounts() {
    const vmMap        = kvGet("vm-vault-map")?.value        || {};
    const deviceMap     = kvGet("device-vault-map")?.value    || {};
    const connectorMap  = kvGet("connector-vault-map")?.value || {};
    const counts = {}; // { vaultItemId: { vms, devices, connectors } }
    for (const vaultItemId of Object.values(vmMap)) {
      if (!vaultItemId) continue;
      counts[vaultItemId] = counts[vaultItemId] || { vms: 0, devices: 0, connectors: 0 };
      counts[vaultItemId].vms++;
    }
    for (const vaultItemId of Object.values(deviceMap)) {
      if (!vaultItemId) continue;
      counts[vaultItemId] = counts[vaultItemId] || { vms: 0, devices: 0, connectors: 0 };
      counts[vaultItemId].devices++;
    }
    for (const vaultItemId of Object.values(connectorMap)) {
      if (!vaultItemId) continue;
      counts[vaultItemId] = counts[vaultItemId] || { vms: 0, devices: 0, connectors: 0 };
      counts[vaultItemId].connectors++;
    }
    return counts;
  }

  function getVaultMetadata() {
    const items         = VAULT_MODE === "bitwarden"
      ? (kvGet("vault-items")?.value || [])
      : getDemoVaultItems();
    const counts        = getVaultUsageCounts();
    const localUsed     = kvGet("vault-last-used")?.value        || {};
    const vmMap         = kvGet("vm-vault-map")?.value           || {};
    const deviceMap     = kvGet("device-vault-map")?.value       || {};
    const connectorMap  = kvGet("connector-vault-map")?.value    || {};

    // Build reverse maps: vaultItemId → [resourceIds]
    const vmRev = {}, devRev = {}, conRev = {};
    for (const [id, vid] of Object.entries(vmMap))        { if (vid) (vmRev[vid]  = vmRev[vid]  || []).push(id); }
    for (const [id, vid] of Object.entries(deviceMap))    { if (vid) (devRev[vid] = devRev[vid] || []).push(id); }
    for (const [id, vid] of Object.entries(connectorMap)) { if (vid) (conRev[vid] = conRev[vid] || []).push(id); }

    return items.map(item => {
      const local    = localUsed[item.id] || "";
      const revision = item.revisionDate  || "";
      let bestTs = "";
      if (local && revision) {
        bestTs = new Date(local) >= new Date(revision) ? local : revision;
      } else {
        bestTs = local || revision;
      }
      return {
        ...item,
        lastUsed:       timeAgo(bestTs),
        vmCount:        counts[item.id]?.vms        || 0,
        deviceCount:    counts[item.id]?.devices    || 0,
        connectorCount: counts[item.id]?.connectors || 0,
        vmIds:          vmRev[item.id]  || [],
        deviceIds:      devRev[item.id] || [],
        connectorIds:   conRev[item.id] || [],
      };
    });
  }

  return {
    VAULT_MODE,
    VAULT_IDLE_MS,
    VAULT_MASTER_PASSWORD,
    BW_BIN,
    vaultSession,
    selectVaultSecret,
    clearVaultTimer,
    lockVaultSession,
    armVaultTimer,
    markVaultUnlocked,
    bw,
    bwEnsureServerAuth,
    syncBitwardenItems,
    lookupVaultPassword,
    seedDemoVault,
    getDemoVaultItems,
    getVaultUsageCounts,
    getVaultMetadata,
  };
}

module.exports = { createVaultService };
