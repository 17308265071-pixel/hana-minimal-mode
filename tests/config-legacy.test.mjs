// Unit tests for config-legacy: one-time file-level cleanup of legacy keys in
// `<dataDir>/config.json` that contradicted the actual (panel-managed)
// registration and confused the built-in assistants reading plugin files.
// Pure module: node:fs / node:path only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripLegacyConfigKeys, removeStaleDataFiles, LEGACY_CONFIG_KEYS } from "../config-legacy.js";

const LEGACY = {
  targetAgents: "hanako",
  targetAgent: "hanako",
  minimalAgentId: "minimal-4,minimal-5",
  allowlist: ["exec_command", "write_stdin", "edit"],
  anchorFirstTurn: true,
  trimContext: true,
};

const CURRENT = {
  enabled: true,
  routerMode: "auto",
  stagedUnlock: true,
  zeroToolAnchor: true,
  bootstrapMaxTokens: 1024,
  dynamicPacks: true,
  postAnchorInjection: true,
  networkGuard: false,
  conversationControl: true,
};

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfig(dir, value) {
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(value, null, 2) + "\n");
}

function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
}

test("strips all legacy keys, preserves current keys + schemaVersion + agent/session maps", () => {
  const dir = tmpDir("hmm-config-legacy-");
  try {
    writeConfig(dir, {
      schemaVersion: 1,
      global: { ...LEGACY, ...CURRENT },
      agents: { hanako: { note: "keep" } },
      sessions: { "s1": { stage: 2 } },
    });

    const removed = stripLegacyConfigKeys(dir);
    assert.deepEqual(removed, LEGACY_CONFIG_KEYS, "every legacy key is reported in stable order");

    const raw = fs.readFileSync(path.join(dir, "config.json"), "utf8");
    assert.ok(raw.endsWith("\n"), "rewrite keeps the trailing newline");
    assert.equal(raw, JSON.stringify(readConfig(dir), null, 2) + "\n", "rewrite uses 2-space JSON");

    const parsed = readConfig(dir);
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(parsed.global, CURRENT, "only the legacy keys are removed");
    assert.deepEqual(parsed.agents, { hanako: { note: "keep" } });
    assert.deepEqual(parsed.sessions, { "s1": { stage: 2 } });
    for (const key of LEGACY_CONFIG_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(parsed.global, key), false, key + " must be gone");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("second run is a no-op: returns [] and leaves the rewritten bytes untouched", () => {
  const dir = tmpDir("hmm-config-legacy-noop-");
  try {
    writeConfig(dir, { schemaVersion: 1, global: { ...LEGACY, ...CURRENT } });
    const first = stripLegacyConfigKeys(dir);
    assert.equal(first.length, LEGACY_CONFIG_KEYS.length);

    const before = fs.readFileSync(path.join(dir, "config.json"), "utf8");
    const second = stripLegacyConfigKeys(dir);
    assert.deepEqual(second, []);
    assert.equal(fs.readFileSync(path.join(dir, "config.json"), "utf8"), before, "no rewrite without removals");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt or unusable config: returns [] and leaves the file untouched", () => {
  const dir = tmpDir("hmm-config-legacy-corrupt-");
  try {
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, "{oops");
    assert.deepEqual(stripLegacyConfigKeys(dir), []);
    assert.equal(fs.readFileSync(file, "utf8"), "{oops", "corrupt file must stay untouched");

    writeConfig(dir, { schemaVersion: 1, global: "not-an-object" });
    const shaped = fs.readFileSync(file, "utf8");
    assert.deepEqual(stripLegacyConfigKeys(dir), []);
    assert.equal(fs.readFileSync(file, "utf8"), shaped, "unusable global shape must stay untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing file or empty dataDir is a silent no-op", () => {
  const dir = tmpDir("hmm-config-legacy-missing-");
  try {
    assert.deepEqual(stripLegacyConfigKeys(dir), []);
    assert.deepEqual(stripLegacyConfigKeys(""), []);
    assert.deepEqual(stripLegacyConfigKeys(null), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeStaleDataFiles deletes settings-mirror.json and reports it", () => {
  const dir = tmpDir("hmm-config-legacy-stale-");
  try {
    const mirror = path.join(dir, "settings-mirror.json");
    fs.writeFileSync(mirror, JSON.stringify({ targetAgents: ["hanako"] }));
    fs.writeFileSync(path.join(dir, "keep.json"), "{}");

    assert.deepEqual(removeStaleDataFiles(dir), ["settings-mirror.json"]);
    assert.equal(fs.existsSync(mirror), false, "the stale mirror is gone");
    assert.equal(fs.existsSync(path.join(dir, "keep.json")), true, "unrelated files are untouched");
    assert.deepEqual(removeStaleDataFiles(dir), [], "a second run is a no-op");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeStaleDataFiles tolerates absent files and unusable dataDir", () => {
  const dir = tmpDir("hmm-config-legacy-stale-missing-");
  try {
    assert.deepEqual(removeStaleDataFiles(dir), [], "absent mirror is a no-op");
    assert.deepEqual(removeStaleDataFiles(path.join(dir, "does-not-exist")), [], "missing dataDir is a no-op");
    assert.deepEqual(removeStaleDataFiles(""), []);
    assert.deepEqual(removeStaleDataFiles(null), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
