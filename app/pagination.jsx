// Shared client-side pagination — every list page in this app filters an
// already-fully-loaded in-memory array (no server-side page/limit params
// exist anywhere), so pagination here is always "slice the filtered array",
// never a new API call. One hook + one UI bar, reused by every page instead
// of each reinventing page-size state and a prev/next control.
//
// Loaded before every page script (see Lintaya.html) so `usePagination`/
// `PaginationBar` are on `window` by the time vms.jsx, devices.jsx, etc. run.
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const PAGE_SIZE_STORAGE_PREFIX = "hq.pageSize.";

// `key` persists the chosen page size per page (e.g. "vms", "ssh-logs") so a
// user who prefers 100/page doesn't have to reset it on every visit — pass
// nothing for a one-off list that doesn't need to remember a preference.
function usePagination(items, { key, defaultPageSize = 25 } = {}) {
  const [pageSize, setPageSizeState] = React.useState(() => {
    if (!key) return defaultPageSize;
    try {
      const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_PREFIX + key));
      return PAGE_SIZE_OPTIONS.includes(stored) ? stored : defaultPageSize;
    } catch { return defaultPageSize; }
  });
  const [page, setPage] = React.useState(0);

  // Volver a la página 0 cuando cambia el CONTENIDO de la lista (otro filtro,
  // otra búsqueda), no cuando solo cambia la referencia del array. Antes se
  // comparaba la referencia, y un llamador que reconstruía su lista filtrada
  // en cada render (el catálogo de Bloques lo hacía) reseteaba la página en el
  // mismo instante en que "Siguiente" la avanzaba: el botón no hacía nada.
  // Se compara por id (o por el elemento si no tiene), así que un filtro que
  // deja la misma cantidad pero otras filas también resetea.
  const signature = React.useMemo(
    () => items.map((item) => (item && typeof item === "object" && "id" in item ? `${item.__kind || ""}:${item.id}` : item)),
    [items],
  );
  const previousSignature = React.useRef(signature);
  React.useEffect(() => {
    const prev = previousSignature.current;
    previousSignature.current = signature;
    const same = prev.length === signature.length && prev.every((value, i) => value === signature[i]);
    if (!same) setPage(0);
  }, [signature]);

  const setPageSize = React.useCallback((size) => {
    setPageSizeState(size);
    setPage(0);
    if (key) { try { localStorage.setItem(PAGE_SIZE_STORAGE_PREFIX + key, String(size)); } catch {} }
  }, [key]);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * pageSize;
  const pageItems = React.useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);

  return { page: clampedPage, setPage, pageSize, setPageSize, pageItems, totalPages, total, pageSizeOptions: PAGE_SIZE_OPTIONS };
}

function pagerBtnStyle(disabled) {
  return {
    height: 26, padding: "0 10px", border: "1px solid var(--border)",
    background: disabled ? "var(--muted)" : "white", borderRadius: 5,
    fontSize: 12, fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
    color: disabled ? "var(--muted-fg)" : "var(--fg)",
  };
}

// Square icon-only prev/next button for compact mode — vs. pagerBtnStyle's
// text pill ("← Anterior"), which wraps mid-word in a narrow sidebar.
function pagerIconBtnStyle(disabled) {
  return {
    width: 22, height: 22, padding: 0, border: "1px solid var(--border)",
    background: disabled ? "var(--muted)" : "white", borderRadius: 5,
    fontSize: 13, lineHeight: 1, fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
    color: disabled ? "var(--muted-fg)" : "var(--fg)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  };
}

// Auto-switches `compact` on for narrow viewports (phones) even when the
// caller didn't pass it explicitly — every page but Board Builder renders
// this bar full-width, so a narrow window is the same "not enough room for
// the text buttons" problem Board Builder's sidebar always has.
function useNarrowViewport(maxWidth = 640) {
  const [narrow, setNarrow] = React.useState(() => typeof window !== "undefined" && window.innerWidth <= maxWidth);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [maxWidth]);
  return narrow;
}

// `compact` drops the "Por página" label and swaps the "← Anterior /
// Página N de M / Siguiente →" text controls for bare chevrons + "N/M" — for
// panels too narrow for the full text (e.g. Board Builder's sidebar, or any
// page on a phone screen), where the wording wraps mid-word instead of just
// shrinking.
// El boton del asistente (✦, ai-chat.jsx) vive fijo abajo a la derecha, 52 px
// mas 16 de margen: justo donde cae "Siguiente" cuando la barra es lo ultimo
// de una lista larga, y lo tapaba. Cada pagina hace scroll en su propio
// contenedor, asi que el hueco lo pone la barra: con el scroll al final queda
// por encima del boton. No aplica a la barra compacta de una barra lateral.
const ASSISTANT_CLEARANCE = 56;

function PaginationBar({ page, setPage, pageSize, setPageSize, totalPages, total, pageSizeOptions = PAGE_SIZE_OPTIONS, style, compact = false }) {
  const inSidebar = compact;
  const narrow = useNarrowViewport();
  const locale = window.I18N.useLocale();
  const t = window.I18N.t;
  compact = compact || narrow;
  if (!total) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const select = (
    <select
      value={pageSize}
      onChange={(e) => setPageSize(Number(e.target.value))}
      style={{ height: 26, border: "1px solid var(--border)", borderRadius: 5, background: "white", fontSize: 12, fontFamily: "inherit", padding: "0 6px", cursor: "pointer" }}
    >
      {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
  if (compact) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "10px 2px", fontSize: 11.5, color: "var(--muted-fg)", flexWrap: "wrap",
        ...(inSidebar ? {} : { marginBottom: ASSISTANT_CLEARANCE }), ...style,
      }}>
        <div>{t("pagination.range", "", { from, to, total })}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {select}
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={pagerIconBtnStyle(page === 0)} aria-label={t("pagination.prevAria")}>‹</button>
          <span>{page + 1}/{totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} style={pagerIconBtnStyle(page >= totalPages - 1)} aria-label={t("pagination.nextAria")}>›</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      padding: "10px 2px", fontSize: 12.5, color: "var(--muted-fg)", flexWrap: "wrap",
      marginBottom: ASSISTANT_CLEARANCE, ...style,
    }}>
      <div>{t("pagination.range", "", { from, to, total })}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {t("pagination.perPage")}
          {select}
        </label>
        <div style={{ display: "flex", gap: 4 }}>
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={pagerBtnStyle(page === 0)}>{t("pagination.prev")}</button>
          <span style={{ padding: "0 6px" }}>{t("pagination.page", "", { page: page + 1, total: totalPages })}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} style={pagerBtnStyle(page >= totalPages - 1)}>{t("pagination.next")}</button>
        </div>
      </div>
    </div>
  );
}

window.usePagination = usePagination;
window.PaginationBar = PaginationBar;
window.PAGE_SIZE_OPTIONS = PAGE_SIZE_OPTIONS;
