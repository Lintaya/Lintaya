// App shell — sidebar + routing + toast + tweaks
const { useState, useEffect, useRef, useMemo } = React;

// Routes that fill the viewport and scroll internally, so the shell must not
// wrap them in a second scroll container.
// "connectors" joined this set when its detail view became a 3-column,
// full-height layout (like ssh/settings) instead of a plain scrolling page —
// see ConnectorsView/ConnectorDetail in connectors.jsx, which manage their
// own internal overflow/scrolling for both the list and the detail panel.
const FULL_HEIGHT_ROUTES = new Set(["ssh", "settings", "connectors"]);

const DEFAULT_PROFILE = { name: "Lintaya Demo", role: "Administrador" };

// Single source of truth for the sidebar's navigable routes. The Sidebar adds
// icons and badges on top; Settings reads it to build its visibility toggles.
// Keeping two hand-maintained lists is what let Settings drift five entries
// behind the sidebar, so anything navigable belongs here and nowhere else.
// `connectorOwned` marks a route that is really the base instance of a
// connector (Passwords → bw, Containers → portainer, VMs/Hosts → vcenter,
// Llamadas → outlook, Correo → outlook-local, Repos <x> → x). It is the
// server-side coreRoute of connectors.js, declared here because a build that
// does not ship the connector publishes no module to derive it from.
const NAV_ROUTES = [
  { id: "home" }, { id: "block-catalog" }, { id: "vms", connectorOwned: true },
  { id: "containers", connectorOwned: true },
  { id: "hosts", connectorOwned: true }, { id: "devices" },
  { id: "passwords", connectorOwned: true },
  { id: "connectors" }, { id: "modules" }, { id: "dashboards" },
  { id: "repos-gitlab", connectorOwned: true }, { id: "repos-github", connectorOwned: true },
  { id: "repos-bitbucket", connectorOwned: true },
  { id: "tags" }, { id: "sshlogs" }, { id: "approvals" },
  { id: "calls", connectorOwned: true }, { id: "correo", connectorOwned: true },
];
// settings.jsx loads before this file, so it reads the registry at render time
// rather than at module scope.
window.NAV_ROUTES = NAV_ROUTES;

// Nombre con prefijo a propósito: settings.jsx declara su propio NAV_GROUPS
// (los paneles de Ajustes) y ambos archivos comparten el scope global.
// Blocks, Boards y Dashboards son tres caras de lo mismo: construir. El grupo
// vive SOLO en el render del sidebar — NAV_ROUTES y las preferencias guardadas
// (orden y ocultos de Settings → Navegación) siguen tratando las tres rutas por
// separado, así que ocultar o reordenar una sigue funcionando sin migrar nada.
// El grupo se pinta donde caiga el primero de sus hijos que sobreviva a esos
// filtros, y se lleva a los demás consigo.
// Cada grupo se pinta en la posición de su hijo más alto, así que el orden por
// defecto sale de CORE_NAV_ORDER y las flechas de Settings → Navegación siguen
// mandando: subir un hijo sube su grupo entero.
// Los iconos del padre no repiten forma con ningún hijo — "server" quedó fuera
// de Infra justamente porque son las mismas barras apiladas que Hosts.
const SIDEBAR_NAV_GROUPS = [
  { id: "builder",   icon: "builder", children: ["block-catalog", "modules", "dashboards"] },
  { id: "infra",     icon: "network", children: ["devices", "vms", "containers", "hosts"] },
  { id: "workspace", icon: "apps",    children: ["passwords", "repos-gitlab", "repos-github", "repos-bitbucket", "calls", "correo"] },
  { id: "system",    icon: "sliders", children: ["connectors", "tags", "sshlogs", "approvals"] },
];
window.SIDEBAR_NAV_GROUPS = SIDEBAR_NAV_GROUPS;

// "documentation" and "settings" have their own sidebar icon buttons (not part
// of NAV_ROUTES); "module-builder" (Board Builder) is deliberately not in the
// sidebar either — reachable only via the button on the Módulos page — so all
// three are listed here explicitly alongside NAV_ROUTES.
// "ssh" is reachable (Devices/VMs/Containers sub-items, VMs' "Open workspace"
// banner) without being its own sidebar nav entry — same situation
// documentation/settings/module-builder were already in.
const KNOWN_ROUTE_IDS = new Set([...NAV_ROUTES.map(r => r.id), "documentation", "settings", "module-builder", "ssh"]);
function isKnownRoute(route, connectorModules = [], activeModulePages = [], activeDashboards = []) {
  return KNOWN_ROUTE_IDS.has(route)
    || connectorModules.some(module => module.route === route)
    || activeModulePages.some(page => `page:${page.id}` === route)
    || activeDashboards.some(dashboard => `dashboard:${dashboard.id}` === route);
}

function profileInitials(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(w => w[0]).join("").toUpperCase() || "L";
}

const ICONS = {
  home:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/></svg>,
  vms:       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  hosts:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="5" rx="1"/><rect x="3" y="18" width="18" height="3" rx="1"/><line x1="7" y1="6.5" x2="7" y2="6.5"/><line x1="7" y1="13.5" x2="7" y2="13.5"/></svg>,
  devices:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l3-8 6 16 3-8h4"/></svg>,
  connectors:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11H4a2 2 0 00-2 2v4a2 2 0 002 2h5"/><path d="M15 11h5a2 2 0 012 2v4a2 2 0 01-2 2h-5"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  modules:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  tags:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  settings:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09A1.65 1.65 0 0019.4 15z"/></svg>,
  sliders:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1.5 14h5M9.5 8h5M17.5 16h5"/></svg>,
  builder:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 8.5L4 17.5V21h3.5l9-9"/><path d="M14.5 2.5l7 7-3 3-7-7z"/></svg>,
  cube:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>,
  boards:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>,
  apps:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  passwords: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  repos:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>,
  search:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  ssh:       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="6 14 10 10 6 6"/><line x1="13" y1="14" x2="18" y2="14"/></svg>,
  sshlogs:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="8 13 10 15 8 17"/><line x1="12" y1="17" x2="16" y2="17"/></svg>,
  "block-catalog": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="8" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/></svg>,
  calls:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
  containers:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  documentation:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="14" y2="12"/></svg>,
  mail:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>,
  // Icon set a custom Module Builder page can pick from (app/module-builder.jsx)
  // — a page's `icon` field is a key into this same shared map, same convention
  // connector-declared modules already use (see Sidebar's `ICONS[module.icon]`).
  grid:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>,
  gauge:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14l4-4M3.5 18a9 9 0 1117 0"/></svg>,
  server:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01"/></svg>,
  code:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/></svg>,
  bell:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 01-3.4 0"/></svg>,
  chart:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 15v3M12 9v9M17 5v13"/></svg>,
  shield:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>,
  network:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h6v4H9zM3 16h6v4H3zM15 16h6v4h-6zM12 8v4M6 16v-2h12v2"/></svg>,
  folder:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h6l2 3h10v10H3z"/></svg>,
  clock:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l4 2"/></svg>,
  users:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 6a4 4 0 100 8 4 4 0 000-8M22 20v-2a4 4 0 00-3-3.9"/></svg>,
  edit:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L8 18l-4 1 1-4z"/></svg>,
  view:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>,
  open:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/></svg>,
  trash:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
};
// settings.jsx and other pre-app.jsx-loaded scripts (module-builder.jsx) read
// icon keys off this map lazily (inside render/effects, never at their own
// module-evaluation top level, since app.jsx loads last) — same pattern
// already relied on for window.BlockBuilderView.
window.ICONS = ICONS;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#0891b2",
  "dark": false,
  "vmDensity": "table",
  "tagsDensity": "cards",
  "sidebarStyle": "spacious",
  "fontPair": "geist"
}/*EDITMODE-END*/;

const ACCENTS = {
  "#2563eb": "Blue",
  "#0891b2": "Cyan",
  "#7c3aed": "Violet",
  "#e07b00": "Orange",
};

const FONT_PAIRS = {
  geist:   { sans: "'Geist', system-ui, sans-serif", mono: "'Geist Mono', ui-monospace, monospace" },
  ibm:     { sans: "'IBM Plex Sans', system-ui, sans-serif", mono: "'IBM Plex Mono', ui-monospace, monospace" },
  systemui:{ sans: "system-ui, -apple-system, sans-serif", mono: "ui-monospace, 'SF Mono', Consolas, monospace" },
};

const CORE_NAV_ORDER = {
  home: 10, "block-catalog": 30, vms: 40, containers: 45,
  hosts: 50, devices: 60, passwords: 75, connectors: 80, modules: 85, dashboards: 86,
  "repos-gitlab": 90, "repos-github": 91, "repos-bitbucket": 92, tags: 100, sshlogs: 120, approvals: 125, calls: 130, correo: 135,
};
// settings.jsx lo lee al renderizar para ordenar su lista igual que el sidebar.
window.CORE_NAV_ORDER = CORE_NAV_ORDER;

const iconBtn = {
  width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: "transparent", border: "1px solid var(--border)",
  borderRadius: 7, cursor: "pointer", color: "var(--fg)",
};

