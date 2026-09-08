// Conectores — estado de cada integración (vCenter, UCS, GitLab, Jira, etc.)
const { useState, useMemo, useEffect, useCallback, useRef } = React;

// Logos de marca reales para GitLab/GitHub, en vez del monograma de 2 letras que
// usan el resto de conectores — se insertan donde antes iba {conn.icon}/{ct.icon}.
function GitlabLogoIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 380 380" xmlns="http://www.w3.org/2000/svg">
      <path fill="#e24329" d="M265.26416,174.37243l-.2134-.55822-21.19899-55.30908c-.4236-1.08359-1.18542-1.99642-2.17699-2.62689-.98837-.63373-2.14749-.93253-3.32305-.87014-1.1689.06239-2.29195.48925-3.20809,1.21821-.90957.73554-1.56629,1.73047-1.87493,2.85346l-14.31327,43.80662h-57.90965l-14.31327-43.80662c-.30864-1.12299-.96536-2.11791-1.87493-2.85346-.91614-.72895-2.03911-1.15582-3.20809-1.21821-1.17548-.06239-2.33468.23641-3.32297.87014-.99166.63047-1.75348,1.5433-2.17707,2.62689l-21.19891,55.31237-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392,15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024,32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z" />
      <path fill="#fc6d26" d="M265.26416,174.37243l-.2134-.55822c-10.5174,2.16062-20.20405,6.6099-28.49844,12.81593-.1346.0985-25.20497,19.05805-46.55171,35.19699,15.84998,11.98517,29.6477,22.40405,29.6477,22.40405l32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z" />
      <path fill="#fca326" d="M160.34962,244.23117l15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024s-13.79772-10.41888-29.6477-22.40405c-15.85327,11.98517-29.65099,22.40405-29.65099,22.40405Z" />
      <path fill="#fc6d26" d="M143.44561,186.63014c-8.29111-6.20274-17.97446-10.65531-28.49507-12.81264l-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392s13.79772-10.41888,29.65099-22.40405c-21.34673-16.13894-46.42031-35.09848-46.55499-35.19699Z" />
    </svg>
  );
}

function GithubLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path fill="white" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function BitbucketLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path fill="white" d="M2.24 2A1.13 1.13 0 001.12 3.34l4.06 24.65a1.47 1.47 0 001.44 1.23h18.75a1.1 1.1 0 001.1-.92L30.88 3.35A1.13 1.13 0 0029.76 2zM19.2 20.13h-6.37L11 11.86h10.16z" />
    </svg>
  );
}

// Marca oficial de Plane.so — glifo recortado (sin el fondo oscuro propio del ícono
// original) para que se vea limpio sobre el mismo badge naranja con gradiente que
// ya usan el resto de conectores genéricos.
function PlaneLogoIcon({ size = 20 }) {
  return <img src="assets/connectors/plane-mark.png" alt="" width={size} height={size} style={{ objectFit: "contain", display: "block" }} />;
}

// Iconos de marca (Simple Icons, un solo path monocromo) para vCenter/Bitwarden/Portainer.
// Ícono oficial de vSphere (blogs.vmware.com) para el conector vCenter — glifo
// verde/amarillo recortado (fondo blanco removido), igual que Plane/Portainer.
function VMwareLogoIcon({ size = 20 }) {
  return <img src="assets/connectors/vsphere-mark.png" alt="" width={size} height={size} style={{ objectFit: "contain", display: "block" }} />;
}

function BitwardenLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="white" d="M21.722.296A.964.964 0 0 0 21.018 0H2.982a.959.959 0 0 0-.703.296.96.96 0 0 0-.297.702v12c0 .895.174 1.783.523 2.665.349.88.783 1.66 1.3 2.345.517.68 1.132 1.346 1.848 1.993a21.807 21.807 0 0 0 1.98 1.609c.605.427 1.235.83 1.893 1.212.657.381 1.125.638 1.4.772.276.134.5.241.664.311a.916.916 0 0 0 .814 0c.168-.073.389-.177.667-.311.275-.134.743-.394 1.401-.772a25.305 25.305 0 0 0 1.894-1.212A21.891 21.891 0 0 0 18.348 20c.716-.647 1.33-1.31 1.847-1.993s.949-1.463 1.3-2.345c.35-.879.524-1.767.524-2.665V1.001a.95.95 0 0 0-.297-.705zm-2.325 12.815c0 4.344-7.397 8.087-7.397 8.087V2.57h7.397v10.54z" />
    </svg>
  );
}

// Marca oficial de Portainer (grúa formando la "P") — igual que Plane, glifo
// recortado del PNG oficial (downloads.portainer.io) en blanco sobre transparente.
function PortainerLogoIcon({ size = 20 }) {
  return <img src="assets/connectors/portainer-mark.png" alt="" width={size} height={size} style={{ objectFit: "contain", display: "block" }} />;
}

// Marca oficial de Cisco (Simple Icons) — usada para el conector UCS Manager.
function CiscoLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="white" d="M16.331 18.171V17.06l-.022.01c-.25.121-.522.19-.801.203a1.186 1.186 0 01-.806-.237 1.038 1.038 0 01-.352-.498 1.21 1.21 0 01-.023-.667c.052-.225.178-.426.357-.569.16-.134.355-.218.562-.242a1.85 1.85 0 011.061.198l.024.013v-1.117l-.051-.014a2.862 2.862 0 00-1.011-.132 2.34 2.34 0 00-.903.206c-.287.132-.54.327-.739.571a2.221 2.221 0 00-.04 2.705c.295.378.709.645 1.175.756.491.12 1.006.102 1.487-.052l.082-.023M5.336 18.171V17.06l-.022.01c-.25.121-.522.19-.801.203a1.183 1.183 0 01-.806-.237 1.03 1.03 0 01-.351-.498 1.202 1.202 0 01-.024-.667c.052-.225.177-.426.357-.569.16-.134.355-.218.562-.242a1.85 1.85 0 011.061.198l.024.013v-1.117l-.051-.014a2.862 2.862 0 00-1.011-.132 2.344 2.344 0 00-.903.206 2.08 2.08 0 00-.74.571 2.224 2.224 0 00-.041 2.705 2.11 2.11 0 001.176.756c.491.12 1.005.102 1.487-.052l.083-.023M9.26 17.249l-.004.957.07.012c.22.041.441.069.664.085.195.019.391.022.587.012.187-.014.372-.049.551-.104.21-.06.405-.163.571-.305a1.16 1.16 0 00.333-.478 1.31 1.31 0 00-.007-.96 1.068 1.068 0 00-.298-.414 1.261 1.261 0 00-.438-.255l-.722-.268a.388.388 0 01-.197-.188.245.245 0 01.008-.219.382.382 0 01.154-.142.798.798 0 01.257-.074c.153-.022.308-.021.46.005.18.02.358.051.533.096l.038.008v-.883l-.069-.015a4.749 4.749 0 00-.543-.097 2.844 2.844 0 00-.714-.003c-.3.027-.585.143-.821.33-.16.126-.281.293-.351.484-.104.29-.105.608 0 .899.054.145.14.274.252.381.097.093.207.173.327.236.157.084.324.149.497.195.057.017.114.035.17.054l.085.031.024.01c.084.03.162.078.226.14.045.042.08.094.101.151a.325.325 0 01.001.161.339.339 0 01-.166.198.856.856 0 01-.275.086 2.032 2.032 0 01-.427.021 5.208 5.208 0 01-.557-.074 9.195 9.195 0 01-.287-.067l-.033-.006zm-2.475.995h1.05v-4.167h-1.05v4.167zm12.162-2.936a1.095 1.095 0 011.541.158 1.094 1.094 0 01-.157 1.541l-.017.014a1.096 1.096 0 01-1.367-1.713m-1.525.854a2.193 2.193 0 002.666 2.107 2.139 2.139 0 00.701-3.937 2.207 2.207 0 00-3.367 1.83M22.961 10.728a.52.52 0 001.039 0V9.573a.52.52 0 00-1.039 0v1.155M20.117 10.728a.522.522 0 001.041 0V8.139a.521.521 0 00-1.04 0v2.589M17.231 11.771a.521.521 0 001.039 0V6.17a.52.52 0 00-1.039 0v5.601M14.393 10.728a.521.521 0 001.04 0V8.139a.52.52 0 00-1.039 0v2.589M11.494 10.728a.522.522 0 001.039 0V9.573a.52.52 0 00-1.039 0v1.155M8.624 10.728a.52.52 0 001.039 0V8.139a.52.52 0 00-1.039 0v2.589M5.737 11.771a.52.52 0 001.039 0V6.17a.52.52 0 00-1.039 0v5.601M2.876 10.728a.522.522 0 001.04 0V8.139a.52.52 0 00-1.039 0v2.589M0 10.728a.521.521 0 001.039 0V9.573a.52.52 0 00-1.039 0v1.155" />
    </svg>
  );
}

// Marca oficial de Outline (Simple Icons).
function OutlineLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="white" d="M 15.081 21.857 L 15.081 22.459 C 15.081 23.636 13.812 24.378 12.785 23.8 L 3.543 18.602 C 3.058 18.329 2.758 17.816 2.758 17.26 L 2.758 6.742 C 2.758 6.185 3.058 5.672 3.543 5.399 L 12.785 0.201 C 13.812 -0.378 15.082 0.365 15.081 1.544 L 15.081 2.145 L 16.178 1.814 C 17.167 1.517 18.163 2.258 18.162 3.29 L 18.162 3.915 L 19.511 3.746 C 20.431 3.632 21.243 4.348 21.242 5.275 L 21.242 18.726 C 21.243 19.652 20.431 20.37 19.511 20.254 L 18.162 20.085 L 18.162 20.71 C 18.163 21.743 17.167 22.484 16.178 22.186 L 15.081 21.857 Z M 15.081 20.249 L 16.621 20.71 L 16.621 3.29 L 15.081 3.753 L 15.081 20.249 Z M 18.162 5.467 L 18.162 18.534 L 19.702 18.726 L 19.702 5.275 L 18.162 5.467 Z M 2.758 16.801 L 2.758 7.2 L 2.758 16.801 Z M 4.298 6.742 L 4.298 17.26 L 13.54 22.459 L 13.54 1.544 L 4.298 6.742 Z M 5.838 7.765 L 7.379 6.995 L 7.379 17.005 L 5.838 16.235 L 5.838 7.765 Z" />
    </svg>
  );
}

// Anthropic's mark (Simple Icons).
function AnthropicLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="white" d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 10.42L8.453 7.687 6.205 13.94H10.7z" />
    </svg>
  );
}

// `size` es opcional — sin él, cada Logo usa su propio default (los mismos
// que ya se ven en esta pantalla). block-catalog.jsx sí lo pasa, para encajar
// el logo real dentro de un badge de otro tamaño (ver window.connectorIconContent).
function connectorIconContent(id, icon, size) {
  if (id === "anthropic") return <AnthropicLogoIcon size={size} />;
  if (id === "gitlab") return <GitlabLogoIcon size={size} />;
  if (id === "github") return <GithubLogoIcon size={size} />;
  if (id === "bitbucket") return <BitbucketLogoIcon size={size} />;
  if (id === "plane") return <PlaneLogoIcon size={size} />;
  if (id === "vcenter" || id === "vc-mex" || id === "vmware") return <VMwareLogoIcon size={size} />;
  if (id === "bw" || id === "bitwarden") return <BitwardenLogoIcon size={size} />;
  if (id === "portainer") return <PortainerLogoIcon size={size} />;
  if (id === "outline") return <OutlineLogoIcon size={size} />;
  if (id === "ucsm") return <CiscoLogoIcon size={size} />;
  return icon;
}

// Product edition is intentionally independent from connection health and from
// the provider logo. The API manifest is the source of truth; this map keeps
// catalog entries and older servers compatible during the migration.
const CONNECTOR_TIER_BY_ID = Object.freeze({
  anthropic: "community",
  github: "community",
  gitlab: "community",
  bitbucket: "community",
  plane: "community",
  outline: "community",
  portainer: "community",
  bw: "community",
  bitwarden: "community",
  ucsm: "enterprise",
  "vc-mex": "enterprise", // compatibility with installations before the generic ID migration
  vcenter: "enterprise",
  vmware: "enterprise",
  qportal: "enterprise",
  outlook: "development",
});

// Un solo gris claro neutro para las tres — antes cada tier tenía su propio color
// (teal/violeta/ámbar) y quedaba muy cargado junto al resto de badges de la UI.
const CONNECTOR_TIER_COLOR = "#9ca3af";
const CONNECTOR_TIER_BG = "color-mix(in srgb, #9ca3af 14%, var(--surface, white))";
const CONNECTOR_TIER_META = Object.freeze({
  community: {
    label: "Comunitario",
    shortLabel: "Community",
    color: CONNECTOR_TIER_COLOR,
    bg: CONNECTOR_TIER_BG,
  },
  enterprise: {
    label: "Empresarial",
    shortLabel: "Business",
    color: CONNECTOR_TIER_COLOR,
    bg: CONNECTOR_TIER_BG,
  },
  development: {
    label: "En desarrollo",
    shortLabel: "In development",
    color: CONNECTOR_TIER_COLOR,
    bg: CONNECTOR_TIER_BG,
  },
});

function connectorTier(id, declaredTier) {
  if (CONNECTOR_TIER_META[declaredTier]) return declaredTier;
  return CONNECTOR_TIER_BY_ID[id] || null;
}

function ConnectorTierIcon({ tier, size = 13 }) {
  if (tier === "community") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="7" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="14.3" cy="7.5" r="1.9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.8 15.5c.5-3 2-4.5 4.4-4.5 2.5 0 4 1.5 4.4 4.5M11.8 12c.7-.7 1.5-1 2.5-1 1.7 0 2.8 1.2 3.1 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (tier === "enterprise") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 17V4.2L10 2v15M10 6h6v11M2.5 17h15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 6.2h1M6.5 9.2h1M6.5 12.2h1M12.5 9h1M12.5 12h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 5.7v4.7l3.2 1.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConnectorTierBadge({ id, tier: explicitTier, compact = false }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const tier = connectorTier(id, explicitTier);
  const meta = CONNECTOR_TIER_META[tier];
  if (!meta) return null;
  const label = t(`connectors.tier.${tier}`, meta.label);
  return (
    <span title={t("connectors.tier.type", "", { label })} style={{
      display: "inline-flex", alignItems: "center", gap: compact ? 0 : 4,
      width: compact ? 22 : "max-content", height: 22,
      justifyContent: "center", padding: compact ? 0 : "0 7px",
      borderRadius: 999, border: `1px solid color-mix(in srgb, ${meta.color} 28%, var(--border))`,
      background: meta.bg, color: meta.color,
      fontSize: 10, fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap",
      fontFamily: "var(--font-mono)",
    }}>
      <ConnectorTierIcon tier={tier} size={12} />
      {!compact && label}
    </span>
  );
}

const STATUS_META = {
  ok:      { label: "Connected",     dot: "var(--ok)",      bg: "color-mix(in srgb, var(--ok) 14%, white)",   fg: "var(--ok)",      icon: "●" },
  warn:    { label: "Warning",       dot: "var(--warn)",    bg: "color-mix(in srgb, var(--warn) 16%, white)", fg: "#9a6f00",        icon: "▲" },
  error:   { label: "Error",         dot: "var(--err)",     bg: "color-mix(in srgb, var(--err) 14%, white)",  fg: "var(--err)",     icon: "✕" },
  offline: { label: "Disconnected",  dot: "var(--muted-fg)", bg: "var(--muted)",                              fg: "var(--muted-fg)", icon: "○" },
};
// Reused by app.jsx's ConnectorModulesPage (Módulos) so its status pills match
// this page's exactly — connectors.jsx loads before app.jsx in Lintaya.html.
window.STATUS_META = STATUS_META;

// Descriptor por tipo para los 8 conectores "simples" e instantiable — única
// parte que cambia entre ellos en el dispatcher genérico de onPulse (ver
// ADR-008/CONN-017 en el roadmap interno). `test`/`sync` reciben la
// respuesta del backend y devuelven { fields, detail } (o { fields, detail,
// itemsSynced } para sync) — `fields` se mezcla en liveStatuses, `detail` es
// el fragmento de texto que log/toast insertan tal cual.
const SIMPLE_ONPULSE = {
  gitlab: {
    displayName: "GitLab",
    test: r => ({ fields: { user: r.user }, detail: r.user }),
    sync: r => ({
      fields: { projects: r.projects, deployments: r.deployments },
      detail: `${r.projectCount} repos, ${r.deploymentCount} despliegues, ${r.commitCount} commits`,
      itemsSynced: r.total,
    }),
  },
  github: {
    displayName: "GitHub",
    test: r => ({ fields: { user: r.user }, detail: r.user }),
    sync: r => ({
      fields: { projects: r.projects, deployments: r.deployments },
      detail: `${r.projectCount} repos, ${r.deploymentCount} despliegues, ${r.commitCount} commits`,
      itemsSynced: r.total,
    }),
  },
  bitbucket: {
    displayName: "Bitbucket",
    test: r => ({ fields: { user: r.user }, detail: r.user }),
    sync: r => ({
      fields: { projects: r.projects, deployments: r.deployments },
      detail: `${r.projectCount} repos, ${r.commitCount} commits`,
      itemsSynced: r.total,
    }),
  },
  outline: {
    displayName: "Outline",
    test: r => ({ fields: { user: r.user, team: r.team }, detail: r.user }),
    sync: r => ({
      fields: { collections: r.collections, documents: r.documents },
      detail: `${r.collectionCount} colecciones, ${r.documentCount} documentos`,
      itemsSynced: r.total,
    }),
  },
  portainer: {
    displayName: "Portainer",
    test: r => ({ fields: {}, detail: `${r.endpoints} endpoints` }),
    sync: r => ({
      fields: { endpointCount: r.endpoints },
      detail: `${r.endpoints} endpoints, ${r.containers} contenedores`,
      itemsSynced: r.containers,
    }),
  },
  qportal: {
    displayName: "Qportal",
    test: () => ({ fields: {}, detail: "" }),
    sync: r => ({
      fields: { vrfCount: r.vrfCount, reqCount: r.requestCount, assignedCount: r.assignedCount },
      detail: `${r.vrfCount} VRFs, ${r.requestCount} requests`,
      itemsSynced: (r.vrfCount || 0) + (r.requestCount || 0),
    }),
  },
  outlook: {
    displayName: "Outlook",
    test: r => ({ fields: { connected: true, user: r.user }, detail: r.user }),
    sync: r => ({
      fields: { eventCount: r.count, connected: true },
      detail: `${r.count} eventos`,
      itemsSynced: r.count,
    }),
  },
  plane: {
    displayName: "Plane.so",
    test: r => ({ fields: { workspace: r.workspace }, detail: `workspace "${r.workspace}"` }),
    sync: r => ({
      fields: { projects: r.projects },
      detail: `${r.projectCount} projects, ${r.issueCount} issues`,
      itemsSynced: r.total,
    }),
  },
  "lintaya-remote": {
    displayName: "Lintaya Remote",
    test: r => ({
      fields: { remoteVersion: r.remoteVersion },
      detail: r.remoteVersion ? `Lintaya ${r.remoteVersion}` : "version desconocida",
    }),
    sync: r => ({
      fields: { remoteVersion: r.remoteVersion },
      detail: `${r.connectors?.length || 0} connectors, ${r.blocks?.length || 0} blocks, ${r.boards?.length || 0} boards`,
      itemsSynced: r.total,
    }),
  },
};

const LEVEL_META = {
  ok:   { dot: "var(--ok)",  fg: "var(--ok)" },
  warn: { dot: "var(--warn)", fg: "#9a6f00" },
  err:  { dot: "var(--err)", fg: "var(--err)" },
};

