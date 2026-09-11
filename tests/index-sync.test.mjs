import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import manifest from "../manifest.json" with { type: "json" };
import HanaMinimalModePlugin, { migrateConfig } from "../index.js";

const state = await import(`../state.js?v=${manifest.version}`);

const SENTINEL = "（不注册）";

// migrateConfig is kept as-is: it maps the legacy minimalAgentId key into
// targetAgents, which _sync now uses as the one-shot routing.json migration
// input. The native config schema no longer declares targetAgents, so no
// write-back ever happens.
test("migrateConfig maps legacy minimalAgentId to targetAgents", () => {
  const out = migrateConfig({ enabled: true, minimalAgentId: "minimal-4,minimal-5", allowlist: ["read"], routerMode: "auto", postAnchorInjection: false });
  assert.equal(out.targetAgents, "minimal-4,minimal-5");
  assert.equal(out.routerMode, "auto");
  assert.equal(out.allowlist, undefined);
  assert.equal(out.postAnchorInjection, false);
});

test("migrateConfig keeps new keys and fills defaults", () => {
  const out = migrateConfig({ enabled: false, targetAgents: "hanako" });
  assert.equal(out.enabled, false);
  assert.equal(out.targetAgents, "hanako");
});

function setupEnv(store) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-sync-"));
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
  return { tmp, dataDir, sets, plugin };
}

// File-backed config store: stripLegacyConfigKeys reads <dataDir>/config.json
// directly, so this stub must serve the same file the cleanup rewrites.
function setupFileEnv(globalConfig) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-sync-file-"));
  const dataDir = path.join(tmp, "plugins", "hana-minimal-mode");
  const configFile = path.join(dataDir, "config.json");
  const sets = [];
  const readConfigFile = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const readGlobal = () => {
    const global = readConfigFile().global;
    return global && typeof global === "object" && !Array.isArray(global) ? global : {};
  };
  writeJson(configFile, { schemaVersion: 1, global: { ...globalConfig }, agents: {}, sessions: {} });
  const plugin = new HanaMinimalModePlugin();
  plugin.ctx = {
    pluginId: "hana-minimal-mode",
    dataDir,
    config: {
      get: async (k) => readGlobal()[k],
      set: async (k, v) => {
        const parsed = readConfigFile();
        const global = parsed.global && typeof parsed.global === "object" ? parsed.global : {};
        global[k] = v;
        writeJson(configFile, { ...parsed, schemaVersion: 1, global });
        sets.push([k, v]);
      },
      getAll: async () => ({ ...readGlobal() }),
    },
    log: { info() {}, warn() {}, error() {} },
  };
  plugin.register = () => {};
  return { tmp, dataDir, configFile, sets, plugin };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRouting(dataDir) {
  return readJson(path.join(dataDir, "routing.json"));
}

function readRegistrations(dataDir) {
  return readJson(path.join(dataDir, "registrations.json"));
}

