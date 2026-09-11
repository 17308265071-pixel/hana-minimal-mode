// Shared in-memory state between the plugin lifecycle, commands, tools, and
// the Pi SDK extension. This module is the runtime mirror of the persisted
// config plus per-session routing state (alias buckets) and per-session stage
// state. Everything is defensive: a corrupt or missing store file is treated
// as empty and rebuilt on the next write.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SCHEMA_VERSION = 1;
const STORE_FILE = "stage-state.json";

// Lazy singletons. storeDir is only set by the first initStore() call in this
// module instance; the tests re-import the module with a cache-busting query
// to simulate a restart, so nothing may be bound at module load time.
let storeDir = null;
let store = null;
let current = null;

// Plugin lifecycle context holder: extensions are registered from onload(ctx)
// but must be able to write back through the lifecycle ctx (config store), as
// the in-memory mirror alone is reverted by _sync / the 60s poll.
let pluginCtx = null;

export function setPluginCtx(ctx) { pluginCtx = ctx; }
export function getPluginCtx() { return pluginCtx; }

export function defaultConfig() {
  return {
    enabled: true,
    targetAgents: "",
    routerMode: "auto",
    stagedUnlock: true,
    zeroToolAnchor: true,
    bootstrapMaxTokens: 1024,
    dynamicPacks: true,
    postAnchorInjection: true,
    networkGuard: false,
    conversationControl: true,
  };
}

function defaultStageBucket() {
  return {
    stage: 0,
    guided: false,
    bootstrapPending: false,
    consumed: 0,
    openedPacks: [],
    lastAdvance: null,
    tier: null,
  };
}

function storePath() {
  return join(storeDir || process.cwd(), STORE_FILE);
}

function loadStore() {
  if (store) return store;
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8"));
    store = {
      schemaVersion: SCHEMA_VERSION,
      buckets: parsed && typeof parsed === "object" && parsed.buckets && typeof parsed.buckets === "object"
        ? parsed.buckets
        : {},
      stages: parsed && typeof parsed === "object" && parsed.stages && typeof parsed.stages === "object"
        ? parsed.stages
        : {},
    };
  } catch {
    store = { schemaVersion: SCHEMA_VERSION, buckets: {}, stages: {} };
  }
  return store;
}

function persistStore() {
  try {
    const file = storePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(loadStore()));
  } catch {
    /* best-effort persistence */
  }
}

export function initStore(dataDir) {
  if (storeDir) return;
  storeDir = typeof dataDir === "string" && dataDir ? dataDir : process.cwd();
}

export function getState() {
  if (!current) current = defaultConfig();
  return current;
}

export function setState(patch) {
  current = { ...getState(), ...(patch && typeof patch === "object" ? patch : {}) };
  return current;
}

