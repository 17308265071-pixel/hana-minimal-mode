// R34: /minimal on replaces the single target (registrations.json +
// routing.json together), /minimal off clears it; enabled still goes through
// the plugin config store (and no target key is ever written there), while
// status reads the single target from the files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute } from "../commands/minimal.js";

function env(store = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-cmd-"));
  const dataDir = path.join(tmp, "plugins", "hana-minimal-mode");
  const sets = [];
  const cmdCtx = {
    dataDir,
    sessionPath: "C:/x/agents/qiushi/sessions/s1.jsonl",
    config: {
      get: async (k) => store[k],
      set: async (k, v) => { store[k] = v; sets.push([k, v]); },
    },
  };
  return { tmp, dataDir, sets, store, cmdCtx };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function routingIds(dataDir) {
  return readJson(path.join(dataDir, "routing.json")).targetAgents;
}

function regIds(dataDir) {
  return Object.keys(readJson(path.join(dataDir, "registrations.json")).registrations);
}

test("/minimal on registers the current agent as the single target", async () => {
  const { tmp, dataDir, sets, store, cmdCtx } = env();
  try {
    const reply = await execute("on", cmdCtx);
    assert.match(reply, /qiushi/);
    assert.deepEqual(routingIds(dataDir), ["qiushi"]);
    assert.deepEqual(regIds(dataDir), ["qiushi"]);
    assert.equal(readJson(path.join(dataDir, "registrations.json")).registrations.qiushi.source, "command");
    assert.deepEqual(sets, [["enabled", true]]);
    assert.equal(store.targetAgent, undefined, "no target key may be written to the native config");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("/minimal on replaces a previous target in both files", async () => {
  const { tmp, dataDir, cmdCtx } = env();
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["butler"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: { butler: { registeredAt: 5, source: "page" } },
    });
    await execute("on", cmdCtx);
    assert.deepEqual(routingIds(dataDir), ["qiushi"]);
    assert.deepEqual(regIds(dataDir), ["qiushi"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("/minimal off clears the single target and disables the plugin", async () => {
  const { tmp, dataDir, sets, store, cmdCtx } = env();
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["qiushi"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: { qiushi: { registeredAt: 5, source: "page" } },
    });
    const reply = await execute("off", cmdCtx);
    assert.match(reply, /qiushi/);
    assert.deepEqual(routingIds(dataDir), []);
    assert.deepEqual(regIds(dataDir), []);
    assert.deepEqual(sets, [["enabled", false]]);
    assert.equal(store.targetAgent, undefined, "no target key may be written to the native config");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("/minimal status reports the single target", async () => {
  const { tmp, dataDir, cmdCtx } = env({ enabled: true, routerMode: "spec" });
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["butler"] });
    const reply = await execute("status", cmdCtx);
    assert.match(reply, /目标助手: butler/);
    assert.match(reply, /模式: spec/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("/minimal status reports (无) when no target is registered", async () => {
  const { tmp, cmdCtx } = env({ enabled: true, routerMode: "auto" });
  try {
    const reply = await execute("status", cmdCtx);
    assert.match(reply, /目标助手: \(无\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
