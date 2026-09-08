// Zone-tree layout engine shared by the Module Builder editor (module-builder.jsx)
// and the read-only custom page renderer (custom-page-view.jsx). A page's layout
// is a binary tree: a "z" leaf is a zone holding an ordered stack of block ids,
// an "s" node is a split (dir "v"|"h", a ratio, and two children). flatten()
// turns that tree into absolute-percentage rectangles for rendering; the rest
// are pure edit operations used by the builder. No JSX/UI here — this repo has
// no bundler/imports (see AGENTS.md), so this is exposed as window.ZoneTree.
(function () {
  let uid = 0;
  const leaf = (blocks = []) => ({ t: "z", k: `z${++uid}`, blocks });
  const split = (dir, a, b, ratio = 0.5) => ({ t: "s", k: `s${++uid}`, dir, ratio, a, b });

  const PRESETS = {
    single: () => leaf(),
    columns: () => split("v", leaf(), leaf()),
    rows: () => split("h", leaf(), leaf()),
    grid: () => split("h", split("v", leaf(), leaf()), split("v", leaf(), leaf())),
    priority: () => split("v", leaf(), split("h", leaf(), leaf()), 0.62),
    focus: () => split("h", split("v", leaf(), leaf(), 0.62), leaf(), 0.58),
  };
  const PRESET_LIST = [
    ["single", "1 zona"], ["columns", "Columnas"], ["rows", "Filas"],
    ["grid", "Cuadrícula"], ["priority", "Prioridad"], ["focus", "Foco"],
  ];

  // Re-seeds the module-scoped counter from the max numeric suffix already
  // present in a loaded tree, so re-splitting a saved page can't mint a node
  // key that collides with one it already has.
  function seedUidFrom(tree) {
    let max = 0;
    const walk = (n) => {
      const m = /^[a-z](\d+)$/.exec(n.k || "");
      if (m) max = Math.max(max, Number(m[1]));
      if (n.t === "s") { walk(n.a); walk(n.b); }
    };
    if (tree) walk(tree);
    uid = Math.max(uid, max);
  }

  const mapZones = (n, fn) => (n.t === "z" ? fn(n) : { ...n, a: mapZones(n.a, fn), b: mapZones(n.b, fn) });
  const editZone = (n, k, fn) => mapZones(n, z => (z.k === k ? fn(z) : z));

  function setRatio(n, k, r) {
    if (n.t !== "s") return n;
    if (n.k === k) return { ...n, ratio: r };
    return { ...n, a: setRatio(n.a, k, r), b: setRatio(n.b, k, r) };
  }
  function splitZone(n, k, dir) {
    if (n.t === "z") return n.k === k ? split(dir, { ...n }, leaf()) : n;
    return { ...n, a: splitZone(n.a, k, dir), b: splitZone(n.b, k, dir) };
  }
  function removeZone(n, k) {
    if (n.t === "z") return n;
    if (n.a.t === "z" && n.a.k === k) return n.b;
    if (n.b.t === "z" && n.b.k === k) return n.a;
    return { ...n, a: removeZone(n.a, k), b: removeZone(n.b, k) };
  }
  const pushBlock = (n, k, id) => editZone(n, k, z => ({ ...z, blocks: [...z.blocks, id] }));

  // Board workspaces need a split node to expose a resize separator. Keep the
  // existing leaf when it is empty; when it is already occupied, place the new
  // Block in a sibling leaf instead of silently stacking it in the same pane.
  // This uses the existing tree contract, so old Boards and pushBlock callers
  // remain valid and no persisted-data migration is required.
  function addBlockAsPane(n, k, id, dir = "h") {
    return editZone(n, k, z => {
      if (!Array.isArray(z.blocks) || z.blocks.length === 0) {
        return { ...z, blocks: [id] };
      }
      return split(dir, { ...z }, leaf([id]), 0.5);
    });
  }

  const pullBlock = (n, k, i) => editZone(n, k, z => ({ ...z, blocks: z.blocks.filter((_, j) => j !== i) }));
  const moveBlock = (n, k, i, d) => editZone(n, k, z => {
    const b = [...z.blocks], j = i + d;
    if (j < 0 || j >= b.length) return z;
    [b[i], b[j]] = [b[j], b[i]];
    return { ...z, blocks: b };
  });

  // Removes empty leaves without changing any occupied subtree. When one
  // side of a split disappears, its sibling is promoted and therefore fills
  // the released space; ratios inside that surviving subtree stay intact.
  // Returning one fresh empty leaf for an entirely empty Board keeps the
  // persisted tree valid and gives Board Builder a target for adding Blocks
  // again. Existing saved trees need no migration: compaction only runs after
  // an explicit placement removal (or when a renderer asks for a presentation
  // tree), and leaf `blocks` remains the same array-of-string-ids contract.
  function compactNode(n) {
    if (!n || typeof n !== "object") return null;
    if (n.t === "z") return Array.isArray(n.blocks) && n.blocks.length ? n : null;
    if (n.t !== "s") return null;
    const a = compactNode(n.a);
    const b = compactNode(n.b);
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return { ...n, a, b };
  }

  function compactTree(n) {
    return compactNode(n) || leaf();
  }

  function removeBlockAndCompact(n, k, i) {
    return compactTree(pullBlock(n, k, i));
  }

  function countBlocks(n) {
    if (!n || typeof n !== "object") return 0;
    if (n.t === "z") return Array.isArray(n.blocks) ? n.blocks.length : 0;
    return countBlocks(n.a) + countBlocks(n.b);
  }

  function firstZoneKey(n) {
    if (!n || typeof n !== "object") return null;
    if (n.t === "z") return n.k || null;
    return firstZoneKey(n.a) || firstZoneKey(n.b);
  }

  function blockIds(n) {
    if (!n || typeof n !== "object") return [];
    if (n.t === "z") return Array.isArray(n.blocks) ? n.blocks : [];
    return [...blockIds(n.a), ...blockIds(n.b)];
  }

  function flatten(n, box = { x: 0, y: 0, w: 100, h: 100 }, out = { zones: [], grips: [] }, idx = { i: 0 }) {
    if (n.t === "z") { out.zones.push({ ...n, ...box, n: ++idx.i }); return out; }
    const G = 1.2;
    if (n.dir === "v") {
      const wa = n.ratio * box.w - G / 2, wb = (1 - n.ratio) * box.w - G / 2;
      flatten(n.a, { x: box.x, y: box.y, w: wa, h: box.h }, out, idx);
      flatten(n.b, { x: box.x + wa + G, y: box.y, w: wb, h: box.h }, out, idx);
      out.grips.push({ k: n.k, dir: "v", x: box.x + wa, y: box.y, len: box.h, at: box.x, span: box.w });
    } else {
      const ha = n.ratio * box.h - G / 2, hb = (1 - n.ratio) * box.h - G / 2;
      flatten(n.a, { x: box.x, y: box.y, w: box.w, h: ha }, out, idx);
      flatten(n.b, { x: box.x, y: box.y + ha + G, w: box.w, h: hb }, out, idx);
      out.grips.push({ k: n.k, dir: "h", x: box.x, y: box.y + ha, len: box.w, at: box.y, span: box.h });
    }
    return out;
  }

  const api = {
    leaf, split, PRESETS, PRESET_LIST, flatten,
    splitZone, removeZone, setRatio, pushBlock, addBlockAsPane, pullBlock, moveBlock,
    compactTree, removeBlockAndCompact, countBlocks, firstZoneKey, blockIds, seedUidFrom,
  };
  if (typeof window !== "undefined") window.ZoneTree = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
