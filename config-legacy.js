// One-time cleanup of legacy keys left in the plugin config store by older
// versions. The built-in assistants read `<dataDir>/config.json` directly and
// were confused by keys that contradict the actual registration (targetAgents,
// targetAgent, minimalAgentId, allowlist, anchorFirstTurn, trimContext). The
// host config store reads from disk per call (no cache), so a file-level strip
// is safe. Also removes stale data files (R33-era settings-mirror.json) that
// no longer match the panel-managed target. Pure module: node:fs / node:path.
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "config.json";
const STALE_DATA_FILES = ["settings-mirror.json"];

export const LEGACY_CONFIG_KEYS = [
  "targetAgents",
  "targetAgent",
  "minimalAgentId",
  "allowlist",
  "anchorFirstTurn",
  "trimContext",
];

// Reads `<dataDir>/config.json`, removes the legacy keys from its `global`
// object and rewrites the file (2-space JSON + trailing newline) only when at
// least one key was actually removed. Returns the removed key names in
// LEGACY_CONFIG_KEYS order; any failure (missing/corrupt file, bad shape,
// write error) yields [] and leaves the file untouched.
export function stripLegacyConfigKeys(dataDir) {
  try {
    if (typeof dataDir !== "string" || !dataDir) return [];
    const file = join(dataDir, CONFIG_FILE);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const global = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.global : null;
    if (!global || typeof global !== "object" || Array.isArray(global)) return [];
    const removed = LEGACY_CONFIG_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(global, key));
    if (!removed.length) return [];
    for (const key of removed) delete global[key];
    writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
    return removed;
  } catch {
    return [];
  }
}

// R39: deletes stale data files (<dataDir>/settings-mirror.json) that older
// versions wrote and that now contradict the panel-managed target. Best-effort:
// missing files and unusable dataDir paths are no-ops. Returns the names of the
// files actually removed.
export function removeStaleDataFiles(dataDir) {
  const removed = [];
  if (typeof dataDir !== "string" || !dataDir) return removed;
  for (const name of STALE_DATA_FILES) {
    try {
      const file = join(dataDir, name);
      if (!existsSync(file)) continue;
      rmSync(file);
      removed.push(name);
    } catch {
      /* best-effort removal */
    }
  }
  return removed;
}
