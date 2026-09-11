// Integration simulation: drives index.js (lifecycle) + extensions/router.js
// (Pi SDK handlers) in-process with a stub host context, covering the four
// R19 integration defects end-to-end. No Hana host is required.
//
// Module isolation note: `import("../index.js?sim=x")` creates a fresh module
// instance; its versioned internal `state.js?v=<manifest.version>` import is
// shared with this test's top-level import below, matching the plugin chain.
// Tests stay independent by using unique session keys per scenario.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import manifest from "../manifest.json" with { type: "json" };

const state = await import(`../state.js?v=${manifest.version}`);

async function freshModules(tag) {
  const indexMod = await import(`../index.js?sim=${tag}`);
  const extMod = await import(`../extensions/router.js?sim=${tag}`);
  return { state, indexMod, extMod };
}

function stubCtx(pluginId, dataDir, store) {
  return {
    pluginId,
    dataDir,
    config: {
      get: async (k) => store[k],
      set: async (k, v) => { store[k] = v; },
      getAll: async () => ({ ...store }),
    },
    bus: { subscribe: () => () => {}, request: async () => ({}) },
    log: { info() {}, warn() {}, error() {} },
  };
}

const HANAKO_PATH = "C:/x/agents/hanako/sessions/s1.jsonl";
const BUTLER_PATH = "C:/x/agents/butler/sessions/s9.jsonl";
const QIUSHI_PATH = "C:/x/agents/qiushi/sessions/s2.jsonl";

function systemText(payload) {
  if (typeof payload?.system === "string") return payload.system;
  const sys = (payload?.messages || []).find((m) => m?.role === "system");
  if (!sys) return "";
  if (typeof sys.content === "string") return sys.content;
  if (Array.isArray(sys.content)) {
    return sys.content.map((b) => (typeof b === "string" ? b : b?.text || "")).join("");
  }
  return "";
}

function messageText(m) {
  if (!m || typeof m !== "object") return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content.map((b) => (typeof b === "string" ? b : b?.text || "")).join(" ");
  }
  return "";
}

function lastUserText(payload) {
  const users = (payload?.messages || []).filter((m) => m?.role === "user");
  return users.length ? messageText(users[users.length - 1]) : "";
}

function toolNames(payload) {
  return (payload?.tools || []).map((t) => t?.function?.name || t?.name);
}

// R36 append-only contract: the extension may only append the known marker
// blocks, never remove or rewrite anything Hana already put in the request.
const ROUTER_MARKERS = [
  "[router-persona]", "[router-stage]", "[router-decl]", "[router-proactivity]",
  "[anchor-notice]", "[tool-pack-hint]", "[router-bootstrap]", "[router-capabilities]",
];

function assertAppendOnlyText(before, after, label) {
  const base = before.replace(/\s+$/, "");
  if (after === before || after === base) return;
  assert.ok(
    after.startsWith(base + "\n\n["),
    label + ": original text must survive byte-for-byte; got: " + after,
  );
  const added = after.slice(base.length);
  const parts = added.split("\n\n[");
  assert.equal(parts[0], "", label + ": output may only gain appended marker blocks");
  for (const part of parts.slice(1)) {
    const close = part.indexOf("]\n");
    assert.ok(close > 0, label + ": malformed marker block");
    const marker = "[" + part.slice(0, close + 1);
    assert.ok(ROUTER_MARKERS.includes(marker), label + ": unexpected added block " + marker);
  }
}