// ─── Spinner ─────────────────────────────────────────────────────────────────
function Spinner({ size = 14, color = "var(--accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: "spin .75s linear infinite", flexShrink: 0 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <path d="M12 2a10 10 0 0 1 10 10" opacity=".25" />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

// ─── Vault picker popup (inline, for connectors) ─────────────────────────────
function VaultPickerPopup({ onPick, onClose }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [items, setItems]   = useState([]);
  const [q, setQ]           = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = React.useRef(null);

  useEffect(() => {
    window.HQ_API.request("/api/vault/items")
      .then(data => { setItems(data || []); setLoading(false); })
      .catch(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = React.useMemo(() => {
    if (!q) return items;
    const s = q.toLowerCase();
    return items.filter(v =>
      (v.service || "").toLowerCase().includes(s) ||
      (v.user || v.username || "").toLowerCase().includes(s) ||
      (v.url || "").toLowerCase().includes(s)
    );
  }, [items, q]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, maxHeight: 480, background: "white", borderRadius: 10,
        boxShadow: "0 16px 48px rgba(0,0,0,.22)", display: "flex", flexDirection: "column",
        overflow: "hidden", border: "1px solid var(--border)",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("connectors.vault.pick")}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder={t("connectors.vault.search")}
            style={{ width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: 0 }} />
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {loading && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--muted-fg)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Spinner size={13} /> {t("connectors.vault.loading")}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted-fg)", fontSize: 13 }}>
              {items.length === 0 ? t("connectors.vault.empty") : t("connectors.vault.noMatch")}
            </div>
          )}
          {filtered.map(item => (
            <div key={item.id} onClick={() => onPick(item)}
              style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--muted)"}
              onMouseLeave={e => e.currentTarget.style.background = "white"}>
              <div style={{ width: 32, height: 32, borderRadius: 7, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                {(item.service || "?").slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.service}</div>
                <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)", marginTop: 1 }}>
                  {item.user || item.username || "—"}{item.url ? ` · ${item.url}` : ""}
                </div>
              </div>
              <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>{t("connectors.vault.use")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Config panel (VMware vSphere) ────────────────────────────────────────────
// El "Pick from vault" es un banner independiente arriba del formulario, no
// algo incrustado en el campo password — por eso no le hace falta a
// SchemaFields ningún slot de acción por campo: rellena username/password
// con el mismo onChange(key, valor) que usa cualquier campo tecleado a mano.
function VCenterConfigPanel({ connId, onSaved }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [pickedVaultItem, setPickedVaultItem] = useState(null); // { service, user }

  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/connectors/vcenter/config-schema"),
      window.HQ_API.request(`/api/connectors/vcenter/${connId}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({ ...v, host: cfg.host || "", username: cfg.username || "" }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [connId]);

  const handlePickVault = async (item) => {
    setShowVaultPicker(false);
    try {
      const { password: pw } = await window.HQ_API.getVaultPassword(item.id);
      setValues(v => ({ ...v, password: pw || "", username: item.user || item.username || v.username }));
      setPickedVaultItem(item);
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.vault.filledFrom", "", { service: item.service }), kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.vault.fetchFailed"), kind: "warn" } }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setErr("");
    if (!values.host || !values.username || !values.password) { setErr(t("connectors.config.allFieldsRequired")); return; }
    setSaving(true);
    try {
      await window.HQ_API.request(`/api/connectors/vcenter/${connId}/config`, {
        method: "POST",
        body: { host: values.host, username: values.username, password: values.password },
      });
      onSaved({ host: values.host, username: values.username });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.config.credentialsSaved"), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <>
      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Vault quick-fill */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: pickedVaultItem ? "color-mix(in srgb, var(--accent) 7%, white)" : "var(--muted)", borderRadius: 6, border: `1px solid ${pickedVaultItem ? "color-mix(in srgb, var(--accent) 25%, var(--border))" : "var(--border)"}` }}>
          <div style={{ fontSize: 12, color: pickedVaultItem ? "var(--accent)" : "var(--muted-fg)" }}>
            {pickedVaultItem
              ? <span>{t("connectors.vault.using")} <b>{pickedVaultItem.service}</b> · {pickedVaultItem.user || pickedVaultItem.username}</span>
              : <span style={{ color: "var(--muted-fg)" }}>{t("connectors.vault.fillFromVault")}</span>}
          </div>
          <button type="button" onClick={() => setShowVaultPicker(true)}
            style={{ height: 26, padding: "0 10px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
            {pickedVaultItem ? t("connectors.vault.change") : t("connectors.vault.pickFromVault")}
          </button>
        </div>

        {schema && (
          <window.SchemaFields
            schema={schema}
            connectorId="vcenter"
            values={values}
            onChange={(key, v) => {
              setValues(prev => ({ ...prev, [key]: v }));
              if (key === "password" && pickedVaultItem) setPickedVaultItem(null);
            }}
            secretPlaceholder={pickedVaultItem ? t("connectors.vault.filledPlaceholder") : undefined}
          />
        )}

        {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
        <button type="submit" disabled={saving}
          style={{ height: 30, padding: "0 14px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
          {saving && <Spinner size={11} color="white" />}
          {saving ? t("connectors.saving") : t("connectors.config.saveCredentials")}
        </button>
      </form>

      {showVaultPicker && (
        <VaultPickerPopup
          onPick={handlePickVault}
          onClose={() => setShowVaultPicker(false)}
        />
      )}
    </>
  );
}

// ─── Config panel (Bitwarden CLI) ────────────────────────────────────────────
function BWConfigPanel({ onSaved }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ serverUrl: "https://localhost:8443" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/connectors/bw/config-schema"),
      window.HQ_API.request("/api/connectors/bw/config"),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({
          ...v,
          serverUrl: cfg.serverUrl || v.serverUrl,
          email: cfg.email || "",
        }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.serverUrl) { setErr(t("connectors.config.serverUrlRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request("/api/connectors/bw/config", {
        method: "POST",
        body: {
          serverUrl: values.serverUrl,
          email: values.email || "",
          clientId: values.clientId || "",
          clientSecret: values.clientSecret || "",
        },
      });
      onSaved({ serverUrl: values.serverUrl, email: values.email });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.config.saved", "", { provider: "Bitwarden" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="bw"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#175ddc", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// ─── Config panel (Plane.so) ──────────────────────────────────────────────────
function PlaneConfigPanel({ onSaved, id = "plane" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ baseUrl: "https://api.plane.so" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        // userId es cacheado por el connector durante el sync (para "mis
        // issues"), no un campo que el usuario deba llenar — se omite del form.
        const { userId, ...displayProps } = schemaRes.properties || {};
        setSchema({ ...schemaRes, properties: displayProps });
        if (cfg.configured) setValues(v => ({
          ...v,
          baseUrl: cfg.baseUrl || v.baseUrl,
          workspace: cfg.workspace || "",
        }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.apiKey || !values.workspace) { setErr(t("connectors.config.planeKeyRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { baseUrl: (values.baseUrl || "").replace(/\/$/, ""), apiKey: values.apiKey, workspace: values.workspace },
      });
      // Auto-test right after saving — see GithubConfigPanel for why.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: values.baseUrl, workspace: values.workspace });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `Plane.so config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "Plane.so" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="plane"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: -4 }}>
        {t("connectors.config.planeSlugInfo")}<b>my-workspace</b>/…
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#f97316", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// ─── Config panel (Qportal) ───────────────────────────────────────────────────
function QportalConfigPanel({ onSaved, id = "qportal" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ baseUrl: "https://10.0.0.1/backend" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [pickedVaultItem, setPickedVaultItem] = useState(null);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        // _cachedToken lo administra el propio connector (se refresca solo en
        // un 401), no es un campo que el usuario deba tocar.
        const { _cachedToken, ...displayProps } = schemaRes.properties || {};
        setSchema({ ...schemaRes, properties: displayProps });
        if (cfg.configured) setValues(v => ({ ...v, baseUrl: cfg.baseUrl || v.baseUrl, email: cfg.email || "" }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handlePickVault = async (item) => {
    setShowVaultPicker(false);
    try {
      const { password: pw } = await window.HQ_API.getVaultPassword(item.id);
      setValues(v => ({ ...v, password: pw || "", email: item.user || item.username || v.email }));
      setPickedVaultItem(item);
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.vault.filledFrom", "", { service: item.service }), kind: "ok" } }));
    } catch {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.vault.fetchFailed"), kind: "warn" } }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.baseUrl || !values.email || !values.password) { setErr(t("connectors.config.allFieldsRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { baseUrl: values.baseUrl, email: values.email, password: values.password },
      });
      // Auto-test right after saving — see GithubConfigPanel for why.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: values.baseUrl, email: values.email });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `Qportal config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "Qportal" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <>
      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: pickedVaultItem ? "color-mix(in srgb, var(--accent) 7%, white)" : "var(--muted)", borderRadius: 6, border: `1px solid ${pickedVaultItem ? "color-mix(in srgb, var(--accent) 25%, var(--border))" : "var(--border)"}` }}>
          <div style={{ fontSize: 12, color: pickedVaultItem ? "var(--accent)" : "var(--muted-fg)" }}>
            {pickedVaultItem ? <span>{t("connectors.vault.using")} <b>{pickedVaultItem.service}</b> · {pickedVaultItem.user || pickedVaultItem.username}</span> : <span>{t("connectors.vault.fillFromVault")}</span>}
          </div>
          <button type="button" onClick={() => setShowVaultPicker(true)} style={{ height: 26, padding: "0 10px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
            {pickedVaultItem ? t("connectors.vault.change") : t("connectors.vault.pickFromVault")}
          </button>
        </div>
        {schema && (
          <window.SchemaFields
            schema={schema}
            connectorId="qportal"
            values={values}
            onChange={(key, v) => {
              setValues(prev => ({ ...prev, [key]: v }));
              if (key === "password" && pickedVaultItem) setPickedVaultItem(null);
            }}
            secretPlaceholder={pickedVaultItem ? t("connectors.vault.filledPlaceholder") : undefined}
          />
        )}
        {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
        <button type="submit" disabled={saving} style={{ height: 30, padding: "0 14px", background: "#0ea5e9", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
          {saving && <Spinner size={11} color="white" />}
          {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
        </button>
      </form>
      {showVaultPicker && <VaultPickerPopup onPick={handlePickVault} onClose={() => setShowVaultPicker(false)} />}
    </>
  );
}

// ─── Config panel (Outlook / Microsoft Graph) ────────────────────────────────
function OutlookConfigPanel({ onSaved, id = "outlook" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({});
  const [connected, setConnected] = useState(false);
  const [user,      setUser]      = useState("");
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState("");
  const [loaded,    setLoaded]    = useState(false);
  const [device,    setDevice]    = useState(null); // { user_code, verification_uri }
  const [polling,   setPolling]   = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        // refreshToken/user los administra el connector (device code flow y
        // el último `test` exitoso) — no son campos que el usuario edite.
        const { refreshToken, user: _user, ...displayProps } = schemaRes.properties || {};
        setSchema({ ...schemaRes, properties: displayProps });
        if (cfg.configured) setValues(v => ({ ...v, tenantId: cfg.tenantId || "", clientId: cfg.clientId || "" }));
        setConnected(!!cfg.connected);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.clientId) { setErr(t("connectors.outlook.clientIdRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { tenantId: values.tenantId, clientId: values.clientId },
      });
      onSaved({ tenantId: values.tenantId, clientId: values.clientId });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.config.saved", "", { provider: "Outlook" }), kind: "ok" } }));
    } catch (e) { setErr(e.message || t("connectors.saveFailed")); }
    finally { setSaving(false); }
  };

  const startConnect = async () => {
    setErr("");
    if (!values.clientId) { setErr(t("connectors.outlook.saveClientIdFirst")); return; }
    try {
      // Persist config first so the server uses the latest tenant/client id
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { tenantId: values.tenantId, clientId: values.clientId },
      });
      const d = await window.HQ_API.request(`/api/connectors/${id}/devicecode`, { method: "POST" });
      setDevice(d);
      setPolling(true);
      pollRef.current = setInterval(async () => {
        try {
          const r = await window.HQ_API.request(`/api/connectors/${id}/poll`, { method: "POST" });
          if (r.connected) {
            clearInterval(pollRef.current); pollRef.current = null;
            setPolling(false); setDevice(null); setConnected(true);
            window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.outlook.connected"), kind: "ok" } }));
            onSaved({ tenantId: values.tenantId, clientId: values.clientId });
          }
        } catch (e) {
          clearInterval(pollRef.current); pollRef.current = null;
          setPolling(false); setErr(e.message || t("connectors.outlook.signInFailed"));
        }
      }, 5000);
    } catch (e) { setErr(e.message || t("connectors.outlook.startFailed")); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.5, background: "var(--muted)", borderRadius: 6, padding: "8px 10px" }}>
        {t("connectors.outlook.appRegPrefix")} <b>App Registration</b> {t("connectors.outlook.appRegMid")} <i>public client flows</i> {t("connectors.outlook.appRegSuffix")}{" "}
        <code>Calendars.Read · User.Read · offline_access</code>.
      </div>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="outlook"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}

      {connected ? (
        <div style={{ fontSize: 12, color: "var(--ok)", background: "color-mix(in srgb,var(--ok) 8%,white)", border: "1px solid color-mix(in srgb,var(--ok) 22%,var(--border))", borderRadius: 5, padding: "7px 10px" }}>
          {t("connectors.outlook.accountConnected")}{user ? ` · ${user}` : ""}. {t("connectors.outlook.useSyncNow")} <b>{t("connectors.card.syncNow")}</b> {t("connectors.outlook.syncHint")}
        </div>
      ) : device ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.6, background: "color-mix(in srgb,var(--accent) 7%,white)", border: "1px solid color-mix(in srgb,var(--accent) 22%,var(--border))", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ marginBottom: 6 }}>{t("connectors.outlook.step1Open")} <a href={device.verification_uri} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>{device.verification_uri}</a></div>
          <div style={{ marginBottom: 6 }}>{t("connectors.outlook.step2Enter")}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "var(--accent)", userSelect: "all" }}>{device.user_code}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: "var(--muted-fg)" }}>
            {polling && <Spinner size={11} />} {t("connectors.outlook.waitingSignIn")}
          </div>
        </div>
      ) : null}

      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}

      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" disabled={saving} style={{ height: 30, padding: "0 14px", background: "#0078d4", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1 }}>
          {saving && <Spinner size={11} color="white" />}
          {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
        </button>
        <button type="button" onClick={startConnect} disabled={polling || !values.clientId} style={{ height: 30, padding: "0 14px", background: "white", color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: (polling || !values.clientId) ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: (polling || !values.clientId) ? .6 : 1 }}>
          {connected ? t("connectors.outlook.reconnect") : t("connectors.outlook.connectAccount")}
        </button>
      </div>
    </form>
  );
}

// ─── Config panel (Portainer) ─────────────────────────────────────────────────
function PortainerConfigPanel({ onSaved, id = "portainer" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ baseUrl: "https://" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({
          ...v,
          baseUrl: cfg.baseUrl || v.baseUrl,
          username: cfg.username || "",
        }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    const body = values.apiKey
      ? { baseUrl: values.baseUrl, apiKey: values.apiKey }
      : { baseUrl: values.baseUrl, username: values.username, password: values.password };
    if (!values.baseUrl || (values.apiKey ? false : !(values.username && values.password))) {
      setErr(t("connectors.portainer.missingData", "", { rest: values.apiKey ? t("connectors.portainer.missingApiKey") : t("connectors.portainer.missingUserPass") })); return;
    }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, { method: "POST", body });
      // Auto-test right after saving — see GithubConfigPanel for why.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: values.baseUrl });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `Portainer config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "Portainer" }), kind: "ok" } }));
    } catch (e) { setErr(e.message || t("connectors.saveFailed")); }
    finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="portainer"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving} style={{ height: 30, padding: "0 14px", background: "#C080FF", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}{saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// ─── Config panel (GitLab) ─────────────────────────────────────────────────────
// id: "gitlab" (default) o "gitlab2" — segunda conexión que reutiliza este
// mismo panel apuntando a sus propios endpoints (ver server/connectors/community/gitlab2).
function GitlabConfigPanel({ onSaved, id = "gitlab" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ baseUrl: id === "gitlab" ? "http://10.0.0.1" : "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({ ...v, baseUrl: cfg.baseUrl || v.baseUrl }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.token) { setErr(t("connectors.config.patRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { baseUrl: (values.baseUrl || "").replace(/\/$/, ""), token: values.token },
      });
      // Auto-test right after saving — see GithubConfigPanel for why.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: values.baseUrl });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `GitLab config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "GitLab" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="gitlab"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: -4 }}>
        {t("connectors.gitlab.help1")} <b>read_api</b> {t("connectors.gitlab.help2")} <b>read_repository</b> {t("connectors.gitlab.help3")}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#380D75", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// Primer conector migrado a formulario schema-driven (ver app/schema-form.jsx
// y el contrato interno de formularios) — los campos salen de
// server/connectors/community/github/config.schema.json vía
// GET /api/connectors/github/config-schema en vez de estar a mano en el JSX.
// Los demás paneles de este archivo aún son la versión manual; migrarlos es
// trabajo de seguimiento (Fase 5, "Renderizar formularios desde schemas").
function GithubConfigPanel({ onSaved, id = "github" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema]       = useState(null);
  const [values, setValues]       = useState({ baseUrl: "https://api.github.com" });
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState("");
  const [loaded, setLoaded]       = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({ ...v, baseUrl: cfg.baseUrl || v.baseUrl }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.token) { setErr(t("connectors.config.patRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { baseUrl: (values.baseUrl || "").replace(/\/$/, ""), token: values.token },
      });
      // Auto-test right after saving — otherwise a freshly configured
      // connector has no live status yet, which hides its card everywhere
      // (Connectors list + sidebar nav) with no button left to test it from.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: values.baseUrl });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `GitHub config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "GitHub" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields
          schema={schema}
          values={values}
          connectorId="github"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))}
        />
      )}
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: -4 }}>
        <a href="https://github.com/settings/tokens/new?description=Lintaya&scopes=repo,workflow" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
          {t("connectors.github.createToken")}
        </a> {t("connectors.github.scopeIntro")} <b>repo</b> {t("connectors.github.scopeMid")} <b>workflow</b> {t("connectors.github.scopeTail")}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#24292f", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// ─── Config panel (Bitbucket — Cloud o Server/Data Center, un solo conector) ──
