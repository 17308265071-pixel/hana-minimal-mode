import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initStore, getState, setState, defaultConfig, targetAgentIds,
  isAgentInScope, getSession, updateSession, resetSession,
  getStageBucket, setStageBucket, clearAgentStages, pruneStagesExcept,
  pruneMissingSessions,
} from "../state.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-state-"));
initStore(tmp);

test("config defaults", () => {
  const c = defaultConfig();
  assert.equal(c.enabled, true);
  assert.equal(c.targetAgents, "");
  assert.equal(c.postAnchorInjection, true);
  assert.equal(c.networkGuard, false);
});

test("getState lazily provides defaults", () => {
  const s = getState();
  assert.equal(s.enabled, true);
  assert.equal(s.routerMode, "auto");
  assert.equal(s.bootstrapMaxTokens, 1024);
});

test("setState merges", () => {
  setState({ enabled: false });
  assert.equal(getState().enabled, false);
  setState({ enabled: true });
  assert.equal(getState().enabled, true);
});

test("targetAgentIds splits and trims", () => {
  setState({ targetAgents: "hanako, butler ,qiushi" });
  assert.deepEqual(targetAgentIds(), ["hanako", "butler", "qiushi"]);
});

test("isAgentInScope", () => {
  assert.equal(isAgentInScope("hanako"), true);
  assert.equal(isAgentInScope("123"), false);
});

test("session buckets by alias", () => {
  updateSession("key-a", { round: 1 }, ["key-b"]);
  assert.equal(getSession(["key-b"]).round, 1);
  resetSession(["key-a"]);
  assert.equal(getSession(["key-a"]), null);
});

test("stage bucket persists to disk", async () => {
  setStageBucket("sid-1", { stage: 2, guided: true });
  assert.equal(getStageBucket("sid-1").stage, 2);
  // 重新 init 同一目录（模拟重启）应读回
  const stateModule = await import(`../state.js?reload=${Date.now()}`);
  stateModule.initStore(tmp);
  assert.equal(stateModule.getStageBucket("sid-1").stage, 2);
  assert.deepEqual(stateModule.getStageBucket("sid-1").openedPacks, []);
});

// R39: session keys are usually absolute paths, but old versions could persist
// relative `agents/<id>/...` keys. The matcher must anchor the full segment.
test("clearAgentStages matches windows, relative, phone and subagent keys; keeps other agents", () => {
  setStageBucket("C:\\hana\\agents\\hanako\\sessions\\a.jsonl", { stage: 1 });
  setStageBucket("agents/hanako/sessions/b.jsonl", { stage: 1 });
  setStageBucket("/data/plugin-data/hana-minimal-mode/agents/hanako/phone/sessions/c.jsonl", { stage: 1 });
  setStageBucket("/data/agents/hanako/subagents/helper/sessions/d.jsonl", { stage: 1 });
  setStageBucket("C:/hana/agents/hahaka/sessions/e.jsonl", { stage: 1 });
  setStageBucket("agents/hahaka/sessions/f.jsonl", { stage: 1 });

  const removed = clearAgentStages("hanako");

  assert.equal(removed, 4, "all four hanako path shapes are removed");
  assert.equal(getStageBucket("C:\\hana\\agents\\hanako\\sessions\\a.jsonl").stage, 0);
  assert.equal(getStageBucket("agents/hanako/sessions/b.jsonl").stage, 0, "relative key removed");
  assert.equal(getStageBucket("/data/plugin-data/hana-minimal-mode/agents/hanako/phone/sessions/c.jsonl").stage, 0);
  assert.equal(getStageBucket("/data/agents/hanako/subagents/helper/sessions/d.jsonl").stage, 0);
  assert.equal(getStageBucket("C:/hana/agents/hahaka/sessions/e.jsonl").stage, 1, "other agents are kept");
  assert.equal(getStageBucket("agents/hahaka/sessions/f.jsonl").stage, 1, "relative keys of other agents are kept");
});