function assertHanaContextIntact(original, out, label) {
  const outSys = systemText(out);
  assert.ok(outSys.includes("HANA-MEMORY-SENTINEL"), label + ": memory sentinel lost");
  assert.ok(outSys.includes("HANA-SKILLS-SENTINEL"), label + ": skills sentinel lost");
  assertAppendOnlyText(systemText(original), outSys, label + " system text");
  assert.equal(out.messages.length, original.messages.length, label + ": message count changed");
  let lastUser = -1;
  original.messages.forEach((m, i) => { if (m?.role === "user") lastUser = i; });
  original.messages.forEach((orig, i) => {
    const got = out.messages[i];
    if (orig?.role === "system") {
      assert.equal(got?.role, "system", label + ": system message role changed");
      assertAppendOnlyText(messageText(orig), messageText(got), label + " system message");
      return;
    }
    if (i === lastUser) {
      assertAppendOnlyText(messageText(orig), messageText(got), label + " last user message");
      return;
    }
    assert.deepEqual(got, orig, label + ": message " + i + " must be byte-identical");
  });
}

function seedRouting(dataDir, ids = ["hanako"]) {
  fs.writeFileSync(
    path.join(dataDir, "routing.json"),
    JSON.stringify({ schemaVersion: 1, targetAgents: ids }, null, 2),
  );
}

function readRouting(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, "routing.json"), "utf8")).targetAgents;
}

async function setup(tag, store) {
  const mods = await freshModules(tag);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-sim-"));
  seedRouting(dataDir, ["hanako"]); // target list lives in routing.json (R26)
  const instance = new mods.indexMod.default();
  instance.ctx = stubCtx("hana-minimal-mode", dataDir, store);
  await instance.onload(); // onload wires setPluginCtx(ctx) for toggle persistence
  const handlers = {};
  mods.extMod.default({ on: (name, fn) => { handlers[name] = fn; } });
  return { ...mods, instance, handlers, store, dataDir };
}

function payloadFixture() {
  return {
    messages: [{ role: "user", content: "帮我重构这个模块" }],
    tools: [{ name: "read" }, { name: "edit" }, { name: "exec_command" }, { name: "mcp_call" }],
  };
}

test("anchor round (bridge tier): persona + notice injected, only bridge tools kept, budget capped", async () => {
  const s = await setup("t1", {});
  const out = s.handlers.before_provider_request(
    { payload: payloadFixture() },
    { sessionRef: { sessionPath: HANAKO_PATH } },
  );

  assert.ok(systemText(out).includes("[router-persona]"));
  assert.ok(systemText(out).includes("[router-capabilities]"), "R37: anchor round injects the capability map");
  assert.ok(systemText(out).includes("[Capability map]"));
  assert.ok(lastUserText(out).includes("[anchor-notice]"));
  assert.ok(lastUserText(out).includes("no work tools are open this round"));
  assert.ok(lastUserText(out).includes("stay available"));
  assert.deepEqual(toolNames(out), ["mcp_call"]);
  assert.equal(out.max_completion_tokens, 1024);
});

test("anchor round (array content): notice lands in the last text block, tools still bridge-only", async () => {
  const s = await setup("t1-array", {});
  const out = s.handlers.before_provider_request(
    {
      payload: {
        messages: [{ role: "user", content: [{ type: "text", text: "帮我重构" }] }],
        tools: [{ name: "read" }, { name: "edit" }, { name: "exec_command" }, { name: "mcp_call" }],
      },
    },
    { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/s1-array.jsonl" } },
  );

  const last = out.messages.filter((m) => m?.role === "user").pop();
  assert.ok(Array.isArray(last.content), "array content must stay an array");
  const textBlocks = last.content.filter((b) => b?.type === "text" && typeof b?.text === "string");
  assert.ok(textBlocks.some((b) => b.text.includes("[anchor-notice]")), "a text block must carry the anchor notice");
  assert.deepEqual(toolNames(out), ["mcp_call"]);
});

test("anchor round (array content without text block): a new text block is appended", async () => {
  const s = await setup("t1-array-fallback", {});
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } };
  const out = s.handlers.before_provider_request(
    {
      payload: {
        messages: [{ role: "user", content: [image] }],
        tools: [{ name: "read" }, { name: "mcp_call" }],
      },
    },
    { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/s1-array-fallback.jsonl" } },
  );

  const last = out.messages.filter((m) => m?.role === "user").pop();
  assert.equal(last.content.length, 2);
  assert.deepEqual(last.content[0], image);
  assert.equal(last.content[1].type, "text");
  assert.ok(last.content[1].text.includes("[anchor-notice]"));
  assert.deepEqual(toolNames(out), ["mcp_call"]);
});

