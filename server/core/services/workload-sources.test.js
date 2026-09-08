const assert = require("node:assert/strict");
const test = require("node:test");

const { createWorkloadSources } = require("./workload-sources");

test("an install with no source correlates nothing rather than failing", async () => {
  // The public build ships no workload source at all. Fabric correlation still
  // has to answer — with every MAC unnamed — instead of throwing.
  const sources = createWorkloadSources();

  assert.deepEqual(await sources.vmIndex("MEX"), { index: {}, vmCount: 0 });
  assert.deepEqual(sources.hostIndex("MEX"), {});
});

test("a registered source answers for its own MACs", async () => {
  const sources = createWorkloadSources();
  sources.register("vcenter", {
    vmIndex: async () => ({ index: { aabb: { vm: "web-01" } }, vmCount: 1 }),
    hostIndex: () => ({ ccdd: { host: "esx-01", device: "vmnic0" } }),
  });

  const { index, vmCount } = await sources.vmIndex();
  assert.deepEqual(index, { aabb: { vm: "web-01" } });
  assert.equal(vmCount, 1);
  assert.deepEqual(sources.hostIndex(), { ccdd: { host: "esx-01", device: "vmnic0" } });
});

test("the site filter reaches the source unchanged", async () => {
  const seen = [];
  const sources = createWorkloadSources();
  sources.register("vcenter", {
    vmIndex: async (site) => { seen.push(site); return { index: {}, vmCount: 0 }; },
    hostIndex: (site) => { seen.push(site); return {}; },
  });

  await sources.vmIndex("GDL");
  sources.hostIndex("GDL");
  assert.deepEqual(seen, ["GDL", "GDL"]);
});

test("two sources merge, and the first to claim a MAC keeps it", async () => {
  const sources = createWorkloadSources();
  sources.register("first", {
    vmIndex: async () => ({ index: { aabb: { vm: "from-first" } }, vmCount: 1 }),
    hostIndex: () => ({ ccdd: { host: "from-first" } }),
  });
  sources.register("second", {
    vmIndex: async () => ({ index: { aabb: { vm: "from-second" }, eeff: { vm: "only-second" } }, vmCount: 2 }),
    hostIndex: () => ({ ccdd: { host: "from-second" } }),
  });

  const { index, vmCount } = await sources.vmIndex();
  assert.equal(index.aabb.vm, "from-first", "registration order decides a contested MAC");
  assert.equal(index.eeff.vm, "only-second");
  assert.equal(vmCount, 3, "counts add up across sources");
  assert.equal(sources.hostIndex().ccdd.host, "from-first");
});

test("a source may answer only one of the two questions", async () => {
  // A cloud provider would have workloads and no physical hosts.
  const sources = createWorkloadSources();
  sources.register("vms-only", { vmIndex: async () => ({ index: { aabb: { vm: "x" } }, vmCount: 1 }) });

  assert.deepEqual(sources.hostIndex(), {});
  assert.equal((await sources.vmIndex()).index.aabb.vm, "x");
});

test("registering the same id twice is refused", () => {
  const sources = createWorkloadSources();
  sources.register("vcenter", {});

  assert.throws(() => sources.register("vcenter", {}), /already registered/);
  assert.throws(() => sources.register("", {}), /needs an id/);
  assert.equal(sources.size, 1);
});
