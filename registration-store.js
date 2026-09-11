// Registration metadata store: which assistant is registered as the single
// target (sidebar panel, /minimal, conversation toggle), when and from where.
// Pure module (node:fs / node:path only, no internal imports). A corrupt or
// missing file is treated as an empty map; writes are best-effort and never
// throw.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCHEMA_VERSION = 1;
const REGISTRATIONS_FILE = "registrations.json";

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const registeredAt = Number(record.registeredAt);
  return {
    registeredAt: Number.isFinite(registeredAt) ? registeredAt : 0,
    source: typeof record.source === "string" && record.source ? record.source : "unknown",
  };
}

function normalizeMap(input) {
  const out = {};
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const [key, record] of Object.entries(source)) {
    const id = typeof key === "string" ? key.trim() : "";
    if (!id) continue;
    const normalized = normalizeRecord(record);
    if (!normalized) continue;
    out[id] = normalized;
  }
  return out;
}

export function loadRegistrations(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, REGISTRATIONS_FILE), "utf8"));
    const registrations = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? normalizeMap(parsed.registrations)
      : {};
    return { schemaVersion: SCHEMA_VERSION, registrations };
  } catch {
    return { schemaVersion: SCHEMA_VERSION, registrations: {} };
  }
}

export function saveRegistrations(dataDir, registrations) {
  try {
    const file = join(dataDir, REGISTRATIONS_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, registrations: normalizeMap(registrations) }, null, 2) + "\n",
    );
    return true;
  } catch {
    return false;
  }
}

// Adds or refreshes an agent's registration record and returns the updated map
// (insertion order is preserved for existing ids).
export function registerAgent(dataDir, agentId, source) {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  const { registrations } = loadRegistrations(dataDir);
  if (!id) return registrations;
  registrations[id] = {
    registeredAt: Date.now(),
    source: typeof source === "string" && source ? source : "unknown",
  };
  saveRegistrations(dataDir, registrations);
  return registrations;
}

// Deletes an agent's registration record and returns the updated map.
export function unregisterAgent(dataDir, agentId) {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  const { registrations } = loadRegistrations(dataDir);
  if (id) delete registrations[id];
  saveRegistrations(dataDir, registrations);
  return registrations;
}