export function targetAgentIds() {
  const raw = getState().targetAgents;
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// Unlike the legacy plugin, an empty target list means "no targets" (the
// plugin has no effect), not "all agents".
export function isAgentInScope(agentId) {
  const ids = targetAgentIds();
  if (!ids.length) return false;
  return typeof agentId === "string" && agentId.length > 0 && ids.includes(agentId);
}

function toKeyList(keys) {
  return (Array.isArray(keys) ? keys : [keys]).filter((k) => typeof k === "string" && k);
}

export function getSession(keys) {
  const list = toKeyList(keys);
  if (!list.length) return null;
  for (const bucket of Object.values(loadStore().buckets)) {
    if (Array.isArray(bucket?.aliases) && bucket.aliases.some((a) => list.includes(a))) {
      return bucket.state ?? null;
    }
  }
  return null;
}

export function updateSession(keys, patch, extraAliases = []) {
  const aliases = [...toKeyList(keys), ...toKeyList(extraAliases)];
  if (!aliases.length) return null;
  const buckets = loadStore().buckets;
  let bucket = null;
  for (const b of Object.values(buckets)) {
    if (Array.isArray(b?.aliases) && b.aliases.some((a) => aliases.includes(a))) {
      bucket = b;
      break;
    }
  }
  if (!bucket) {
    bucket = { aliases: [], state: {} };
    buckets[aliases[0]] = bucket;
  }
  for (const a of aliases) {
    if (!bucket.aliases.includes(a)) bucket.aliases.push(a);
  }
  bucket.state = { ...(bucket.state || {}), ...(patch && typeof patch === "object" ? patch : {}) };
  persistStore();
  return bucket.state;
}

export function resetSession(keys) {
  const list = toKeyList(keys);
  if (!list.length) return;
  const buckets = loadStore().buckets;
  let removed = false;
  for (const [id, bucket] of Object.entries(buckets)) {
    if (Array.isArray(bucket?.aliases) && bucket.aliases.some((a) => list.includes(a))) {
      delete buckets[id];
      removed = true;
    }
  }
  if (removed) persistStore();
}

export function getStageBucket(sid) {
  const found = loadStore().stages[sid];
  return found && typeof found === "object"
    ? { ...defaultStageBucket(), ...found }
    : defaultStageBucket();
}

export function setStageBucket(sid, patch) {
  if (typeof sid !== "string" || !sid) return null;
  const stages = loadStore().stages;
  const prev = stages[sid] && typeof stages[sid] === "object" ? stages[sid] : {};
  const next = { ...defaultStageBucket(), ...prev, ...(patch && typeof patch === "object" ? patch : {}) };
  stages[sid] = next;
  persistStore();
  return next;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// R27: "deleting a registration restores the pre-registration state" — remove
// every persisted stage bucket whose session key belongs to the agent. Session
// keys are file paths containing "/agents/<id>/", normalized for Windows
// separators; the segment is anchored so relative keys (agents/<id>/...) match
// while ids that merely contain the agent id do not. Alias buckets are
// best-effort: a bucket is dropped when any of its aliases points at the agent.
// Returns the number of removed entries.
export function clearAgentStages(agentId) {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  if (!id) return 0;
  const st = loadStore();
  const agentRe = new RegExp("(^|/)agents/" + escapeRegExp(id) + "/");
  const matches = (value) => typeof value === "string" && agentRe.test(value.replace(/\\/g, "/"));
  let cleared = 0;
  for (const key of Object.keys(st.stages)) {
    if (matches(key)) {
      delete st.stages[key];
      cleared += 1;
    }
  }
  for (const [key, bucket] of Object.entries(st.buckets)) {
    const aliases = Array.isArray(bucket?.aliases) ? bucket.aliases : [];
    if (aliases.some(matches)) {
      delete st.buckets[key];
      cleared += 1;
    }
  }
  if (cleared) persistStore();
  return cleared;
}

// R39: sweep stage entries for agents that are no longer the target (older
// versions could leave them behind independently of any registration change).
// The agent id is captured from the first `(^|/)agents/<id>/` segment of each
// normalized stage key; entries without that segment are unscoped and kept.
// Alias buckets are dropped when any alias points at another agent. Passing
// "" removes every agent-scoped entry. Persists once when anything changed;
// returns the number of removed entries.
export function pruneStagesExcept(keepAgentId) {
  const keep = typeof keepAgentId === "string" ? keepAgentId.trim() : "";
  const st = loadStore();
  const agentRe = /(^|\/)agents\/([^/]+)\//;
  const agentOf = (value) => {
    if (typeof value !== "string") return "";
    const match = agentRe.exec(value.replace(/\\/g, "/"));
    return match ? match[2] : "";
  };
  let removed = 0;
  for (const key of Object.keys(st.stages)) {
    const id = agentOf(key);
    if (id && id !== keep) {
      delete st.stages[key];
      removed += 1;
    }
  }
  for (const [key, bucket] of Object.entries(st.buckets)) {
    const aliases = Array.isArray(bucket?.aliases) ? bucket.aliases : [];
    if (aliases.some((alias) => {
      const id = agentOf(alias);
      return id !== "" && id !== keep;
    })) {
      delete st.buckets[key];
      removed += 1;
    }
  }
  if (removed) persistStore();
  return removed;
}

// R40: prune residue for sessions that no longer exist on disk (the audit
// found stage-state.json pointing at 2 of 4 deleted session files). A key is
// only considered when it contains an `agents/<id>/` segment (separators
// normalized) AND looks like an absolute path (Windows drive or leading "/");
// relative keys cannot be resolved against the filesystem and stay. Alias
// buckets are dropped when any alias matches the same rule. Filesystem errors
// count as "keep" so odd keys are never deleted on a false signal.
//
// Safety valve: if the store still holds more than MAX_STAGES stage entries
// after existence pruning, timestamps live in the session filenames, so sorting
// keys lexicographically descending puts the newest first; everything beyond
// the first MAX_STAGES keys is dropped. Persists once and returns the number of
// removed entries (stages + buckets).
const MAX_STAGES = 500;

function isMissingSessionPath(value) {
  if (typeof value !== "string" || !value) return false;
  const normalized = value.replace(/\\/g, "/");
  if (!/(^|\/)agents\/[^/]+\//.test(normalized)) return false;
  if (!/^[A-Za-z]:\//.test(normalized) && !normalized.startsWith("/")) return false;
  try {
    return !existsSync(value);
  } catch {
    return false;
  }
}

export function pruneMissingSessions() {
  const st = loadStore();
  let removed = 0;
  for (const key of Object.keys(st.stages)) {
    if (isMissingSessionPath(key)) {
      delete st.stages[key];
      removed += 1;
    }
  }
  for (const [key, bucket] of Object.entries(st.buckets)) {
    const aliases = Array.isArray(bucket?.aliases) ? bucket.aliases : [];
    if (aliases.some(isMissingSessionPath)) {
      delete st.buckets[key];
      removed += 1;
    }
  }
  const keys = Object.keys(st.stages);
  if (keys.length > MAX_STAGES) {
    for (const key of keys.sort().reverse().slice(MAX_STAGES)) {
      delete st.stages[key];
      removed += 1;
    }
  }
  if (removed) persistStore();
  return removed;
}
