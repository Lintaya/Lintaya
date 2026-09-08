// Service worker — cache-first para shell estático, network-first para /api
//
// VERSION is a placeholder. The server rewrites it while serving /sw.js — see
// server/core/services/sw-version.js — so no development workflow has to modify
// this tracked file to bust the browser cache. The literal below applies only
// when sw.js is served as a plain static asset.
const VERSION = "dev";
const STATIC_CACHE = `static-${VERSION}`;
const API_CACHE    = `api-${VERSION}`;

const STATIC_ASSETS = [
  "./",
  "./Lintaya.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/brand/lintaya-logo-light.png",
  "./assets/brand/lintaya-logo-dark.png",
  "./assets/brand/lintaya-mark-light.png",
  "./assets/brand/lintaya-mark-dark.png",
  "./app/public-data.js",
  "./app/api.js",
  "./app/zone-tree.js",
  "./app/i18n.js",
  "./app/app.jsx",
  "./app/home.jsx",
  "./app/vms.jsx",
  "./app/hosts.jsx",
  "./app/devices.jsx",
  "./app/passwords.jsx",
  "./app/connectors.jsx",
  "./app/repos.jsx",
  "./app/containers.jsx",
  "./app/ssh-logs.jsx",
  "./app/approvals.jsx",
  "./app/mail.jsx",
  "./app/block-builder.jsx",
  "./app/block-catalog.jsx",
  "./app/confirm-modal.jsx",
  "./app/custom-page-view.jsx",
  "./app/module-builder.jsx",
  "./app/dashboard.jsx",
  "./app/cmdk.jsx",
  "./app/ai-chat.jsx",
  "./app/tweaks-panel.jsx",
  "./app/tags.jsx",
  "./vendor/react.development.js",
  "./vendor/react-dom.development.js",
  "./vendor/babel.min.js",
  "./vendor/mermaid.min.js",
  "./vendor/marked.min.js",
  "./vendor/purify.min.js",
];

// Install — precachear shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch((err) => console.warn("[SW] precache failed:", err))
    )
  );
  self.skipWaiting();
});

// Activate — limpiar caches viejos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — estrategia híbrida
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Solo GET
  if (event.request.method !== "GET") return;

  // Never cache the worker script through itself.  Caching this request made
  // an older cache-first worker prevent its own replacement after a restart.
  // Let the browser's service-worker update check reach the server directly.
  if (url.pathname === "/sw.js") return;

  // /api/* — network-first con fallback al cache (datos en vivo)
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname.startsWith("/api/vault/")) {
      event.respondWith(
        fetch(event.request).catch(() =>
          new Response(JSON.stringify({ error: "offline" }), {
            status: 503, headers: { "Content-Type": "application/json" }
          })
        )
      );
      return;
    }

    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached || new Response(JSON.stringify({ error: "offline" }), {
              status: 503, headers: { "Content-Type": "application/json" }
            })
          )
        )
    );
    return;
  }

  // JSX/JS app files — network-first so edits are picked up immediately
  if (url.pathname.startsWith("/app/") || url.pathname.endsWith(".jsx") || url.pathname.endsWith(".js")) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Other static — cache-first
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => caches.match("./Lintaya.html"))
    )
  );
});