function BottomNav({ route, setRoute, connectorModules = [] }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  // The sidebar already only offers a connector-owned route while an available
  // connector publishes it; this list never applied that rule, so a phone on a
  // build without vCenter or Bitwarden showed VMs and Passwords as two of its
  // four tabs and both led nowhere. Candidates are tried in order and the first
  // four that exist are shown, so an install with those connectors keeps the
  // nav it had and a bare one falls through to Connectors instead of a dead tab.
  const published = new Set(
    connectorModules.filter(module => module.coreRoute && module.available !== false)
                    .map(module => module.coreRoute)
  );
  const connectorOwned = new Set(NAV_ROUTES.filter(r => r.connectorOwned).map(r => r.id));
  const items = [
    { id: "home", label: t("nav.home.label"), icon: ICONS.home },
    { id: "vms", label: t("nav.vms.label"), icon: ICONS.vms },
    { id: "devices", label: t("nav.devices.label"), icon: ICONS.devices },
    { id: "passwords", label: t("nav.passwords.label"), icon: ICONS.passwords },
    { id: "containers", label: t("nav.containers.label"), icon: ICONS.containers },
    { id: "connectors", label: t("nav.connectors.label"), icon: ICONS.connectors },
  ].filter(item => !connectorOwned.has(item.id) || published.has(item.id)).slice(0, 4);
  return (
    <nav aria-label={t("shell.primaryNav")} style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40,
      background: "var(--surface)", borderTop: "1px solid var(--border)",
      display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`,
      paddingBottom: "env(safe-area-inset-bottom, 0)",
      boxShadow: "0 -2px 12px -6px rgba(0,0,0,.08)",
    }}>
      {items.map(it => {
        const active = route === it.id;
        return (
          <button key={it.id} onClick={() => setRoute(it.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
            padding: "8px 4px", border: 0, background: "transparent",
            color: active ? "var(--accent)" : "var(--muted-fg)",
            fontFamily: "inherit", fontSize: 10.5, fontWeight: 500, cursor: "pointer",
          }}>
            <span style={{ display: "inline-flex" }}>{it.icon}</span>
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}

// Una vista que lanza durante el render se llevaba el arbol de React entero:
// la app quedaba en blanco, incluida la pantalla de Connectors a la que
// habria que ir para desactivar el conector culpable, y la unica salida era
// recargar. Un error boundary acota el fallo a la pagina que lo produjo.
//
// Clase y no hook porque React no expone esto de otra forma.
class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // La consola es lo unico que conserva el stack: el mensaje de abajo se
    // queda en lo que le sirve a quien lo esta viendo.
    // eslint-disable-next-line no-console
    console.error(`[route:${this.props.route}]`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = window.I18N.t;
    return (
      <div role="alert" style={{ padding: 24, maxWidth: 680 }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{t("shell.viewFailed", "This page could not be rendered")}</h1>
        <p style={{ color: "var(--muted-fg)", margin: "0 0 12px", lineHeight: 1.6 }}>
          {t("shell.viewFailedHelp", "The rest of Lintaya still works — pick another page from the menu. The details are in the browser console.")}
        </p>
        <code style={{ display: "block", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--err)", background: "var(--muted)", padding: "8px 10px", borderRadius: 6, overflowX: "auto" }}>
          {String(this.state.error?.message || this.state.error)}
        </code>
      </div>
    );
  }
}
// A connector manifest names a component already loaded by Lintaya; it never
// sends executable UI over the API. New packages can therefore register a
// full view without adding another route branch to this shell.
function ConnectorModuleView({ module, onNavigate }) {
  const Component = window[module.component];
  if (typeof Component !== "function") {
    return (
      <div style={{ padding: 24, maxWidth: 680 }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{module.label}</h1>
        <p style={{ color: "var(--muted-fg)", margin: 0 }}>{window.I18N.t("ui.shell.component", "The component")} <code>{module.component}</code> {window.I18N.t("ui.shell.componentMissing", "declared by this connector is not loaded.")} </p>
      </div>
    );
  }
  return <Component connectorId={module.connectorId} provider={module.connectorId} connectorType={module.connectorType} connectorName={module.connectorName} onNavigate={onNavigate} />;
}


// Same select-with-label the Blocks catalog toolbar uses (block-catalog.jsx)
// — duplicated here because this repo doesn't share components between .jsx
// files without going through window.*.
function FilterChip({ label, value, options, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-fg)", flexShrink: 0 }}>
      {label}:
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        height: 32, padding: "0 26px 0 8px", border: "1px solid var(--border)",
        borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "white", color: "var(--fg)", cursor: "pointer",
        appearance: "none",
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
        backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
      }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function BoardStatusPill({ ok, label }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
      background: ok ? "color-mix(in srgb, var(--ok) 14%, white)" : "var(--muted)",
      color: ok ? "var(--ok)" : "var(--muted-fg)",
    }}>{label}</span>
  );
}

function BoardActionButton({ label, icon, onClick, disabled = false, danger = false }) {
  const restingColor = disabled ? "var(--muted-fg)" : danger ? "var(--err)" : "var(--muted-fg)";
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(); }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = "var(--row-hover)"; e.currentTarget.style.color = danger ? "var(--err)" : "var(--fg)"; } }}
      onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = restingColor; }}
      style={{
        width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--border)", background: "white", borderRadius: 6,
        cursor: disabled ? "default" : "pointer", color: restingColor, opacity: disabled ? 0.65 : 1,
      }}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>{icon}</span>
    </button>
  );
}

// This page deliberately lives in the shell: it is the navigation surface
// for connector-owned views and must remain available even if an older service
// worker has a cached script list. Table + filters layout deliberately mirrors
// block-catalog.jsx's Blocks page — same visual family, same "search + 3
// dropdowns + single table" pattern — since both are read-mostly catalogs of
// things a connector or the user declared.
function ConnectorModulesPage({ modules = [], modulePages = [], onNavigate }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [q, setQ] = useState("");
  const [connectorFilter, setConnectorFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [estadoFilter, setEstadoFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [confirmBoard, setConfirmBoard] = useState(null);

  // Deleting a custom board here just hits the API directly and lets the
  // hq:module-pages-changed listener in App() refetch — same event convention
  // module-builder.jsx's own delete already uses, so both places stay in sync.
  const deleteBoard = async (board) => {
    try {
      await window.HQ_API.request(`/api/module-pages/${board.id}`, { method: "DELETE" });
      window.dispatchEvent(new CustomEvent("hq:module-pages-changed"));
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.shell.boardDeleted", "Board \"{0}\" deleted", { 0: board.title }), kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.deleteFailed", "Could not delete:") + " " + e.message, kind: "error" } }));
    }
  };
  // Editing a board here jumps straight into its Board Builder editor — see
  // window.__moduleBuilderIntent read at ModuleBuilder's mount, same mechanism
  // Sidebar's openPinnedRepo already uses (window.__pendingRepoOpen) to hand a
  // target off across a route change without real URL params.
  const editBoard = (board) => { window.__moduleBuilderIntent = board; onNavigate("module-builder"); };

  const visibleModules = modules;

  // Both custom boards and connector modules get normalized into one row
  // shape so a single table/filter set can cover both — kind distinguishes
  // them where the rendering actually differs (icon, actions).
  const boardRows = modulePages.map(board => ({
    kind: "board", key: `board:${board.id}`, board, tags: board.tags || [],
    title: board.title, connectorId: null, connectorLabel: "—",
    typeKey: "custom", typeLabel: t("boards.custom"), ok: board.active, statusKey: board.active ? "active" : "inactive", statusLabel: board.active ? t("boards.active") : t("boards.inactive"),
  }));
  const moduleRows = visibleModules.map(module => ({
    kind: "module", key: `module:${module.route}`, module,
    title: window.I18N.tModuleLabel(module), connectorId: module.connectorId, connectorLabel: module.connectorType,
    typeKey: module.component === "ReposView" ? "repo" : "tool", typeLabel: module.component === "ReposView" ? t("boards.repo") : t("boards.tool"),
    ok: module.available !== false, statusKey: module.available === false ? "disconnected" : "connected", statusLabel: module.available === false ? t("boards.disconnected") : t("boards.connected"),
  }));
  const allRows = [...boardRows, ...moduleRows];
  const totalCount = allRows.length;

  const term = q.trim().toLowerCase();
  const matches = (row) =>
    (connectorFilter === "all" || row.connectorId === connectorFilter) &&
    (typeFilter === "all" || row.typeKey === typeFilter) &&
    (estadoFilter === "all"
      ? row.statusKey !== "disconnected"
      : row.statusKey === estadoFilter) &&
    (tagFilter === "all" || (row.tags || []).includes(tagFilter)) &&
    (!term || row.title.toLowerCase().includes(term) || row.connectorLabel.toLowerCase().includes(term));
  const tagOptions = window.tagFilterOptions ? window.tagFilterOptions(boardRows) : [];
  const rows = allRows.filter(matches);
  const filtersActive = !!term
    || connectorFilter !== "all" || typeFilter !== "all"
    || estadoFilter !== "all" || tagFilter !== "all";
  const showEmptyPanel = rows.length === 0 && !filtersActive;
  const pagination = usePagination(rows, { key: "boards" });

  const connectorOptions = [...new Set(moduleRows.map(r => r.connectorId).filter(Boolean))].sort()
    .map(c => [c, c.charAt(0).toUpperCase() + c.slice(1)]);

  return (
    <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.2, margin: 0 }}>{t("boards.title")}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
            {t("boards.desc")}
          </p>
        </div>
        <button onClick={() => { window.__moduleBuilderIntent = "new"; onNavigate("module-builder"); }} style={{ height: 32, padding: "0 14px", background: "var(--accent)", color: "#fff", border: 0, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap" }}>
          {t("boards.new")}
        </button>
      </div>

      {showEmptyPanel ? (
        <window.LintayaEmptyState
          icon="🗂️"
          title={totalCount === 0 ? t("boards.emptyTitle", "No boards yet") : t("boards.allDisconnectedTitle", "Nothing connected yet")}
          body={totalCount === 0 ? t("boards.empty") : t("boards.allDisconnected", "", { count: totalCount })}
          action={totalCount === 0 ? t("boards.new") : t("boards.disconnected")}
          onAction={totalCount === 0
            ? () => { window.__moduleBuilderIntent = "new"; onNavigate("module-builder"); }
            : () => setEstadoFilter("disconnected")}
        />
      ) : (<>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "nowrap", overflowX: "auto" }}>
        <div style={{ position: "relative", flex: "0 0 220px" }}>
          <span style={{ position: "absolute", left: 9, top: 8, color: "var(--muted-fg)", fontSize: 13 }}>⌕</span>
          <input placeholder={t("boards.search")} value={q} onChange={e => setQ(e.target.value)}
            style={{ width: "100%", height: 32, padding: "0 10px 0 28px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "white", outline: "none" }}
            onFocus={e => e.target.style.borderColor = "var(--accent)"}
            onBlur={e => e.target.style.borderColor = "var(--border)"} />
        </div>
        <FilterChip label={t("boards.connector")} value={connectorFilter} options={[["all", t("boards.all")], ...connectorOptions]} onChange={setConnectorFilter} />
        <FilterChip label={t("boards.type")} value={typeFilter} options={[["all", t("boards.all")], ["tool", t("boards.tool")], ["repo", t("boards.repo")], ["custom", t("boards.custom")]]} onChange={setTypeFilter} />
        <FilterChip label={t("boards.status")} value={estadoFilter} options={[["all", t("boards.all")], ["connected", t("boards.connected")], ["disconnected", t("boards.disconnected")], ["active", t("boards.active")], ["inactive", t("boards.inactive")]]} onChange={setEstadoFilter} />
        {tagOptions.length > 0 && (
          <FilterChip label={t("tags.title", "Tags")} value={tagFilter} options={[["all", t("boards.all")], ...tagOptions]} onChange={setTagFilter} />
        )}
        <div style={{ marginLeft: "auto", flexShrink: 0, fontSize: 12, color: "var(--muted-fg)", whiteSpace: "nowrap" }}>
          <b style={{ color: "var(--fg)" }}>{rows.length}</b> / {totalCount}
        </div>
      </div>


      <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", overflow: "hidden" }}>
        <table className="boards-catalog-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--muted)", color: "var(--muted-fg)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase" }}>
              <th className="boards-catalog-icon" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}></th>
              <th className="boards-catalog-title" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{t("boards.title")}</th>
              <th className="boards-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{t("boards.connector")}</th>
              <th className="boards-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{t("boards.type")}</th>
              <th className="boards-catalog-secondary" style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{t("boards.status")}</th>
              <th className="boards-catalog-actions" style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>{t("boards.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "28px 14px", textAlign: "center", color: "var(--muted-fg)", fontSize: 12.5 }}>
                {t("boards.noResults")}
              </td></tr>
            )}
            {pagination.pageItems.map((row, i) => {
              const swatchColor = row.kind === "module" ? (window.BLOCK_CONNECTOR_STYLE?.[row.connectorId]?.color || "var(--muted-fg)") : null;
              const disabled = row.kind === "module" && !row.ok;
              const onRowClick = row.kind === "module" ? () => { if (!disabled) onNavigate(row.module.route); } : () => editBoard(row.board);
              return (
                <tr key={row.key}
                  title={disabled ? window.I18N.t("ui.shell.disconnected", "{0} is disconnected — connect it in Connectors", { 0: row.module.connectorType }) : ""}
                  style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}
                  onClick={onRowClick}
                  onMouseEnter={e => e.currentTarget.style.background = disabled ? e.currentTarget.style.background : "var(--row-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? "color-mix(in srgb, var(--fg) 4%, transparent)" : "transparent"}>
                  <td className="boards-catalog-icon" style={{ padding: "8px 12px" }}>
                    {row.kind === "module"
                      ? <window.BlockLogo connectorId={row.connectorId} color={swatchColor} />
                      : <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ICONS[row.board.icon] || ICONS.grid}</div>}
                  </td>
                  <td className="boards-catalog-title" style={{ padding: "8px 12px", fontWeight: 500 }}>{row.title}</td>
                  <td className="boards-catalog-secondary" style={{ padding: "8px 12px", color: "var(--muted-fg)" }}>{row.connectorLabel}</td>
                  <td className="boards-catalog-secondary" style={{ padding: "8px 12px", color: "var(--muted-fg)" }}>{row.typeLabel}</td>
                  <td className="boards-catalog-secondary" style={{ padding: "8px 12px" }}><BoardStatusPill ok={row.ok} label={row.statusLabel} /></td>
                  <td className="boards-catalog-actions" style={{ padding: "8px 12px", textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end", whiteSpace: "nowrap" }}>
                    {row.kind === "module" ? (
                      <BoardActionButton label={`Abrir ${row.title}`} icon={ICONS.open} disabled={disabled}
                        onClick={() => onNavigate(row.module.route)} />
                    ) : (
                      <>
                        <BoardActionButton label={window.I18N.t("ui.editNamed", "Edit {0}", { 0: row.title })} icon={ICONS.edit}
                          onClick={() => editBoard(row.board)} />
                        {row.board.active && (
                          <BoardActionButton label={`Ver ${row.title}`} icon={ICONS.view}
                            onClick={() => onNavigate(`page:${row.board.id}`)} />
                        )}
                        <BoardActionButton label={window.I18N.t("ui.deleteNamed", "Delete {0}", { 0: row.title })} icon={ICONS.trash} danger
                          onClick={() => setConfirmBoard(row.board)} />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && <PaginationBar {...pagination} />}
      </>)}

      {confirmBoard && (
        <window.ConfirmModal
          title={window.I18N.t("ui.confirm.deleteTitle", "Confirm deletion")}
          message={window.I18N.t("ui.shell.confirmDeleteBoard", "Delete Board “{0}”? Its Blocks are not deleted — they stay in the catalog. This cannot be undone.", { 0: confirmBoard.title })}
          onConfirm={() => deleteBoard(confirmBoard)}
          onClose={() => setConfirmBoard(null)} />
      )}
    </div>
  );
}

function NotFoundView({ onHome }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", padding: "48px 40px", border: "1px dashed var(--border)", borderRadius: 10, background: "var(--muted)", maxWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>{window.I18N.t("ui.shell.routeMissing", "Route not found")}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-fg)", marginBottom: 14, lineHeight: 1.5 }}>{window.I18N.t("ui.shell.sectionMissing", "This section does not exist or is no longer available.")} </div>
        <button onClick={onHome} style={{ height: 32, padding: "0 16px", background: "var(--accent)", color: "white", border: 0, borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{window.I18N.t("ui.shell.goHome", "Go to Home")} </button>
      </div>
    </div>
  );
}

// Every route in the app depends on the same single session token
// (server/app.js requireAuth) — there is no per-page permission model. So a
// 401 anywhere (see the "hq:unauthorized" dispatch in app/api.js) means the
// whole session is unauthenticated, not that one screen lacks access. Before
// this gate existed, each view reacted to that on its own: SSH Logs printed
// the raw "unauthorized" string, Connectors/Boards/Home badges failed open
// and rendered empty with no explanation, and core nav items that should
// hide when their connector is unconfigured (Repos, Passwords, Containers)
// stayed visible because the fetch that would have hidden them never
// resolved. This blocks the whole shell behind one reconnect screen instead.
const AUTH_GATE_EYE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const AUTH_GATE_EYE_OFF = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

function AuthGate() {
  const t = window.I18N.t;
  const [open, setOpen] = useState(false);
  // A stored token the server rejects is a session that ended. No token at all
  // is someone opening Lintaya for the first time, and telling them their
  // session expired describes something that never happened to them — it was
  // also the very first sentence a new install said.
  const [firstRun, setFirstRun] = useState(false);
  const [token, setTokenValue] = useState("");
  const [showToken, setShowToken] = useState(false);
  const dark = document.documentElement.dataset.theme === "dark";
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => {
      setFirstRun(!window.HQ_API.getToken());
      setOpen(true);
    };
    window.addEventListener("hq:unauthorized", onUnauthorized);
    return () => window.removeEventListener("hq:unauthorized", onUnauthorized);
  }, []);

  if (!open) return null;

  const title = firstRun
    ? t("authGate.setupTitle", "Welcome to Lintaya")
    : t("authGate.title", "Session expired");
  const description = firstRun
    ? t("authGate.setupDesc", "This is a fresh install. Enter your access token to unlock Lintaya — you will find it in server/start-dev.js. It stays in this browser, and the server never sends it back.")
    : t("authGate.desc", "Your Lintaya access token is missing or no longer valid. Enter it again to keep working -- nothing you had open was lost.");
  const submitLabel = busy
    ? (firstRun ? t("authGate.connecting", "Unlocking…") : t("authGate.reconnecting", "Reconnecting…"))
    : (firstRun ? t("authGate.connect", "Unlock") : t("authGate.reconnect", "Reconnect"));

  const reconnect = (e) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    window.HQ_API.setToken(trimmed);
    // Every piece of app state that depends on auth was fetched once at
    // mount via plain effects, not a shared store — a full reload is the
    // simplest way to have all of them re-fetch with the new token. Same
    // approach Settings' "Log out" button and the Passwords reconnect flow
    // already use after a token change.
    location.reload();
  };

  return (
    <div role="alertdialog" aria-modal="true" aria-label={title} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      // Una instalación nueva no tiene nada detrás que valga la pena mirar: el
      // fondo opaco la convierte en su propia pantalla de bienvenida. Una sesión
      // expirada sí lo tiene, y el velo translúcido es lo que dice "tu trabajo
      // sigue ahí detrás" — por eso solo el primer arranque va en claro.
      background: firstRun ? "var(--bg)" : "rgba(15,23,42,.7)",
      backdropFilter: firstRun ? "none" : "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <form onSubmit={reconnect} style={{
        width: 380, maxWidth: "100%", background: "var(--surface)", borderRadius: 12,
        padding: 28,
        // La sombra dura se diseñó contra el velo oscuro; sobre el fondo claro
        // del primer arranque solo ensucia, así que ahí va apenas insinuada.
        boxShadow: firstRun ? "0 8px 28px rgba(15,23,42,.10)" : "0 24px 64px rgba(0,0,0,.4)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div>
          <img
            src={dark ? "assets/brand/lintaya-logo-dark.png" : "assets/brand/lintaya-logo-light.png"}
            alt="" aria-hidden="true"
            style={{ height: 52, width: "auto", maxWidth: "100%", objectFit: "contain", display: "block", marginBottom: 16 }}
          />
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "var(--fg)" }}>
            {title}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.5 }}>
            {description}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", overflow: "hidden" }}>
          <input
            autoFocus type={showToken ? "text" : "password"} value={token} onChange={e => setTokenValue(e.target.value)}
            placeholder={t("authGate.placeholder", "Access token")}
            style={{ flex: 1, height: 36, padding: "0 12px", border: 0, outline: 0, fontSize: 13, fontFamily: "inherit", background: "transparent", color: "var(--fg)" }}
          />
          <button
            type="button" onClick={() => setShowToken(v => !v)}
            title={showToken ? "Hide" : "Show"}
            style={{ height: 36, width: 34, border: 0, background: "none", cursor: "pointer", color: "var(--muted-fg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            {showToken ? AUTH_GATE_EYE_OFF : AUTH_GATE_EYE}
          </button>
        </div>
        <button type="submit" disabled={busy || !token.trim()} style={{
          height: 36, background: "var(--accent)", color: "#fff", border: 0, borderRadius: 7,
          fontSize: 13, fontWeight: 600, cursor: busy || !token.trim() ? "default" : "pointer",
          fontFamily: "inherit", opacity: busy || !token.trim() ? 0.65 : 1,
        }}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 800);
  useEffect(() => {
    const onR = () => setM(window.innerWidth < 800);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return m;
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useState("home");
  const [hiddenRoutes, setHiddenRoutes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hq.hiddenRoutes") || "[]"); } catch { return []; }
  });
  // Custom sidebar order — array of NAV_ROUTES ids. Null/missing = default
  // order (the order NAV_ROUTES is declared in). Any id not yet in a saved
  // order (e.g. a route added after the user last reordered) is appended at
  // the end so it still shows up instead of silently disappearing.
  const [navOrderIds, setNavOrderIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("hq.navOrder") || "null");
      if (!Array.isArray(saved)) return null;
      const known = NAV_ROUTES.map(r => r.id);
      return [...saved.filter(id => known.includes(id)), ...known.filter(id => !saved.includes(id))];
    } catch { return null; }
  });
  const [connectorModules, setConnectorModules] = useState([]);

  function toggleRoute(id, visible) {
    setHiddenRoutes(prev => {
      const next = visible ? prev.filter(r => r !== id) : [...prev.filter(r => r !== id), id];
      localStorage.setItem("hq.hiddenRoutes", JSON.stringify(next));
      return next;
    });
  }

  // Settings -> Navegacion arma la lista completa: mover un grupo desplaza su
  // bloque entero, que no es un intercambio entre vecinos adyacentes. Por eso
  // persiste el orden ya resuelto en vez de aplicar aqui un swap.
  function reorderNav(nextIds) {
    if (!Array.isArray(nextIds) || !nextIds.length) return;
    localStorage.setItem("hq.navOrder", JSON.stringify(nextIds));
    setNavOrderIds(nextIds);
  }
  useEffect(() => {
    const loadConnectorModules = () => {
      window.HQ_API.request("/api/connectors/modules")
        .then(list => setConnectorModules(Array.isArray(list) ? list : []))
        .catch(() => setConnectorModules([]));
    };
    loadConnectorModules();
    window.addEventListener("hq:connector-config-changed", loadConnectorModules);
    window.addEventListener("hq:connector-status-changed", loadConnectorModules);
    return () => {
      window.removeEventListener("hq:connector-config-changed", loadConnectorModules);
      window.removeEventListener("hq:connector-status-changed", loadConnectorModules);
    };
  }, []);
  // El catálogo trae también los módulos de conectores Disconnected, para que
  // el Sidebar sepa qué ruta core esconder. Todo lo que navega o renderiza usa
  // solo los disponibles. `!== false` mantiene compatibilidad con respuestas
  // viejas del endpoint, que no traían el flag.
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const availableModules = useMemo(
    () => connectorModules
      .filter(module => module.available !== false)
      .map(module => ({ ...module, label: window.I18N.tModuleLabel(module) })),
    [connectorModules, locale],
  );

  // Module Builder pages — user-created custom navigable pages (app/module-builder.jsx,
  // app/custom-page-view.jsx). Refetched on hq:module-pages-changed, the same event
  // convention hq:connector-config-changed already uses for connectorModules above.
  const [modulePages, setModulePages] = useState([]);
  useEffect(() => {
    const loadModulePages = () => {
      window.HQ_API.request("/api/module-pages")
        .then(list => setModulePages(Array.isArray(list) ? list : []))
        .catch(() => setModulePages([]));
    };
    loadModulePages();
    window.addEventListener("hq:module-pages-changed", loadModulePages);
    return () => window.removeEventListener("hq:module-pages-changed", loadModulePages);
  }, []);
  const activeModulePages = useMemo(() => modulePages.filter(page => page.active), [modulePages]);
  const [dashboards, setDashboards] = useState([]);
  useEffect(() => {
    const loadDashboards = () => {
      window.HQ_API.request("/api/dashboards")
        .then(list => setDashboards(Array.isArray(list) ? list : []))
        .catch(() => setDashboards([]));
    };
    loadDashboards();
    window.addEventListener("hq:dashboards-changed", loadDashboards);
    return () => window.removeEventListener("hq:dashboards-changed", loadDashboards);
  }, []);
  const activeDashboards = useMemo(() => dashboards.filter(dashboard => dashboard.active), [dashboards]);
  // The tag catalog is server-owned (ADR-015), but getTag(), Passwords and
  // Devices all read window.APP_DATA.TAGS. Filling it here rather than when the
  // Tags view mounts is what keeps a tag looking the same before you have
  // opened that view — including this sidebar's own count.
  const [tagCount, setTagCount] = useState(() => window.APP_DATA?.TAGS?.length || 0);
  useEffect(() => {
    const loadTags = () => {
      window.HQ_API.request("/api/tags")
        .then(list => {
          if (!Array.isArray(list)) return;
          window.APP_DATA = window.APP_DATA || {};
          window.APP_DATA.TAGS = list;
          setTagCount(list.length);
        })
        .catch(() => {});
    };
    loadTags();
    window.addEventListener("hq:tags-changed", loadTags);
    return () => window.removeEventListener("hq:tags-changed", loadTags);
  }, []);
  // Live VM/host data — fetched once at App level, shared to Home + Sidebar badges
  const [liveVMs,   setLiveVMs]   = useState(null);  // null = loading
  const [liveHosts, setLiveHosts] = useState(null);
  const [liveMeta,  setLiveMeta]  = useState([]);

  // Estas dos rutas las registra el conector de vCenter, no el core (ADR-014),
  // así que en una instalación que no lo trae no existen. Pedirlas igual dejaba
  // dos 404 en cada carga de toda instalación pública: sobrevivía, porque el
  // catch las traga, pero llenaba la consola de errores que no lo son.
  // Se preguntan solo cuando un módulo disponible publica su ruta, que es la
  // misma regla con la que el menú decide mostrarlas.
  const liveVMsPublished = connectorModules.some(module => module.coreRoute === "vms" && module.available !== false);
  const liveHostsPublished = connectorModules.some(module => module.coreRoute === "hosts" && module.available !== false);
  useEffect(() => {
    if (!liveVMsPublished && !liveHostsPublished) return;
    Promise.all([
      liveVMsPublished ? window.HQ_API.request("/api/vms-live").catch(() => null) : null,
      liveHostsPublished ? window.HQ_API.request("/api/hosts-live").catch(() => null) : null,
    ]).then(([vmData, hostData]) => {
      if (vmData?.vms?.length)   setLiveVMs(vmData.vms);
      if (hostData?.hosts?.length) setLiveHosts(hostData.hosts);
      if (vmData?.meta) setLiveMeta(vmData.meta);
    });
  }, [liveVMsPublished, liveHostsPublished]);

  // Device count — updated by DevicesView once custom devices load from API
  const [deviceCount, setDeviceCount] = useState(window.APP_DATA?.DEVICES?.length || 0);
  // Active connectors (live status "ok"), not the total card count — a
  // connector sitting there disconnected or erroring isn't "active". No
  // static seed to start from (status is only known live), same as
  // callsCount below.
  const [connectorCount, setConnectorCount] = useState(0);
  // Calls count — upcoming Outlook calendar events this week
  const [callsCount, setCallsCount] = useState(0);
  // Containers count — running containers across monitored VMs
  const [containersCount, setContainersCount] = useState(0);
  // Blocks count — blocks activos hoy en Home (declarados por manifest.json,
  // ya filtrados server-side por "conector configurado")
  const [blockCatalogCount, setBlockCatalogCount] = useState(0);
  // Merged connector + custom blocks — the same "which blocks can a page use"
  // catalog the Module Builder editor sources, kept here too so a rendered
  // custom page (CustomPageView) can resolve its block ids without every page
  // re-fetching both endpoints on its own.
  const [blockCatalog, setBlockCatalog] = useState([]);

  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/connectors").catch(() => []),
      window.HQ_API.request("/api/connectors/status").catch(() => ({})),
    ]).then(([list, status]) => {
      if (!Array.isArray(list)) return;
      // Multi-instance connectors (extra GitLab/GitHub/Bitbucket/Outlook-local
      // accounts) don't have a fixed key in /api/connectors/status — their
      // live status is embedded directly on the connector object instead
      // (see connectors.jsx's effStatus for the same fallback).
      const active = list.filter(c => ((status?.[c.id] || c.liveStatus)?.status || "offline") === "ok").length;
      setConnectorCount(active);
    });
    window.HQ_API.request("/api/containers")
      .then(d => { if (typeof d?.running === "number") setContainersCount(d.running); })
      .catch(() => {});
  }, []);

  // The Calls badge belongs to whichever connector publishes the Calls
  // module, so it is asked for only once that module exists and its id comes
  // from the declaration. Fetching it unconditionally hardcoded one provider
  // in the shell and fired a doomed request on every load of a build that
  // does not ship it.
  useEffect(() => {
    const callsModule = connectorModules.find(module => module.moduleId === "calls" && module.available !== false);
    if (!callsModule) { setCallsCount(0); return; }
    window.HQ_API.request(`/api/connectors/${callsModule.connectorId}/events`)
      .then(d => { if (Array.isArray(d?.events)) setCallsCount(d.events.length); })
      .catch(() => {});
  }, [connectorModules]);

  // /api/home/blocks already excludes a connector's block once it's disabled
  // or unconfigured, but only if this refetches — without listening for the
  // same event loadConnectorModules above reacts to, a block whose connector
  // just got disabled kept resolving via the stale blockCatalog (CustomPageView
  // renders it through window.ConnectorBlockPanel, live Sync button included)
  // until a full page reload.
  useEffect(() => {
    const loadBlockCatalog = () => {
      Promise.all([
        window.HQ_API.request("/api/home/blocks").catch(() => []),
        window.HQ_API.request("/api/home/custom-blocks").catch(() => []),
      ]).then(([connectorBlocks, customBlocks]) => {
        const connList = Array.isArray(connectorBlocks) ? connectorBlocks : [];
        const customList = Array.isArray(customBlocks) ? customBlocks : [];
        setBlockCatalogCount(connList.length);
        setBlockCatalog([...connList, ...customList]);
      });
    };
    loadBlockCatalog();
    window.addEventListener("hq:connector-config-changed", loadBlockCatalog);
    window.addEventListener("hq:connector-status-changed", loadBlockCatalog);
    window.addEventListener("hq:custom-blocks-changed", loadBlockCatalog);
    return () => {
      window.removeEventListener("hq:connector-config-changed", loadBlockCatalog);
      window.removeEventListener("hq:connector-status-changed", loadBlockCatalog);
      window.removeEventListener("hq:custom-blocks-changed", loadBlockCatalog);
    };
  }, []);

  // SSH Workspace — sessions survive route changes
  const [sshSessions, setSshSessions] = useState([]);
  // Which session the sidebar's Devices/VMs sub-items last asked to jump to —
  // SSHWorkspaceView reads this once to select that tab, same idea as
  // window.__pendingRepoOpen for pinned repos.
  const [focusSshSessionId, setFocusSshSessionId] = useState(null);
  // Live per-session status ("connecting"/"connected"/"error"/"authfail"/…)
  // mirrored up from SSHWorkspaceView so the Devices/VMs sub-item can show a
  // real connection problem even while you're looking at a different page.
  const [sshSessionStatuses, setSshSessionStatuses] = useState({});

  // `source` tags where the session came from (devices/vms/containers) so
  // the sidebar can group its "open now" sub-items under the right nav
  // button, the same way pinned repos nest under Repos <provider>.
  function handleOpenSSH(vm, vaultItem, source = null) {
    setSshSessions(prev => {
      // Don't add a duplicate for the same VM
      if (prev.find(s => s.vm.id === vm.id)) return prev;
      return [...prev, { id:`${vm.id}-${Date.now()}`, vm, vaultItem, source }];
    });
    setRoute("ssh");
  }

  function handleFocusSSHSession(sessionId) {
    setFocusSshSessionId(sessionId);
    setRoute("ssh");
  }

  function handleRemoveSSHSession(sessionId) {
    setSshSessions(prev => prev.filter(s => s.id !== sessionId));
    setSshSessionStatuses(prev => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev }; delete next[sessionId]; return next;
    });
  }

  // Open an interactive console inside a container via SSH to its VM (docker exec)
  function handleOpenContainerConsole(c) {
    if (!c.vmId || !c.hostIp) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: window.I18N.t("ui.shell.noSshTarget", "No VM/IP available to open this container's SSH console"), kind: "warn" } }));
      return;
    }
    const vmShape = {
      id: `${c.vmId}-${c.id}`,        // unique per container (avoids session dedupe collisions)
      vmId: c.vmId,                    // real VM id → server resolves SSH creds from vault map
      name: `${c.vmName} › ${c.name}`,
      ip: c.hostIp, sshPort: 22,
      execCommand: `docker exec -it ${c.id} sh 2>/dev/null || docker exec -it ${c.id} bash`,
    };
    handleOpenSSH(vmShape, null, "containers");
  }

  const [cmdOpen, setCmdOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Destructive actions can be requested by another local/remote client while
  // the user is working elsewhere. Keep their count at the shell level so the
  // navigation indicator is never tied to the Approval Center route itself.
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [pendingApprovalIds, setPendingApprovalIds] = useState([]);
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState([]);
  const knownApprovalIdsRef = useRef(null);
  const approvalAudioRef = useRef(null);
  const isMobile = useIsMobile();

  // Cerrar menu móvil al cambiar de ruta
  useEffect(() => { setMobileNavOpen(false); }, [route]);

  // Apply CSS vars from tweaks
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent", tweaks.accent);
    r.dataset.theme = tweaks.dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      tweaks.dark ? "#0b1220" : "#0891b2"
    );
    const pair = FONT_PAIRS[tweaks.fontPair] || FONT_PAIRS.geist;
    r.style.setProperty("--font-sans", pair.sans);
    r.style.setProperty("--font-mono", pair.mono);
  }, [tweaks.accent, tweaks.dark, tweaks.fontPair]);

  // Expose setTweak globally so submodules can change density without prop drilling
  useEffect(() => { window.setTweak = setTweak; }, [setTweak]);

  // Toast system
  useEffect(() => {
    const showToast = (detail = {}) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(t => [...t, { id, ...detail }]);
      const duration = Number(detail.duration) || 2400;
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
    };
    // Prefer this direct entry point for shell-owned notices (such as an
    // approval arriving in the background). The CustomEvent remains for all
    // existing feature modules and integrations.
    window.HQ_NOTIFY = showToast;
    const onToast = (e) => showToast(e.detail);
    window.addEventListener("toast", onToast);
    return () => {
      window.removeEventListener("toast", onToast);
      if (window.HQ_NOTIFY === showToast) delete window.HQ_NOTIFY;
    };
  }, []);

  // Browsers only allow audio after an actual user interaction. Arm one local
  // Web Audio context on the first click/key press; no microphone, network
  // request, media file, or persistent permission is involved.
  useEffect(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return undefined;
    let armed = false;
    const armApprovalSound = () => {
      if (armed) return;
      armed = true;
      window.removeEventListener("pointerdown", armApprovalSound, true);
      window.removeEventListener("keydown", armApprovalSound, true);
      const context = approvalAudioRef.current || new AudioContextClass();
      approvalAudioRef.current = context;
      if (context.state === "suspended") context.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", armApprovalSound, true);
    window.addEventListener("keydown", armApprovalSound, true);
    return () => {
      window.removeEventListener("pointerdown", armApprovalSound, true);
      window.removeEventListener("keydown", armApprovalSound, true);
      approvalAudioRef.current?.close?.().catch(() => {});
      approvalAudioRef.current = null;
    };
  }, []);

  function playApprovalChime() {
    const context = approvalAudioRef.current;
    if (!context || context.state !== "running") return;
    const playTone = (frequency, startsAfter, duration) => {
      const start = context.currentTime + startsAfter;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    };
    // A soft rising two-note chime: noticeable, but not an alarm.
    playTone(659.25, 0, 0.14);
    playTone(880, 0.12, 0.22);
  }

  // Approval notifications deliberately use polling for this local-first
  // release: there is no shared event broker yet, and polling the small,
  // redacted pending list keeps every open Lintaya screen consistent. The
  // first successful read establishes a baseline (badge only); later ids are
  // announced once when they appear, without interrupting the Approval page.
  useEffect(() => {
    let cancelled = false;
    const refreshPendingApprovals = async () => {
      try {
        const rows = await window.HQ_API.request("/api/approvals?status=pending");
        if (cancelled) return;
        const approvals = Array.isArray(rows) ? rows : [];
        const ids = new Set(approvals.map(approval => approval.id));
        const previousIds = knownApprovalIdsRef.current;
        setPendingApprovalCount(approvals.length);
        setPendingApprovalIds(approvals.map(approval => approval.id));
        // A dismissal applies only to approvals that existed at that time.
        // Resolved ids are pruned, while a later request gets its own alert.
        setDismissedApprovalIds(previous => previous.filter(id => ids.has(id)));
        if (previousIds) {
          const newApprovals = approvals.filter(approval => !previousIds.has(approval.id));
          if (newApprovals.length && route !== "approvals") {
            const first = newApprovals[0];
            const suffix = newApprovals.length === 1 ? "" : t("approvals.toastMore", "", { count: newApprovals.length - 1 });
            // Audio is an enhancement only. A browser/device audio failure
            // must never suppress the visual notification or its badge.
            try { playApprovalChime(); } catch {}
            const detail = {
              msg: t("approvals.toast", "", { action: first.actionTitle || first.actionId, suffix }),
              kind: "warn",
              duration: 7000,
            };
            if (typeof window.HQ_NOTIFY === "function") window.HQ_NOTIFY(detail);
            else window.dispatchEvent(new CustomEvent("toast", { detail }));
          }
        }
        knownApprovalIdsRef.current = ids;
      } catch {
        // A disconnected/expired browser session must not generate repetitive
        // error toasts while the user works. The Approval Center handles its
        // own explicit reconnect state when the user opens it.
      }
    };
    refreshPendingApprovals();
    const timer = window.setInterval(refreshPendingApprovals, 10000);
    window.addEventListener("hq:approvals-changed", refreshPendingApprovals);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("hq:approvals-changed", refreshPendingApprovals);
    };
  }, [route]);

  const hasUndismissedPendingApprovals = pendingApprovalIds.some(
    id => !dismissedApprovalIds.includes(id),
  );

  // Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); setCmdOpen(v => !v);
      }
      if (e.key === "Escape") setCmdOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell" style={{ display: "flex", width: "100%", minWidth: 0, height: "100dvh", overflow: "hidden", color: "var(--fg)", background: "var(--bg)" }}>
      <AuthGate />
      {/* Persistent, route-independent approval alert. Toasts are useful for
          momentary feedback, but a human-gated destructive action must stay
          discoverable until it is actually resolved. */}
      {pendingApprovalCount > 0 && hasUndismissedPendingApprovals && route !== "approvals" && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed", top: 16, right: 20, zIndex: 210,
            maxWidth: "min(380px, calc(100vw - 40px))",
            display: "flex", alignItems: "center", gap: 10,
            padding: "11px 14px", borderRadius: 10, cursor: "pointer",
            color: "#78350f", background: "#fffbeb", border: "1px solid #f59e0b",
            boxShadow: "0 10px 26px -12px rgba(146,64,14,.55)",
            fontFamily: "inherit", textAlign: "left",
          }}>
          <button
            type="button"
            onClick={() => setRoute("approvals")}
            aria-label={t("approvals.ariaLabel", "", { count: pendingApprovalCount, label: pendingApprovalCount === 1 ? t("approvals.pendingOne") : t("approvals.pendingMany") })}
            style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
            <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", color: "#b45309", background: "#fef3c7", flexShrink: 0 }}>{ICONS.shield}</span>
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: "block", fontSize: 13 }}>{pendingApprovalCount} {pendingApprovalCount === 1 ? t("approvals.pendingOne") : t("approvals.pendingMany")}</strong>
              <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "#92400e" }}>{t("approvals.requireConfirm")}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDismissedApprovalIds(pendingApprovalIds)}
            aria-label={t("approvals.dismissAria")}
            title={t("approvals.dismissTitle")}
            style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 5, background: "transparent", color: "#92400e", cursor: "pointer", fontSize: 19, lineHeight: 1, flexShrink: 0 }}>
            ×
          </button>
        </div>
      )}
      {/* Sidebar desktop */}
      {!isMobile && (
        <Sidebar
          route={route}
          setRoute={setRoute}
          onOpenCmd={() => setCmdOpen(true)}
          style={tweaks.sidebarStyle}
          dark={!!tweaks.dark}
          profileName={tweaks.profileName || DEFAULT_PROFILE.name}
          profileRole={tweaks.profileRole || t("profile.defaultRole")}
          hiddenRoutes={hiddenRoutes}
          navOrderIds={navOrderIds}
          connectorModules={connectorModules}
          modulePages={modulePages}
          dashboards={dashboards}
          sshSessions={sshSessions}
          sshSessionStatuses={sshSessionStatuses}
          onFocusSession={handleFocusSSHSession}
          onToggleCollapse={() => setTweak("sidebarStyle", tweaks.sidebarStyle === "compact" ? "spacious" : "compact")}
          dynamicBadges={{
            vms:        liveVMs                  ? String(liveVMs.filter(v => v.monitoringEnabled !== false).length) : "",
            hosts:      liveHosts                ? String(liveHosts.length)      : "",
            devices:    deviceCount > 0          ? String(deviceCount)           : "",
            connectors: connectorCount > 0       ? String(connectorCount)        : "",
            calls:      callsCount > 0           ? String(callsCount)            : "",
            containers: containersCount > 0      ? String(containersCount)       : "",
            blockCatalog: blockCatalogCount > 0  ? String(blockCatalogCount)     : "",
            approvals:  pendingApprovalCount > 0 ? String(pendingApprovalCount)  : "",
            tags:       tagCount > 0             ? String(tagCount)              : "",
          }}
        />
      )}

      {/* Drawer móvil */}
      {isMobile && mobileNavOpen && (
        <div className="mobile-drawer-backdrop" onClick={() => setMobileNavOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.48)", zIndex: 80 }}>
          <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label={t("shell.primaryNav")} onClick={e => e.stopPropagation()} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 288, maxWidth: "86vw", background: "var(--surface)", boxShadow: "8px 0 28px -12px rgba(0,0,0,.4)", overflow: "hidden" }}>
            <Sidebar profileName={tweaks.profileName || DEFAULT_PROFILE.name} profileRole={tweaks.profileRole || t("profile.defaultRole")} route={route} setRoute={setRoute} onClose={() => setMobileNavOpen(false)} onOpenCmd={() => { setMobileNavOpen(false); setCmdOpen(true); }} style="spacious" dark={!!tweaks.dark} hiddenRoutes={hiddenRoutes} navOrderIds={navOrderIds} connectorModules={connectorModules} modulePages={modulePages} dashboards={dashboards} sshSessions={sshSessions} sshSessionStatuses={sshSessionStatuses} onFocusSession={handleFocusSSHSession} dynamicBadges={{ vms: liveVMs ? String(liveVMs.filter(v => v.monitoringEnabled !== false).length) : "", hosts: liveHosts ? String(liveHosts.length) : "", devices: deviceCount > 0 ? String(deviceCount) : "", connectors: connectorCount > 0 ? String(connectorCount) : "", calls: callsCount > 0 ? String(callsCount) : "", containers: containersCount > 0 ? String(containersCount) : "", blockCatalog: blockCatalogCount > 0 ? String(blockCatalogCount) : "", approvals: pendingApprovalCount > 0 ? String(pendingApprovalCount) : "", tags: tagCount > 0 ? String(tagCount) : "" }} />
          </div>
        </div>
      )}

      <main className="app-main" aria-label={t("shell.mainContent")} data-lintaya-surface="workspace" style={{ flex: 1, width: "100%", minWidth: 0, position: "relative", overflow: FULL_HEIGHT_ROUTES.has(route) ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
        {/* Top bar móvil */}
        {isMobile && (
          <header style={{
            position: "sticky", top: 0, zIndex: 30,
            background: "var(--surface)", borderBottom: "1px solid var(--border)",
            padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <button onClick={() => setMobileNavOpen(true)} aria-label={t("shell.menu")} style={iconBtn}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }} title={availableModules.find(module => module.route === route)?.label || window.I18N.t(`nav.${route}.label`, route === "settings" ? "Settings" : "Lintaya")}>
              <img
                src={tweaks.dark ? "assets/brand/lintaya-mark-dark.png" : "assets/brand/lintaya-mark-light.png"}
                alt="Lintaya"
                style={{ display: "block", width: "auto", height: 30, objectFit: "contain", objectPosition: "left center" }}
              />
            </div>
            <button onClick={() => setCmdOpen(true)} aria-label={t("shell.search")} style={iconBtn}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
          </header>
        )}

        {/* SSH and Settings manage their own scrolling internally — Settings so
            its rail and pane scroll independently — so the shell must not add
            a second scroll container around them. */}
        <div style={{ flex: 1, minHeight: 0, display: FULL_HEIGHT_ROUTES.has(route) ? "flex" : "block", flexDirection: "column", overflow: FULL_HEIGHT_ROUTES.has(route) ? "hidden" : "visible" }}>
          {/* route como key: remonta al navegar, para que una vista rota no
              deje su estado a medias en la siguiente. */}
          <RouteErrorBoundary route={route} key={route}>
          {route === "ssh" && (
            <SSHWorkspaceView
              sessions={sshSessions}
              onRemoveSession={handleRemoveSSHSession}
              onBack={(target) => setRoute(target || "vms")}
              onClear={() => { setSshSessions([]); setRoute("vms"); }}
              focusSessionId={focusSshSessionId}
              onFocusHandled={() => setFocusSshSessionId(null)}
              onSessionStatus={(id, status) => setSshSessionStatuses(prev => ({ ...prev, [id]: status }))}
            />
          )}
          {route === "home"      && <HomeView      onNavigate={setRoute} liveVMs={liveVMs} liveHosts={liveHosts} liveMeta={liveMeta} />}
          {route === "block-catalog" && <BlockCatalogView isMobile={isMobile} />}
          {route === "module-builder" && <window.ModuleBuilderView onNavigate={setRoute} />}
          {route === "vms"       && <VMsView       tweaks={tweaks} sshSessions={sshSessions} onOpenSSH={(vm, vaultItem) => handleOpenSSH(vm, vaultItem, "vms")} onNavigateToSSH={() => setRoute("ssh")} />}
          {route === "hosts"     && <HostsView onNavigate={setRoute} />}
          {route === "devices"   && <DevicesView onCountChange={setDeviceCount} onOpenSSH={(dev, vaultItem) => {
            // Map device → vm-compatible shape expected by handleOpenSSH / SSHWorkspaceView
            const vmShape = {
              id:       dev.id,
              name:     dev.name,
              ip:       dev.mgmtIp,
              sshUser:  dev.sshUser || "admin",
              sshPort:  dev.sshPort || 22,
              isWindows: false,
              vcenterName: dev.kind || "Device",
              os:       dev.firmware || "",
              kind:     dev.kind,
            };
            handleOpenSSH(vmShape, vaultItem, "devices");
          }} />}
          {route === "passwords" && <PasswordsView />}
          {route === "connectors" && <ConnectorsView />}
          {route === "modules" && <ConnectorModulesPage modules={connectorModules} modulePages={modulePages} onNavigate={setRoute} />}
          {route === "dashboards" && <window.DashboardCatalogView dashboards={dashboards} boards={modulePages} onNavigate={setRoute} />}
          {route.startsWith("repos-") && (() => {
            // Core repo routes bypass ConnectorModuleView, so they look their
            // own module up to learn which connection they are showing —
            // otherwise this heading reads "GitHub" for both accounts.
            const coreModule = availableModules.find(module => module.coreRoute === route);
            return <ReposView provider={route.slice("repos-".length)} connectorType={coreModule?.connectorType} connectorName={coreModule?.connectorName} />;
          })()}
          {availableModules.filter(module => module.route === route).map(module => (
            <ConnectorModuleView key={module.route} module={module} onNavigate={setRoute} />
          ))}
          {activeModulePages.filter(page => `page:${page.id}` === route).map(page => (
            <window.CustomPageView key={page.id} page={page} blockCatalog={blockCatalog} onEdit={currentPage => {
              window.__moduleBuilderIntent = currentPage || page;
              setRoute("module-builder");
            }} />
          ))}
          {activeDashboards.filter(dashboard => `dashboard:${dashboard.id}` === route).map(dashboard => (
            <window.DashboardWorkspaceView key={dashboard.id} dashboard={dashboard} boards={modulePages} blockCatalog={blockCatalog} onNavigate={setRoute} />
          ))}
          {route === "tags"       && <TagsView tweaks={tweaks} />}
          {route === "documentation" && <DocumentationView />}
          {route === "calls"      && <CallsView onNavigate={setRoute} />}
          {route === "correo"     && <MailView connectorId="outlook-local" onNavigate={setRoute} />}
          {route === "containers" && <ContainersView onNavigate={setRoute} onOpenConsole={handleOpenContainerConsole} />}
          {route === "sshlogs"    && <SshLogsView />}
          {route === "approvals"  && <window.ApprovalCenterView />}
          {route === "settings"   && <SettingsView hiddenRoutes={hiddenRoutes} onToggleRoute={toggleRoute} navOrderIds={navOrderIds} onReorderNav={reorderNav} tweaks={tweaks} onSetTweak={setTweak} />}
          {!isKnownRoute(route, availableModules, activeModulePages, activeDashboards) && <NotFoundView onHome={() => setRoute("home")} />}
        </RouteErrorBoundary>
        </div>
      </main>

      {/* Bottom nav móvil */}
      {isMobile && <BottomNav route={route} setRoute={setRoute} connectorModules={availableModules} />}

      <CommandK open={cmdOpen} onClose={() => setCmdOpen(false)} connectorModules={availableModules}
        modulePages={modulePages} dashboards={dashboards} blockCatalog={blockCatalog}
        onNavigate={(r) => { setRoute(r); setCmdOpen(false); }} />

      {/* AI Assistant — launcher solo cuando está cerrado */}
      {!chatOpen && <AILauncher onClick={() => setChatOpen(true)} isMobile={isMobile} />}
      <AIChat open={chatOpen} onClose={() => setChatOpen(false)} isMobile={isMobile} onOpenSettings={() => setRoute("settings")} />

      {/* Toasts */}
      <div role="status" aria-live="polite" aria-atomic="true" style={{ position: "fixed", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 6, zIndex: 200 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: "9px 14px",
            background: "#1c1917",
            color: "#fafaf9",
            borderRadius: 7, fontSize: 12.5, fontWeight: 500,
            boxShadow: "0 8px 20px -8px rgba(0,0,0,.3)",
            display: "flex", alignItems: "center", gap: 8,
            borderLeft: `3px solid ${t.kind === "ok" ? "var(--ok)" : "var(--accent)"}`,
            animation: "toastIn .18s ease-out",
          }}>
            {t.kind === "ok" && <span style={{ color: "var(--ok)" }}>✓</span>}
            {t.msg}
          </div>
        ))}
      </div>

      {/* Tweaks panel */}
      <TweaksPanel title={t("tweaks.title")}>
        <TweakSection label={t("tweaks.appearance")}>
          <TweakToggle
            label={t("tweaks.dark")}
            value={!!tweaks.dark}
            onChange={v => setTweak("dark", v)}
          />
          <TweakColor
            label={t("tweaks.accent")}
            value={tweaks.accent}
            options={Object.keys(ACCENTS)}
            onChange={v => setTweak("accent", v)}
          />
          <TweakRadio
            label={t("tweaks.typography")}
            value={tweaks.fontPair}
            options={[
              { value: "geist",    label: "Geist" },
              { value: "ibm",      label: "IBM Plex" },
              { value: "systemui", label: "System" },
            ]}
            onChange={v => setTweak("fontPair", v)}
          />
          <TweakRadio
            label={t("tweaks.sidebar")}
            value={tweaks.sidebarStyle}
            options={[
              { value: "spacious", label: t("tweaks.wide") },
              { value: "compact",  label: t("tweaks.compact") },
            ]}
            onChange={v => setTweak("sidebarStyle", v)}
          />
        </TweakSection>
        <TweakSection label={t("tweaks.vmsView")}>
          <TweakRadio
            label={t("tweaks.density")}
            value={tweaks.vmDensity}
            options={[
              { value: "table", label: t("tweaks.table") },
              { value: "cards", label: t("tweaks.cards") },
              { value: "mini",  label: t("tweaks.grid") },
            ]}
            onChange={v => setTweak("vmDensity", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function Sidebar({ route, setRoute, onOpenCmd, onClose, style, dark = false, hiddenRoutes = [], navOrderIds = null, onToggleCollapse, dynamicBadges = {},
  connectorModules = [], modulePages = [], dashboards = [], profileName = DEFAULT_PROFILE.name, profileRole = window.I18N.t("profile.defaultRole"),
  sshSessions = [], sshSessionStatuses = {}, onFocusSession }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const compact = style === "compact";
  // El Sidebar recibe el catálogo completo (necesita los módulos Disconnected
  // para saber qué ruta core ocultar); todo lo que se cuenta o se pinta sale
  // de este subconjunto navegable.
  const navigableModules = connectorModules.filter(module => module.available !== false);
  // Ancho arrastrable del modo spacious — mismo patrón que ResizeHandle /
  // useResizableWidth de repos.jsx, guardado aparte de compact/spacious
  // (ese toggle solo elige el PRESET; esto es el ancho fino dentro de él).
  const [openGroups, setOpenGroups] = useState(
    () => SIDEBAR_NAV_GROUPS.filter(g => g.children.includes(route)).map(g => g.id)
  );
  // Navegar a un hijo desde fuera del menú (buscador, enlace interno) abre su
  // grupo: si no, la ruta activa quedaría marcada dentro de un grupo cerrado.
  useEffect(() => {
    const g = SIDEBAR_NAV_GROUPS.find(x => x.children.includes(route));
    if (g) setOpenGroups(prev => prev.includes(g.id) ? prev : [...prev, g.id]);
  }, [route]);
  const SIDEBAR_MIN = 180, SIDEBAR_MAX = 420, SIDEBAR_DEFAULT = 232;
  const [spaciousWidth, setSpaciousWidth] = useState(() => {
    const saved = Number(localStorage.getItem("hq.sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT;
  });
  const spaciousWidthRef = useRef(spaciousWidth);
  spaciousWidthRef.current = spaciousWidth;
  const width = compact ? 60 : spaciousWidth;
  const onSidebarResizeStart = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = spaciousWidthRef.current;
    let current = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      current = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX)));
      setSpaciousWidth(current);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem("hq.sidebarWidth", String(current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [pinnedRepos, setPinnedRepos] = useState({});

  useEffect(() => {
    const loadPinned = () => {
      const ids = navigableModules
        .filter(module => module.component === "ReposView")
        .map(module => module.connectorId);
      if (ids.length === 0) { setPinnedRepos({}); return; }
      Promise.all(ids.map(id => window.HQ_API.request(`/api/connectors/${id}/pinned-repos`).catch(() => [])))
        .then(results => {
          const map = {};
          ids.forEach((id, i) => { map[id] = results[i]; });
          setPinnedRepos(map);
        });
    };
    loadPinned();
    window.addEventListener("hq:repo-settings-changed", loadPinned);
    return () => window.removeEventListener("hq:repo-settings-changed", loadPinned);
  }, [connectorModules]);

  const openPinnedRepo = (provider, id) => {
    window.__pendingRepoOpen = id;
    window.dispatchEvent(new CustomEvent("hq:open-repo", { detail: { id } }));
    setRoute(`repos-${provider}`);
  };
  // Icon and badge for core routes. Connector-owned views carry their own icon
  // and arrive from the authenticated modules catalog.
  const ROUTE_ICONS = {
    home: ICONS.home, vms: ICONS.vms, containers: ICONS.containers, hosts: ICONS.hosts,
    devices: ICONS.devices, passwords: ICONS.passwords,
    connectors: ICONS.connectors, modules: ICONS["block-catalog"], dashboards: ICONS.boards,
    "repos-gitlab": ICONS.repos, "repos-github": ICONS.repos, "repos-bitbucket": ICONS.repos,
    tags: ICONS.tags, sshlogs: ICONS.sshlogs, approvals: ICONS.shield,
    calls: ICONS.calls, correo: ICONS.mail, "block-catalog": ICONS.cube,
  };
  const ROUTE_BADGES = {
    vms: dynamicBadges.vms || "",
    "block-catalog": dynamicBadges.blockCatalog || "",
    containers: dynamicBadges.containers || "",
    hosts: dynamicBadges.hosts || "",
    devices: dynamicBadges.devices || "",
    connectors: dynamicBadges.connectors || "",
    modules: navigableModules.length ? String(navigableModules.length) : "",
    dashboards: dashboards.length ? String(dashboards.length) : "",
    tags: dynamicBadges.tags || "",
    calls: dynamicBadges.calls || "",
    approvals: dynamicBadges.approvals || "",
  };
  // Una ruta marcada connectorOwned solo se muestra si algún módulo disponible
  // la publica. Cubre los dos casos con una sola regla: el conector está pero
  // Disconnected — no puede servir la vista, y sigue configurable en Connectors —
  // y el conector no está instalado en absoluto (ADR-014), que antes se colaba
  // porque sin módulo no había coreRoute que ocultar y el menú terminaba
  // ofreciendo una página que nadie podía llenar.
  // Guarda el módulo entero, no solo la ruta: es también quien sabe cómo se
  // llama esa conexión. Una ruta core se etiquetaba con un texto fijo, así que
  // dos conexiones del mismo tipo se leían distinto en el menú — la base con
  // el nombre genérico del tipo y la extra con el suyo.
  const publishedCoreRoutes = new Map(
    connectorModules.filter(module => module.coreRoute && module.available !== false)
                    .map(module => [module.coreRoute, module])
  );
  // A user-set order (Settings → Navegación, up/down arrows) overrides the
  // hardcoded CORE_NAV_ORDER — rank is just position in that saved list.
  const coreNavRank = navOrderIds && navOrderIds.length
    ? Object.fromEntries(navOrderIds.map((id, i) => [id, i * 10]))
    : null;
  const coreItems = NAV_ROUTES
    .filter(route => !route.connectorOwned || publishedCoreRoutes.has(route.id))
    .map((route) => {
    const provider = route.id.startsWith("repos-") ? route.id.slice("repos-".length) : null;
    return {
      id: route.id,
      // El nombre de la conexión gana sobre el del tipo: si el usuario la
      // renombró, el menú lo dice. Sin conector detrás (Home, Devices…) no hay
      // módulo y se queda el texto de siempre.
      label: publishedCoreRoutes.has(route.id)
        ? window.I18N.tModuleLabel(publishedCoreRoutes.get(route.id))
        : t(`nav.${route.id}.label`, route.id),
      icon: ROUTE_ICONS[route.id],
      badge: ROUTE_BADGES[route.id] || "",
      navOrder: coreNavRank ? (coreNavRank[route.id] ?? 200) : (CORE_NAV_ORDER[route.id] ?? 200),
      ...(provider ? { connectorId: provider, component: "ReposView" } : {}),
    };
  });
  const allItems = [...coreItems, ...connectorModules
    .filter(module => module.connectorId !== module.connectorType && module.available !== false)
    .map(module => ({
    id: module.route,
    // Misma traducción que reciben las rutas core: si no, una conexión base y
    // una extra del mismo tipo se leen con dos formatos distintos en el menú.
    label: window.I18N.tModuleLabel(module),
    icon: ICONS[module.icon] || ICONS.connectors,
    badge: module.component === "CallsView" ? dynamicBadges.calls || "" : "",
    navOrder: module.navOrder,
    connectorId: module.connectorId,
    component: module.component,
  })), ...dashboards.filter(dashboard => dashboard.active && dashboard.showInSidebar !== false).map((dashboard, i) => ({
    id: `dashboard:${dashboard.id}`,
    label: dashboard.title,
    icon: ICONS[dashboard.icon] || ICONS.grid,
    badge: String(dashboard.boardIds?.length || ""),
    navOrder: 480 + i,
  })), ...modulePages.filter(page => page.active && page.showInSidebar !== false).map((page, i) => ({
    id: `page:${page.id}`,
    label: page.title,
    icon: ICONS[page.icon] || ICONS.grid,
    badge: "",
    navOrder: 500 + i,
  }))].sort((left, right) => left.navOrder - right.navOrder || left.label.localeCompare(right.label));
  const items = allItems
    .filter(it => !hiddenRoutes.includes(it.id))
    .filter((item, index, list) => list.findIndex(candidate => candidate.id === item.id) === index);
  // El rail compacto es solo íconos: ahí no hay dónde anidar ni espacio para el
  // chevron, así que los hijos se quedan planos como estaban.
  const groupOf = new Map();
  if (!compact) SIDEBAR_NAV_GROUPS.forEach(g => g.children.forEach(id => groupOf.set(id, g)));
  const nodes = [];
  const placed = new Set();
  for (const it of items) {
    const g = groupOf.get(it.id);
    if (!g) { nodes.push({ kind: "item", item: it, navOrder: it.navOrder }); continue; }
    if (placed.has(g.id)) continue;
    placed.add(g.id);
    const children = items.filter(candidate => groupOf.get(candidate.id) === g);
    nodes.push({ kind: "group", group: g, children, navOrder: Math.min(...children.map(c => c.navOrder)) });
  }
  nodes.sort((left, right) => left.navOrder - right.navOrder);
  const navList = [];
  for (const node of nodes) {
    // Un grupo de un solo hijo cuesta un clic y una fila para no esconder nada:
    // con pocos conectores conectados, Infra sería un envoltorio de Devices y
    // Workspace o Repos ni existirían. En ese caso se pinta el hijo suelto.
    if (node.kind === "item" || node.children.length < 2) {
      navList.push({ kind: "item", item: node.kind === "item" ? node.item : node.children[0] });
      continue;
    }
    navList.push({ kind: "group", group: node.group });
    for (const child of node.children) navList.push({ kind: "item", item: child, nested: true });
  }
  const firstGroupIndex = navList.findIndex(entry => entry.kind === "group");
  // El handle solo aplica al sidebar de escritorio en modo spacious — el
  // drawer móvil (onClose presente) y el modo compact (rail de íconos fijo)
  // no se redimensionan a mano.
  const showResizeHandle = !compact && !onClose;
  return (
    <>
    <aside className="app-sidebar" style={{
      width, flexShrink: 0,
      height: "100%", minHeight: 0, overflow: "hidden",
      background: "var(--surface)",
      borderRight: showResizeHandle ? "none" : "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      transition: "width .15s ease",
    }}>
      {/* Brand + toggle */}
      <div style={{ minHeight: "var(--header-h)", padding: compact ? "8px 7px" : "8px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)", position: "relative" }}>
        {dark && (
          // Destello de faro: la mayor parte del ciclo queda tenue, con un pico breve
          // de brillo — imita un beacon real en vez de un "respirar" parejo.
          <style>{`
            @keyframes lintaya-beacon-flash {
              0%, 100% { filter: brightness(1) drop-shadow(0 0 2px rgba(34,211,238,.35)); }
              6%       { filter: brightness(1.45) drop-shadow(0 0 16px rgba(34,211,238,.95)); }
              14%      { filter: brightness(1) drop-shadow(0 0 2px rgba(34,211,238,.35)); }
            }
          `}</style>
        )}
        {compact ? (
          <img
            src={dark ? "assets/brand/lintaya-mark-dark.png" : "assets/brand/lintaya-mark-light.png"}
            alt="Lintaya"
            title="Lintaya"
            style={{
              width: 36, height: 36, objectFit: "contain", flexShrink: 0,
              transition: "opacity .18s ease",
              animation: dark ? "lintaya-beacon-flash 3.6s ease-in-out infinite" : "none",
            }}
          />
        ) : (
          // El wordmark completo vive partido en dos assets (icono "L" + texto "INTAYA")
          // para que el destello del faro anime SOLO el icono, no el texto entero.
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 32 }}>
            <img
              src={dark ? "assets/brand/lintaya-icon-dark.png" : "assets/brand/lintaya-icon-light.png"}
              alt="Lintaya"
              style={{
                height: 32, width: "auto", objectFit: "contain", flexShrink: 0,
                transition: "opacity .18s ease",
                animation: dark ? "lintaya-beacon-flash 3.6s ease-in-out infinite" : "none",
              }}
            />
            <div style={{ position: "relative", height: 17, flexShrink: 0 }}>
              <img
                src={dark ? "assets/brand/lintaya-wordmark-dark.png" : "assets/brand/lintaya-wordmark-light.png"}
                alt="Lintaya"
                style={{ height: 17, width: "auto", objectFit: "contain", display: "block" }}
              />
              {/* Triángulos de la "A" recortados aparte del wordmark (que tiene ese
                  hueco transparente) para poder encenderlos con el mismo destello. */}
              <img
                src={dark ? "assets/brand/lintaya-triangles-dark.png" : "assets/brand/lintaya-triangles-light.png"}
                alt=""
                style={{
                  position: "absolute",
                  left: dark ? "51.4%" : "50.9%", top: dark ? "56.6%" : "55.8%",
                  width: dark ? "41.0%" : "41.9%", height: dark ? "40.7%" : "44.2%",
                  objectFit: "fill",
                  animation: dark ? "lintaya-beacon-flash 3.6s ease-in-out infinite" : "none",
                }}
              />
            </div>
          </div>
        )}
        {onClose && (
          <button onClick={onClose} aria-label={t("shell.closeMenu")} title={t("shell.closeMenu")} style={{
            marginLeft: "auto", width: 34, height: 34, borderRadius: 8,
            background: "var(--muted)", border: "1px solid var(--border)",
            cursor: "pointer", color: "var(--fg)", flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>
          </button>
        )}
      </div>

      {/* Search trigger + plegado del panel. El control del panel vive sobre
          el panel y no en la cabecera: así la marca se queda sola con ella y
          el botón sigue a mano en los dos estados. column-reverse al plegar
          lo sube encima del buscador sin tener que pintarlo dos veces. */}
      <div style={{
        margin: 10, display: "flex", gap: 8, alignItems: "stretch",
        flexDirection: compact ? "column-reverse" : "row",
      }}>
        <button onClick={onOpenCmd} style={{
          flex: 1, minWidth: 0, padding: compact ? "8px 6px" : "7px 10px",
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--muted)", border: "1px solid var(--border)",
          borderRadius: 6, cursor: "pointer", fontSize: 12, color: "var(--muted-fg)",
          fontFamily: "inherit",
          justifyContent: compact ? "center" : "flex-start",
        }}>
          {ICONS.search}
          {/* Sin el badge ⌃K: compartiendo la fila con el botón, el texto se
              quedaba con 0,2 px de holgura. El atajo sigue funcionando. */}
          {!compact && <span style={{ flex: 1, textAlign: "left" }}>{t("cmdk.searchShort", "Search…")}</span>}
        </button>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse}
            aria-label={compact ? window.I18N.t("ui.shell.expandMenu", "Expand menu") : window.I18N.t("ui.shell.collapseMenu", "Collapse menu")}
            title={compact ? window.I18N.t("ui.shell.expandMenu", "Expand menu") : window.I18N.t("ui.shell.collapseMenu", "Collapse menu")}
            style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0, alignSelf: "center",
              background: "var(--muted)", border: "1px solid var(--border)",
              cursor: "pointer", color: "var(--fg)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              transition: "background .12s, color .12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--accent)"; e.currentTarget.style.color = "white"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--muted)"; e.currentTarget.style.color = "var(--fg)"; }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="9" y1="4" x2="9" y2="20"/>
              {compact
                ? <polyline points="13 9 16 12 13 15"/>
                : <polyline points="16 9 13 12 16 15"/>}
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
        <nav className="app-sidebar-nav" aria-label={t("nav.workspace", "Workspace navigation")} style={{ padding: "4px 8px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        {navList.map((entry, index) => {
          if (entry.kind === "group") {
            const g = entry.group;
            const open = openGroups.includes(g.id);
            // Una linea donde arranca la zona agrupada, separandola de las rutas
            // sueltas de arriba. Si un grupo quedara primero del todo no se pinta:
            // una raya pegada al borde superior del menu no separa nada.
            const opensSection = index === firstGroupIndex && index > 0;
            // El padre no navega a ninguna parte: no existe una página Builder,
            // solo agrupa. Por eso abre y cierra en vez de llamar a setRoute, y
            // se marca en color cuando la ruta activa es uno de sus hijos.
            const childActive = g.children.includes(route);
            return (
              <React.Fragment key={"group:" + g.id}>
              {opensSection && <div aria-hidden="true" style={{ height: 1, background: "var(--border)", margin: "8px 2px" }} />}
              <button
                onClick={() => setOpenGroups(prev => prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id])}
                aria-expanded={open}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", background: "transparent",
                  border: 0, borderRadius: 6, cursor: "pointer",
                  color: childActive ? "var(--accent)" : "var(--fg)",
                  fontSize: 13, fontFamily: "inherit", fontWeight: childActive ? 600 : 500,
                  position: "relative", textAlign: "left",
                }}>
                <span style={{ flexShrink: 0 }}>{ICONS[g.icon]}</span>
                <span style={{ flex: 1 }}>{t("nav." + g.id + ".label", g.id)}</span>
                <span style={{
                  flexShrink: 0, display: "inline-flex", color: "var(--muted-fg)",
                  transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease",
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                </span>
              </button>
              </React.Fragment>
            );
          }
          const it = entry.item;
          if (entry.nested && !openGroups.includes(groupOf.get(it.id).id)) return null;
          const active = route === it.id;
          return (
            <React.Fragment key={it.id}>
              <button
                onClick={() => setRoute(it.id)}
                title={compact ? it.label : ""}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  marginLeft: entry.nested ? 14 : 0,
                  padding: compact ? "8px 6px" : "8px 10px",
                  background: active ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "transparent",
                  border: 0, borderRadius: 6, cursor: "pointer",
                  color: active ? "var(--accent)" : "var(--fg)",
                  fontSize: 13, fontFamily: "inherit", fontWeight: active ? 600 : 500,
                  position: "relative", textAlign: "left",
                  justifyContent: compact ? "center" : "flex-start",
                }}>
                {active && <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 2, background: "var(--accent)", borderRadius: 2 }} />}
                <span style={{ flexShrink: 0 }}>{it.icon}</span>
                {!compact && <>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.badge && (() => {
                    const isApprovalPending = it.id === "approvals" && !active;
                    return (
                      <span style={{
                        fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                        padding: "1px 6px", borderRadius: 999,
                        background: active ? "color-mix(in srgb, var(--accent) 18%, var(--surface))" : isApprovalPending ? "#fef3c7" : "var(--muted)",
                        color: active ? "var(--accent)" : isApprovalPending ? "#b45309" : "var(--muted-fg)",
                      }}>{it.badge}</span>
                    );
                  })()}
                </>}
              </button>
              {!compact && it.component === "ReposView" && (() => {
                const provider = it.connectorId;
                const list = pinnedRepos[provider] || [];
                if (!list.length) return null;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "1px 0 3px 30px" }}>
                    {list.map(r => (
                      <button key={r.id} onClick={() => openPinnedRepo(provider, r.id)} title={r.path} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 8px", border: 0, borderRadius: 5, background: "transparent",
                        color: "var(--muted-fg)", fontSize: 11.5, fontFamily: "var(--font-mono)",
                        textAlign: "left", cursor: "pointer",
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                      onMouseLeave={e => e.currentTarget.style.color = "var(--muted-fg)"}>
                        <span style={{ opacity: .6, flexShrink: 0 }}>↳</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* Open SSH sessions started from this nav item — same nested
                  sub-item pattern as pinned repos above, so an active
                  connection to a device or VM shows up right where you
                  opened it instead of only inside SSH Workspace. */}
              {!compact && (it.id === "devices" || it.id === "vms" || it.id === "containers") && (() => {
                const list = sshSessions.filter(s => s.source === it.id);
                if (!list.length) return null;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "1px 0 3px 30px" }}>
                    {list.map(s => {
                      // Reflects the real connection state (from
                      // SSHWorkspaceView's onSessionStatus), not just "is
                      // SSH Workspace the current page" — so a rejected
                      // credential or dropped connection is visible right
                      // from Devices/VMs, not only after opening the tab.
                      const st = sshSessionStatuses[s.id];
                      const isProblem = st === "error" || st === "authfail";
                      const isConnecting = st === "connecting" || st === "loading";
                      const isConnected = st === "connected";
                      const fg = isProblem ? "#dc2626" : isConnecting ? "#d97706" : isConnected ? "#16a34a" : "var(--muted-fg)";
                      const bg = isProblem ? "color-mix(in srgb, #dc2626 10%, transparent)"
                        : isConnecting ? "color-mix(in srgb, #d97706 10%, transparent)"
                        : isConnected ? "color-mix(in srgb, var(--ok) 10%, transparent)" : "transparent";
                      return (
                        <button key={s.id} onClick={() => onFocusSession?.(s.id)}
                          title={isProblem ? `${s.vm.name} — connection problem` : s.vm.name}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "5px 8px", border: 0, borderRadius: 5,
                            background: bg, color: fg, fontSize: 11.5, fontFamily: "var(--font-mono)",
                            textAlign: "left", cursor: "pointer",
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                          onMouseLeave={e => e.currentTarget.style.color = fg}>
                          <span style={{ opacity: .6, flexShrink: 0 }}>{isProblem ? "✕" : "↳"}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.vm.name}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </React.Fragment>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", padding: 10, borderTop: "1px solid var(--border)" }}>
        {!compact ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 999, background: "var(--accent)", color: "white",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 12, fontFamily: "var(--font-mono)",
            }}>{profileInitials(profileName)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileName}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileRole}</div>
            </div>
            <button
              onClick={() => setRoute("documentation")}
              style={{ background: route === "documentation" ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "none", border: 0, cursor: "pointer", color: route === "documentation" ? "var(--accent)" : "var(--muted-fg)", padding: 4, borderRadius: 5 }}
              title={t("nav.documentation.label")}
            >
              {ICONS.documentation}
            </button>
            <button
              onClick={() => setRoute("settings")}
              style={{ background: route === "settings" ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "none", border: 0, cursor: "pointer", color: route === "settings" ? "var(--accent)" : "var(--muted-fg)", padding: 4, borderRadius: 5 }}
              title={t("nav.settings.label")}
            >
              {ICONS.settings}
            </button>
          </div>
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: 999, background: "var(--accent)", color: "white", margin: "0 auto",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 12, fontFamily: "var(--font-mono)",
          }}>MR</div>
        )}
      </div>
    </aside>
    {showResizeHandle && <ResizeHandle onMouseDown={onSidebarResizeStart} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