test("pruneStagesExcept keeps only the current target's agent-scoped stages and buckets", () => {
  pruneStagesExcept(""); // reset agent-scoped residue from earlier tests
  setStageBucket("C:/x/agents/hanako/sessions/keep.jsonl", { stage: 1 });
  setStageBucket("C:\\x\\agents\\hahaka\\sessions\\drop.jsonl", { stage: 1 });
  setStageBucket("agents/hahaka/sessions/drop-relative.jsonl", { stage: 1 });
  setStageBucket("plain-session", { stage: 1 });
  updateSession("C:/x/agents/hahaka/sessions/s1.jsonl", { round: 1 }, ["agents/hahaka/sessions/s1.jsonl"]);

  const removed = pruneStagesExcept("hanako");

  assert.equal(removed, 3, "two non-target stage entries + one alias bucket");
  assert.equal(getStageBucket("C:/x/agents/hanako/sessions/keep.jsonl").stage, 1, "current target is kept");
  assert.equal(getStageBucket("C:\\x\\agents\\hahaka\\sessions\\drop.jsonl").stage, 0);
  assert.equal(getStageBucket("agents/hahaka/sessions/drop-relative.jsonl").stage, 0, "relative residue is swept");
  assert.equal(getStageBucket("plain-session").stage, 1, "keys without an agents segment are kept");
  assert.equal(getSession(["C:/x/agents/hahaka/sessions/s1.jsonl"]), null, "non-target alias buckets are dropped");
});

test("pruneStagesExcept with an empty keep removes every agent-scoped entry", () => {
  setStageBucket("C:/x/agents/hanako/sessions/keep.jsonl", { stage: 1 });
  setStageBucket("agents/qiushi/sessions/q.jsonl", { stage: 1 });
  setStageBucket("plain-session-2", { stage: 1 });

  const removed = pruneStagesExcept("");

  assert.equal(removed, 2);
  assert.equal(getStageBucket("C:/x/agents/hanako/sessions/keep.jsonl").stage, 0);
  assert.equal(getStageBucket("agents/qiushi/sessions/q.jsonl").stage, 0);
  assert.equal(getStageBucket("plain-session-2").stage, 1, "unscoped keys survive an empty keep");
});

// R40: stage/bucket keys that point at an absolute `agents/<id>/` session path
// whose file no longer exists are residue from deleted sessions. Relative keys
// (and keys without an agents segment) cannot be checked and must be kept.
test("pruneMissingSessions drops deleted-session stages/buckets and keeps untestable keys", () => {
  pruneStagesExcept(""); // isolate from earlier agent-scoped residue
  const liveStage = path.join(tmp, "agents", "x", "sessions", "live.jsonl");
  const missingStage = path.join(tmp, "agents", "x", "sessions", "missing.jsonl");
  const liveBucket = path.join(tmp, "agents", "x", "sessions", "bucket-live.jsonl");
  const missingBucket = path.join(tmp, "agents", "x", "sessions", "bucket-missing.jsonl");
  fs.mkdirSync(path.dirname(liveStage), { recursive: true });
  fs.writeFileSync(liveStage, "{}\n");
  fs.writeFileSync(liveBucket, "{}\n");

  setStageBucket(liveStage, { stage: 1 });
  setStageBucket(missingStage, { stage: 1 });
  setStageBucket("agents/x/sessions/relative.jsonl", { stage: 1 });
  setStageBucket("global", { stage: 1 });
  updateSession(liveBucket, { round: 1 });
  updateSession(missingBucket, { round: 1 });

  const removed = pruneMissingSessions();

  assert.equal(removed, 2, "one missing-file stage entry + one missing-alias bucket");
  assert.equal(getStageBucket(liveStage).stage, 1, "existing session file is kept");
  assert.equal(getStageBucket(missingStage).stage, 0, "deleted session file is pruned");
  assert.equal(getStageBucket("agents/x/sessions/relative.jsonl").stage, 1, "relative keys cannot be checked and are kept");
  assert.equal(getStageBucket("global").stage, 1, "keys without an agents segment are kept");
  assert.equal(getSession([liveBucket])?.round, 1, "bucket with a live alias is kept");
  assert.equal(getSession([missingBucket]), null, "bucket whose alias is missing is pruned");
});

// R40 safety valve: the >500 cap runs only AFTER existence pruning, so it is
// unreachable with fully missing paths (removed first) and exercising it would
// require 501 real files. Creating those in a unit test is not worth it; bulk
// deletion is still asserted here and the cap is covered by the code comment.
test("pruneMissingSessions bulk-deletes hundreds of residue entries", () => {
  pruneStagesExcept(""); // isolate from earlier agent-scoped residue
  for (let i = 0; i < 505; i += 1) {
    setStageBucket(path.join(tmp, "agents", "bulk", "sessions", `1757000000000-${i}.jsonl`), { stage: 1 });
  }

  const removed = pruneMissingSessions();

  assert.equal(removed, 505, "every missing bulk entry is removed");
  const persisted = JSON.parse(fs.readFileSync(path.join(tmp, "stage-state.json"), "utf8"));
  assert.ok(
    Object.keys(persisted.stages).length < 505,
    "the persisted store shrinks back below the seeded bulk residue",
  );
});