function BitbucketConfigPanel({ onSaved, id = "bitbucket" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ type: "cloud" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({
          ...v,
          type: cfg.type === "server" ? "server" : "cloud",
          baseUrl: cfg.baseUrl && cfg.type === "server" ? cfg.baseUrl : "",
          username: cfg.username || "",
          workspace: cfg.workspace || "",
        }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    const type = values.type === "server" ? "server" : "cloud";
    if (!values.token) { setErr(t("connectors.bitbucket.tokenRequired")); return; }
    if (type === "server" && !values.baseUrl) { setErr(t("connectors.bitbucket.baseUrlRequired")); return; }
    if (type === "cloud" && !values.username) { setErr(t("connectors.bitbucket.usernameRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: {
          type,
          baseUrl: type === "server" ? (values.baseUrl || "").replace(/\/$/, "") : undefined,
          username: type === "cloud" ? values.username : undefined,
          workspace: type === "cloud" ? ((values.workspace || "").trim() || undefined) : undefined,
          token: values.token,
        },
      });
      // Auto-test right after saving — see GithubConfigPanel for why.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: type === "server" ? values.baseUrl : "https://api.bitbucket.org/2.0" });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `Bitbucket config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "Bitbucket" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="bitbucket"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: -4 }}>
        {values.type === "server" ? (
          t("connectors.bitbucket.serverHelp")
        ) : (
          <>
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              {t("connectors.bitbucket.createToken")}
            </a> {t("connectors.bitbucket.useScopes")} <b>"Create API token with scopes"</b> {t("connectors.bitbucket.notClassic")} <b>Bitbucket</b> {t("connectors.bitbucket.markMin")} <b>Repository: Read</b> ({t("connectors.github.scopeMid")} <b>User: Read</b> {t("connectors.bitbucket.andIfEmpty")} {t("connectors.bitbucket.classicTokenError")} <i>"API Token provided has no Bitbucket scopes"</i>.
            {" "}{t("connectors.bitbucket.appPasswordsGone")}
          </>
        )}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#0052CC", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// ─── Config panel (Outline) ────────────────────────────────────────────────────
function OutlineConfigPanel({ onSaved, id = "outline" }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ baseUrl: "https://10.0.0.1" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      window.HQ_API.request(`/api/connectors/${id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${id}/config`),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({ ...v, baseUrl: cfg.baseUrl || v.baseUrl }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.apiKey) { setErr(t("connectors.outline.apiKeyRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${id}/config`, {
        method: "POST",
        body: { baseUrl: (values.baseUrl || "").replace(/\/$/, ""), apiKey: values.apiKey },
      });
      // Auto-test right after saving — see GithubConfigPanel for why.
      let testError = "";
      try { await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" }); }
      catch (testErr) { testError = testErr.message || ""; }
      onSaved({ baseUrl: values.baseUrl });
      window.dispatchEvent(new CustomEvent("toast", { detail: testError
        ? { msg: `Outline config saved, but the test failed: ${testError}`, kind: "warn" }
        : { msg: t("connectors.config.saved", "", { provider: "Outline" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="outline"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: -4 }}>
        Settings → API → New API key
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#27272a", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// ─── Config panel (UCS Manager) ─────────────────────────────────────────────────
function UcsmConfigPanel({ onSaved }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({ hosts: { MEX: "10.0.0.1", GDL: "10.0.0.1" } });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/connectors/ucsm/config-schema"),
      window.HQ_API.request("/api/connectors/ucsm/config"),
    ])
      .then(([schemaRes, cfg]) => {
        setSchema(schemaRes);
        if (cfg.configured) setValues(v => ({
          ...v,
          hosts: { MEX: cfg.hosts?.MEX || v.hosts.MEX, GDL: cfg.hosts?.GDL || v.hosts.GDL },
        }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!values.username || !values.password) { setErr(t("connectors.ucsm.userPassRequired")); return; }
    if (!values.hosts?.MEX || !values.hosts?.GDL) { setErr(t("connectors.ucsm.hostsRequired")); return; }
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request("/api/connectors/ucsm/config", {
        method: "POST",
        body: { username: values.username, password: values.password, hosts: values.hosts },
      });
      onSaved({ hosts: values.hosts });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.config.saved", "", { provider: "UCS Manager" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && (
        <window.SchemaFields schema={schema} values={values} connectorId="ucsm"
          onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))} />
      )}
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: "#049fd9", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

// Which generic "connection" fields make sense for a connector, keyed by its
// manifest's `transport` (server/routes/connectors.js derives this per row
// from the manifest, defaulting to "http" — see that file's comment). A
// "script" connector (outlook-local: PowerShell/COM against the desktop app,
// no network endpoint at all) has no Endpoint/Auth/Items to show; Last sync
// and Latency stay meaningful either way, so they're not part of this table.
// Card and Detail both read this instead of each re-deriving their own
// isOutlookLocal-style check — that drift (Card got fixed, Detail didn't) is
// exactly the bug this table exists to prevent from happening again.
const CONNECTOR_FIELDS_BY_TRANSPORT = {
  http:   { endpoint: true,  auth: true,  items: true },
  script: { endpoint: false, auth: false, items: false },
};
function connectorFields(conn) {
  return CONNECTOR_FIELDS_BY_TRANSPORT[conn.transport || "http"] || CONNECTOR_FIELDS_BY_TRANSPORT.http;
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function ConnectorCard({ conn, liveStatus, account, onSelect, onPulse, busy }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const effStatus = liveStatus?.status || "offline";
  const s = STATUS_META[effStatus] || STATUS_META.offline;
  const statusLabel = t(`connectors.status.${effStatus}`, s.label);
  const isBusy = busy === conn.id;
  const fields = connectorFields(conn);
  // Outlook-local (the one "script" transport connector today) has no
  // endpoint — the mailbox it's bound to is the one thing worth showing
  // instead. That substitution is connector-specific content, unlike the
  // hide/show decision above which is generic to any "script" connector.
  const isOutlookLocal = conn.type === "outlook-local";
  // El servidor no montó este conector porque su manifiesto nombra otras
  // plataformas. Sin decirlo, la tarjeta se vería como cualquier otra
  // desconectada y nadie sabría que no es un problema de configuración.
  const unsupported = conn.supportedHere === false;

  return (
    <article role="listitem" aria-labelledby={`connector-card-${conn.id}`} data-lintaya-entity="connection" style={{
      background: "white", border: "1px solid var(--border)",
      borderLeft: `3px solid ${s.dot}`,
      borderRadius: 8, padding: 12, cursor: "default",
      display: "flex", flexDirection: "column", gap: 10,
      transition: "border-color .12s",
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.borderLeftColor = s.dot; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = s.dot; }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 8,
          background: `linear-gradient(135deg, ${conn.color}, color-mix(in srgb, ${conn.color} 65%, black))`,
          color: "white",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 13, fontFamily: "var(--font-mono)",
          flexShrink: 0, letterSpacing: -0.4,
        }}>{connectorIconContent(conn.type || conn.id, conn.icon)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={`connector-card-${conn.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{conn.name}</h2>
          <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 2, fontFamily: "var(--font-mono)" }}>{conn.kind}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <ConnectorTierBadge id={conn.id} tier={conn.tier} compact />
          {conn.enabled === false && (
            <span title={t("connectors.card.disabledTitle")} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
              background: "var(--muted)", color: "var(--muted-fg)", letterSpacing: 0.4, textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}>
              {t("connectors.card.disabled")}
            </span>
          )}
          {unsupported ? (
            // "Disconnected" would be a lie here: nothing was tried and
            // nothing could be. The connector names the platforms it runs on,
            // this is not one, and the server never mounted it (ADR-014).
            <span title={conn.requires || ""} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
              background: "var(--muted)", color: "var(--muted-fg)",
              letterSpacing: 0.4, textTransform: "uppercase", fontFamily: "var(--font-mono)",
            }}>
              {t("connectors.card.unsupportedHere", "Not on this system")}
            </span>
          ) : (
          <span title={statusLabel} aria-live={isBusy ? "polite" : undefined} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
            background: s.bg, color: s.fg, letterSpacing: 0.4, textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}>
            {isBusy ? <Spinner size={9} color={s.fg} /> : s.icon} {isBusy ? t("connectors.card.working") : statusLabel}
          </span>
          )}
        </div>
      </div>

      {unsupported && (
        <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5 }}>
          {conn.requires || t("connectors.card.unsupportedHelp", "This connector declares the platforms it runs on, and this is not one of them.")}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 10px", fontSize: 11 }}>
        {fields.endpoint ? (
          <>
            <span style={{ color: "var(--muted-fg)" }}>{t("connectors.card.endpoint")}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: conn.endpoint ? "var(--fg)" : "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conn.id === "bw"   ? (liveStatus?.serverUrl || conn.endpoint || "—")
             : (conn.id === "vcenter" || conn.id === "vc-mex") ? (liveStatus?.host || conn.endpoint || "—")
             : (conn.endpoint || "—")}
            </span>
          </>
        ) : isOutlookLocal ? (
          <>
            <span style={{ color: "var(--muted-fg)" }}>{t("connectors.card.account")}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: account ? "var(--fg)" : "var(--muted-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account || "—"}
            </span>
          </>
        ) : null}
        <span style={{ color: "var(--muted-fg)" }}>{t("connectors.card.lastSync")}</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {liveStatus?.lastSync ? new Date(liveStatus.lastSync).toLocaleTimeString() : <span style={{ color: "var(--muted-fg)" }}>—</span>}
          {" "}<span style={{ color: "var(--muted-fg)" }}>· {conn.interval}</span>
        </span>
        {fields.items && (
          <>
            <span style={{ color: "var(--muted-fg)" }}>{t("connectors.card.items")}</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {liveStatus?.itemsSynced != null
                ? <><b>{liveStatus.itemsSynced}</b><span style={{ color: "var(--muted-fg)" }}> · {liveStatus.latency || "—"}</span></>
                : <span style={{ color: "var(--muted-fg)" }}>—</span>}
            </span>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {conn.feeds.map((f, i) => (
          <span key={i} style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 3,
            background: "var(--muted)", color: "var(--muted-fg)", fontWeight: 500,
          }}>{f}</span>
        ))}
      </div>

      {/* Un conector que no corre aquí conserva el último error de la máquina
          donde sí corría. Mostrarlo contradice el mensaje de al lado y manda a
          depurar un fallo que aquí ya no puede ocurrir. */}
      {liveStatus?.lastError && !unsupported && (
        <div style={{
          fontSize: 11, lineHeight: 1.4, padding: "6px 8px", borderRadius: 5,
          background: "color-mix(in srgb, var(--err) 8%, white)",
          color: "var(--err)", border: "1px solid color-mix(in srgb, var(--err) 25%, var(--border))",
        }}>
          <b>{t("connectors.card.lastError")}</b> {liveStatus.lastError}
        </div>
      )}

      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" aria-label={t("connectors.card.testAria", "", { name: conn.name })} onClick={() => onPulse(conn.id, "test")} disabled={isBusy} style={miniBtn}>
          {isBusy ? <Spinner size={10} /> : null} {t("connectors.card.test")}
        </button>
        <button type="button" aria-label={t("connectors.card.syncAria", "", { name: conn.name })} onClick={() => onPulse(conn.id, "sync")} disabled={isBusy} style={miniBtn}>{t("connectors.card.syncNow")}</button>
        <button type="button" aria-label={t("connectors.card.viewAria", "", { name: conn.name })} onClick={() => onSelect(conn)} style={{ ...miniBtn, marginLeft: "auto" }}>{t("connectors.card.viewDetail")}</button>
      </div>
    </article>
  );
}

const miniBtn = {
  height: 26, padding: "0 9px", border: "1px solid var(--border)",
  background: "white", borderRadius: 5, fontSize: 11.5, fontFamily: "inherit",
  cursor: "pointer", color: "var(--fg)", display: "inline-flex", alignItems: "center", gap: 4,
};

// Intervalo de auto-sync por conector — antes solo vCenter tenía un campo especial
// ("vCenter cada X min") en AutoSyncPanel; cualquier conector puede fijar el suyo
// aquí, se guarda en kv "connector-sync-intervals" y el scheduler lo respeta.
function SyncIntervalControl({ id }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [target, setTarget] = useState(null);
  const [override, setOverrideState] = useState(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    window.HQ_API.request("/api/settings/auto-sync").then(cfg => {
      const found = (cfg.targets || []).find(x => x.id === id);
      setTarget(found || null);
      const ov = cfg.overrides?.[id] ?? null;
      setOverrideState(ov);
      setValue(String(ov ?? found?.effectiveMinutes ?? ""));
    }).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  const save = async () => {
    const n = Number(value);
    if (!n || n < 1) { window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.sync.invalidMinutes"), kind: "warn" } })); return; }
    setSaving(true);
    try {
      await window.HQ_API.request(`/api/connectors/${id}/sync-interval`, { method: "POST", body: { minutes: n } });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.sync.saved"), kind: "ok" } }));
      load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: e.message || t("connectors.saveFailed"), kind: "error" } }));
    } finally { setSaving(false); }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await window.HQ_API.request(`/api/connectors/${id}/sync-interval`, { method: "POST", body: { minutes: null } });
      load();
    } catch (_) {} finally { setSaving(false); }
  };

  if (!target) return null;
  const inp = {
    width: 64, height: 28, padding: "0 8px", fontSize: 12, textAlign: "center",
    border: "1px solid var(--border)", borderRadius: 5, outline: 0,
    fontFamily: "var(--font-mono)", background: "white", color: "var(--fg)",
  };
  const groupLabel = t(`connectors.sync.group.${target.group === "slow" ? "slow" : "general"}`);

  return (
    <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={sectionLabel}>{t("connectors.sync.title")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
        <input type="number" min={1} max={1440} style={inp} value={value} onChange={e => setValue(e.target.value)} />
        <span style={{ color: "var(--muted-fg)" }}>{t("connectors.sync.min")}</span>
        <button onClick={save} disabled={saving} style={{ height: 28, padding: "0 12px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: saving ? .7 : 1 }}>
          {saving && <Spinner size={10} color="white" />} {t("connectors.save")}
        </button>
        {override != null && (
          <button onClick={reset} disabled={saving} style={{ height: 28, padding: "0 10px", background: "white", border: "1px solid var(--border)", borderRadius: 5, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
            {t("connectors.sync.useDefault", "", { group: groupLabel, minutes: target.group === "slow" ? "20" : "5" })}
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)" }}>
        {override != null
          ? t("connectors.sync.customInfo", "", { minutes: override })
          : t("connectors.sync.defaultInfo", "", { group: groupLabel, minutes: target.effectiveMinutes })}
      </div>
    </div>
  );
}

// Contexto en Markdown por conector — reglas de negocio propias del usuario
// (formato de título, campos obligatorios, plantilla de descripción, etc.)
// para que un agente de IA sepa cómo crear/editar datos ahí. Vive en kv
// "connector-ai-context" = { [id]: markdown }, mismo patrón genérico que
// SyncIntervalControl arriba (solo depende de conn.id, no del tipo).
function AIContextControl({ id }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    window.HQ_API.request(`/api/connectors/${id}/ai-context`)
      .then(r => setValue(r.content || ""))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [id]);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await window.HQ_API.request(`/api/connectors/${id}/ai-context`, { method: "POST", body: { content: value } });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.aiContext.saved"), kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: e.message || t("connectors.saveFailed"), kind: "error" } }));
    } finally { setSaving(false); }
  };

  if (!loaded) return null;

  return (
    <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={sectionLabel}>{t("connectors.aiContext.title")}</div>
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)" }}>
        {t("connectors.aiContext.desc")} <code style={{ fontFamily: "var(--font-mono)" }}>GET /api/connectors/{id}/ai-context</code>.
      </div>
      <textarea value={value} onChange={e => setValue(e.target.value)} rows={14} placeholder={`${t("connectors.aiContext.placeholderTitle")}\n...`}
        style={{ width: "100%", boxSizing: "border-box", padding: 10, fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.5, border: "1px solid var(--border)", borderRadius: 6, resize: "vertical", background: "white", color: "var(--fg)" }} />
      <div>
        <button onClick={save} disabled={saving} style={{ height: 28, padding: "0 12px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: saving ? .7 : 1 }}>
          {saving && <Spinner size={10} color="white" />} {t("connectors.save")}
        </button>
      </div>
    </div>
  );
}

// Identidad de committer por conexion para los commits que Lintaya hace sobre
// clones locales (modulo Repos). Vive en kv "connector-commit-identity" =
// { [id]: { name, email } }, mismo patron generico que AIContextControl arriba.
// Es un campo estructurado y no una linea del AI context a proposito: el
// servidor la aplica con `-c user.name/-c user.email` a cualquier commit, lo
// haga el usuario desde la UI o un agente, asi que no puede depender de prosa
// que el propio agente pueda reinterpretar.
function CommitIdentityControl({ id }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    window.HQ_API.request(`/api/connectors/${id}/commit-identity`)
      .then(r => { setName(r.identity?.name || ""); setEmail(r.identity?.email || ""); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [id]);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await window.HQ_API.request(`/api/connectors/${id}/commit-identity`, { method: "POST", body: { name, email } });
      setName(r.identity?.name || ""); setEmail(r.identity?.email || "");
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: r.identity ? t("connectors.commitIdentity.saved") : t("connectors.commitIdentity.cleared"), kind: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: e.message || t("connectors.saveFailed"), kind: "error" } }));
    } finally { setSaving(false); }
  };

  if (!loaded) return null;

  const field = { width: "100%", boxSizing: "border-box", height: 28, padding: "0 8px", fontSize: 11.5, border: "1px solid var(--border)", borderRadius: 6, background: "white", color: "var(--fg)", fontFamily: "inherit" };

  return (
    <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={sectionLabel}>{t("connectors.commitIdentity.title")}</div>
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)" }}>{t("connectors.commitIdentity.desc")}</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--muted-fg)" }}>
        {t("connectors.commitIdentity.name")}
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ada Lovelace" style={field} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--muted-fg)" }}>
        {t("connectors.commitIdentity.email")}
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="ada@example.com" style={{ ...field, fontFamily: "var(--font-mono)" }} />
      </label>
      <div>
        <button onClick={save} disabled={saving} style={{ height: 28, padding: "0 12px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: saving ? .7 : 1 }}>
          {saving && <Spinner size={10} color="white" />} {t("connectors.save")}
        </button>
      </div>
    </div>
  );
}

// Nombre editable del conector (clic para renombrar) — pensado para conexiones
// duplicadas de un mismo tipo (ej. una segunda instancia de GitLab), donde el
// nombre por defecto es el mismo para las dos y hace falta poder diferenciarlas.
// Genérico: cualquier conector puede renombrarse, no solo GitLab.
function ConnectorNameEditor({ conn, onRenamed }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(conn.name);
  useEffect(() => { setValue(conn.name); }, [conn.name]);

  const save = async () => {
    const trimmed = value.trim();
    setEditing(false);
    if (!trimmed || trimmed === conn.name) { setValue(conn.name); return; }
    try {
      const updated = await window.HQ_API.request(`/api/connectors/${conn.id}`, { method: "PUT", body: { name: trimmed } });
      onRenamed(updated);
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.rename.failed", "", { message: e.message }), kind: "error" } }));
      setValue(conn.name);
    }
  };

  if (editing) {
    return (
      <input autoFocus value={value} onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setValue(conn.name); setEditing(false); }
        }}
        style={{ fontSize: 13, fontWeight: 500, border: "1px solid var(--accent)", borderRadius: 4, padding: "1px 5px", fontFamily: "inherit", width: 180 }} />
    );
  }
  return (
    <div onClick={() => setEditing(true)} title={t("connectors.rename.title")} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter") setEditing(true); }}
      style={{ fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
      {conn.name}
      <span style={{ fontSize: 10, color: "var(--muted-fg)" }}>✎</span>
    </div>
  );
}

// Crea una N-ésima conexión de un tipo instantiable (ver ADR-008/CONN-017) —
// window.prompt() no es confiable como PWA instalada, así que es un modal
// propio (mismo patrón que TextPromptModal en repos.jsx, no reusable entre
// scripts — cada <script> corre aislado, ver CLAUDE.md).
function AddInstanceModal({ typeId, typeLabel, onClose, onCreated }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    setSaving(true); setErr("");
    try {
      const created = await window.HQ_API.request(`/api/connectors/${typeId}/instances`, {
        method: "POST",
        body: { label: label.trim() },
      });
      onCreated(created);
    } catch (e) {
      setErr(e.message || t("connectors.addInstance.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 380, background: "white", borderRadius: 10, boxShadow: "0 16px 48px rgba(0,0,0,.22)", border: "1px solid var(--border)" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>{t("connectors.addInstance.title", "", { type: typeLabel })}</div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--muted-fg)", marginBottom: 8 }}>
            {t("connectors.addInstance.desc")}
          </div>
          <input ref={inputRef} value={label} onChange={e => setLabel(e.target.value)}
            placeholder={`${typeLabel} (personal, work, …)`}
            onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
            style={{ width: "100%", height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, boxSizing: "border-box", fontFamily: "inherit" }} />
          {err && <div style={{ fontSize: 11.5, color: "var(--err)", marginTop: 8 }}>{err}</div>}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtn}>{t("connectors.cancel")}</button>
          <button onClick={submit} disabled={saving} style={{ ...primaryBtn, opacity: saving ? .7 : 1 }}>
            {saving ? t("connectors.addInstance.creating") : t("connectors.addInstance.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Renders package/development-tier connectors' actual README.md — those
// don't have an external `docs` URL (see manifest.json), so without this the
// "Documentation" section had nothing useful to show. Uses `window.marked`
// (tables, fenced code — READMEs in this repo use both) when it loaded,
// falling back to block-builder.jsx's tiny renderer, same pattern as
// ContentBlockBody there.
const README_MODAL_STYLES = `
.readme-body { font-size: 12.5px; line-height: 1.65; color: var(--fg); word-break: break-word; }
.readme-body h1, .readme-body h2, .readme-body h3, .readme-body h4 { font-weight: 600; line-height: 1.3; margin: .9em 0 .35em; }
.readme-body h1 { font-size: 1.3em; } .readme-body h2 { font-size: 1.18em; } .readme-body h3 { font-size: 1.06em; }
.readme-body p { margin: .45em 0; }
.readme-body code { font-family: var(--font-mono); background: var(--muted); padding: .1em .35em; border-radius: 4px; font-size: .92em; }
.readme-body pre { background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; overflow: auto; margin: .6em 0; }
.readme-body pre code { background: none; padding: 0; color: inherit; }
.readme-body blockquote { margin: .5em 0; padding: 2px 12px; color: var(--muted-fg); border-left: 3px solid var(--border); }
.readme-body ul, .readme-body ol { padding-left: 1.3em; margin: .45em 0; }
.readme-body li { margin: .15em 0; }
.readme-body a { color: var(--accent); }
.readme-body table { border-collapse: collapse; margin: .6em 0; }
.readme-body th, .readme-body td { border: 1px solid var(--border); padding: 4px 8px; font-size: .95em; }
.readme-body hr { border: 0; border-top: 1px solid var(--border); margin: .8em 0; }
`;
function ReadmeModal({ conn, onClose }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [content, setContent] = useState(null); // null = loading
  const [error, setError] = useState("");

  useEffect(() => {
    window.HQ_API.request(`/api/connectors/${conn.id}/readme`)
      .then(r => setContent(r.content || ""))
      .catch(e => setError(e.message || t("connectors.readme.loadFailed")));
  }, [conn.id]);

  const html = content
    ? (window.marked ? window.marked.parse(content) : (window.renderMarkdown ? window.renderMarkdown(content) : content))
    : "";

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "var(--surface)", borderRadius: 12, width: "min(720px, 94vw)", maxHeight: "86vh",
        boxShadow: "0 24px 64px rgba(0,0,0,.25)", overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{t("connectors.readme.title", "", { name: conn.name })}</span>
          <button onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--muted-fg)", fontSize: 16, padding: 2, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>
          {error ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-fg)" }}>
              {error === "no-readme" ? t("connectors.readme.none") : error}
            </div>
          ) : content === null ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-fg)", display: "flex", alignItems: "center", gap: 8 }}>
              <Spinner size={12} /> {t("connectors.loading")}
            </div>
          ) : (
            <>
              <style>{README_MODAL_STYLES}</style>
              <div className="readme-body" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Draggable width for the detail panel's zone 1/3 columns — same hook/handle
// shape as module-builder.jsx's own copy (duplicated locally rather than
// shared across files: this repo has no cross-file imports, see AGENTS.md).
// Named uniquely per file — these are plain global <script> tags sharing one
// window scope, not ES modules, so a name shared with another file's version
// gets silently overwritten by whichever <script> tag loads last.
function useConnectorsResizableWidth(storageKey, defaultWidth, min = 260, max = 560) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= min && saved <= max ? saved : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback((e, sign = 1) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = ev => {
      currentWidth = Math.min(max, Math.max(min, startWidth + sign * (ev.clientX - startX)));
      setWidth(currentWidth);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(storageKey, String(currentWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [min, max, storageKey]);

  return [width, onMouseDown];
}

function ConnectorsResizeHandle({ onMouseDown }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={t("connectors.resizeHandle")}
      style={{
        width: 5, flexShrink: 0, cursor: "col-resize",
        background: hover ? "var(--accent)" : "transparent",
        borderRight: hover ? "none" : "1px solid var(--border)",
        transition: "background .1s",
      }}
    />
  );
}

// Wraps one of ConnectorDetail's 3 zones — on desktop just the original
// aside/section tag; on mobile (`mobile` true) an accordion section instead,
// since the 3 fixed/flexible columns have no room to sit side-by-side under
// ~700px. The zone's own inner JSX is passed through as `children` totally
// unchanged, only the wrapping tag differs — same pattern as
// BlockBuilderAccordionSection / ModuleBuilderAccordionSection, but shaped
// to swap in for an existing aside/section instead of always rendering a div.
function ConnectorDetailZoneWrap({ mobile, tag = "aside", ariaLabel, style, id, openSection, setOpenSection, title, children }) {
  if (!mobile) {
    const Tag = tag;
    return <Tag aria-label={ariaLabel} style={style}>{children}</Tag>;
  }
  const open = openSection === id;
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpenSection(s => s === id ? null : id)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", background: open ? "var(--muted)" : "white", border: 0, cursor: "pointer",
        fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, textAlign: "left", color: "var(--fg)",
      }}>
        {title}
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .1s", color: "var(--muted-fg)", fontSize: 13 }}>›</span>
      </button>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function ConnectorDetail({ conn, liveStatus, liveLog, account, onClose, onPulse, busy, onConfigSaved, onRenamed, onEnabledChanged, onInstanceCreated, onDeleted }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [showConfig, setShowConfig] = useState(false);
  const [showInterval, setShowInterval] = useState(false);
  const [showAIContext, setShowAIContext] = useState(false);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logPage, setLogPage] = useState(0);
  // Server default is enabled when the KV entry is absent (see routes/
  // connectors.js), so `!== false` here mirrors that rather than requiring
  // every connector to carry an explicit `enabled: true`.
  const [enabled, setEnabled] = useState(conn?.enabled !== false);
  const [enabledBusy, setEnabledBusy] = useState(false);
  // Zone 1/3 widths are draggable; zone 2 (data & AI context) takes whatever
  // space is left. Called unconditionally, before the `!conn` early return,
  // same as every other hook here — React's rules of hooks apply even though
  // this component returns null for most of its lifetime between selections.
  const [zone1Width, onZone1HandleDown] = useConnectorsResizableWidth("hq.connectorDetailZone1Width", 340, 280, 560);
  const [zone3Width, onZone3HandleDown] = useConnectorsResizableWidth("hq.connectorDetailZone3Width", 320, 260, 520);
  // Same breakpoint/reasoning as BlockBuilder and Board Builder: zone1
  // (280-560px) + zone3 (260-520px) alone need ~660px just for their two
  // fixed-width columns, so under ~700px the row overflows and only zone 1
  // is visible. Below that we switch to a single-open-at-a-time accordion.
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 700);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [openSection, setOpenSection] = useState("zone1");
  if (!conn) return null;

  const effStatus = liveStatus?.status || "offline";
  const s = STATUS_META[effStatus] || STATUS_META.offline;
  const isBusy = busy === conn.id;
  // conn.type resuelve una instancia extra (ej. "gitlab3") a su tipo base
  // (viene de GET /api/connectors, server-side vía resolveConnectorType — ver
  // ADR-008/CONN-017). Los 8 flags de abajo funcionan igual para cualquier
  // instancia de esos tipos, no solo la base.
  const isVMware   = conn.type === "vcenter" || conn.kind === "VMware vSphere REST";
  const isBW       = conn.id === "bw";
  const isPlane    = conn.type === "plane";
  const isQportal  = conn.type === "qportal";
  const isOutlook  = conn.type === "outlook";
  const isPortainer = conn.type === "portainer";
  const isGitlab    = conn.type === "gitlab";
  const isGithub    = conn.type === "github";
  const isBitbucket = conn.type === "bitbucket";
  const isOutline   = conn.type === "outline";
  const isUcsm      = conn.id === "ucsm";
  const isAnthropic = conn.id === "anthropic";
  const isOutlookLocal = conn.type === "outlook-local";
  const fields = connectorFields(conn);
  const hasCustomConfig = isVMware || isBW || isPlane || isQportal || isOutlook || isPortainer || isGitlab || isGithub || isBitbucket || isOutline || isUcsm || isAnthropic;

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabledBusy(true);
    try {
      await window.HQ_API.request(`/api/connectors/${conn.id}/enabled`, { method: "POST", body: { enabled: next } });
      setEnabled(next);
      onEnabledChanged?.(conn.id, next);
      window.dispatchEvent(new CustomEvent("toast", {
        detail: {
          msg: next ? t("connectors.detail.enabledToast", "", { name: conn.name }) : t("connectors.detail.disabledToast", "", { name: conn.name }),
          kind: next ? "ok" : "info",
        },
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.detail.enabledChangeFailed", "", { message: e.message }), kind: "error" } }));
    } finally {
      setEnabledBusy(false);
    }
  };

  // Zone styles for the 3-column layout: 1) connection & configuration data,
  // 2) synced data + AI context, 3) activity log. Each column scrolls on its
  // own; only the header bar spans the full width.
  const zoneCol = { minWidth: 0, overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 };
  const zoneHeading = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--muted-fg)" };

  return (
    // A normal flex child of main.app-main (see ConnectorsView below, which
    // renders this instead of the connector grid rather than layering it on
    // top) — no position:fixed/absolute. Fixed would cover the sidebar;
    // absolute over the still-mounted grid was scroll-position-dependent
    // (main.app-main's scrollTop from browsing the grid stayed put, so the
    // overlay — anchored to the content's untransformed top — no longer
    // lined up with the viewport and the grid showed through underneath it).
    <section aria-label={t("connectors.detail.ariaLabel", "", { name: conn.name })} data-lintaya-entity="connection-detail" style={{
      background: "white", flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ minHeight: "var(--header-h)", padding: "8px 16px 8px 2px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, alignSelf: "stretch", display: "flex", alignItems: "flex-end", padding: "0 14px 6px", borderBottom: "2px solid var(--accent)" }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: `linear-gradient(135deg, ${conn.color}, color-mix(in srgb, ${conn.color} 65%, black))`,
            color: "white",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 11, fontFamily: "var(--font-mono)",
          }}>{conn.id === "anthropic" ? <AnthropicLogoIcon size={15} /> : isGitlab ? <GitlabLogoIcon size={26} /> : isGithub ? <GithubLogoIcon size={15} /> : isBitbucket ? <BitbucketLogoIcon size={16} /> : isPlane ? <PlaneLogoIcon size={16} /> : (conn.id === "vcenter" || conn.id === "vc-mex") ? <VMwareLogoIcon size={16} /> : conn.id === "bw" ? <BitwardenLogoIcon size={16} /> : isPortainer ? <PortainerLogoIcon size={16} /> : isOutline ? <OutlineLogoIcon size={16} /> : conn.id === "ucsm" ? <CiscoLogoIcon size={16} /> : conn.icon}</div>
          <div>
            <ConnectorNameEditor conn={conn} onRenamed={onRenamed} />
          </div>
          <ConnectorTierBadge id={conn.id} tier={conn.tier} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
            background: s.bg, color: s.fg, letterSpacing: 0.4, textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}>
            {isBusy ? <Spinner size={9} color={s.fg} /> : s.icon}
            {" "}{isBusy ? t("connectors.card.working") : t(`connectors.status.${effStatus}`, s.label)}
          </span>
          <button type="button" aria-pressed={enabled} onClick={toggleEnabled} disabled={enabledBusy}
            title={enabled ? t("connectors.detail.enabledTitleOn") : t("connectors.detail.enabledTitleOff")}
            style={{
              height: 28, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              border: `1px solid ${enabled ? "var(--accent)" : "var(--border)"}`,
              background: enabled ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "white",
              color: enabled ? "var(--accent)" : "var(--muted-fg)", borderRadius: 6,
              cursor: enabledBusy ? "default" : "pointer", opacity: enabledBusy ? 0.6 : 1,
            }}>
            <span style={{ width: 22, height: 13, borderRadius: 99, padding: 1.5, flexShrink: 0, background: enabled ? "var(--accent)" : "var(--border)", display: "inline-flex", justifyContent: enabled ? "flex-end" : "flex-start" }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "#fff", display: "block" }} />
            </span>
            {enabled ? t("connectors.detail.active") : t("connectors.detail.inactive")}
          </button>
          <button type="button" aria-label={t("connectors.detail.closeAria")} onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 18, color: "var(--muted-fg)" }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: mobile ? "block" : "flex", overflowY: mobile ? "auto" : "visible" }}>

        {/* Zone 1 — connection & configuration */}
        <ConnectorDetailZoneWrap mobile={mobile} tag="aside" ariaLabel={t("connectors.detail.connectionConfig")} style={{ ...zoneCol, width: zone1Width, flexShrink: 0 }}
          id="zone1" openSection={openSection} setOpenSection={setOpenSection} title={t("connectors.detail.connectionConfig")}>
          <div style={zoneHeading}>{t("connectors.detail.connectionConfig")}</div>

          {/* Live stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "5px 12px", fontSize: 12 }}>
            {fields.endpoint ? (
              <>
                <span style={kk}>{t("connectors.card.endpoint")}</span>
                <span style={{ ...vv, color: liveStatus ? "var(--fg)" : "var(--muted-fg)" }}>
                  {isBW
                    ? (liveStatus?.serverUrl || "—")
                    : (liveStatus?.host ? `${liveStatus.host}` : "—")}
                </span>
              </>
            ) : isOutlookLocal ? (
              <>
                <span style={kk}>{t("connectors.card.account")}</span>
                <span style={{ ...vv, color: account ? "var(--fg)" : "var(--muted-fg)" }}>{account || "—"}</span>
              </>
            ) : null}
            {fields.auth && (<><span style={kk}>{t("connectors.detail.auth")}</span>        <span>{conn.auth}</span></>)}
            {conn.type === "lintaya-remote" && (
              <>
                <span style={kk}>{t("connectors.detail.remoteVersion")}</span>
                <span style={{ ...vv, color: liveStatus?.remoteVersion ? "var(--fg)" : "var(--muted-fg)" }}>
                  {liveStatus?.remoteVersion || t("connectors.detail.runTest")}
                </span>
              </>
            )}
            <span style={kk}>{t("connectors.detail.frequency")}</span>  <span style={{ fontFamily: "var(--font-mono)" }}>{conn.interval}</span>
            <span style={kk}>{t("connectors.card.lastSync")}</span>  <span style={{ fontFamily: "var(--font-mono)", color: liveStatus?.lastSync ? "var(--fg)" : "var(--muted-fg)" }}>
              {liveStatus?.lastSync ? new Date(liveStatus.lastSync).toLocaleString() : "—"}
            </span>
            <span style={kk}>{t("connectors.detail.latency")}</span>    <span style={{ fontFamily: "var(--font-mono)", color: liveStatus?.latency ? "var(--fg)" : "var(--muted-fg)" }}>{liveStatus?.latency || "—"}</span>
            {fields.items && (
              <>
                <span style={kk}>{t("connectors.card.items")}</span>       <span style={{ fontFamily: "var(--font-mono)", color: liveStatus?.itemsSynced != null ? "var(--fg)" : "var(--muted-fg)" }}>
                  {liveStatus?.itemsSynced != null ? liveStatus.itemsSynced : "—"}
                </span>
              </>
            )}
            {isVMware && (
              <>
                <span style={kk}>{t("connectors.detail.configured")}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: liveStatus?.configured ? "var(--ok)" : "var(--warn)" }}>
                  {liveStatus?.configured ? t("connectors.detail.yes") : t("connectors.detail.noEnterCreds")}
                </span>
              </>
            )}
            {isBW && (
              <>
                <span style={kk}>{t("connectors.detail.serverHealth")}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: liveStatus?.serverHealth ? "var(--ok)" : liveStatus?.lastTest ? "var(--err)" : "var(--muted-fg)" }}>
                  {liveStatus?.serverHealth ? t("connectors.detail.reachable") : liveStatus?.lastTest ? t("connectors.detail.unreachable") : t("connectors.detail.notTested")}
                </span>
                <span style={kk}>{t("connectors.detail.cliStatus")}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {(() => {
                    const st = liveStatus?.bwCliStatus;
                    if (!st) return <span style={{ color: "var(--muted-fg)" }}>—</span>;
                    const colors = { unlocked: "var(--ok)", locked: "#9a6f00", unauthenticated: "var(--err)", error: "var(--err)" };
                    const icons  = { unlocked: "🔓", locked: "🔒", unauthenticated: "✕", error: "✕" };
                    return <span style={{ color: colors[st] || "var(--muted-fg)" }}>{icons[st] || "?"} {st}</span>;
                  })()}
                </span>
                {liveStatus?.userEmail && (
                  <>
                    <span style={kk}>{t("connectors.detail.loggedInAs")}</span>
                    <span style={vv}>{liveStatus.userEmail}</span>
                  </>
                )}
                <span style={kk}>{t("connectors.detail.configured")}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: liveStatus?.configured ? "var(--ok)" : "var(--warn)" }}>
                  {liveStatus?.configured ? t("connectors.detail.yes") : t("connectors.detail.noClickConfigure")}
                </span>
              </>
            )}
          </div>

          {/* Errors */}
          {liveStatus?.lastError && (
            <div style={{
              fontSize: 12, lineHeight: 1.55, padding: "10px 12px", borderRadius: 6,
              background: "color-mix(in srgb, var(--err) 8%, white)",
              color: "var(--err)", border: "1px solid color-mix(in srgb, var(--err) 25%, var(--border))",
            }}>
              <b>{t("connectors.detail.lastError")}</b><br />{liveStatus.lastError}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => onPulse(conn.id, "test")} disabled={isBusy} style={primaryBtn}>
              {isBusy ? <Spinner size={11} color="white" /> : "↻"} {t("connectors.detail.testConnection")}
            </button>
            <button onClick={() => onPulse(conn.id, "sync")} disabled={isBusy} style={secondaryBtn}>⟳ {t("connectors.card.syncNow")}</button>
            {(hasCustomConfig || conn.configurable) && (
              <button onClick={() => setShowConfig(v => !v)} style={{ ...secondaryBtn, borderColor: showConfig ? "var(--accent)" : undefined, color: showConfig ? "var(--accent)" : undefined }}>
                ⚙ {showConfig ? t("connectors.detail.hideConfig") : t("connectors.detail.configure")}
              </button>
            )}
            {SIMPLE_ONPULSE[conn.type] && (
              <button onClick={() => setShowAddInstance(true)} style={secondaryBtn} title={t("connectors.detail.addAnotherTitle")}>
                {t("connectors.detail.addAnother")}
              </button>
            )}
            <button onClick={() => setShowInterval(v => !v)} style={{ ...secondaryBtn, borderColor: showInterval ? "var(--accent)" : undefined, color: showInterval ? "var(--accent)" : undefined }}>
              ⏱ {showInterval ? t("connectors.detail.hideInterval") : t("connectors.detail.syncIntervalShort")}
            </button>
          </div>

          {showInterval && <SyncIntervalControl id={conn.id} />}

          {/* VMware credential config form */}
          {isVMware && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.vcenterCreds")}</div>
              <VCenterConfigPanel connId={conn.id} onSaved={(info) => {
                onConfigSaved(conn.id, info);
                setShowConfig(false);
              }} />
            </div>
          )}

          {/* Bitwarden config form */}
          {isBW && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.bwConfig")}</div>
              <BWConfigPanel onSaved={(info) => {
                onConfigSaved(conn.id, info);
                setShowConfig(false);
              }} />
            </div>
          )}

          {/* Plane.so config form */}
          {isPlane && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.planeConfig")}</div>
              <PlaneConfigPanel id={conn.id} onSaved={(info) => {
                onConfigSaved(conn.id, info);
                setShowConfig(false);
              }} />
            </div>
          )}

          {/* Qportal config form */}
          {isQportal && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.qportalConfig")}</div>
              <QportalConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* Outlook config form */}
          {isOutlook && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.outlookConfig")}</div>
              <OutlookConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); }} />
            </div>
          )}

          {/* Portainer config form */}
          {isPortainer && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.portainerConfig")}</div>
              <PortainerConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* Anthropic config form */}
          {isAnthropic && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.anthropicConfig")}</div>
              <AnthropicConfigPanel onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 14 }}>
                <div style={sectionLabel}>{t("connectors.detail.calibrateLimits")}</div>
                <AnthropicCalibratePanel metric={liveStatus?.metric || "cost"} onDone={() => onPulse(conn.id, "sync")} />
              </div>
            </div>
          )}

          {isGitlab && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.gitlabConfig")}</div>
              <GitlabConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* GitHub config form */}
          {isGithub && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.githubConfig")}</div>
              <GithubConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* Bitbucket config form */}
          {isBitbucket && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.bitbucketConfig")}</div>
              <BitbucketConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* Outline config form */}
          {isOutline && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.outlineConfig")}</div>
              <OutlineConfigPanel id={conn.id} onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* UCS Manager config form */}
          {isUcsm && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{t("connectors.detail.ucsmConfig")}</div>
              <UcsmConfigPanel onSaved={(info) => { onConfigSaved(conn.id, info); setShowConfig(false); }} />
            </div>
          )}

          {/* A package with a conventional /config route needs no new JSX here. */}
          {!hasCustomConfig && conn.configurable && showConfig && (
            <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={sectionLabel}>{conn.name} Config</div>
              <GenericConnectorConfigPanel connector={conn} onSaved={(info) => {
                onConfigSaved(conn.id, info);
                setShowConfig(false);
              }} />
            </div>
          )}

          {/* Runtime — only shown for a non-default transport (currently just
              outlook-local's "script"): explains why Endpoint/Auth/Items are
              missing above instead of leaving that unexplained. */}
          {conn.transport && conn.transport !== "http" && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.runtime")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--muted)", color: "var(--muted-fg)", fontWeight: 500, textTransform: "capitalize" }}>
                  {conn.transport}
                </span>
                {(conn.os || []).map(o => (
                  <span key={o} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--muted)", color: "var(--muted-fg)", fontWeight: 500 }}>
                    {o === "win32" ? "Windows" : o}
                  </span>
                ))}
              </div>
              {conn.requires && <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 6, lineHeight: 1.5 }}>{conn.requires}</div>}
            </div>
          )}

          {/* Docs */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ ...sectionLabel, marginBottom: 0 }}>{t("connectors.detail.documentation")}</div>
              <button onClick={() => setShowReadme(true)} style={{ ...secondaryBtn, height: 24, padding: "0 8px", fontSize: 11 }}>
                {t("connectors.detail.viewReadme")}
              </button>
            </div>
            {conn.docs && (
              <a href={conn.docs} target="_blank" rel="noreferrer"
                onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.detail.openingDocs", "", { url: conn.docs }), kind: "info" } })); }}
                style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                ↗ {conn.docs}
              </a>
            )}
          </div>

          {/* Danger zone — set apart from the actions above (Test/Sync/
              Configure are all reversible; this isn't), same visual
              separation this file already uses around config forms. */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 2 }}>
            <div style={{ ...sectionLabel, color: "var(--err)" }}>{t("connectors.detail.dangerZone")}</div>
            <button onClick={() => setShowDeleteConfirm(true)}
              style={{ height: 30, padding: "0 12px", background: "white", color: "var(--err)", border: "1px solid color-mix(in srgb, var(--err) 40%, var(--border))", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {t("connectors.detail.deleteConnection")}
            </button>
          </div>
        </ConnectorDetailZoneWrap>
        {!mobile && <ConnectorsResizeHandle onMouseDown={e => onZone1HandleDown(e, 1)} />}

        {/* Zone 2 — synced data & AI context */}
        <ConnectorDetailZoneWrap mobile={mobile} tag="section" ariaLabel={t("connectors.detail.dataAiContext")} style={{ ...zoneCol, flex: 1 }}
          id="zone2" openSection={openSection} setOpenSection={setOpenSection} title={t("connectors.detail.dataAiContext")}>
          <div style={zoneHeading}>{t("connectors.detail.dataAiContext")}</div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={sectionLabel}>{t("connectors.aiContext.title")}</div>
              {!showAIContext && (
                <button onClick={() => setShowAIContext(true)} style={{ ...secondaryBtn, height: 24, padding: "0 8px", fontSize: 11 }}>
                  {t("connectors.detail.showAiContext")}
                </button>
              )}
            </div>
            {showAIContext ? <AIContextControl id={conn.id} /> : (
              <div style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>
                {t("connectors.detail.aiContextInactiveDesc")}
              </div>
            )}
          </div>

          {/* Git providers only — the committer identity has no meaning for a
              connector that never produces local commits. */}
          {(isGitlab || isGithub || isBitbucket) && <CommitIdentityControl id={conn.id} />}

          {/* Plane.so live data — projects list */}
          {isPlane && liveStatus?.projects?.length > 0 && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.projectsSynced")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {liveStatus.projects.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--muted)", borderRadius: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "#f97316", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, flex: 1 }}>{p.name}</span>
                    <span style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{p.identifier}</span>
                    <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{p.issueCount ?? "—"} issues</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Portainer live summary */}
          {isPortainer && liveStatus?.endpointCount != null && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.synced")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 10px", background: "var(--muted)", borderRadius: 5, justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#C080FF" }}>→</span>
                  <span>{t("connectors.detail.endpointsContainers")}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>{liveStatus.endpointCount} · {liveStatus.itemsSynced ?? "—"}</span>
              </div>
            </div>
          )}

          {/* Anthropic live data — plan usage gauges */}
          {isAnthropic && (liveStatus?.fiveHour || liveStatus?.weekly) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={sectionLabel}>{t("connectors.detail.planUsage")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <UsageGauge label={t("connectors.detail.fiveHourLimit")} gauge={liveStatus.fiveHour} metric={liveStatus.metric}
                    onCalibrate={() => setShowConfig(true)} />
                  <UsageGauge label={t("connectors.detail.weeklyAllModels")} gauge={liveStatus.weekly} metric={liveStatus.metric}
                    onCalibrate={() => setShowConfig(true)} />
                </div>
              </div>

              {liveStatus.contextWindow && (
                <div>
                  <div style={sectionLabel}>{t("connectors.detail.contextWindowLastTurn")}</div>
                  <UsageGauge
                    label={liveStatus.contextWindow.model}
                    metric="tokens"
                    gauge={{
                      used: liveStatus.contextWindow.used,
                      limit: liveStatus.contextWindow.limit,
                      percent: liveStatus.contextWindow.percent,
                      remaining: liveStatus.contextWindow.limit != null
                        ? liveStatus.contextWindow.limit - liveStatus.contextWindow.used
                        : null,
                      resetsInMs: null,
                    }}
                  />
                </div>
              )}

              {liveStatus.byModel?.length > 0 && (
                <div>
                  <div style={sectionLabel}>{t("connectors.detail.byModelDays", "", { days: liveStatus.source?.lookbackDays || 30 })}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {liveStatus.byModel.map(m => (
                      <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--muted)", borderRadius: 6, fontSize: 12 }}>
                        <span style={{ fontWeight: 600, flex: 1 }}>{m.model}</span>
                        <span style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{m.entries} {t("connectors.detail.turns")}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", color: ANTHROPIC_ACCENT }}>{formatUsageValue(m.tokens, "tokens")} tok</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: 6, lineHeight: 1.5 }}>
                    {t("connectors.detail.readFrom", "", { count: liveStatus.source?.fileCount || 0, host: liveStatus.source?.host || t("connectors.detail.thisMachine") })}
                    {" "}{t("connectors.detail.readFromSuffix")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* GitLab live data — recent deployments */}
          {isGitlab && liveStatus?.deployments?.length > 0 && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.recentDeployments")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {liveStatus.deployments.slice(0, 15).map(dep => {
                  const statusColor = dep.status === "success" ? "var(--ok)" : dep.status === "failed" ? "var(--err)" : dep.status === "running" ? "var(--warn)" : "var(--muted-fg)";
                  return (
                    <a key={dep.id} href={dep.webUrl} target="_blank" rel="noreferrer"
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--muted)", borderRadius: 6, fontSize: 12, textDecoration: "none", color: "inherit" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: statusColor, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, flex: 1 }}>{dep.projectName}</span>
                      <span style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{dep.environment}</span>
                      <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: statusColor, fontWeight: 600 }}>{dep.status}</span>
                      <span style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{dep.createdAt ? new Date(dep.createdAt).toLocaleDateString() : "—"}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* GitHub live data — recent deployments */}
          {isGithub && liveStatus?.deployments?.length > 0 && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.recentDeployments")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {liveStatus.deployments.slice(0, 15).map(dep => {
                  const statusColor = dep.status === "success" ? "var(--ok)" : dep.status === "failed" ? "var(--err)" : dep.status === "running" ? "var(--warn)" : "var(--muted-fg)";
                  return (
                    <a key={dep.id} href={dep.webUrl} target="_blank" rel="noreferrer"
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--muted)", borderRadius: 6, fontSize: 12, textDecoration: "none", color: "inherit" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: statusColor, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, flex: 1 }}>{dep.projectName}</span>
                      <span style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{dep.environment}</span>
                      <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: statusColor, fontWeight: 600 }}>{dep.status}</span>
                      <span style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{dep.createdAt ? new Date(dep.createdAt).toLocaleDateString() : "—"}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Outline live data — collections */}
          {isOutline && liveStatus?.collections?.length > 0 && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.collectionsSynced")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {liveStatus.collections.map(c => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--muted)", borderRadius: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color || "#000000", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, flex: 1 }}>{c.name}</span>
                    <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{c.documentCount} docs</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* UCS Manager live data — chassis + blades per site */}
          {isUcsm && liveStatus?.sites && Object.keys(liveStatus.sites).length > 0 && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.chassisBladesSynced")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.entries(liveStatus.sites).map(([site, data]) => (
                  <div key={site}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-fg)", marginBottom: 4 }}>{t("connectors.detail.chassisBladesCount", "", { site, chassis: data.chassis?.length || 0, blades: data.blades?.length || 0 })}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {(data.blades || []).map(b => (
                        <div key={b.dn} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--muted)", borderRadius: 6, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#049fd9", flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, flex: 1, fontFamily: "var(--font-mono)" }}>{b.dn}</span>
                          <span style={{ fontSize: 10.5, color: "var(--muted-fg)" }}>{b.model}</span>
                          <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{b.numCores}c / {b.ramMB ? Math.round(b.ramMB/1024) : "—"}GB</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outlook live summary */}
          {isOutlook && liveStatus?.eventCount != null && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.calendarSynced")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 10px", background: "var(--muted)", borderRadius: 5, justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#0078d4" }}>→</span>
                  <span>{t("connectors.detail.eventsThisWeek")}{liveStatus.user ? ` · ${liveStatus.user}` : ""}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>{liveStatus.eventCount}</span>
              </div>
            </div>
          )}

          {/* Qportal live data summary */}
          {isQportal && liveStatus?.vrfCount != null && (
            <div>
              <div style={sectionLabel}>{t("connectors.detail.syncedDataQportal")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { label: "VRF Catalog",         count: liveStatus.vrfCount },
                  { label: t("connectors.detail.resourceRequests"),    count: liveStatus.reqCount },
                  { label: t("connectors.detail.assignedResources"),   count: liveStatus.assignedCount },
                ].map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 10px", background: "var(--muted)", borderRadius: 5, justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#0ea5e9" }}>→</span>
                      <span>{f.label}</span>
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>{f.count ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data feeds */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={sectionLabel}>{t("connectors.detail.dataFeeds")}</div>
              {isVMware && liveStatus?.feeds?.syncedAt && (
                <span style={{ fontSize: 10, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>
                  {t("connectors.detail.syncedAt", "", { time: new Date(liveStatus.feeds.syncedAt).toLocaleTimeString() })}
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(isVMware && liveStatus?.feeds) ? (
                // Real feed counts from vCenter sync
                <>
                  {[
                    { label: t("connectors.detail.virtualMachines"), count: liveStatus.feeds.vms,        icon: "🖥" },
                    { label: "ESXi Hosts",        count: liveStatus.feeds.hosts,      icon: "🔲" },
                    { label: "Datastores",        count: liveStatus.feeds.datastores, icon: "💾" },
                  ].map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 10px", background: "var(--muted)", borderRadius: 5, justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--accent)" }}>→</span>
                        <span>{f.label}</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--fg)" }}>{f.count}</span>
                    </div>
                  ))}
                  {/* Clusters — expanded with DRS/HA details */}
                  <div style={{ background: "var(--muted)", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 10px", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--accent)" }}>→</span>
                        <span>Clusters</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--fg)" }}>{liveStatus.feeds.clusters}</span>
                    </div>
                    {(liveStatus.feeds.clusterDetails || []).length > 0 && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "4px 0" }}>
                        {(liveStatus.feeds.clusterDetails || []).map(cl => (
                          <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px 4px 28px", fontSize: 12 }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flex: 1, color: "var(--fg)" }}>{cl.name}</span>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)",
                              background: cl.drs_enabled ? "color-mix(in srgb, var(--ok) 14%, white)" : "var(--muted)",
                              color: cl.drs_enabled ? "var(--ok)" : "var(--muted-fg)",
                              border: `1px solid ${cl.drs_enabled ? "color-mix(in srgb, var(--ok) 30%, white)" : "var(--border)"}`,
                            }}>DRS</span>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)",
                              background: cl.ha_enabled ? "color-mix(in srgb, #8b5cf6 14%, white)" : "var(--muted)",
                              color: cl.ha_enabled ? "#8b5cf6" : "var(--muted-fg)",
                              border: `1px solid ${cl.ha_enabled ? "color-mix(in srgb, #8b5cf6 30%, white)" : "var(--border)"}`,
                            }}>HA</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // Static fallback
                conn.feeds.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 8px", background: "var(--muted)", borderRadius: 5 }}>
                    <span style={{ color: "var(--accent)" }}>→</span>
                    {f}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sample endpoints */}
          <div>
            <div style={sectionLabel}>{t("connectors.detail.sampleEndpoints")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {conn.sampleEndpoints.map((e, i) => (
                <code key={i} style={{
                  fontSize: 11, fontFamily: "var(--font-mono)",
                  padding: "5px 8px", background: "#1c1917", color: "#fafaf9", borderRadius: 4,
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>{e}</code>
              ))}
            </div>
          </div>
        </ConnectorDetailZoneWrap>
        {!mobile && <ConnectorsResizeHandle onMouseDown={e => onZone3HandleDown(e, -1)} />}

        {/* Zone 3 — activity log */}
        <ConnectorDetailZoneWrap mobile={mobile} tag="aside" ariaLabel={t("connectors.detail.activityLog")} style={{ ...zoneCol, width: zone3Width, flexShrink: 0 }}
          id="zone3" openSection={openSection} setOpenSection={setOpenSection} title={t("connectors.detail.activityLog")}>
          <div style={zoneHeading}>{t("connectors.detail.activityLog")}</div>
          {(() => {
            const LOG_PAGE_SIZE = 10;
            const liveCount   = liveLog?.length || 0;
            const allEntries  = liveLog || [];
            const logColors   = { ok: "#4ade80", warn: "#fbbf24", err: "#f87171" };
            const logDots     = { ok: "#22c55e", warn: "#f59e0b", err: "#ef4444" };
            const q           = logSearch.trim().toLowerCase();
            const filtered    = q ? allEntries.filter(l => l.msg.toLowerCase().includes(q) || l.t.includes(q)) : allEntries;
            const totalPages  = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
            const safePage    = Math.min(logPage, totalPages - 1);
            const pageEntries = filtered.slice(safePage * LOG_PAGE_SIZE, safePage * LOG_PAGE_SIZE + LOG_PAGE_SIZE);
            const thStyle = { textAlign: "left", padding: "6px 12px", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#475569", borderBottom: "1px solid #1e293b" };
            const pagerBtn = (disabled) => ({
              background: "none", border: "1px solid var(--border)", borderRadius: 5,
              padding: "3px 9px", fontSize: 11, fontFamily: "inherit", color: disabled ? "var(--muted-fg)" : "var(--fg)",
              cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
            });
            return (
              <div>
                <style>{`@keyframes logFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                  <div style={sectionLabel}>{q ? t("connectors.detail.entriesFiltered", "", { filtered: filtered.length, total: allEntries.length }) : t("connectors.detail.entriesTotal", "", { total: allEntries.length })}</div>
                  {liveCount > 0 && (
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "2px 7px", borderRadius: 10, background: "color-mix(in srgb,var(--ok) 12%,white)", color: "var(--ok)", border: "1px solid color-mix(in srgb,var(--ok) 25%,var(--border))", textTransform: "uppercase", flexShrink: 0 }}>
                      {t("connectors.detail.live")}
                    </span>
                  )}
                </div>
                <input
                  value={logSearch}
                  onChange={e => { setLogSearch(e.target.value); setLogPage(0); }}
                  placeholder={t("connectors.detail.searchLog")}
                  style={{ width: "100%", height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: 0, marginBottom: 8 }}
                />
                <div style={{ background: "#0f172a", borderRadius: 7, overflow: "hidden" }}>
                  {pageEntries.length === 0 ? (
                    <div style={{ padding: 14, fontFamily: "var(--font-mono)", fontSize: 11, color: "#475569" }}>
                      {allEntries.length === 0 ? t("connectors.detail.noActivityYet") : t("connectors.detail.noEntriesMatch")}
                    </div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, width: 74 }}>{t("connectors.detail.time")}</th>
                          <th style={{ ...thStyle, width: 14 }} />
                          <th style={thStyle}>{t("connectors.detail.message")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageEntries.map((l, i) => {
                          const globalIndex = safePage * LOG_PAGE_SIZE + i;
                          const isLive = globalIndex < liveCount;
                          const color  = logColors[l.level] || "#94a3b8";
                          const dot    = logDots[l.level]   || "#64748b";
                          return (
                            <tr key={`${l.t}-${globalIndex}`} style={{
                              background: isLive && globalIndex === 0 ? "rgba(99,102,241,.07)" : "transparent",
                              animation: isLive && globalIndex === 0 ? "logFadeIn .25s ease" : "none",
                            }}>
                              <td style={{ padding: "6px 12px", fontFamily: "var(--font-mono)", color: "#475569", fontSize: 10.5, whiteSpace: "nowrap", verticalAlign: "top", borderTop: i === 0 ? "none" : "1px solid #1e293b" }}>{l.t}</td>
                              <td style={{ padding: "6px 0", verticalAlign: "top", borderTop: i === 0 ? "none" : "1px solid #1e293b" }}>
                                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: dot, marginTop: 5 }} />
                              </td>
                              <td style={{ padding: "6px 12px", fontFamily: "var(--font-mono)", fontSize: 11, color, lineHeight: 1.55, wordBreak: "break-all", verticalAlign: "top", borderTop: i === 0 ? "none" : "1px solid #1e293b" }}>
                                {l.msg}
                                {isLive && (
                                  <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "#1e293b", color: "#64748b", marginLeft: 6, letterSpacing: 0.3 }}>{t("connectors.detail.now")}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 2px 0" }}>
                    <button onClick={() => setLogPage(p => Math.max(0, p - 1))} disabled={safePage <= 0} style={pagerBtn(safePage <= 0)}>{t("pagination.prev")}</button>
                    <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{t("pagination.page", "", { page: safePage + 1, total: totalPages })}</span>
                    <button onClick={() => setLogPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} style={pagerBtn(safePage >= totalPages - 1)}>{t("pagination.next")}</button>
                  </div>
                )}
              </div>
            );
          })()}
        </ConnectorDetailZoneWrap>
      </div>

      {showAddInstance && (
        <AddInstanceModal
          typeId={conn.type}
          typeLabel={SIMPLE_ONPULSE[conn.type]?.displayName || conn.type}
          onClose={() => setShowAddInstance(false)}
          onCreated={(created) => { setShowAddInstance(false); onInstanceCreated?.(created); }}
        />
      )}
      {showReadme && <ReadmeModal conn={conn} onClose={() => setShowReadme(false)} />}
      {showDeleteConfirm && (
        <DeleteConnectorConfirm
          conn={conn}
          onClose={() => setShowDeleteConfirm(false)}
          onDeleted={() => { setShowDeleteConfirm(false); onDeleted?.(conn.id); }}
        />
      )}
    </section>
  );
}

// Warns exactly what deleting a connector will take with it — Boards that
// lose blocks, Boards/Dashboards deleted outright because every block they
// had came from this connector — before the DELETE below actually runs
// (server/routes/connectors.js's computeConnectorImpact powers both this
// preview and the real cascade, so what's shown here is what happens).
function DeleteConnectorConfirm({ conn, onClose, onDeleted }) {
  const t = window.I18N.t;
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    window.HQ_API.request(`/api/connectors/${conn.id}/impact`)
      .then(data => { if (active) setImpact(data); })
      .catch(e => { if (active) setErr(e.message || t("connectors.saveFailed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conn.id]);

  const hasImpact = impact && (impact.boards.length > 0 || impact.dashboards.length > 0);

  const handleDelete = async () => {
    setDeleting(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${conn.id}`, { method: "DELETE" });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.detail.deleteToast", "", { name: conn.name }), kind: "ok" } }));
      onDeleted();
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
      setDeleting(false);
    }
  };

  return (
    <div onClick={e => e.target === e.currentTarget && !deleting && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ background: "white", borderRadius: 12, width: "min(460px, 94vw)", maxHeight: "86vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.22)", padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          {t("connectors.detail.deleteTitle", "", { name: conn.name })}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-fg)", lineHeight: 1.5, marginBottom: 14 }}>
          {t("connectors.detail.deleteIntro")}
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "var(--muted-fg)", fontSize: 12 }}>
            <Spinner size={12} /> {t("connectors.config.loading")}
          </div>
        ) : hasImpact ? (
          <div style={{ background: "color-mix(in srgb, var(--err) 6%, white)", border: "1px solid color-mix(in srgb, var(--err) 25%, var(--border))", borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--err)", marginBottom: 8 }}>
              ⚠ {t("connectors.detail.deleteWarningIntro")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
              {impact.boards.map(b => (
                <div key={b.id} style={{ display: "flex", gap: 6 }}>
                  <span>📋</span>
                  <span><b>{b.title}</b> — {b.willBeDeleted
                    ? t("connectors.detail.deleteBoardWillBeDeleted")
                    : t("connectors.detail.deleteBlocksRemoved", "", { count: b.blocksRemoved })}</span>
                </div>
              ))}
              {impact.dashboards.map(d => (
                <div key={d.id} style={{ display: "flex", gap: 6 }}>
                  <span>🗂</span>
                  <span><b>{d.title}</b> — {d.willBeDeleted
                    ? t("connectors.detail.deleteDashboardWillBeDeleted")
                    : t("connectors.detail.deleteBoardsRemoved", "", { count: d.boardsRemoved })}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px", marginBottom: 12 }}>{err}</div>}

        <div style={{ fontSize: 12, color: "var(--muted-fg)", marginBottom: 16 }}>
          {t("connectors.detail.deleteCannotUndo")}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={deleting} style={{ height: 32, padding: "0 14px", background: "white", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: deleting ? "default" : "pointer", fontFamily: "inherit" }}>
            {t("connectors.cancel")}
          </button>
          <button onClick={handleDelete} disabled={loading || deleting} style={{ height: 32, padding: "0 14px", background: "var(--err)", color: "white", border: 0, borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: (loading || deleting) ? "default" : "pointer", fontFamily: "inherit", opacity: (loading || deleting) ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}>
            {deleting && <Spinner size={11} color="white" />}
            {deleting ? t("connectors.detail.deleting") : t("connectors.detail.deleteConnection")}
          </button>
        </div>
      </div>
    </div>
  );
}

const ANTHROPIC_ACCENT = "#D97757";
// Plan gauges follow Claude Code's own palette so the two read as the same
// measurement: blue while there is headroom, amber then red as it runs out.
const GAUGE_BLUE = "#3B6FF5";
const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function formatUsageValue(value, metric) {
  if (value == null) return "—";
  if (metric === "tokens") {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
    return String(Math.round(value));
  }
  return `$${Number(value).toFixed(2)}`;
}

function formatResetIn(ms) {
  if (ms == null) return "—";
  const t = window.I18N.t;
  const minUnit = t("connectors.unit.min"), hUnit = t("connectors.unit.hour"), dUnit = t("connectors.unit.day");
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} ${minUnit}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hUnit} ${minutes % 60} ${minUnit}`;
  return `${Math.floor(hours / 24)} ${dUnit} ${hours % 24} ${hUnit}`;
}

// A labelled progress bar. When the plan limit has not been calibrated there is
// no ratio to draw, so the track is left empty and dashed — a filled bar in any
// colour reads as a real measurement, which is exactly what we do not have.
function UsageGauge({ label, gauge, metric, onCalibrate }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  if (!gauge) return null;
  const pct = gauge.percent;
  const uncalibrated = pct == null;
  // "observed" limits come from past 429s and are only a floor, so the ratio is
  // an approximation and can legitimately exceed 100%.
  const estimated = gauge.source === "observed";
  const clamped = uncalibrated ? 0 : Math.min(100, Math.max(0, pct));
  const over = !uncalibrated && pct > 100;
  const barColor = over || clamped >= 90 ? "var(--err)" : clamped >= 75 ? "var(--warn)" : GAUGE_BLUE;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {/* Label, reset time and percentage share one row, then the bar spans the
          full width underneath — the same arrangement Claude Code uses. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
        <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
        {gauge.resetsInMs != null && (
          <span style={{ fontSize: 11, color: "var(--muted-fg)", whiteSpace: "nowrap" }}>
            {t("connectors.detail.resetsIn", "", { time: formatResetIn(gauge.resetsInMs) })}
          </span>
        )}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", color: uncalibrated ? "var(--muted-fg)" : barColor }}>
          {uncalibrated ? "—" : `${estimated ? "≈" : ""}${over ? ">100" : pct}%`}
        </span>
      </div>

      {uncalibrated ? (
        <div style={{ height: 8, borderRadius: 999, border: "1px dashed var(--border)", boxSizing: "border-box" }} />
      ) : (
        <div style={{ height: 8, borderRadius: 999, background: "var(--muted)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${over ? 100 : clamped}%`, background: barColor, borderRadius: 999, transition: "width .3s", opacity: estimated ? 0.75 : 1 }} />
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {uncalibrated
            ? formatUsageValue(gauge.used, metric)
            : `${formatUsageValue(gauge.used, metric)} / ${estimated ? "≥" : ""}${formatUsageValue(gauge.limit, metric)}`}
        </span>
        <span>
          {uncalibrated || estimated ? (
            onCalibrate ? (
              <button type="button" onClick={onCalibrate}
                style={{ background: "none", border: 0, padding: 0, font: "inherit", color: ANTHROPIC_ACCENT, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                {estimated ? t("connectors.detail.estimatedCalibrate") : t("connectors.detail.calibrateToSeePercent")}
              </button>
            ) : (estimated ? t("connectors.detail.estimatedFromPrevious") : t("connectors.detail.uncalibrated"))
          ) : t("connectors.detail.remaining", "", { amount: formatUsageValue(gauge.remaining, metric) })}
        </span>
      </div>
    </div>
  );
}

// Anthropic does not publish subscription quotas, so the gauges are anchored to
// the percentages Claude Code itself reports.
function AnthropicCalibratePanel({ metric, onDone }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [fiveHourPercent, setFiveHour] = useState("");
  const [weeklyPercent, setWeekly]     = useState("");
  const [saving, setSaving]            = useState(false);
  const [err, setErr]                  = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!fiveHourPercent && !weeklyPercent) { setErr(t("connectors.anthropic.percentRequired")); return; }
    setSaving(true); setErr("");
    try {
      const body = {};
      if (fiveHourPercent) body.fiveHourPercent = Number(fiveHourPercent);
      if (weeklyPercent) body.weeklyPercent = Number(weeklyPercent);
      const r = await window.HQ_API.request("/api/connectors/anthropic/calibrate", { method: "POST", body });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.anthropic.limitsCalibrated", "", { metric: r.metric }), kind: "ok" } }));
      onDone && onDone(r);
    } catch (e) {
      setErr(e.message || t("connectors.anthropic.calibrationFailed"));
    } finally { setSaving(false); }
  };

  const inp = { height: 32, padding: "0 10px", fontSize: 12.5, border: "1px solid var(--border)", borderRadius: 5, outline: 0, fontFamily: "var(--font-mono)", width: "100%", background: "white", color: "var(--fg)" };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "var(--muted-fg)", lineHeight: 1.5 }}>
        {t("connectors.anthropic.explainerPrefix")} <b>{metric === "tokens" ? t("connectors.anthropic.metricTokens") : t("connectors.anthropic.metricCost")}</b>.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", display: "block", marginBottom: 4 }}>{t("connectors.anthropic.fiveHourPercentLabel")}</label>
          <input style={inp} type="number" min="0.1" max="100" step="0.1" placeholder="19" value={fiveHourPercent} onChange={e => setFiveHour(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", display: "block", marginBottom: 4 }}>{t("connectors.anthropic.weeklyPercentLabel")}</label>
          <input style={inp} type="number" min="0.1" max="100" step="0.1" placeholder="28" value={weeklyPercent} onChange={e => setWeekly(e.target.value)} />
        </div>
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: ANTHROPIC_ACCENT, color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.anthropic.calibrating") : t("connectors.anthropic.calibrateLimits")}
      </button>
    </form>
  );
}

function AnthropicConfigPanel({ onSaved }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [cfg, setCfg]       = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/connectors/anthropic/config-schema"),
      window.HQ_API.request("/api/connectors/anthropic/config")
        .catch(() => ({ metric: "cost", lookbackDays: 30, weeklyReset: { weekday: 4, hour: 22 } })),
    ]).then(([schemaRes, cfgRes]) => {
      // blockHours/limits son ajustes de calibración avanzados sin UI propia
      // todavía, y weeklyReset.minute no se expone (siempre en punto) — se
      // omiten del formulario básico en vez de mostrarlos a medio terminar.
      const { transcriptsDir, lookbackDays, metric, weeklyReset, adminApiKey } = schemaRes.properties || {};
      const { minute, ...weeklyResetProps } = weeklyReset?.properties || {};
      setSchema({
        ...schemaRes,
        properties: { transcriptsDir, lookbackDays, metric, weeklyReset: { ...weeklyReset, properties: weeklyResetProps }, adminApiKey },
      });
      setCfg(cfgRes);
    });
  }, []);

  if (!cfg || !schema) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}>
      <Spinner size={12} /> {t("connectors.config.loading")}
    </div>
  );

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true); setErr("");
    try {
      const body = {
        transcriptsDir: cfg.transcriptsDir,
        lookbackDays: Number(cfg.lookbackDays) || 30,
        metric: cfg.metric,
        weeklyReset: cfg.weeklyReset,
      };
      if (cfg.adminApiKey?.trim()) body.adminApiKey = cfg.adminApiKey.trim();
      await window.HQ_API.request("/api/connectors/anthropic/config", { method: "POST", body });
      onSaved({ metric: cfg.metric });
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.config.saved", "", { provider: "Anthropic" }), kind: "ok" } }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <window.SchemaFields
        schema={schema}
        values={cfg}
        connectorId="anthropic"
        onChange={(key, v) => setCfg(c => ({ ...c, [key]: v }))}
        secretPlaceholder={cfg.hasAdminApiKey ? t("connectors.anthropic.savedKeyPlaceholder") : "sk-ant-admin-…"}
      />
      <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: -4 }}>
        {t("connectors.anthropic.localPathPart1")} <b>{t("connectors.detail.thisMachine")}</b>{t("connectors.anthropic.localPathPart2")}
        {" "}<b>API keys</b> {t("connectors.anthropic.localPathPart3")}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      <button type="submit" disabled={saving}
        style={{ height: 30, padding: "0 14px", background: ANTHROPIC_ACCENT, color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>
        {saving && <Spinner size={11} color="white" />}
        {saving ? t("connectors.saving") : t("connectors.config.saveConfig")}
      </button>
    </form>
  );
}

const kk = { color: "var(--muted-fg)", fontWeight: 500 };
const vv = { fontFamily: "var(--font-mono)", color: "var(--fg)", wordBreak: "break-all" };
const sectionLabel = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: "var(--muted-fg)", textTransform: "uppercase", marginBottom: 6 };
const primaryBtn = { height: 30, padding: "0 12px", background: "var(--accent)", color: "white", border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 };
const secondaryBtn = { height: 30, padding: "0 12px", background: "white", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };

// ─── New Connection modal ─────────────────────────────────────────────────────
// The connector catalog itself comes from manifest.json through
// GET /api/connectors/catalog. This small presentation map is deliberately
// optional: a new connector gets the generic accent and monogram until it adds
// a branded logo, without requiring an edit to this view.
const CONNECTOR_PICKER_COLORS = Object.freeze({
  anthropic: ANTHROPIC_ACCENT, bitbucket: "#0052CC", bw: "#175ddc",
  github: "#24292f", gitlab: "#380D75", outline: "#27272a", outlook: "#0078d4",
  plane: "#f97316", portainer: "#C080FF", qportal: "#0ea5e9", ucsm: "#049fd9", vcenter: "#ffffff",
});

function pickerColor(id) {
  return CONNECTOR_PICKER_COLORS[id] || "var(--accent)";
}

function GenericConnectorConfigPanel({ connector, onSaved }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      window.HQ_API.request(`/api/connectors/${connector.id}/config-schema`),
      window.HQ_API.request(`/api/connectors/${connector.id}/config`),
    ]).then(([schemaRes, cfg]) => {
      if (!active) return;
      const defaults = Object.fromEntries(Object.entries(schemaRes.properties || {})
        .filter(([, prop]) => prop.default !== undefined)
        .map(([key, prop]) => [key, prop.default]));
      const visibleValues = Object.fromEntries(Object.keys(schemaRes.properties || {})
        .filter((key) => cfg?.[key] !== undefined)
        .map((key) => [key, cfg[key]]));
      setSchema(schemaRes);
      setValues({ ...defaults, ...visibleValues });
    }).catch((error) => {
      if (active) setErr(error.message || t("connectors.generic.schemaLoadFailed"));
    });
    return () => { active = false; };
  }, [connector.id]);

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true); setErr("");
    try {
      await window.HQ_API.request(`/api/connectors/${connector.id}/config`, { method: "POST", body: values });
      onSaved({ id: connector.id });
    } catch (error) {
      setErr(error.message || t("connectors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!schema && !err) return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--muted-fg)", fontSize: 12 }}><Spinner size={12} /> {t("connectors.config.loading")}</div>;
  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema && <window.SchemaFields schema={schema} values={values} connectorId={connector.id} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />}
      {err && <div style={{ fontSize: 11.5, color: "var(--err)", background: "color-mix(in srgb,var(--err) 8%,white)", border: "1px solid color-mix(in srgb,var(--err) 20%,var(--border))", borderRadius: 5, padding: "6px 8px" }}>{err}</div>}
      {schema && <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? .7 : 1, alignSelf: "flex-start" }}>{saving && <Spinner size={11} color="white" />}{saving ? t("connectors.saving") : t("connectors.config.saveConfig")}</button>}
    </form>
  );
}

// Existing providers retain their small workflow additions (Vault picker and
// Outlook device code). Any new manifest falls through to the schema-driven
// panel above, so it does not need to be added to connectors.jsx.
// `id` es la conexión concreta que el panel configura. Los cuatro tipos que no
// lo reciben (vcenter, bw, ucsm, anthropic) son justo los que el manifiesto
// declara no instanciables, así que su única conexión siempre es la base.
const CUSTOM_CONFIG_PANELS = Object.freeze({
  vcenter: ({ onSaved }) => <VCenterConfigPanel connId="vcenter" onSaved={onSaved} />,
  bw: ({ onSaved }) => <BWConfigPanel onSaved={onSaved} />,
  plane: ({ onSaved, id }) => <PlaneConfigPanel onSaved={onSaved} id={id} />,
  qportal: ({ onSaved, id }) => <QportalConfigPanel onSaved={onSaved} id={id} />,
  outlook: ({ onSaved, id }) => <OutlookConfigPanel onSaved={onSaved} id={id} />,
  portainer: ({ onSaved, id }) => <PortainerConfigPanel onSaved={onSaved} id={id} />,
  gitlab: ({ onSaved, id }) => <GitlabConfigPanel onSaved={onSaved} id={id} />,
  github: ({ onSaved, id }) => <GithubConfigPanel onSaved={onSaved} id={id} />,
  bitbucket: ({ onSaved, id }) => <BitbucketConfigPanel onSaved={onSaved} id={id} />,
  outline: ({ onSaved, id }) => <OutlineConfigPanel onSaved={onSaved} id={id} />,
  ucsm: ({ onSaved }) => <UcsmConfigPanel onSaved={onSaved} />,
  anthropic: ({ onSaved }) => <AnthropicConfigPanel onSaved={onSaved} />,
});

function NewConnectionModal({ onClose, onSaved }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [step, setStep] = useState("pick");
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [saved, setSaved] = useState(false);
  // La conexión se nombra aquí, antes de existir. Hasta ahora el nombre venía
  // fijo del manifiesto y solo una instancia extra podía llevar etiqueta
  // propia, así que dos cuentas del mismo tipo se veían igual en la grilla.
  const [name, setName] = useState("");
  // La conexión que se está configurando. Es el propio tipo cuando todavía no
  // hay ninguna, y una instancia nueva cuando ya existe: hasta ahora este
  // diálogo escribía siempre sobre la base, así que "New connection" sobre un
  // tipo ya configurado pisaba en silencio las credenciales que hubiera.
  const [targetId, setTargetId] = useState(null);
  const [preparing, setPreparing] = useState(false);
  // Instancia creada por este diálogo y aún sin guardar: si el usuario vuelve
  // o cierra, se borra en vez de quedar como conexión huérfana.
  const pendingInstance = useRef(null);

  useEffect(() => {
    let active = true;
    window.HQ_API.request("/api/connectors/catalog")
      .then((items) => { if (active) setCatalog(Array.isArray(items) ? items : []); })
      .catch((error) => { if (active) setCatalogError(error.message || t("connectors.newConnection.catalogLoadFailed")); });
    return () => { active = false; };
  }, []);

  const selectedConnector = catalog.find((connector) => connector.id === step) || null;
  const defaultName = selectedConnector?.displayName || "";
  // Cada vez que se entra a un tipo, el campo arranca en su nombre por defecto.
  useEffect(() => { setName(defaultName); }, [defaultName]);

  const discardPendingInstance = useCallback(async () => {
    const pending = pendingInstance.current;
    pendingInstance.current = null;
    if (!pending) return;
    await window.HQ_API.request(`/api/connectors/${encodeURIComponent(pending.typeId)}/instances/${encodeURIComponent(pending.instanceId)}`, { method: "DELETE" }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTargetId(null);
    if (!selectedConnector) return undefined;
    setPreparing(true);
    (async () => {
      const existing = await window.HQ_API.request("/api/connectors").catch(() => []);
      const base = Array.isArray(existing) ? existing.find(c => c.id === selectedConnector.id) : null;
      // Solo se crea una conexión aparte si ya hay una configurada de ese tipo
      // y el manifiesto lo permite. El primer GitHub sigue siendo "github".
      if (!base?.configured || !selectedConnector.instantiable) {
        if (!cancelled) { setTargetId(selectedConnector.id); setPreparing(false); }
        return;
      }
      try {
        const created = await window.HQ_API.request(`/api/connectors/${encodeURIComponent(selectedConnector.id)}/instances`, {
          method: "POST", body: { label: (name || defaultName).trim() },
        });
        if (cancelled) return;
        pendingInstance.current = { typeId: selectedConnector.id, instanceId: created.id };
        setTargetId(created.id);
      } catch {
        // Sin instancia no hay dónde escribir, y escribir sobre la base es
        // exactamente lo que este cambio evita.
        if (!cancelled) setTargetId(null);
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedConnector?.id]);
  const SelectedConfigPanel = selectedConnector && CUSTOM_CONFIG_PANELS[selectedConnector.id];

  const closeAndDiscard = useCallback(async () => {
    await discardPendingInstance();
    onClose();
  }, [discardPendingInstance, onClose]);

  const handleSaved = async (info) => {
    const chosen = name.trim();
    // Solo se guarda si difiere del default: así el conector sigue siguiendo
    // al manifiesto cuando el usuario no pidió otra cosa.
    // A partir de aquí la conexión existe de verdad, así que ya no se descarta.
    pendingInstance.current = null;
    if (targetId && chosen && chosen !== defaultName) {
      try {
        await window.HQ_API.request(`/api/connectors/${encodeURIComponent(targetId)}/name`, {
          method: "POST", body: { name: chosen },
        });
      } catch { /* el nombre es cosmético: no tirar una conexión ya guardada */ }
    }
    setSaved(true);
    onSaved({ id: targetId || selectedConnector?.id, ...info });
    setTimeout(() => onClose(), 1200);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => e.target === e.currentTarget && closeAndDiscard()}>
      <div style={{
        background: "white", borderRadius: 12, width: step === "pick" ? 920 : 560, maxWidth: "94vw",
        maxHeight: "88vh",
        boxShadow: "0 24px 60px rgba(0,0,0,.22)", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {step === "pick" ? t("connectors.newConnection.title") : selectedConnector?.displayName || t("connectors.newConnection.connectorFallback")}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 2 }}>
              {step === "pick" ? t("connectors.newConnection.chooseType") : t("connectors.newConnection.enterCredentials")}
            </div>
          </div>
          <button onClick={closeAndDiscard} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 20, color: "var(--muted-fg)", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20, overflow: "auto" }}>
          {/* Step 1: type picker. Tres columnas fijas dejaban las tarjetas en
              ~150 px en un teléfono, con el nombre del conector recortado sin
              siquiera puntos suspensivos ("Bitbucke", "Bitwarder"). Con
              auto-fill son las mismas tres donde caben y una sola cuando no. */}
          {step === "pick" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {catalog.map(ct => {
                const color = pickerColor(ct.id);
                const fields = (ct.config?.fields || []).map((field) => `${field.label}${field.required ? " *" : ""}`).join(" · ");
                const rawDescription = ct.config?.description;
                const description = rawDescription
                  ? window.I18N.tSchemaText(ct.id, "$root", rawDescription)
                  : (ct.capabilities?.length ? t("connectors.newConnection.capabilities", "", { list: ct.capabilities.join(" · ") }) : t("connectors.newConnection.configDeclared"));
                return (
                <button key={ct.id} onClick={() => setStep(ct.id)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start",
                    padding: "14px 14px 12px", border: "1.5px solid var(--border)", borderRadius: 9,
                    background: "white", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                    transition: "border-color .12s, box-shadow .12s", height: "100%", boxSizing: "border-box",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${color} 12%, transparent)`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                      background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, black))`,
                      color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 700, fontSize: 12, fontFamily: "var(--font-mono)",
                    }}>{connectorIconContent(ct.id, ct.displayName.slice(0, 2).toUpperCase())}</div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", flex: 1, minWidth: 0 }}>{ct.displayName}</span>
                    <ConnectorTierBadge id={ct.id} tier={ct.tier} compact />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-fg)", lineHeight: 1.45 }}>{description}</div>
                  <div style={{ fontSize: 10.5, color, fontFamily: "var(--font-mono)", fontWeight: 500, marginTop: "auto" }}>{fields || t("connectors.newConnection.noFieldsDeclared")}</div>
                </button>
                );
              })}
              {!catalog.length && !catalogError && <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, padding: "20px 0", color: "var(--muted-fg)", fontSize: 12 }}><Spinner size={12} /> {t("connectors.newConnection.loadingConnectors")}</div>}
              {catalogError && <div style={{ gridColumn: "1 / -1", color: "var(--err)", fontSize: 12 }}>{catalogError}</div>}
            </div>
          )}

          {selectedConnector && !saved && (
            <div>
              <button onClick={async () => { await discardPendingInstance(); setStep("pick"); }} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, padding: "0 0 12px", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                {t("connectors.newConnection.back")}
              </button>
              {/* Sobre las credenciales: es lo primero que distingue una
                  conexión de otra del mismo tipo, y el panel de abajo lo
                  publica cada conector a su manera, así que vive aquí y
                  sirve para todos por igual. */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-fg)", display: "block", marginBottom: 4 }}>
                  {t("connectors.newConnection.nameLabel", "Connection name")}
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={defaultName}
                  maxLength={60}
                  style={{ height: 32, padding: "0 10px", fontSize: 12.5, border: "1px solid var(--border)", borderRadius: 5, outline: 0, width: "100%", background: "white", color: "var(--fg)", boxSizing: "border-box" }}
                />
                <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: 3 }}>
                  {t("connectors.newConnection.nameHelp", "Shown on the card and in the sidebar. Leave it as it is to keep the default.")}
                </div>
                {targetId && targetId !== selectedConnector.id && (
                  <div style={{ fontSize: 10.5, color: "var(--muted-fg)", marginTop: 4 }}>
                    {t("connectors.newConnection.extraInstance", "", { id: targetId }) || `Separate connection (${targetId}) — the existing one is left untouched.`}
                  </div>
                )}
              </div>
              {preparing && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted-fg)", fontSize: 12 }}><Spinner size={12} /> {t("connectors.newConnection.preparing", "Preparing the connection…")}</div>}
              {!preparing && targetId && (SelectedConfigPanel
                ? <SelectedConfigPanel onSaved={handleSaved} id={targetId} />
                : <GenericConnectorConfigPanel connector={{ ...selectedConnector, id: targetId }} onSaved={handleSaved} />)}
              {!preparing && !targetId && <div style={{ color: "var(--err)", fontSize: 12 }}>{t("connectors.newConnection.prepareFailed", "Could not prepare a new connection for this type.")}</div>}
            </div>
          )}

          {/* Success */}
          {saved && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 0", color: "var(--ok)" }}>
              <div style={{ fontSize: 36 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("connectors.newConnection.saved")}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
function AutoSyncPanel() {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    window.HQ_API.request("/api/settings/auto-sync").then(setCfg).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next); // optimistic
    setSaving(true); setErr("");
    try {
      const r = await window.HQ_API.request("/api/settings/auto-sync", {
        method: "POST",
        body: { enabled: next.enabled, fastMinutes: next.fastMinutes, slowMinutes: next.slowMinutes },
      });
      setCfg(c => ({ ...c, ...r }));
    } catch (e) {
      setErr(e.message || t("connectors.saveFailed"));
      load();
    } finally { setSaving(false); }
  };

  if (!cfg) return null;

  const inp = {
    width: 56, height: 26, padding: "0 6px", fontSize: 12, textAlign: "center",
    border: "1px solid var(--border)", borderRadius: 5, outline: 0,
    fontFamily: "var(--font-mono)", background: "white", color: "var(--fg)",
  };
  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour12: false }) : "—";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      background: "white", border: "1px solid var(--border)", borderRadius: 8,
      padding: "10px 14px", marginBottom: 14, fontSize: 12.5,
    }}>
      <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontWeight: 600 }}>
        <input type="checkbox" checked={!!cfg.enabled} onChange={e => save({ enabled: e.target.checked })} />
        {t("connectors.autoSync.label")}
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted-fg)" }}>
        {t("connectors.autoSync.every")}
        <input type="number" min={1} max={180} style={inp} value={cfg.fastMinutes}
          onChange={e => setCfg(c => ({ ...c, fastMinutes: e.target.value }))}
          onBlur={e => save({ fastMinutes: Math.max(1, Number(e.target.value) || 5) })} />
        {t("connectors.sync.min")}
      </div>

      {cfg.enabled && (
        <div style={{ color: "var(--muted-fg)", fontSize: 11.5, marginLeft: "auto" }}>
          {t("connectors.autoSync.lastRun")} <b style={{ fontFamily: "var(--font-mono)" }}>
            {fmt(Object.values(cfg.lastRun || {}).sort().slice(-1)[0])}
          </b>
        </div>
      )}
      {saving && <Spinner size={11} />}
      {err && <span style={{ color: "var(--err)" }}>{err}</span>}
    </div>
  );
}

