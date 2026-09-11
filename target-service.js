// R33 single-target orchestration: the sidebar panel, /minimal and the
// conversation toggle are the target sources (all through this module). It
// keeps the runtime list (`routing.json`) and the registration metadata
// (`registrations.json`) converged to at most one assistant. Pure-ish: only
// node:fs / node:path plus versioned internal module imports; the stores are
// best-effort and never throw.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const MODULE_VERSION = "0.4.6";
const _routing = await import(new URL("./routing-store.js?v=" + MODULE_VERSION, import.meta.url).href);
const _reg = await import(new URL("./registration-store.js?v=" + MODULE_VERSION, import.meta.url).href);
const { loadRouting, saveRouting } = _routing;
const { loadRegistrations, saveRegistrations } = _reg;

const ROUTING_FILE = "routing.json";
const REGISTRATIONS_FILE = "registrations.json";
const TOMBSTONE = ".deleted-agent.json";

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fileExists(dataDir, name) {
  try {
    return existsSync(join(dataDir, name));
  } catch {
    return false;
  }
}

// routing.json is authoritative only when it exists: loadRouting() treats a
// missing file as the legacy default ["hanako"], which must not resurrect a
// phantom target in a fresh dataDir.
function readRoutingIds(dataDir) {
  try {
    if (!fileExists(dataDir, ROUTING_FILE)) return [];
    return loadRouting(dataDir).targetAgents;
  } catch {
    return [];
  }
}

function readRegistrations(dataDir) {
  try {
    return loadRegistrations(dataDir).registrations;
  } catch {
    return {};
  }
}

function recordOf(registrations, id) {
  const record = registrations[id];
  if (!record) return null;
  return {
    registeredAt: Number.isFinite(record.registeredAt) ? record.registeredAt : 0,
    source: typeof record.source === "string" && record.source ? record.source : "unknown",
  };
}

// Preserves an existing record; materializes a missing one from the runtime
// list ("routing") or from the legacy config migration ("legacy").
function materializeRecord(dataDir, registrations, id) {
  const existing = recordOf(registrations, id);
  if (existing) return existing;
  return {
    registeredAt: Date.now(),
    source: fileExists(dataDir, REGISTRATIONS_FILE) ? "routing" : "legacy",
  };
}

function unionIds(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const id = normalizeId(value);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function isLiveOnDisk(dataDir, id, options) {
  const agentsDir = typeof options?.agentsDir === "string" && options.agentsDir
    ? options.agentsDir
    : resolve(dataDir || process.cwd(), "../../agents");
  try {
    return existsSync(join(agentsDir, id)) && !existsSync(join(agentsDir, id, TOMBSTONE));
  } catch {
    return false;
  }
}

function makeIsLive(dataDir, options) {
  if (typeof options?.isLive === "function") return options.isLive;
  const live = Array.isArray(options?.liveIds) ? new Set(options.liveIds.map(normalizeId)) : null;
  return (id) => (live ? live.has(id) : isLiveOnDisk(dataDir, id, options));
}

// Newest registeredAt wins; ties prefer a live agent, then the pool order
// (routing order).
function pickNewest(pool, registrations, isLive) {
  let best = "";
  let bestAt = -Infinity;
  let bestLive = false;
  for (const id of pool) {
    const record = recordOf(registrations, id);
    const at = record ? record.registeredAt : 0;
    const live = Boolean(isLive(id));
    if (at > bestAt || (at === bestAt && live && !bestLive)) {
      best = id;
      bestAt = at;
      bestLive = live;
    }
  }
  return best;
}

function persist(dataDir, registrations, ids) {
  saveRegistrations(dataDir, registrations);
  saveRouting(dataDir, ids);
}

// Single tolerant read: registrations.json wins when it holds exactly one
// record, otherwise the runtime routing list; anything else reads as "none".
export function getTarget(dataDir) {
  const regIds = Object.keys(readRegistrations(dataDir));
  if (regIds.length === 1) return regIds[0];
  const routingIds = readRoutingIds(dataDir);
  if (routingIds.length === 1) return routingIds[0];
  return "";
}

// Single-target write: the whole registration set becomes [] or [agentId].
// Returns the previous id list, the next id list and the ids that were
// dropped, so callers can clear the removed agents' stage state.
export function setTarget(dataDir, agentId, options = {}) {
  const id = normalizeId(agentId);
  const routingIds = readRoutingIds(dataDir);
  const registrations = readRegistrations(dataDir);
  const previous = unionIds(routingIds, Object.keys(registrations));
  const next = id ? [id] : [];
  const existing = recordOf(registrations, id);
  const source = typeof options?.source === "string" && options.source
    ? options.source
    : (existing?.source || "unknown");
  const records = id
    ? { [id]: { registeredAt: existing ? existing.registeredAt : Date.now(), source } }
    : {};
  persist(dataDir, records, next);
  return { previous, next, removed: previous.filter((value) => !next.includes(value)) };
}

// Refreshes the current single target's registeredAt without touching
// routing.json (the target list is unchanged). Returns { ok: false } when
// nothing is registered; otherwise { ok: true, registrations }.
export function reregisterTarget(dataDir, source = "panel") {
  const id = getTarget(dataDir);
  if (!id) return { ok: false };
  const existing = recordOf(readRegistrations(dataDir), id);
  const nextSource = typeof source === "string" && source ? source : (existing?.source || "unknown");
  const records = { [id]: { registeredAt: Date.now(), source: nextSource } };
  saveRegistrations(dataDir, records);
  return { ok: true, registrations: records };
}

// Collapses any legacy multi-registration to one target: newest registeredAt
// wins (live agents break ties), the rest are removed from both files.
export function collapseToSingle(dataDir, options = {}) {
  const routingIds = readRoutingIds(dataDir);
  const registrations = readRegistrations(dataDir);
  const regIds = Object.keys(registrations);
  const ids = unionIds(routingIds, regIds);
  if (!ids.length) return { kept: "", removed: [] };
  if (ids.length === 1) {
    // An explicitly empty routing list wins over a stray metadata record.
    if (fileExists(dataDir, ROUTING_FILE) && routingIds.length === 0) {
      persist(dataDir, {}, []);
      return { kept: "", removed: [ids[0]] };
    }
    const id = ids[0];
    const consistent = routingIds.length === 1 && routingIds[0] === id && regIds.length === 1;
    if (consistent) return { kept: id, removed: [] };
    persist(dataDir, { [id]: materializeRecord(dataDir, registrations, id) }, [id]);
    return { kept: id, removed: [] };
  }
  const pool = routingIds.length ? routingIds : regIds;
  const kept = pickNewest(pool, registrations, makeIsLive(dataDir, options));
  const removed = ids.filter((value) => value !== kept);
  persist(dataDir, { [kept]: materializeRecord(dataDir, registrations, kept) }, [kept]);
  return { kept, removed };
}
