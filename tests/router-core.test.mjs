import test from "node:test";
import assert from "node:assert/strict";
import {
  bandOf, bandFor, personaFor, modelFamily, classifyTask, parseMode,
  canonicalMode, extractText, activationActionFor, packsForText,
  matchesToolSpec, expandPackTools, RL_PERSONA,
} from "../router-core.js";

test("bandOf quantizes to three bands", () => {
  assert.equal(bandOf(0), "spec");
  assert.equal(bandOf(0.3), "transition");
  assert.equal(bandOf(1), "react");
  assert.equal(bandOf("weak"), "weak");
  assert.equal(bandFor(0.3), "mixed");
});

test("classifyTask: react vs spec vs weak", () => {
  assert.equal(classifyTask("帮我创建一个新项目"), 1);
  assert.equal(classifyTask("帮我修复这个 bug"), 0);
  assert.equal(classifyTask("你好"), "weak");
});

test("modelFamily is stateless across calls", () => {
  assert.equal(modelFamily("deepseek-v4-flash"), "flash");
  assert.equal(modelFamily("deepseek-v4-flash"), "flash"); // 二次调用不粘 lastIndex
  assert.equal(modelFamily("deepseek-v4-pro"), "pro");
  assert.equal(modelFamily("unknown-model"), null);
});

test("personaFor returns RL_PERSONA in standard modes", () => {
  assert.equal(personaFor(0, "deepseek-v4-flash"), RL_PERSONA);
  assert.ok(personaFor("weak", "deepseek-v4-flash").startsWith("You are a helpful assistant."));
});

test("parseMode/canonicalMode", () => {
  assert.equal(parseMode("auto"), "auto");
  assert.equal(parseMode("spec"), 0);
  assert.equal(parseMode("70"), 1);
  assert.equal(parseMode("0.3"), 0.3);
  assert.equal(canonicalMode("mixed"), "mixed");
  assert.equal(canonicalMode("nonsense"), null);
});

test("extractText handles nested message", () => {
  assert.equal(extractText({ message: { content: [{ text: "a" }, "b"] } }), "a b");
});

test("activationActionFor", () => {
  assert.equal(activationActionFor("开启极简模式"), "on");
  assert.equal(activationActionFor("disable minimal mode"), "off");
  assert.equal(activationActionFor("写个插件"), null);
});

test("packsForText + expand + match", () => {
  assert.deepEqual(packsForText("帮我整理这个 Word 文档"), ["docs"]);
  assert.deepEqual(expandPackTools(["docs"]).slice(0, 1), ["doc-mcp_*"]);
  assert.equal(matchesToolSpec("doc-mcp_read", "doc-mcp_*"), true);
  assert.equal(matchesToolSpec("read", "doc-mcp_*"), false);
});