function ConnectorsView() {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [selected, setSelected] = useState(null);
  const [liveStatuses, setLiveStatuses] = useState({});
  const [liveLogs, setLiveLogs] = useState({});
  const [busy, setBusy] = useState(null);
  const [showNewConn, setShowNewConn] = useState(false);
  const [showExportConn, setShowExportConn] = useState(false);
  const [showImportConn, setShowImportConn] = useState(false);
  const [conns, setConns] = useState(window.APP_DATA?.CONNECTORS || []);
  const [connsLoading, setConnsLoading] = useState(true);
  // Outlook-local instances are bound to one specific mailbox (accountSmtp),
  // but /api/connectors only returns each type's config *schema*, not the
  // saved value — that lives behind its own /config endpoint. Fetched once
  // per instance here so the card can show the actual mailbox instead of an
  // "Endpoint" field that's meaningless for a COM-automated local connector.
  const [accountByConn, setAccountByConn] = useState({});
  useEffect(() => {
    const ids = conns.filter(c => c.type === "outlook-local").map(c => c.id);
    if (!ids.length) return;
    Promise.all(ids.map(id =>
      window.HQ_API.request(`/api/connectors/${id}/config`)
        .then(cfg => [id, cfg?.accountSmtp || null])
        .catch(() => [id, null])
    )).then(pairs => setAccountByConn(prev => ({ ...prev, ...Object.fromEntries(pairs) })));
  }, [conns]);

  const addLog = useCallback((id, level, msg) => {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setLiveLogs(s => ({
      ...s,
      [id]: [{ t: time, level, msg }, ...(s[id] || [])].slice(0, 20),
    }));
  }, []);

  // Load connectors from SQLite + live statuses on mount
  useEffect(() => {
    Promise.all([
      window.HQ_API.request("/api/connectors"),
      window.HQ_API.request("/api/connectors/status"),
    ]).then(([registry, statusData]) => {
      if (Array.isArray(registry) && registry.length) setConns(registry);
      setLiveStatuses(statusData || {});
      const logsFromServer = {};
      for (const [id, s] of Object.entries(statusData || {})) {
        if (s.log?.length) logsFromServer[id] = s.log;
      }
      if (Object.keys(logsFromServer).length) setLiveLogs(logsFromServer);
    }).catch(() => {}).finally(() => setConnsLoading(false));
  }, []);

  // Test/Sync/reauth cambian el estado por muchas ramas distintas de onPulse;
  // en vez de emitir el evento en cada una, se observa aquí qué conectores
  // están conectados y se avisa al shell cuando ese conjunto cambia, para que
  // el menú muestre u oculte sus módulos sin recargar la página.
  const connectedKey = useMemo(
    () => Object.entries(liveStatuses)
      .filter(([, status]) => (status?.status || "offline") !== "offline")
      .map(([id]) => id).sort().join(","),
    [liveStatuses],
  );
  const lastConnectedKey = useRef(null);
  useEffect(() => {
    if (lastConnectedKey.current === null) { lastConnectedKey.current = connectedKey; return; }
    if (lastConnectedKey.current === connectedKey) return;
    lastConnectedKey.current = connectedKey;
    window.dispatchEvent(new CustomEvent("hq:connector-status-changed"));
  }, [connectedKey]);

  // Single-instance connectors (vcenter, bw, gitlab, …) only ever report
  // their live status through /api/connectors/status, keyed by type id.
  // Multi-instance connectors (extra GitLab/GitHub/Bitbucket/Outlook-local
  // accounts) don't have a fixed key that endpoint could use, so the
  // registry (/api/connectors) embeds each instance's own liveStatus
  // directly instead — falling back to that here is what makes those
  // instances (e.g. a second Correo/Outlook-local account) actually show
  // up as connected instead of always reading as "offline".
  const effStatus = useCallback((c) => liveStatuses[c.id] || c.liveStatus, [liveStatuses]);

  // Only "offline" (no live status at all — never configured, or configured
  // but never successfully tested/synced) is hidden. "ok"/"warn"/"error" all
  // mean the connector was actually set up and has a real, current status —
  // "error" in particular is exactly the case a user needs to see (something
  // that was working is now failing), not hide. A hidden/unconfigured
  // connector only surfaces through "+ New connection", which already lists
  // every type regardless of state and lets you (re)configure it.
  const visible = useMemo(
    () => conns.filter(c => {
      if ((effStatus(c)?.status || "offline") !== "offline") return true;
      // Una conexión extra la creó el usuario a propósito y no aparece en
      // "+ New connection", que lista tipos y no conexiones. Ocultarla por no
      // estar configurada todavía la dejaba sin ninguna forma de llegar a
      // ella: creada, invisible y sin poder recibir credenciales.
      return c.id !== (c.type || c.connectorTypeId || c.id);
    }),
    [conns, effStatus],
  );

  const connectorsPagination = usePagination(visible, { key: "connectors" });

  const counts = useMemo(() => ({
    total: visible.length,
    items: visible.reduce((s, c) => s + (effStatus(c)?.itemsSynced ?? 0), 0),
  }), [visible, effStatus]);

  const onPulse = useCallback(async (id, action) => {
    const conn = conns.find(c => c.id === id);
    const isVMware = conn?.type === "vcenter" || conn?.kind === "VMware vSphere REST";
    const isBW     = id === "bw";

    if (isVMware) {
      // Check configured before trying
      const cfg = liveStatuses[id];
      if (!cfg?.configured && action !== "test") {
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.vmware.configureFirst"), kind: "warn" } }));
        return;
      }

      setBusy(id);
      try {
        if (action === "test") {
          const r = await window.HQ_API.request(`/api/connectors/vcenter/${id}/test`, { method: "POST" });
          setLiveStatuses(s => ({ ...s, [id]: { ...s[id], status: "ok", lastError: null, latency: r.latency } }));
          addLog(id, "ok", t("connectors.pulse.vmware.testOkLog", "", { latency: r.latency }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.vmware.testOkToast", "", { name: conn.name, latency: r.latency }), kind: "ok" } }));
        } else if (action === "sync") {
          const r = await window.HQ_API.request(`/api/connectors/vcenter/${id}/sync`, { method: "POST" });
          setLiveStatuses(s => ({
            ...s,
            [id]: {
              ...s[id], status: "ok", lastError: null,
              latency: r.latency, itemsSynced: r.vms + r.hosts,
              lastSync: r.syncedAt,
            },
          }));
          addLog(id, "ok", t("connectors.pulse.vmware.syncOkLog", "", { vms: r.vms, hosts: r.hosts, clusters: r.clusters, latency: r.latency }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.vmware.syncOkToast", "", { name: conn.name, vms: r.vms, hosts: r.hosts, latency: r.latency }), kind: "ok" } }));
        }
      } catch (e) {
        const msg = e.message || t("connectors.pulse.unknownError");
        setLiveStatuses(s => ({ ...s, [id]: { ...s[id], status: "error", lastError: msg } }));
        addLog(id, "err", t("connectors.pulse.errorLog", "", { message: msg }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.errorToast", "", { label: conn.name, message: msg }), kind: "error" } }));
      } finally {
        setBusy(null);
      }

    } else if (isBW) {
      setBusy(id);
      try {
        if (action === "test") {
          const r = await window.HQ_API.request("/api/connectors/bw/test", { method: "POST" });
          setLiveStatuses(s => ({
            ...s,
            bw: {
              ...s.bw,
              configured: true,
              status: r.ok ? "ok" : "error",
              latency: r.latency,
              serverHealth: r.serverHealth?.ok,
              serverUrl: r.bwStatus?.serverUrl || s.bw?.serverUrl,
              bwCliStatus: r.bwStatus?.status || null,
              userEmail: r.bwStatus?.userEmail || null,
              lastTest: new Date().toISOString(),
              lastError: r.ok ? null : (r.serverHealth?.error || t("connectors.pulse.bw.serverUnreachable")),
            },
          }));
          const cliSt = r.bwStatus?.status || "?";
          const logMsg = r.ok
            ? t("connectors.pulse.bw.testOkLog", "", { health: r.serverHealth?.ok ? t("connectors.pulse.bw.reachable") : t("connectors.pulse.bw.unreachable"), status: cliSt, latency: r.latency })
            : t("connectors.pulse.bw.testFailLog", "", { error: r.serverHealth?.error || t("connectors.pulse.bw.serverUnreachable"), latency: r.latency });
          addLog("bw", r.ok ? "ok" : "err", logMsg);
          window.dispatchEvent(new CustomEvent("toast", {
            detail: {
              msg: r.ok
                ? t("connectors.pulse.bw.testOkToast", "", { status: cliSt, latency: r.latency })
                : t("connectors.pulse.bw.testFailToast", "", { error: r.serverHealth?.error || t("connectors.pulse.bw.serverUnreachable") }),
              kind: r.ok ? "ok" : "error",
            },
          }));
        } else if (action === "sync") {
          const r = await window.HQ_API.request("/api/connectors/bw/sync", { method: "POST" });
          setLiveStatuses(s => ({
            ...s,
            bw: {
              ...s.bw,
              configured: true,
              status: "ok", lastError: null,
              latency: r.latency, itemsSynced: r.itemsSynced,
              lastSync: r.syncedAt, bwCliStatus: r.bwStatus,
              userEmail: r.userEmail || s.bw?.userEmail,
              serverHealth: r.serverHealth,
            },
          }));
          const cliInfo = r.bwStatus === "unauthenticated" ? t("connectors.pulse.bw.notLoggedIn") : r.bwStatus === "locked" ? t("connectors.pulse.bw.vaultLocked") : t("connectors.pulse.bw.vaultStatus", "", { status: r.bwStatus });
          addLog("bw", "ok", t("connectors.pulse.bw.syncOkLog", "", { items: r.itemsSynced, cliInfo, latency: r.latency }));
          const toastCli = r.bwStatus === "unauthenticated" ? t("connectors.pulse.bw.notLoggedInToast") : r.bwStatus === "locked" ? t("connectors.pulse.bw.lockedToast") : "";
          window.dispatchEvent(new CustomEvent("toast", {
            detail: { msg: t("connectors.pulse.bw.syncOkToast", "", { items: r.itemsSynced, cli: toastCli, latency: r.latency }), kind: "ok" },
          }));
        }
      } catch (e) {
        const msg = e.message || t("connectors.pulse.unknownError");
        setLiveStatuses(s => ({ ...s, bw: { ...s.bw, status: "error", lastError: msg } }));
        addLog("bw", "err", t("connectors.pulse.errorLog", "", { message: msg }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.bw.testFailToast", "", { error: msg }), kind: "error" } }));
      } finally {
        setBusy(null);
      }

    } else if (SIMPLE_ONPULSE[conn?.type]) {
      // Conectores "simples" e instantiable (gitlab/github/bitbucket/outline/
      // portainer/qportal/outlook/plane) — antes 8 ramas casi idénticas de
      // ~23 líneas cada una. Colapsan en una sola rama por `conn.type`
      // (viene de GET /api/connectors, resuelto server-side por
      // resolveConnectorType — ver ADR-008/CONN-017); SIMPLE_ONPULSE es la
      // única parte que cambia por tipo. El texto de log/toast se
      // homogeneiza entre tipos (mismo contenido, redacción uniforme) —
      // antes cada uno tenía su propia frase a mano.
      const spec = SIMPLE_ONPULSE[conn.type];
      const label = conn?.name || spec.displayName;
      setBusy(id);
      try {
        if (action === "test") {
          const r = await window.HQ_API.request(`/api/connectors/${id}/test`, { method: "POST" });
          const { fields, detail } = r.ok ? spec.test(r) : { fields: {}, detail: "" };
          const detailPart = detail ? ` · ${detail}` : "";
          setLiveStatuses(s => ({ ...s, [id]: { ...s[id], status: r.ok ? "ok" : "error", lastError: r.ok ? null : r.error, latency: r.latency, configured: true, ...fields } }));
          addLog(id, r.ok ? "ok" : "err", r.ok ? t("connectors.pulse.simple.testOkLog", "", { detail: detailPart, latency: r.latency }) : t("connectors.pulse.simple.testFailLog", "", { error: r.error }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: r.ok ? t("connectors.pulse.simple.testOkToast", "", { label, detail: detailPart, latency: r.latency }) : t("connectors.pulse.errorToast", "", { label, message: r.error }), kind: r.ok ? "ok" : "error" } }));
        } else if (action === "sync") {
          const r = await window.HQ_API.request(`/api/connectors/${id}/sync`, { method: "POST" });
          const { fields, detail, itemsSynced } = spec.sync(r);
          setLiveStatuses(s => ({ ...s, [id]: { ...s[id], status: "ok", lastError: null, latency: r.latency, itemsSynced, lastSync: r.syncedAt, ...fields } }));
          addLog(id, "ok", t("connectors.pulse.simple.syncOkLog", "", { detail, latency: r.latency }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.simple.syncOkToast", "", { label, detail, latency: r.latency }), kind: "ok" } }));
        }
      } catch (e) {
        const msg = e.message || t("connectors.pulse.unknownError");
        setLiveStatuses(s => ({ ...s, [id]: { ...s[id], status: "error", lastError: msg } }));
        addLog(id, "err", t("connectors.pulse.errorLog", "", { message: msg }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.errorToast", "", { label, message: msg }), kind: "error" } }));
      } finally {
        setBusy(null);
      }

    } else if (id === "anthropic") {
      setBusy(id);
      try {
        if (action === "test") {
          const r = await window.HQ_API.request("/api/connectors/anthropic/test", { method: "POST" });
          setLiveStatuses(s => ({ ...s, anthropic: { ...s.anthropic, status: r.ok ? "ok" : "error", lastError: r.ok ? null : r.error, latency: r.latency, configured: true } }));
          addLog("anthropic", r.ok ? "ok" : "err", r.ok ? t("connectors.pulse.anthropic.testOkLog", "", { count: r.fileCount, latency: r.latency }) : t("connectors.pulse.simple.testFailLog", "", { error: r.error }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: r.ok ? t("connectors.pulse.anthropic.testOkToast", "", { count: r.entryCount, latency: r.latency }) : t("connectors.pulse.errorToast", "", { label: "Anthropic", message: r.error }), kind: r.ok ? "ok" : "error" } }));
        } else if (action === "sync") {
          const r = await window.HQ_API.request("/api/connectors/anthropic/sync", { method: "POST" });
          setLiveStatuses(s => ({
            ...s,
            anthropic: {
              ...s.anthropic, status: "ok", lastError: null, latency: r.latency,
              itemsSynced: r.entryCount, lastSync: r.syncedAt, metric: r.metric,
              fiveHour: r.fiveHour, weekly: r.weekly, contextWindow: r.contextWindow,
              byModel: r.byModel, byDay: r.byDay, blocks: r.blocks, source: r.source,
            },
          }));
          const pct = r.fiveHour?.percent;
          const pctPart = pct == null ? t("connectors.pulse.anthropic.noLimit") : `${pct}%`;
          addLog("anthropic", "ok", t("connectors.pulse.anthropic.syncOkLog", "", { count: r.entryCount, pctPart, latency: r.latency }));
          const syncDetail = pct == null ? t("connectors.pulse.anthropic.turnsCount", "", { count: r.entryCount }) : t("connectors.pulse.anthropic.fiveHourAt", "", { pct });
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.anthropic.syncOkToast", "", { detail: syncDetail, latency: r.latency }), kind: "ok" } }));
        }
      } catch (e) {
        const msg = e.message || t("connectors.pulse.unknownError");
        setLiveStatuses(s => ({ ...s, anthropic: { ...s.anthropic, status: "error", lastError: msg } }));
        addLog("anthropic", "err", t("connectors.pulse.errorLog", "", { message: msg }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.errorToast", "", { label: "Anthropic", message: msg }), kind: "error" } }));
      } finally {
        setBusy(null);
      }
    } else if (id === "ucsm") {
      setBusy(id);
      try {
        if (action === "test") {
          const r = await window.HQ_API.request("/api/connectors/ucsm/test", { method: "POST" });
          setLiveStatuses(s => ({ ...s, ucsm: { ...s.ucsm, status: r.ok ? "ok" : "error", lastError: r.ok ? null : r.error, latency: r.latency, configured: true } }));
          addLog("ucsm", r.ok ? "ok" : "err", r.ok ? t("connectors.pulse.ucsm.testOkLog", "", { latency: r.latency }) : t("connectors.pulse.simple.testFailLog", "", { error: r.error }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: r.ok ? t("connectors.pulse.ucsm.testOkToast", "", { latency: r.latency }) : t("connectors.pulse.errorToast", "", { label: "UCS Manager", message: r.error }), kind: r.ok ? "ok" : "error" } }));
        } else if (action === "sync") {
          const r = await window.HQ_API.request("/api/connectors/ucsm/sync", { method: "POST" });
          setLiveStatuses(s => ({ ...s, ucsm: { ...s.ucsm, status: "ok", lastError: null, latency: r.latency, itemsSynced: r.chassisCount + r.bladeCount, lastSync: r.syncedAt, sites: r.sites } }));
          addLog("ucsm", "ok", t("connectors.pulse.ucsm.syncOkLog", "", { chassis: r.chassisCount, blades: r.bladeCount, latency: r.latency }));
          window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.ucsm.syncOkToast", "", { chassis: r.chassisCount, blades: r.bladeCount, latency: r.latency }), kind: "ok" } }));
        }
      } catch (e) {
        const msg = e.message || t("connectors.pulse.unknownError");
        setLiveStatuses(s => ({ ...s, ucsm: { ...s.ucsm, status: "error", lastError: msg } }));
        addLog("ucsm", "err", t("connectors.pulse.errorLog", "", { message: msg }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.errorToast", "", { label: "UCS Manager", message: msg }), kind: "error" } }));
      } finally {
        setBusy(null);
      }

    } else if (conn?.configurable) {
      // Package connectors that follow the conventional routes can use the
      // same card actions without adding a new branch to this dispatcher.
      const label = conn.name || conn.type || id;
      setBusy(id);
      try {
        const r = await window.HQ_API.request(`/api/connectors/${id}/${action}`, { method: "POST" });
        const ok = r?.ok !== false;
        const latency = r?.latency || null;
        const itemsSynced = r?.itemsSynced ?? r?.total ?? r?.count ?? null;
        const detail = r?.detail || (itemsSynced != null ? t("connectors.pulse.generic.itemsDetail", "", { count: itemsSynced }) : latency || t("connectors.pulse.generic.completed"));
        setLiveStatuses((statuses) => ({
          ...statuses,
          [id]: {
            ...statuses[id],
            configured: true,
            status: ok ? "ok" : "error",
            lastError: ok ? null : (r?.error || t("connectors.pulse.generic.actionFailed")),
            latency,
            ...(action === "sync" ? { itemsSynced, lastSync: r?.syncedAt || new Date().toISOString() } : { lastTest: new Date().toISOString() }),
          },
        }));
        addLog(id, ok ? "ok" : "err", ok ? t("connectors.pulse.generic.actionOkLog", "", { action: action === "sync" ? t("connectors.pulse.generic.actionSync") : t("connectors.pulse.generic.actionTest"), detail }) : t("connectors.pulse.generic.testFailLog", "", { error: r?.error || t("connectors.pulse.generic.actionFailed") }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: ok ? t("connectors.pulse.generic.actionOkToast", "", { label, detail }) : t("connectors.pulse.errorToast", "", { label, message: r?.error || t("connectors.pulse.generic.actionFailed") }), kind: ok ? "ok" : "error" } }));
      } catch (e) {
        const msg = e.message || t("connectors.pulse.unknownError");
        setLiveStatuses((statuses) => ({ ...statuses, [id]: { ...statuses[id], status: "error", lastError: msg } }));
        addLog(id, "err", t("connectors.pulse.errorLog", "", { message: msg }));
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.errorToast", "", { label, message: msg }), kind: "error" } }));
      } finally {
        setBusy(null);
      }
    } else {
      // Other connectors — no-op with info toast
      const labels = { test: t("connectors.pulse.fallback.test"), sync: t("connectors.pulse.fallback.sync"), reauth: t("connectors.pulse.fallback.reauth") };
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.pulse.fallback.toast", "", { label: labels[action] || action, name: conn.name }), kind: "info" } }));
    }
  }, [conns, liveStatuses, addLog]);

  const onConfigSaved = useCallback((id, info) => {
    setLiveStatuses(s => ({ ...s, [id]: { ...s[id], configured: true } }));
    window.dispatchEvent(new CustomEvent("hq:connector-config-changed", { detail: { id } }));
  }, []);

  return (
    // Detail replaces the list entirely (rather than overlaying it) — a
    // stale grid left mounted underneath an absolutely-positioned overlay is
    // exactly what caused it to show through when the list had been
    // scrolled before opening a card (see ConnectorDetail's own comment).
    // "connectors" is a FULL_HEIGHT_ROUTE (app.jsx) so main.app-main is a
    // bounded-height flex column here — this wrapper fills it exactly, and
    // whichever branch below (list or detail) manages its own overflow, so
    // each zone/the grid can stretch to the bottom of the screen instead of
    // stopping at its content height with empty page below it.
    <section aria-label={t("connectors.view.workspaceAria")} data-lintaya-surface="connectors" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {selected ? (
        <ConnectorDetail
          conn={selected}
          liveStatus={effStatus(selected)}
          liveLog={liveLogs[selected.id]}
          account={accountByConn[selected.id]}
          onClose={() => setSelected(null)}
          onPulse={onPulse}
          busy={busy}
          onConfigSaved={onConfigSaved}
          onRenamed={(updated) => {
            setConns(cs => cs.map(c => c.id === updated.id ? updated : c));
            setSelected(s => (s && s.id === updated.id ? updated : s));
            // El sidebar lee el nombre real del conector para distinguir dos
            // instancias del mismo tipo (ver app.jsx → Sidebar → connectorNames).
            window.dispatchEvent(new CustomEvent("hq:connector-config-changed", { detail: { id: updated.id } }));
          }}
          onEnabledChanged={(id, nextEnabled) => {
            setConns(cs => cs.map(c => c.id === id ? { ...c, enabled: nextEnabled } : c));
            setSelected(s => (s && s.id === id ? { ...s, enabled: nextEnabled } : s));
            // Sin esto, app.jsx's Sidebar (que sí escucha este evento — ver
            // loadConnectorModules) nunca se entera de que este toggle
            // cambió `available`, así que el módulo/bloque de un conector
            // recién deshabilitado seguía en el menú hasta recargar la
            // página. onRenamed/onInstanceCreated ya lo disparaban; a este
            // le faltaba.
            window.dispatchEvent(new CustomEvent("hq:connector-config-changed", { detail: { id } }));
          }}
          onInstanceCreated={(created) => {
            // POST .../instances devuelve la fila cruda (sin el enriquecido
            // `type`/`configured`/`liveStatus` que agrega GET /api/connectors) —
            // se refetchea la lista completa para que la card nueva tenga
            // exactamente el mismo shape que el resto.
            window.HQ_API.request("/api/connectors").then(list => {
              if (!Array.isArray(list)) return;
              setConns(list);
              setSelected(list.find(c => c.id === created.id) || created);
            });
            window.dispatchEvent(new CustomEvent("hq:connector-config-changed", { detail: { id: created.id } }));
          }}
          onDeleted={(id) => {
            setConns(cs => cs.filter(c => c.id !== id));
            setSelected(null);
            // Same event every other connector-list-affecting action already
            // dispatches, so the sidebar drops this connector's nav module
            // immediately instead of only after a reload.
            window.dispatchEvent(new CustomEvent("hq:connector-config-changed", { detail: { id } }));
          }}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ padding: 20, maxWidth: 1480, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>{t("connectors.view.title")}</h1>
              <p style={{ margin: "4px 0 0", color: "var(--muted-fg)", fontSize: 13 }}>
                {t("connectors.view.summary", "", { total: counts.total, items: counts.items })}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowImportConn(true)} title={t("connectors.view.importTitle")} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>{t("connectors.view.import")}</button>
              <button onClick={() => setShowExportConn(true)} title={t("connectors.view.exportTitle")} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>{t("connectors.view.export")}</button>
              <button onClick={() => setShowNewConn(true)} style={{ height: 32, padding: "0 12px", border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>{t("connectors.view.newConnection")}</button>
            </div>
          </div>

          <AutoSyncPanel />

          {connsLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "24px 0", color: "var(--muted-fg)", fontSize: 13 }}>
              <Spinner size={14} /> {t("connectors.newConnection.loadingConnectors")}
            </div>
          )}
          {!connsLoading && !visible.length && (
            <div style={{ padding: "24px 0", color: "var(--muted-fg)", fontSize: 13 }}>
              {t("connectors.view.emptyState", "", { button: t("connectors.view.newConnection") })}
            </div>
          )}
          <div role="list" aria-label={t("connectors.view.listAria")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 10 }}>
            {connectorsPagination.pageItems.map(c => (
              <ConnectorCard
                key={c.id}
                conn={c}
                liveStatus={effStatus(c)}
                account={accountByConn[c.id]}
                onSelect={setSelected}
                onPulse={onPulse}
                busy={busy}
              />
            ))}
          </div>
          {visible.length > 0 && <PaginationBar {...connectorsPagination} />}
        </div>
        </div>
      )}

      {showNewConn && (
        <NewConnectionModal
          onClose={() => setShowNewConn(false)}
          onSaved={(info) => {
            // Patching just `configured: true` into liveStatuses isn't
            // enough to make the new card show up: the Connectors grid only
            // shows a connector once its `status` isn't "offline" (see
            // `visible` above), and that status only exists once a real
            // GET /api/connectors(/status) round-trip has happened — this
            // save already ran that connector's own auto-test
            // (GithubConfigPanel etc.), so refetch now instead of waiting
            // for the next unrelated poll to happen to pick it up.
            Promise.all([
              window.HQ_API.request("/api/connectors"),
              window.HQ_API.request("/api/connectors/status"),
            ]).then(([registry, statusData]) => {
              if (Array.isArray(registry)) setConns(registry);
              if (statusData) setLiveStatuses(s => ({ ...s, ...statusData }));
            }).catch(() => {});
            window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Connector saved — click Test to verify", kind: "ok" } }));
            // Same event every other connector-list-affecting action in this
            // file already dispatches, so the sidebar's nav module shows up
            // immediately too instead of only after a reload.
            if (info?.id) window.dispatchEvent(new CustomEvent("hq:connector-config-changed", { detail: { id: info.id } }));
          }}
        />
      )}

      {showExportConn && (
        <ExportConnectionsModal conns={conns} onClose={() => setShowExportConn(false)} />
      )}

      {showImportConn && (
        <ImportConnectionsModal onClose={() => setShowImportConn(false)} onImported={() => {
          window.HQ_API.request("/api/connectors").then(list => { if (Array.isArray(list)) setConns(list); });
        }} />
      )}
    </section>
  );
}

// ── Export/import connection config (Development + Enterprise) ──────────────
// Public config only — never secrets, see server/routes/connectors.js. The
// modal only lists Development/Enterprise connections (the ones with the
// most fiddly config to retype by hand — per-site VIPs, base URLs), but the
// underlying API works for any connectorTypeId; nothing here restricts it.
const EXPORTABLE_TIERS = new Set(["development", "enterprise"]);

function modalShellStyle(width) {
  return {
    background: "white", borderRadius: 12, width, maxWidth: "94vw", maxHeight: "88vh",
    boxShadow: "0 24px 60px rgba(0,0,0,.22)", overflow: "hidden",
    display: "flex", flexDirection: "column",
  };
}
function modalBackdropProps(onClose) {
  return {
    style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" },
    onClick: (e) => e.target === e.currentTarget && onClose(),
  };
}
function ModalHeader({ title, subtitle, onClose }) {
  const t = window.I18N.t;
  return (
    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button type="button" aria-label={t("connectors.modal.closeAria", "", { title })} onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 20, color: "var(--muted-fg)", lineHeight: 1 }}>×</button>
    </div>
  );
}

function ExportConnectionsModal({ conns, onClose }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const eligible = useMemo(() => conns.filter(c => EXPORTABLE_TIERS.has(c.tier)), [conns]);
  const [checked, setChecked] = useState(() => new Set(eligible.map(c => c.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id) => setChecked(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const exportNow = async () => {
    if (!checked.size) return;
    setBusy(true); setErr("");
    try {
      const data = await window.HQ_API.request(`/api/connectors/export?ids=${[...checked].map(encodeURIComponent).join(",")}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `lintaya-connections-${new Date().toISOString().slice(0, 10)}.json`; link.style.display = "none";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.export.exported", "", { count: data.connections.length }), kind: "ok" } }));
      onClose();
    } catch (e) { setErr(e.message || t("connectors.export.failed")); }
    finally { setBusy(false); }
  };

  return (
    <div {...modalBackdropProps(onClose)}>
      <div role="dialog" aria-modal="true" aria-label={t("connectors.export.title")} style={modalShellStyle(480)}>
        <ModalHeader title={t("connectors.export.title")} subtitle={t("connectors.export.subtitle")} onClose={onClose} />
        <div style={{ padding: 20, overflow: "auto" }}>
          {!eligible.length ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-fg)" }}>{t("connectors.export.noneYet")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {eligible.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", cursor: "pointer", fontSize: 13 }}>
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span style={{ fontWeight: 500 }}>{c.name || c.id}</span>
                  <span style={{ fontSize: 11, color: "var(--muted-fg)", textTransform: "capitalize" }}>{c.tier}</span>
                  {c.id !== c.connectorTypeId && <span style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{c.id}</span>}
                </label>
              ))}
            </div>
          )}
          {err && <div role="alert" style={{ marginTop: 12, fontSize: 11.5, color: "var(--err)" }}>{err}</div>}
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>{t("connectors.cancel")}</button>
          <button onClick={exportNow} disabled={busy || !checked.size} style={{ height: 32, padding: "0 12px", border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: busy || !checked.size ? "default" : "pointer", fontWeight: 600, opacity: busy || !checked.size ? .6 : 1 }}>
            {busy ? t("connectors.export.exporting") : t("connectors.export.exportButton", "", { count: checked.size || "" }).trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportConnectionsModal({ onClose, onImported }) {
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFile = (f) => {
    setFile(f); setParsed(null); setParseError(""); setResults(null);
    if (!f) return;
    f.text().then(text => {
      let data;
      try { data = JSON.parse(text); } catch { return setParseError(t("connectors.import.invalidJson")); }
      if (data?.format !== "lintaya-connections-export" || !Array.isArray(data.connections)) {
        return setParseError(t("connectors.import.notLintayaExport"));
      }
      setParsed(data.connections);
    }).catch(() => setParseError(t("connectors.import.readFailed")));
  };

  const importNow = async () => {
    if (!parsed?.length) return;
    setBusy(true);
    try {
      const { results: r } = await window.HQ_API.request("/api/connectors/import", { method: "POST", body: { connections: parsed } });
      setResults(r);
      const ok = r.filter(x => x.ok).length;
      if (ok) {
        window.dispatchEvent(new CustomEvent("toast", { detail: { msg: t("connectors.import.imported", "", { ok, total: r.length }), kind: ok === r.length ? "ok" : "warn" } }));
        onImported();
      }
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: e.message || t("connectors.import.failed"), kind: "error" } }));
    } finally { setBusy(false); }
  };

  return (
    <div {...modalBackdropProps(onClose)}>
      <div role="dialog" aria-modal="true" aria-label={t("connectors.import.title")} style={modalShellStyle(520)}>
        <ModalHeader title={t("connectors.import.title")} subtitle={t("connectors.import.subtitle", "", { button: t("connectors.view.newConnection") })} onClose={onClose} />
        <div style={{ padding: 20, overflow: "auto" }}>
          <button type="button" onClick={() => fileInput.current?.click()} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>
            {file ? file.name : t("connectors.import.selectFile")}
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={e => pickFile(e.target.files?.[0] || null)} />

          {parseError && <div role="alert" style={{ marginTop: 12, fontSize: 11.5, color: "var(--err)" }}>{parseError}</div>}

          {parsed && !results && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 11.5, color: "var(--muted-fg)", marginBottom: 4 }}>{t("connectors.import.filesCount", "", { count: parsed.length })}</div>
              {parsed.map((c, i) => (
                <div key={i} style={{ fontSize: 13, padding: "4px 6px" }}>
                  <span style={{ fontWeight: 500 }}>{c.displayName || c.connectorTypeId}</span>{" "}
                  <span style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{c.connectionId}</span>
                </div>
              ))}
            </div>
          )}

          {results && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              {results.map((r, i) => (
                <div key={i} style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: r.ok ? "var(--ok, #16a34a)" : "var(--err)" }}>{r.ok ? "✓" : "✗"}</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{r.connectionId || "?"}</span>
                  {!r.ok && <span style={{ color: "var(--muted-fg)" }}>— {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", background: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>
            {results ? t("connectors.import.close") : t("connectors.cancel")}
          </button>
          {!results && (
            <button onClick={importNow} disabled={busy || !parsed?.length} style={{ height: 32, padding: "0 12px", border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", cursor: busy || !parsed?.length ? "default" : "pointer", fontWeight: 600, opacity: busy || !parsed?.length ? .6 : 1 }}>
              {busy ? t("connectors.import.importing") : t("connectors.import.importButton")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

window.ConnectorsView = ConnectorsView;
// Reused by block-catalog.jsx's BlockLogo so el mismo logo de marca real
// (GitLab/GitHub/Outline/Plane/vCenter/…) aparece en Blocks, no solo en
// Connectors — connectors.jsx carga antes que block-catalog.jsx en Lintaya.html.
window.connectorIconContent = connectorIconContent;
