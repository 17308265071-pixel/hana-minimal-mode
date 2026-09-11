// Pure routing-target persistence: the target-assistant list lives in
// `<dataDir>/routing.json` because the native plugin settings schema only
// renders static manifest properties (no dynamic option source). No host
// dependencies beyond node:fs / node:path.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SCHEMA_VERSION = 1;
const ROUTING_FILE = "routing.json";
const TOMBSTONE = ".deleted-agent.json";
const DEFAULT_TARGETS = ["hanako"];

function defaultRouting() {
  return { targetAgents: [...DEFAULT_TARGETS] };
}

// Accepts an array or a legacy comma-string, trims, drops non-strings/empties
// and dedupes while preserving order. Returns null for unsupported types.
function normalizeIdList(input) {
  let items;
  if (Array.isArray(input)) items = input;
  else if (typeof input === "string") items = input.split(",");
  else return null;
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function coerceObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to default */
    }
  }
  return null;
}

// Tolerant parse: missing/invalid targetAgents → ["hanako"]; an explicitly
// empty list stays empty (means "no targets", not "all agents").
export function parseRouting(raw) {
  const value = coerceObject(raw);
  if (!value || !("targetAgents" in value)) return defaultRouting();
  const list = normalizeIdList(value.targetAgents);
  if (list === null) return defaultRouting();
  return { targetAgents: list };
}

export function loadRouting(dataDir) {
  try {
    return parseRouting(readFileSync(join(dataDir, ROUTING_FILE), "utf8"));
  } catch {
    return parseRouting(null);
  }
}

export function saveRouting(dataDir, ids) {
  try {
    const list = normalizeIdList(ids);
    const file = join(dataDir, ROUTING_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ schemaVersion: SCHEMA_VERSION, targetAgents: list || [] }, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

function hasTombstone(agentsDir, id) {
  if (!agentsDir) return false;
  try {
    return existsSync(join(agentsDir, id, TOMBSTONE));
  } catch {
    return false;
  }
}

// One-shot migration input for hosts that still carry the legacy config value
// (targetAgents string "a,b" or array, possibly from minimalAgentId). The
// optional isDeleted callback avoids a cross-module dependency; when omitted,
// agentsDir tombstones are consulted directly. A missing routing.json with no
// legacy value is a fresh install: it starts with no target (the settings
// dropdown is the only registration surface), never with a built-in default.
export function migrateRouting({ configValue, routingExists, agentsDir, isDeleted } = {}) {
  if (routingExists) return { ids: [], migrated: false };
  const legacy = normalizeIdList(configValue);
  if (!legacy || !legacy.length) return { ids: [], migrated: true };
  const isGone = typeof isDeleted === "function" ? isDeleted : (id) => hasTombstone(agentsDir, id);
  return { ids: legacy.filter((id) => !isGone(id)), migrated: true };
}
