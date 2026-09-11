// Pure agent-catalog helpers: map bus entries, scan the agents directory and
// prune deleted targets. No host dependencies beyond node:fs / node:path.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TOMBSTONE = ".deleted-agent.json";
const NAME_RE = /^\s*name:\s*["']?([^"'\n#]+)["']?\s*$/m;

export function mapAgentEntries(entries) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.deleted || entry.deletedAt) continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id;
    out.push({ id, name, isPrimary: Boolean(entry.isPrimary) });
  }
  return out.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

function extractAgentName(source) {
  const lines = String(source).split(/\r?\n/);
  const start = lines.findIndex((line) => /^agent\s*:/.test(line));
  if (start === -1) return null;
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() && !/^\s/.test(line)) break;
    block.push(line);
  }
  const match = NAME_RE.exec(block.join("\n"));
  return match ? match[1].trim() || null : null;
}

export function scanAgentsDir(agentsDir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(agentsDir, entry.name);
    if (existsSync(join(dir, TOMBSTONE))) continue;
    let name = entry.name;
    try {
      const extracted = extractAgentName(readFileSync(join(dir, "config.yaml"), "utf8"));
      if (extracted) name = extracted;
    } catch {
      /* keep the directory name */
    }
    out.push({ id: entry.name, name, isPrimary: false });
  }
  return out;
}

export function pruneDeletedTargets(targets, agentsDir) {
  const kept = [];
  const removed = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const id = typeof target === "string" ? target.trim() : "";
    if (!id) continue;
    if (existsSync(join(agentsDir, id, TOMBSTONE))) removed.push(id);
    else kept.push(id);
  }
  return { kept, removed };
}