// This test must be the first one in the file that triggers onload(): the
// state.js singleton binds its storeDir on the first initStore() call, and
// clearAgentStages() must read THIS test's stage-state.json.
test("_sync collapses legacy multi-registrations to the newest target and clears the removed agent's stages", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({});
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["hahaka", "hanako"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        hahaka: { registeredAt: 111, source: "page" },
        hanako: { registeredAt: 222, source: "settings" },
      },
    });
    // R40: the target agent has one live session file (kept) and one deleted
    // session file (pruned after _sync) — plus a live/missing alias-bucket pair.
    const liveStage = path.join(tmp, "agents", "hanako", "sessions", "s2.jsonl");
    const missingStage = path.join(tmp, "agents", "hanako", "sessions", "gone.jsonl");
    const liveBucket = path.join(tmp, "agents", "hanako", "sessions", "bucket-live.jsonl");
    const missingBucket = path.join(tmp, "agents", "hanako", "sessions", "bucket-gone.jsonl");
    writeJson(path.join(dataDir, "stage-state.json"), {
      schemaVersion: 1,
      buckets: {
        "C:/x/agents/hahaka/sessions/s1.jsonl": {
          aliases: ["C:/x/agents/hahaka/sessions/s1.jsonl"],
          state: { notes: "hahaka" },
        },
        "agents/hahaka/sessions/relative.jsonl": {
          aliases: ["agents/hahaka/sessions/relative.jsonl"],
          state: { notes: "hahaka-relative" },
        },
        [liveBucket]: { aliases: [liveBucket], state: { notes: "live" } },
        [missingBucket]: { aliases: [missingBucket], state: { notes: "gone" } },
      },
      stages: {
        "C:/x/agents/hahaka/sessions/s1.jsonl": { stage: 2 },
        "agents/hahaka/sessions/relative.jsonl": { stage: 2 },
        [liveStage]: { stage: 1 },
        [missingStage]: { stage: 1 },
      },
    });
    writeJson(path.join(dataDir, "settings-mirror.json"), { targetAgents: ["hahaka"] });
    fs.mkdirSync(path.join(tmp, "agents", "hahaka"), { recursive: true });
    fs.mkdirSync(path.dirname(liveStage), { recursive: true });
    fs.writeFileSync(liveStage, "{}\n");
    fs.writeFileSync(liveBucket, "{}\n");

    await plugin.onload();

    assert.deepEqual(readRouting(dataDir).targetAgents, ["hanako"], "newest registeredAt wins");
    const regs = readRegistrations(dataDir).registrations;
    assert.deepEqual(Object.keys(regs), ["hanako"]);
    assert.equal(regs.hanako.registeredAt, 222, "kept metadata is preserved");
    assert.equal(regs.hanako.source, "settings");
    assert.equal(state.getState().targetAgents, "hanako");
    const persisted = readJson(path.join(dataDir, "stage-state.json"));
    assert.deepEqual(
      Object.keys(persisted.stages),
      [liveStage],
      "removed-agent and deleted-session stage state is cleared; the live session is kept",
    );
    assert.deepEqual(
      Object.keys(persisted.buckets),
      [liveBucket],
      "removed-agent buckets and deleted-session buckets are cleared; the live bucket is kept",
    );
    assert.equal(
      fs.existsSync(path.join(dataDir, "settings-mirror.json")),
      false,
      "the stale settings-mirror.json is removed on load",
    );
    assert.deepEqual(sets, [], "no settings write without a targetAgent value");

    // R39: every sync sweeps agent-scoped residue for anyone but the current
    // target (no collapse needed) so switching leaves nothing behind.
    state.setStageBucket("agents/hahaka/sessions/residue.jsonl", { stage: 3 });
    state.setStageBucket("C:/x/agents/qiushi/sessions/q.jsonl", { stage: 3 });
    await plugin._sync();
    const swept = readJson(path.join(dataDir, "stage-state.json"));
    assert.deepEqual(
      Object.keys(swept.stages),
      [liveStage],
      "the stage sweep keeps only the current target's live entries",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("fresh install has no target; a tombstoned runtime target is pruned without config writes", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({ targetAgent: SENTINEL });
  try {
    fs.mkdirSync(path.join(tmp, "agents", "hanako"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "agents", "butler"), { recursive: true });

    await plugin.onload(); // no legacy value / no routing.json -> no target

    assert.deepEqual(sets, [], "native config must never receive a targetAgents write");
    const routing = readRouting(dataDir);
    assert.equal(routing.schemaVersion, 1);
    assert.deepEqual(routing.targetAgents, [], "a fresh install must not register hanako");
    assert.equal(state.getState().targetAgents, "");

    // A stale runtime target pointing at a deleted assistant is pruned.
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["hanako"] });
    fs.writeFileSync(path.join(tmp, "agents", "hanako", ".deleted-agent.json"), "{}");
    await plugin._sync();
    assert.deepEqual(sets, [], "pruning must not write the native config either");
    assert.deepEqual(readRouting(dataDir).targetAgents, []);
    assert.equal(state.getState().targetAgents, "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("_sync migrates the legacy config targetAgents value into routing.json once, single target", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({ targetAgents: "butler, qiushi" });
  try {
    await plugin.onload();

    assert.deepEqual(sets, []);
    assert.deepEqual(readRouting(dataDir).targetAgents, ["butler"], "legacy multi-migration collapses to one target");
    assert.equal(state.getState().targetAgents, "butler");
    const regs = readRegistrations(dataDir).registrations;
    assert.deepEqual(Object.keys(regs), ["butler"]);
    assert.equal(regs.butler.source, "legacy");

    await plugin._sync(); // routing.json now exists: no re-migration, no writes
    assert.deepEqual(sets, []);
    assert.deepEqual(readRouting(dataDir).targetAgents, ["butler"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("_sync prefers routing.json over a stale legacy config value", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({ targetAgents: "hanako" });
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["qiushi"] });

    await plugin.onload();

    assert.deepEqual(readRouting(dataDir).targetAgents, ["qiushi"]);
    assert.equal(state.getState().targetAgents, "qiushi");
    assert.deepEqual(sets, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("_sync creates registrations.json from the routing list once (source legacy)", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({});
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["qiushi"] });

    await plugin.onload();

    const raw = readRegistrations(dataDir);
    assert.deepEqual(Object.keys(raw.registrations), ["qiushi"]);
    assert.equal(raw.registrations.qiushi.source, "legacy");
    assert.equal(typeof raw.registrations.qiushi.registeredAt, "number");
    assert.deepEqual(readRouting(dataDir).targetAgents, ["qiushi"], "routing.json stays as-is");
    assert.deepEqual(sets, []);

    const stamped = raw.registrations.qiushi.registeredAt;
    await plugin._sync();
    const again = readRegistrations(dataDir);
    assert.equal(again.registrations.qiushi.registeredAt, stamped, "later syncs must not churn the timestamp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("_sync keeps the newest runtime target and drops stale metadata entries", async () => {
  const { tmp, dataDir, sets, plugin } = setupEnv({});
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["butler", "qiushi"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        butler: { registeredAt: 42, source: "page" },
        ghost: { registeredAt: 7, source: "page" },
      },
    });

    await plugin.onload();

    const raw = readRegistrations(dataDir);
    assert.deepEqual(Object.keys(raw.registrations), ["butler"], "newest record wins, stale entries drop");
    assert.equal(raw.registrations.butler.registeredAt, 42, "existing metadata is preserved");
    assert.equal(raw.registrations.butler.source, "page");
    assert.deepEqual(readRouting(dataDir).targetAgents, ["butler"]);
    assert.equal(state.getState().targetAgents, "butler");
    assert.deepEqual(sets, []);

    await plugin._sync();
    assert.equal(readRegistrations(dataDir).registrations.butler.registeredAt, 42, "later syncs are stable");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("R38: direct legacy upgrade migrates the target before the legacy config cleanup", async () => {
  const { tmp, dataDir, configFile, sets, plugin } = setupFileEnv({ enabled: true, targetAgents: "hanako" });
  try {
    assert.equal(fs.existsSync(path.join(dataDir, "routing.json")), false, "precondition: no routing.json");

    await plugin.onload();

    assert.deepEqual(readRouting(dataDir).targetAgents, ["hanako"], "legacy target migrated, not lost");
    assert.equal(state.getState().targetAgents, "hanako");
    const global = readJson(configFile).global;
    assert.equal(
      Object.prototype.hasOwnProperty.call(global, "targetAgents"),
      false,
      "legacy key stripped only after the migration sync",
    );
    assert.equal(global.enabled, true, "unrelated keys are preserved");
    assert.deepEqual(sets, [], "no native settings write");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("R38: legacy cleanup still strips keys when routing.json exists, target list untouched", async () => {
  const { tmp, dataDir, configFile, plugin } = setupFileEnv({ enabled: true, targetAgents: "hanako" });
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["qiushi"] });

    await plugin.onload();

    assert.deepEqual(readRouting(dataDir).targetAgents, ["qiushi"], "existing routing list untouched");
    assert.equal(state.getState().targetAgents, "qiushi");
    const global = readJson(configFile).global;
    assert.equal(
      Object.prototype.hasOwnProperty.call(global, "targetAgents"),
      false,
      "legacy key still stripped when routing.json already exists",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
