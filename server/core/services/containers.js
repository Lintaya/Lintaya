function deriveContainerState(rawState, status) {
  const state = (rawState || "").toLowerCase();
  if (state) return state;
  const text = (status || "").trim().toLowerCase();
  if (/^up\b/.test(text)) return "running";
  if (/^(exited|dead)\b/.test(text)) return "exited";
  if (/^created\b/.test(text)) return "created";
  if (/^(paused|\(paused\))/.test(text)) return "paused";
  if (/^restarting\b/.test(text)) return "restarting";
  return "";
}

function parseDockerPs(text) {
  return String(text || "").split("\n").filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean)
    .map((container) => ({ id: (container.ID || "").slice(0, 12), name: container.Names || container.Name || "", image: container.Image || "", state: deriveContainerState(container.State, container.Status), status: container.Status || "", ports: container.Ports ? container.Ports.split(",").map((value) => value.trim()).filter(Boolean) : [], createdAt: container.CreatedAt || null, cpuPct: null, memUsage: null }));
}

function demuxDockerLog(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""));
  const multiplexed = buffer.length >= 8 && (buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2) && buffer[1] === 0 && buffer[2] === 0 && buffer[3] === 0;
  if (!multiplexed) return buffer.toString("utf8");
  let output = ""; let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4); offset += 8;
    if (offset + size > buffer.length) { output += buffer.slice(offset).toString("utf8"); break; }
    output += buffer.slice(offset, offset + size).toString("utf8"); offset += size;
  }
  return output;
}

function normalizeInspect(detail) {
  if (!detail) return null;
  const networks = detail.NetworkSettings?.Networks || {};
  return { id: (detail.Id || "").slice(0, 12), name: (detail.Name || "").replace(/^\//, ""), image: detail.Config?.Image || "", state: (detail.State?.Status || "").toLowerCase(), status: detail.State?.Status || "", created: detail.Created || null, startedAt: detail.State?.StartedAt || null, restartCount: detail.RestartCount ?? 0, health: detail.State?.Health?.Status || null, cmd: Array.isArray(detail.Config?.Cmd) ? detail.Config.Cmd.join(" ") : (detail.Config?.Cmd || ""), env: Array.isArray(detail.Config?.Env) ? detail.Config.Env : [], mounts: (detail.Mounts || []).map((mount) => ({ src: mount.Source || mount.Name || "", dst: mount.Destination || "", mode: mount.Mode || (mount.RW ? "rw" : "ro") })), networks: Object.entries(networks).map(([name, network]) => ({ name, ip: network.IPAddress || "" })), restartPolicy: detail.HostConfig?.RestartPolicy?.Name || "", ports: detail.NetworkSettings?.Ports ? Object.keys(detail.NetworkSettings.Ports) : [] };
}

module.exports = { demuxDockerLog, deriveContainerState, normalizeInspect, parseDockerPs };
