// Workload sources for fabric correlation.
//
// A fabric adapter yields a MAC table: which MAC was seen on which port. Naming
// the thing behind that MAC takes a *workload source* — a connector that knows
// what it runs. vCenter is one; a cloud provider would be another.
//
// Core owns the join and never the source. Before ADR-014 Phase 1 server.js
// called the vCenter client directly, which is why a build without the
// enterprise tier could not resolve a workload at all. Now a source registers
// itself and an install with none simply correlates fewer rows: every MAC comes
// back unnamed, which is the honest answer rather than an error.
function createWorkloadSources() {
  const sources = new Map();

  function register(id, source) {
    if (!id) throw new TypeError("A workload source needs an id");
    if (sources.has(id)) throw new Error(`Workload source "${id}" is already registered`);
    sources.set(id, source);
  }

  // mac → { vm, net, connected }. Sources are queried in registration order and
  // the first to name a MAC wins; two sources claiming the same MAC would mean
  // the same workload is inventoried twice, and picking either is better than
  // failing the whole correlation.
  async function vmIndex(site) {
    const index = {};
    let vmCount = 0;
    for (const source of sources.values()) {
      if (typeof source.vmIndex !== "function") continue;
      const result = await source.vmIndex(site);
      vmCount += result?.vmCount || 0;
      for (const [mac, workload] of Object.entries(result?.index || {})) {
        if (!(mac in index)) index[mac] = workload;
      }
    }
    return { index, vmCount };
  }

  // mac → { host, device }, for physical host uplinks. Synchronous: every
  // source so far answers this from its own cached inventory.
  function hostIndex(site) {
    const index = {};
    for (const source of sources.values()) {
      if (typeof source.hostIndex !== "function") continue;
      for (const [mac, host] of Object.entries(source.hostIndex(site) || {})) {
        if (!(mac in index)) index[mac] = host;
      }
    }
    return index;
  }

  return { register, vmIndex, hostIndex, get size() { return sources.size; } };
}

module.exports = { createWorkloadSources };
