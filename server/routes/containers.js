// Container monitoring routes. The collector, SSH executor, and credential
// resolver are injected because server.js also uses them for its timer and app
// topology analysis.
const { getConnectorConfig } = require("../core/services/connector-store");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRef(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function parseTail(value, AppError) {
  if (value === undefined) return 200;
  const tail = Number(value);
  if (!Number.isInteger(tail) || tail < 1 || tail > 2000) {
    throw AppError.unprocessable("tail must be an integer between 1 and 2000.");
  }
  return tail;
}

function registerContainersRoutes({
  app, requireAuth, kvGet, kvSet, auditActivity, AppError, sendAppError,
  collectOneVm, runContainerCollection, resolveVmSshCreds, sshExec,
  portainer, demuxDockerLog, normalizeInspect,
}) {
  const inventoryVm = (vmId) => {
    const data = kvGet("vcenter-data-vcenter")?.value;
    if (!Array.isArray(data?.vms)) return { data: null, vm: null };
    return { data, vm: data.vms.find((vm) => vm?.vm === vmId) || null };
  };
  const vmIp = (vmId) => {
    const { data, vm } = inventoryVm(vmId);
    if (!data) throw AppError.notFound("vcenter-inventory-not-synced");
    if (!vm) throw AppError.notFound("vm-not-found-in-inventory");
    const overrides = kvGet("vm-ip-overrides")?.value || {};
    if (!isPlainObject(overrides)) throw AppError.internal("VM IP override map is invalid");
    const ip = data.clusterVmMap?.[vmId]?.ipAddress || overrides[vm.name] || null;
    if (!ip) throw AppError.unprocessable("VM does not have a resolvable IP address.");
    return ip;
  };
  const credentials = async (vmId) => {
    const result = await resolveVmSshCreds(vmId);
    if (!result?.error) return result;
    if (result.error === "vault-locked") {
      throw new AppError("Vault is locked.", { code: "VAULT_LOCKED", status: 401 });
    }
    throw AppError.unprocessable("VM SSH credentials are unavailable.", { code: "VM_SSH_CREDENTIAL_UNAVAILABLE" });
  };
  const remoteError = (message, error) => AppError.badGateway(message, { cause: error });

  app.get("/api/containers/hosts", requireAuth, (req, res) => {
    const hosts = kvGet("vm-container-hosts")?.value || [];
    if (!Array.isArray(hosts)) return sendAppError(res, AppError.internal("Container host list is invalid"), req);
    return res.json({ hosts });
  });

  app.put("/api/vms/:id/container-monitor", requireAuth, auditActivity({ provider: "containers", action: "Cambiar container-monitor de VM" }), (req, res) => {
    if (!isPlainObject(req.body) || typeof req.body.enabled !== "boolean") {
      return sendAppError(res, AppError.badRequest("enabled must be a boolean."), req);
    }
    const { data, vm } = inventoryVm(req.params.id);
    if (!data) return sendAppError(res, AppError.notFound("vcenter-inventory-not-synced"), req);
    if (!vm) return sendAppError(res, AppError.notFound("vm-not-found-in-inventory"), req);
    try {
      const existing = kvGet("vm-container-hosts")?.value || [];
      if (!Array.isArray(existing)) return sendAppError(res, AppError.internal("Container host list is invalid"), req);
      const hosts = new Set(existing);
      if (req.body.enabled) hosts.add(req.params.id); else hosts.delete(req.params.id);
      const list = [...hosts];
      kvSet("vm-container-hosts", list);
      res.locals.auditMessage = `Container-monitor de VM "${req.params.id}" ${req.body.enabled ? "activado" : "desactivado"}`;
      return res.json({ ok: true, enabled: req.body.enabled, hosts: list });
    } catch (error) {
      return sendAppError(res, AppError.internal("Unable to update container monitoring", { cause: error }), req);
    }
  });

  app.post("/api/containers/collect", requireAuth, auditActivity({ provider: "containers", action: "Forzar colección de contenedores" }), async (req, res) => {
    if (req.body !== undefined && !isPlainObject(req.body)) {
      return sendAppError(res, AppError.badRequest("Container collection body must be a JSON object."), req);
    }
    const { vmId } = req.body || {};
    if (vmId !== undefined && !validRef(vmId)) return sendAppError(res, AppError.badRequest("vmId is invalid."), req);
    if (vmId) {
      const { data, vm } = inventoryVm(vmId);
      if (!data) return sendAppError(res, AppError.notFound("vcenter-inventory-not-synced"), req);
      if (!vm) return sendAppError(res, AppError.notFound("vm-not-found-in-inventory"), req);
    }
    try {
      const result = vmId ? await collectOneVm(vmId) : await runContainerCollection();
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAppError(res, AppError.internal("Unable to collect containers", { cause: error }), req);
    }
  });

  async function inspectOrLogs(req, res, kind) {
    const { source, id, endpointId, vmId } = req.query;
    if (!validRef(id)) return sendAppError(res, AppError.badRequest("id is invalid."), req);
    if (source !== "portainer" && source !== "ssh") return sendAppError(res, AppError.badRequest("source must be portainer or ssh."), req);
    let tail;
    try { tail = parseTail(req.query.tail, AppError); }
    catch (error) { return sendAppError(res, error, req); }
    try {
      if (source === "portainer") {
        if (!validRef(endpointId)) return sendAppError(res, AppError.badRequest("endpointId is invalid."), req);
        const cfg = getConnectorConfig("portainer", { kvGet, kvSet });
        if (!cfg) return sendAppError(res, AppError.unavailable("Portainer is not configured.", { code: "PORTAINER_NOT_CONFIGURED" }), req);
        const token = await portainer.token(cfg);
        if (kind === "inspect") {
          const detail = await portainer.fetch(cfg, `/api/endpoints/${endpointId}/docker/containers/${id}/json`, token);
          return res.json({ inspect: normalizeInspect(detail) });
        }
        const buffer = await portainer.fetchBuffer(cfg, `/api/endpoints/${endpointId}/docker/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`, token);
        return res.json({ logs: demuxDockerLog(buffer) });
      }
      if (!validRef(vmId)) return sendAppError(res, AppError.badRequest("vmId is invalid."), req);
      const ip = vmIp(vmId);
      const creds = await credentials(vmId);
      if (kind === "inspect") {
        const result = await sshExec(ip, creds.port || 22, creds.username, creds.password, `docker inspect ${id}`, 12000, creds.jump);
        let detail = null;
        try { detail = JSON.parse(result.out); } catch {}
        return res.json({ inspect: normalizeInspect(Array.isArray(detail) ? detail[0] : detail) });
      }
      const result = await sshExec(ip, creds.port || 22, creds.username, creds.password, `docker logs --tail ${tail} --timestamps ${id} 2>&1`, 12000, creds.jump);
      return res.json({ logs: result.out });
    } catch (error) {
      const appError = error instanceof AppError ? error : remoteError(kind === "inspect" ? "Unable to inspect container" : "Unable to load container logs", error);
      return sendAppError(res, appError, req);
    }
  }

  app.get("/api/containers/inspect", requireAuth, (req, res) => inspectOrLogs(req, res, "inspect"));
  app.get("/api/containers/logs", requireAuth, (req, res) => inspectOrLogs(req, res, "logs"));

  app.get("/api/containers", requireAuth, (req, res) => {
    const filterVmId = typeof req.query.vmId === "string" ? req.query.vmId : null;
    const out = [];
    const coveredHosts = new Set();
    const vdata = kvGet("vcenter-data-vcenter")?.value;
    const vmRows = Array.isArray(vdata?.vms) ? vdata.vms : [];
    const clusterVmMap = isPlainObject(vdata?.clusterVmMap) ? vdata.clusterVmMap : {};
    const ipToVm = {};
    for (const vm of vmRows) {
      if (!vm?.vm) continue;
      const ip = clusterVmMap[vm.vm]?.ipAddress;
      if (ip) ipToVm[ip] = { vmId: vm.vm, vmName: vm.name };
    }
    const portainerData = kvGet("connector-data-portainer")?.value;
    const baseUrl = (getConnectorConfig("portainer", { kvGet, kvSet })?.baseUrl || "").replace(/\/$/, "");
    if (Array.isArray(portainerData?.endpoints)) {
      for (const endpoint of portainerData.endpoints) {
        if (!endpoint) continue;
        const match = endpoint.hostIp ? ipToVm[endpoint.hostIp] : null;
        const vmId = match?.vmId || endpoint.vmId || null;
        const vmName = match?.vmName || endpoint.name;
        const portainerUrl = baseUrl && endpoint.id ? `${baseUrl}/#!/${endpoint.id}/docker/containers` : null;
        for (const container of Array.isArray(endpoint.containers) ? endpoint.containers : []) {
          out.push({ ...container, vmId, vmName, hostIp: endpoint.hostIp || null, source: "portainer", endpointId: endpoint.id, portainerUrl });
        }
        if (vmId) coveredHosts.add(vmId);
        if (endpoint.hostIp) coveredHosts.add(endpoint.hostIp);
      }
    }
    const markedHosts = kvGet("vm-container-hosts")?.value || [];
    if (!Array.isArray(markedHosts)) return sendAppError(res, AppError.internal("Container host list is invalid"), req);
    for (const vmId of markedHosts) {
      if (coveredHosts.has(vmId)) continue;
      const collected = kvGet(`vm-containers-${vmId}`)?.value;
      if (!Array.isArray(collected?.containers) || (collected.ip && coveredHosts.has(collected.ip))) continue;
      for (const container of collected.containers) out.push({ ...container, vmId, vmName: collected.vmName, hostIp: collected.ip, source: "ssh", collectedAt: collected.ts || null });
    }
    const containers = filterVmId ? out.filter((container) => container.vmId === filterVmId) : out;
    return res.json({ containers, total: containers.length, running: containers.filter((container) => container.state === "running").length });
  });
}

module.exports = { parseTail, registerContainersRoutes, validRef };
