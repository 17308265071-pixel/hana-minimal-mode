// R34 focused index tests: the sidebar panel is the only registration surface,
// so `_sync` must converge legacy multi-registrations and prune a deleted
// target WITHOUT ever writing to the native config store (no targetAgent key,
// no settings-mirror.json file). The collapse/prune behavior itself is kept
// from R33; the settings apply-once machinery it used to test is gone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import manifest from "../manifest.json" with { type: "json" };
import HanaMinimalModePlugin from "../index.js";

const state = await import(`../state.js?v=${manifest.version}`);

const HAHAKA_STAGE = "C:/x/agents/hahaka/sessions/s1.jsonl";
const HANAKO_STAGE = "C:/x/agents/hanako/sessions/s1.jsonl";

function setupEnv(store) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-index-settings-"));
  const dataDir = path.join(tmp, "plugins", "hana-minimal-mode");
  const sets = [];
  const plugin = new HanaMinimalModePlugin();
  plugin.ctx = {
    pluginId: "hana-minimal-mode",
    dataDir,
    config: {
      get: async (k) => store[k],
      set: async (k, v) => { store[k] = v; sets.push([k, v]); },
      getAll: async () => ({ ...store }),
    },
    log: { info() {}, warn() {}, error() {} },
  };
  plugin.register = () => {};
  return { tmp, dataDir, store, sets, plugin };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// First onload() in this file: state.js binds its storeDir here, so this test
// is the one that seeds and asserts the stage-state cleanup.
test("legacy double registration collapses to the newest single target without settings writes", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({});
  try {
    fs.mkdirSync(path.join(tmp, "agents", "hahaka"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "agents", "hanako"), { recursive: true });
    // R40: the kept agent's stage state must point at a real session file, or
    // the dead-session pruner would legitimately remove it.
    const hanakoStage = path.join(tmp, "agents", "hanako", "sessions", "s1.jsonl");
    fs.mkdirSync(path.dirname(hanakoStage), { recursive: true });
    fs.writeFileSync(hanakoStage, "{}\n");
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["hahaka", "hanako"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        hahaka: { registeredAt: 111, source: "page" },
        hanako: { registeredAt: 222, source: "panel" },
      },
    });
    writeJson(path.join(dataDir, "stage-state.json"), {
      schemaVersion: 1,
      buckets: {
        [HAHAKA_STAGE]: { aliases: [HAHAKA_STAGE], state: {} },
      },
      stages: {
        [HAHAKA_STAGE]: { stage: 2 },
        [hanakoStage]: { stage: 1 },
      },
    });

    await plugin.onload();

    assert.deepEqual(readJson(path.join(dataDir, "routing.json")).targetAgents, ["hanako"], "newest registeredAt wins");
    const regs = readJson(path.join(dataDir, "registrations.json")).registrations;
    assert.deepEqual(Object.keys(regs), ["hanako"]);
    assert.equal(regs.hanako.registeredAt, 222, "kept metadata is preserved");
    assert.equal(state.getState().targetAgents, "hanako");
    assert.equal(state.getStageBucket(HAHAKA_STAGE).stage, 0, "the removed agent's stage state must be cleared");
    assert.equal(state.getStageBucket(hanakoStage).stage, 1, "the kept agent's stage state must survive");
    assert.deepEqual(sets, [], "no native config writes");
    assert.equal(fs.existsSync(path.join(dataDir, "settings-mirror.json")), false, "no settings mirror file");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a tombstoned target is cleared through target-service with no settings writes", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({});
  try {
    fs.mkdirSync(path.join(tmp, "agents", "hanako"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "agents", "hanako", ".deleted-agent.json"), "{}");
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["hanako"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: { hanako: { registeredAt: 5, source: "panel" } },
    });

    await plugin.onload();

    assert.deepEqual(readJson(path.join(dataDir, "routing.json")).targetAgents, []);
    assert.deepEqual(readJson(path.join(dataDir, "registrations.json")).registrations, {});
    assert.equal(state.getState().targetAgents, "");
    assert.equal(state.getStageBucket(HANAKO_STAGE).stage, 0, "the deleted target's stages must be cleared");
    assert.deepEqual(sets, [], "pruning must not write the native config");
    assert.equal(fs.existsSync(path.join(dataDir, "settings-mirror.json")), false, "no settings mirror file");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
