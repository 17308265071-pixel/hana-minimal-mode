import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGES, META_TOOLS, windowFor, stageToolSet, stageInfo, markerFor,
  autoAdvance, stageSummary, stageText, memoryMuted, firstUserTask,
  PROGRESSIVE_DECL, PRESSURE_GUIDE, BOOTSTRAP, STAGE_GUIDES,
} from "../stage-engine.js";

test("four stages with completion signals", () => {
  assert.equal(STAGES.length, 4);
  assert.deepEqual(STAGES[0].completion, ["todo_write"]);
  assert.deepEqual(STAGES[2].completion, ["delivery_check"]);
  assert.ok(STAGES[1].tools.includes("todo_write"));
  assert.ok(STAGES[2].tools.includes("write"));
  assert.ok(STAGES[3].tools.includes("exec_command"));
});

test("windowFor/stageToolSet", () => {
  assert.equal(windowFor(0), 1);
  assert.equal(windowFor(3), 4);
  assert.ok(stageToolSet(0).has("read"));
  assert.ok(stageToolSet(0).has("todo_write"));
  assert.ok(!stageToolSet(0).has("write"));
  assert.ok(stageToolSet(2).has("write"));
});

test("stageInfo/markerFor", () => {
  assert.deepEqual(stageInfo("read"), { kind: "stage", stage: 0 });
  assert.deepEqual(stageInfo("tools_catalog"), { kind: "meta" });
  assert.deepEqual(stageInfo("computer"), { kind: "host" });
  assert.equal(markerFor("read", 0, []), "可调");
  assert.equal(markerFor("write", 0, []), "未解锁");
  assert.equal(markerFor("tools_help", 0, []), "meta");
  assert.equal(markerFor("docs", 0, ["docs"]), "可调");
  assert.equal(markerFor("exec_command", 3, []), "全量");
});

test("autoAdvance: native signals + legacy unlock", () => {
  assert.equal(autoAdvance(0, ["todo_write"]), 1);
  assert.equal(autoAdvance(1, ["todo_write"]), 2);
  assert.equal(autoAdvance(2, ["delivery_check"]), 3);
  assert.equal(autoAdvance(2, ["write"]), 2);            // 工具名不跨档跳级
  assert.equal(autoAdvance(2, ["exec_command"], { legacy: true }), 3);
  assert.equal(autoAdvance(0, ["read"]), 0);
  assert.equal(autoAdvance(3, ["anything"]), 3);         // 顶到 3
});

test("memoryMuted/firstUserTask", () => {
  assert.equal(memoryMuted(["帮我写代码", "不用记忆"]), true);
  assert.equal(memoryMuted(["帮我写代码"]), false);
  assert.equal(firstUserTask(["a".repeat(200), "短任务"]), "a".repeat(160) + "…");
});

test("stageText contains task echo + phase name", () => {
  const t = stageText(0, [], "重构这个模块");
  assert.ok(t.includes("重构这个模块"));
  assert.ok(t.includes("Current phase"));
  const t3 = stageText(3, [], "收尾");
  assert.ok(t3.includes("full catalog open"));
});

test("meta/declaration strings non-empty", () => {
  for (const s of [PROGRESSIVE_DECL, PRESSURE_GUIDE, BOOTSTRAP, ...STAGE_GUIDES]) {
    assert.ok(s.length > 100, "guidance texts must be substantial");
  }
});

test("stageSummary lists unlocked", () => {
  const s = stageSummary(0, ["docs"]);
  assert.equal(s.stage, 0);
  assert.ok(s.unlocked.includes("read"));
  assert.deepEqual(s.packsOpen, ["docs"]);
});