test("R36: anchor round (bridge tier) keeps Hana memory tools alongside the bridge tool", async () => {
  const s = await setup("r36-anchor-memory", {});
  const out = s.handlers.before_provider_request(
    {
      payload: {
        messages: [{ role: "user", content: "帮我重构" }],
        tools: [
          { name: "read" }, { name: "edit" }, { name: "exec_command" },
          { name: "mcp_call" }, { name: "search_memory" },
        ],
      },
    },
    { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/r36-anchor-memory.jsonl" } },
  );

  assert.deepEqual(toolNames(out), ["mcp_call", "search_memory"]);
  assert.ok(lastUserText(out).includes("[anchor-notice]"), "anchor notice still appended");
});

test("R43: anchor round keeps the thinking plugin tool when present", async () => {
  const s = await setup("r43-anchor-thinking", {});
  const out = s.handlers.before_provider_request(
    {
      payload: {
        messages: [{ role: "user", content: "帮我重构" }],
        tools: [
          { name: "read" }, { name: "edit" }, { name: "exec_command" },
          { name: "mcp_call" }, { name: "search_memory" },
          { name: "hana-max-thinking_thinking_status" },
        ],
      },
    },
    { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/r43-anchor-thinking.jsonl" } },
  );

  assert.deepEqual(toolNames(out), ["mcp_call", "search_memory", "hana-max-thinking_thinking_status"]);
  assert.ok(lastUserText(out).includes("[anchor-notice]"), "anchor notice still appended");
});

test("out-of-scope agent: zero intervention, tools untouched", async () => {
  const s = await setup("t2", {});
  const out = s.handlers.before_provider_request(
    { payload: payloadFixture() },
    { sessionRef: { sessionPath: BUTLER_PATH } },
  );

  assert.ok(!systemText(out).includes("[router-persona]"));
  assert.equal(toolNames(out).length, 4);
  assert.equal(out.max_completion_tokens, undefined);
});

test("progression via native signals: auto-guided, on-demand release, full surface", async () => {
  const s = await setup("t3", {});
  const ctxHanako = { sessionRef: { sessionPath: HANAKO_PATH } };
  const freshTools = () => [
    { name: "read" },
    { name: "edit" },
    { name: "exec_command" },
    { name: "mcp_call" },
  ];
  const secondTurn = () => [
    { role: "user", content: "帮我重构这个模块" },
    { role: "assistant", content: "好的，我先读代码了解结构。" },
    { role: "user", content: "继续，先给方案。" },
  ];

  // Fix 2: a prior assistant reply auto-sets guided on bridge/legacy tiers.
  const p1 = s.handlers.before_provider_request(
    { payload: { messages: secondTurn(), tools: freshTools() } },
    ctxHanako,
  );
  assert.ok(systemText(p1).includes("[router-stage]"));
  assert.ok(systemText(p1).includes("Current phase"));
  assert.equal(s.state.getStageBucket(HANAKO_PATH).guided, true);
  assert.equal(s.state.getStageBucket(HANAKO_PATH).stage, 0);

  // Fix 1: todo_write is the stage-0 completion signal and must pass the guard.
  assert.equal(s.handlers.tool_call({ toolName: "todo_write" }, ctxHanako), undefined);
  assert.equal(s.state.getStageBucket(HANAKO_PATH).stage, 1);

  // R29: after the anchor the full tool surface stays visible — nothing is
  // filtered out of p.tools and nothing is blocked at call time.
  const p2 = s.handlers.before_provider_request(
    { payload: { messages: secondTurn(), tools: freshTools() } },
    ctxHanako,
  );
  assert.deepEqual(toolNames(p2), ["read", "edit", "exec_command", "mcp_call"]);

  // A write call is no longer locked: it is allowed and does not advance.
  assert.equal(s.handlers.tool_call({ toolName: "write" }, ctxHanako), undefined);
  assert.equal(s.state.getStageBucket(HANAKO_PATH).stage, 1);

  // R29: a pack tool call auto-opens its pack and is allowed.
  assert.equal(s.handlers.tool_call({ toolName: "media_generate-image" }, ctxHanako), undefined);
  assert.ok(
    s.state.getStageBucket(HANAKO_PATH).openedPacks.includes("media"),
    "calling a media tool must auto-open the media pack",
  );

  // Advance 1→2→3 through completion signals.
  assert.equal(s.handlers.tool_call({ toolName: "todo_write" }, ctxHanako), undefined);
  assert.equal(s.state.getStageBucket(HANAKO_PATH).stage, 2);
  assert.equal(s.handlers.tool_call({ toolName: "delivery_check" }, ctxHanako), undefined);
  assert.equal(s.state.getStageBucket(HANAKO_PATH).stage, 3);

  const p3 = s.handlers.before_provider_request(
    { payload: { messages: secondTurn(), tools: freshTools() } },
    ctxHanako,
  );
  assert.equal(toolNames(p3).length, 4);
  assert.ok(systemText(p3).includes("full catalog open"));
});

test("conversation toggle switches the single target in routing.json, never the legacy targetAgents key", async () => {
  const store = {};
  const s = await setup("t4", store);
  const ctxQiushi = { sessionRef: { sessionPath: QIUSHI_PATH } };

  s.handlers.input({ text: "开启极简模式" }, ctxQiushi);
  assert.deepEqual(readRouting(s.dataDir), ["qiushi"], "on replaces the whole target list with the current agent");
  assert.equal(s.state.getState().targetAgents, "qiushi");
  assert.equal(store.targetAgent, undefined, "the native settings must not receive targetAgent");
  assert.equal(store.targetAgents, undefined, "native config must never receive targetAgents");

  s.handlers.input({ text: "关闭极简模式" }, ctxQiushi);
  assert.deepEqual(readRouting(s.dataDir), [], "off clears the single target");
  assert.equal(s.state.getState().targetAgents, "");
  assert.equal(store.targetAgent, undefined, "no target key is written on clear either");
  assert.equal(store.enabled, false);
  assert.equal(store.targetAgents, undefined);
});

test("R29: call-time gating removed — tool calls are released with any stagedUnlock setting", async () => {
  // Default (stagedUnlock true): stage-0 edit is released on demand.
  const gated = await setup("t5-gated", {});
  const released = gated.handlers.tool_call(
    { toolName: "edit" },
    { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/s5-gated.jsonl" } },
  );
  assert.equal(released, undefined);

  // stagedUnlock false: identical release.
  const ungatedStore = { stagedUnlock: false };
  const ungated = await setup("t5-ungated", ungatedStore);
  const releasedUngated = ungated.handlers.tool_call(
    { toolName: "edit" },
    { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/s5-ungated.jsonl" } },
  );
  assert.equal(releasedUngated, undefined);
  delete ungatedStore.stagedUnlock;
});

test("legacy tier on-demand unlock advances stage 3", async () => {
  const s = await setup("t6-legacy", {});
  const key = "C:/x/agents/hanako/sessions/s6-legacy.jsonl";
  const ctxHanako = { sessionRef: { sessionPath: key } };

  // Bridge tier (mcp_call present, no hana-minimal-mode_ prefixed tool).
  s.handlers.before_provider_request({ payload: payloadFixture() }, ctxHanako);
  assert.equal(s.state.getStageBucket(key).tier, "bridge");

  // Advance 0→1→2 through the native completion signal.
  assert.equal(s.handlers.tool_call({ toolName: "todo_write" }, ctxHanako), undefined);
  assert.equal(s.handlers.tool_call({ toolName: "todo_write" }, ctxHanako), undefined);
  assert.equal(s.state.getStageBucket(key).stage, 2);

  // First stage-3 attempt auto-unlocks on demand instead of being blocked.
  assert.equal(s.handlers.tool_call({ toolName: "exec_command" }, ctxHanako), undefined);
  assert.equal(s.state.getStageBucket(key).stage, 3);

  // Native tier: the call itself is released (R29, no call-time block), but
  // exec_command is NOT a completion signal, so the stage stays at 2.
  const nativeKey = "C:/x/agents/hanako/sessions/s6-legacy-native.jsonl";
  const ctxNative = { sessionRef: { sessionPath: nativeKey } };
  s.handlers.before_provider_request(
    {
      payload: {
        messages: [{ role: "user", content: "帮我重构这个模块" }],
        tools: [
          { name: "hana-minimal-mode_phase_begin" },
          { name: "read" },
          { name: "exec_command" },
        ],
      },
    },
    ctxNative,
  );
  assert.equal(s.state.getStageBucket(nativeKey).tier, "native");
  assert.equal(s.handlers.tool_call({ toolName: "todo_write" }, ctxNative), undefined);
  assert.equal(s.handlers.tool_call({ toolName: "todo_write" }, ctxNative), undefined);
  assert.equal(s.state.getStageBucket(nativeKey).stage, 2);

  assert.equal(s.handlers.tool_call({ toolName: "exec_command" }, ctxNative), undefined);
  assert.equal(s.state.getStageBucket(nativeKey).stage, 2, "native 2→3 still requires delivery_check");
});

test("bootstrap is injected once", async () => {
  const s = await setup("t7-bootstrap", {});
  const key = "C:/x/agents/hanako/sessions/s7-bootstrap.jsonl";
  const ctxHanako = { sessionRef: { sessionPath: key } };
  const freshTools = () => [
    { name: "read" },
    { name: "edit" },
    { name: "exec_command" },
    { name: "mcp_call" },
  ];
  const anchoredTurn = () => ({
    messages: [{ role: "user", content: "帮我重构这个模块" }],
    tools: freshTools(),
  });
  const guidedTurn = () => ({
    messages: [
      { role: "user", content: "帮我重构这个模块" },
      { role: "assistant", content: "好的，我先了解结构。" },
      { role: "user", content: "继续。" },
    ],
    tools: freshTools(),
  });

  // Anchor round: bootstrap not pending until phase_begin confirms the session.
  const p1 = s.handlers.before_provider_request({ payload: anchoredTurn() }, ctxHanako);
  assert.ok(!systemText(p1).includes("[router-bootstrap]"));

  // Confirm start: phase_begin sets the one-shot bootstrapPending flag.
  s.handlers.tool_call({ toolName: "phase_begin" }, ctxHanako);

  // Next guided request injects the bootstrap guide.
  const p2 = s.handlers.before_provider_request({ payload: guidedTurn() }, ctxHanako);
  assert.ok(systemText(p2).includes("[router-bootstrap]"));

  // The round after that must NOT re-inject it (flag consumed by the injector).
  const p3 = s.handlers.before_provider_request({ payload: guidedTurn() }, ctxHanako);
  assert.ok(!systemText(p3).includes("[router-bootstrap]"));
});

test("R29: postAnchorInjection=false — anchor round unchanged, later rounds inject nothing", async () => {
  const s = await setup("t8-post-injection", { postAnchorInjection: false });
  const key = "C:/x/agents/hanako/sessions/s8-post-injection.jsonl";
  const ctxHanako = { sessionRef: { sessionPath: key } };
  const freshTools = () => [
    { name: "mcp_call" },
    { name: "hana-minimal-mode_phase_begin" },
    { name: "read" },
    { name: "write" },
  ];

  const anchored = s.handlers.before_provider_request(
    { payload: { messages: [{ role: "user", content: "帮我重构这个模块" }], tools: freshTools() } },
    ctxHanako,
  );
  assert.ok(systemText(anchored).includes("[router-persona]"), "anchor round still injects persona");
  assert.ok(lastUserText(anchored).includes("[anchor-notice]"), "anchor round still injects the notice");

  const post = s.handlers.before_provider_request(
    {
      payload: {
        messages: [
          { role: "user", content: "帮我重构这个模块" },
          { role: "assistant", content: "好的。" },
          { role: "user", content: "继续。" },
        ],
        tools: freshTools(),
      },
    },
    ctxHanako,
  );
  const sys = systemText(post);
  for (const marker of ["[router-persona]", "[router-stage]", "[router-decl]", "[router-proactivity]", "[router-bootstrap]"]) {
    assert.ok(!sys.includes(marker), "post-anchor injection must stay off: " + marker);
  }
  assert.deepEqual(toolNames(post), ["mcp_call", "hana-minimal-mode_phase_begin", "read", "write"], "tool surface stays full");
});

test("R36: append-only — Hana's native system/message context is never removed or rewritten", async () => {
  const s = await setup("r36-append-only", {});
  const tools = [
    { name: "read" }, { name: "edit" }, { name: "exec_command" }, { name: "mcp_call" },
    { name: "search_memory" }, { name: "recall_experience" }, { name: "current_status" },
  ];
  const sysText = "HANA-MEMORY-SENTINEL user memory segment. HANA-SKILLS-SENTINEL skill catalog segment. Hana native identity segment.";
  const dialogue = [
    { role: "user", content: "帮我重构" },
    { role: "assistant", content: "好" },
    { role: "user", content: "继续" },
  ];

  const scoped = [
    { tag: "system-field/guided", session: "r36-sf-guided", messages: [...dialogue], system: sysText, anchor: false },
    { tag: "system-field/anchor", session: "r36-sf-anchor", messages: [dialogue[0]], system: sysText, anchor: true },
    { tag: "system-message/guided", session: "r36-sm-guided", messages: [{ role: "system", content: sysText }, ...dialogue], anchor: false },
    { tag: "system-message/anchor", session: "r36-sm-anchor", messages: [{ role: "system", content: sysText }, dialogue[0]], anchor: true },
  ];

  for (const v of scoped) {
    const payload = { messages: v.messages, tools };
    if (v.system !== undefined) payload.system = v.system;
    const original = structuredClone(payload);
    const out = s.handlers.before_provider_request(
      { payload },
      { sessionRef: { sessionPath: "C:/x/agents/hanako/sessions/" + v.session + ".jsonl" } },
    );

    assertHanaContextIntact(original, out, v.tag);
    assert.ok(systemText(out).includes("[router-persona]"), v.tag + ": persona must still be appended");

    if (v.anchor) {
      assert.ok(lastUserText(out).includes("[anchor-notice]"), v.tag + ": anchor notice lands in the last user message");
      assert.deepEqual(
        toolNames(out),
        ["mcp_call", "search_memory", "recall_experience", "current_status"],
        v.tag + ": Hana memory tools stay available in the anchor round",
      );
    } else {
      assert.deepEqual(toolNames(out), tools.map((t) => t.name), v.tag + ": post-anchor tool surface stays full");
    }
  }

  // Non-scoped agent: strict deep-equal no-op for both system shapes.
  const butlerPayloads = [
    { system: sysText, messages: [...dialogue], tools },
    { messages: [{ role: "system", content: sysText }, ...dialogue], tools },
  ];
  for (const [i, payload] of butlerPayloads.entries()) {
    const original = structuredClone(payload);
    const out = s.handlers.before_provider_request(
      { payload },
      { sessionRef: { sessionPath: BUTLER_PATH } },
    );
    assert.deepEqual(out, original, "butler payload " + i + " must be completely untouched");
  }
});
