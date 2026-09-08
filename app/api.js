(function initApiClient() {
  const TOKEN_KEY = "personal-hq.api-token";
  // 401s that are about the vault's own master password, not about this
  // client's API token — see the note at the status check below.
  const VAULT_AUTH_CODES = new Set(["WRONG_MASTER_PASSWORD", "VAULT_LOCKED"]);

  function getToken() {
    try {
      // localStorage persists across reloads/tabs — no need to re-enter every session
      const saved = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
      if (saved) return saved;
    } catch (error) {
      // Some embedded browser contexts disable Web Storage. The local
      // development server still has an explicit, non-secret dev token.
    }

    return location.hostname === "localhost" && location.port === "3000" ? "dev-token" : "";
  }

  function setToken(token) {
    try {
      const next = (token || "").trim();
      if (next) {
        localStorage.setItem(TOKEN_KEY, next);
        sessionStorage.setItem(TOKEN_KEY, next);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
      }
      return next;
    } catch (error) {
      return "";
    }
  }

  // The local development server (`npm run dev`) intentionally uses the
  // fixed dev-token. Keep its browser origin usable even when it still has a
  // token from another local instance (for example :3001) in storage. This is
  // strictly limited to the development origin; LAN/VPN and production hosts
  // always retain the user-provided token.
  try {
    if (location.hostname === "localhost" && location.port === "3000") {
      setToken("dev-token");
    }
  } catch (error) {
    // Storage can be unavailable in a restrictive browser context; request()
    // will then behave normally and surface the server authentication result.
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
