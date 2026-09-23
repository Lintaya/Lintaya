(function initApiClient() {
  const TOKEN_KEY = "personal-hq.api-token";
  // 401s that are about the vault's own master password, not about this
  // client's API token — see the note at the status check below.
  const VAULT_AUTH_CODES = new Set(["WRONG_MASTER_PASSWORD", "VAULT_LOCKED"]);

  // Last resort for embedded contexts that disable Web Storage: the token the
  // user just typed, kept for this page load only. Without it the gate would
  // accept a token, fail to store it, and open again on the next request —
  // forever, with no way in.
  let memoryToken = "";
  // Separate from memoryToken being truthy, because logging out sets it to the
  // empty string on purpose: a store that silently ignores removeItem would
  // otherwise keep handing back the token the user just signed out of.
  let memoryTokenSet = false;
  // Whether the last setToken() outlives a reload. The auth gate reloads to
  // re-fetch everything with the new token, which is only safe when something
  // will still be holding it afterwards.
  let tokenPersisted = false;

  // Getters, not the Storage objects themselves: with cookies or site data
  // blocked, merely reading `window.localStorage` throws — before any try/catch
  // around getItem could ever run. Every access goes through one of these.
  const localStore = () => window.localStorage;
  const sessionStore = () => window.sessionStorage;

  function readStored(getStore) {
    try {
      return getStore().getItem(TOKEN_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function getToken() {
    // A token that could not be persisted is still the newest one this page
    // has. Reading storage first would hand back the very value the user just
    // replaced — or signed out of — from a store that would not let go of it,
    // and every request would keep using the token they already replaced.
    if (memoryTokenSet && !tokenPersisted) return memoryToken;

    // localStorage persists across reloads/tabs — no need to re-enter every session
    const saved = readStored(localStore) || readStored(sessionStore);
    if (saved) return saved;

    // No origin gets a token for free — not even localhost. A default here
    // would be a credential published in this repository.
    return memoryToken;
  }

  // Each store is written on its own: one of them being blocked (Safari's
  // partitioned storage blocks localStorage while leaving sessionStorage
  // alone, and vice versa) must not cost the token the other could have kept.
  //
  // A store that refuses the new value must not be left holding the old one
  // either. localStorage is read first, so a stale token surviving there would
  // outrank the fresh one in sessionStorage after the reload and put the user
  // back in front of the same prompt, with the same token, forever.
  function writeStored(getStore, value) {
    try {
      const store = getStore();
      if (value) store.setItem(TOKEN_KEY, value);
      else store.removeItem(TOKEN_KEY);
      // Quota and private-mode quirks can accept a write and keep the old value
      // anyway, so trust the read-back rather than the absence of an exception.
      if (readStored(getStore) === value) return true;
    } catch (error) {
      // Same cleanup either way — a throw and a silently ignored write leave
      // the store in the same state.
    }
    try {
      getStore().removeItem(TOKEN_KEY);
    } catch (removeError) {
      // Nothing else to try: the caller decides what an unusable store means.
    }
    return false;
  }

  function setToken(token) {
    const next = (token || "").trim();
    memoryToken = next;
    memoryTokenSet = true;
    const local = writeStored(localStore, next);
    const session = writeStored(sessionStore, next);
    // Persisted means the next read finds this token and nothing else. Since
    // getToken reads localStorage first, a stale value still sitting there
    // outranks a good one in sessionStorage — and no amount of success on the
    // session side makes the pair usable.
    const leftover = readStored(localStore);
    const staleWins = leftover !== "" && leftover !== next;
    tokenPersisted = Boolean(next) && (local || session) && !staleWins;
    return next;
  }

  function isTokenPersisted() {
    return tokenPersisted;
  }

  // Whether a token would still be found after a reload. Signing out has to
  // check this: a store that ignores removeItem without complaining would hand
  // the token straight back on the next load, leaving the user signed in after
  // being told they were signed out.
  function hasStoredToken() {
    return readStored(localStore) !== "" || readStored(sessionStore) !== "";
  }

  function clearToken() {
    return setToken("");
  }

  function apiError(response, payload) {
    const errorField = payload && payload.error;
    const isStructured = errorField && typeof errorField === "object";
    const isProblemDetails = payload && typeof payload === "object" && typeof payload.type === "string" && typeof payload.title === "string";
    const message = isProblemDetails
      ? (payload.detail || payload.title || `request-failed-${response.status}`)
      : isStructured
      ? (errorField.message || `request-failed-${response.status}`)
      : (errorField || `request-failed-${response.status}`);
    const failure = new Error(message);
    failure.status = response.status;
    failure.payload = payload;
    if (isProblemDetails) {
      failure.code = payload.code;
      failure.details = payload.details;
      failure.requestId = payload.requestId;
      failure.problem = payload;
    } else if (isStructured) {
      failure.code = errorField.code;
      failure.details = errorField.details;
      failure.requestId = errorField.requestId;
    }
    return failure;
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = { ...(options.headers || {}) };
    const token = getToken();

    if (token) headers.Authorization = `Bearer ${token}`;

    // Raw bodies (binary uploads, strings, FormData) pass through untouched and
    // keep the caller's Content-Type. Plain objects are JSON-encoded.
    let body = options.body;
    const isRaw = body !== undefined && (
      typeof body === "string" ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      (typeof Blob !== "undefined" && body instanceof Blob) ||
      (typeof FormData !== "undefined" && body instanceof FormData)
    );
    if (body !== undefined && !isRaw) {
      body = JSON.stringify(body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }

    const response = await fetch(path, { method, headers, body });

    const raw = await response.text();
    let payload = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = raw;
      }
    }

    if (!response.ok) {
      // Every route shares the same single Bearer token (server/app.js
      // requireAuth), so a 401 normally means "not authenticated". Announce it
      // once here so the shell can block behind a single reconnect screen
      // instead of each view failing open (empty list, silently missing badge)
      // or showing its own inconsistent inline error.
      //
      // The vault is the exception: it answers 401 about its own credential,
      // not about this token. Treating those as a lost session put a
      // "Session expired" prompt in front of a stopped vault server — a prompt
      // that re-entering the token could never clear, and that hid the one
      // thing the person needed to read.
      if (response.status === 401 && !VAULT_AUTH_CODES.has(payload?.code)) {
        window.dispatchEvent(new CustomEvent("hq:unauthorized"));
      }
      // Server errors are migrating from a flat `{ error: "message" }` string
      // to RFC 9457 Problem Details. Handle both formats while routers migrate
      // so callers reading `e.message` keep working.
      throw apiError(response, payload);
    }

    return payload;
  }

  async function downloadBackup(password) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch("/api/backups/export", { method: "POST", headers, body: JSON.stringify({ password }) });
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new CustomEvent("hq:unauthorized"));
      let payload = null;
      try { payload = JSON.parse(await response.text()); } catch {}
      throw apiError(response, payload);
    }
    return {
      blob: await response.blob(),
      filename: (response.headers.get("Content-Disposition") || "").match(/filename=\"?([^\";]+)\"?/i)?.[1] || "lintaya-backup.lhq",
    };
  }

  async function importBackup(file, password) {
    const headers = {
      "Content-Type": file.type || "application/vnd.lintaya.backup+json",
      "X-Lintaya-Backup-Password": password,
      "X-Lintaya-Backup-Confirm": "RESTORE",
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch("/api/backups/import", { method: "POST", headers, body: file });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new CustomEvent("hq:unauthorized"));
      throw apiError(response, payload);
    }
    return payload;
  }

  window.HQ_API = {
    getToken,
    setToken,
    isTokenPersisted,
    hasStoredToken,
    clearToken,
    request,
    downloadBackup,
    importBackup,
    getVaultStatus() {
      return request("/api/vault/status");
    },
    listVaultItems() {
      return request("/api/vault/items");
    },
    unlockVault(masterPassword) {
      return request("/api/vault/unlock", {
        method: "POST",
        body: { masterPassword },
      });
    },
    lockVault() {
      return request("/api/vault/lock", { method: "POST" });
    },
    getVaultPassword(itemId) {
      return request("/api/vault/get", {
        method: "POST",
        body: { itemId },
      });
    },
    syncVault() {
      return request("/api/vault/sync", { method: "POST" });
    },
    listFolders() {
      return request("/api/vault/folders");
    },
    createVaultItem(data) {
      return request("/api/vault/create", { method: "POST", body: data });
    },
    editVaultItem(id, data) {
      return request(`/api/vault/edit/${id}`, { method: "PUT", body: data });
    },
  };
})();
