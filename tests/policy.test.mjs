import test from "node:test";
import assert from "node:assert/strict";
import { TIER } from "../compat.js";
import { computePolicy, buildAnchorCapabilityDigest, isAnchorExtraTool } from "../policy.js";

const PREFIX = "hana-minimal-mode_";
const base = {
  state: { enabled: true, targetAgents: "hanako", routerMode: "auto", stagedUnlock: true,
           zeroToolAnchor: true, bootstrapMaxTokens: 1024, dynamicPacks: true, postAnchorInjection: true, networkGuard: false, conversationControl: true },
  session: { stage: 0, guided: false, bootstrapPending: false, openedPacks: [] },
  userTexts: ["帮我重构这个模块"],
  priorAssistant: false,
};

test("T0 anchor on bridge tier keeps only bridge tools, injects persona+notice, caps budget", () => {
  const tools = ["read", "edit", "exec_command", "mcp_call"];
  const p = computePolicy({ ...base, tier: TIER.BRIDGE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, ["mcp_call"]);
  assert.ok(p.inject.persona?.includes("software engineer"));
  assert.ok(p.inject.anchorNotice?.includes("no work tools are open this round"));
  assert.ok(p.inject.anchorNotice?.includes("Do NOT read files"));
  assert.equal(p.budget, 1024);
  assert.equal(p.inject.bootstrap, undefined);
});

test("T0 anchor on legacy tier without bridge tools exposes an empty tool face", () => {
  const tools = ["read", "edit", "exec_command"];
  const p = computePolicy({ ...base, tier: TIER.LEGACY, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, []);
  assert.ok(p.inject.anchorNotice?.includes("no work tools are open this round"));
  assert.equal(p.budget, 1024);
});

test("T0 anchor in native tier allows only phase_begin", () => {
  const tools = ["read", "edit", `${PREFIX}phase_begin`, `${PREFIX}tools_catalog`];
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, [`${PREFIX}phase_begin`]);
});

test("R36: native anchor keeps Hana memory/recall/status tools after phase_begin", () => {
  const tools = ["read", `${PREFIX}phase_begin`, "search_memory", "recall_experience", "current_status", "edit"];
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, [`${PREFIX}phase_begin`, "search_memory", "recall_experience", "current_status"]);
});

test("R36: bridge anchor keeps Hana memory tools alongside the bridge tool", () => {
  const tools = ["read", "mcp_call", "edit", "search_memory"];
  const p = computePolicy({ ...base, tier: TIER.BRIDGE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, ["mcp_call", "search_memory"]);
});

test("R36: anchor without Hana memory tools keeps the previous tool face", () => {
  const bridge = computePolicy({ ...base, tier: TIER.BRIDGE, availableTools: ["read", "edit", "mcp_call"] });
  assert.deepEqual(bridge.allowed, ["mcp_call"]);
  const legacy = computePolicy({ ...base, tier: TIER.LEGACY, availableTools: ["read", "edit"] });
  assert.deepEqual(legacy.allowed, []);
});

test("R43: native anchor keeps the thinking plugin tool after the memory tools", () => {
  const tools = ["read", `${PREFIX}phase_begin`, "search_memory", "hana-max-thinking_thinking_status"];
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, [`${PREFIX}phase_begin`, "search_memory", "hana-max-thinking_thinking_status"]);
});

test("R43: bridge anchor keeps the thinking plugin tool alongside the bridge tool", () => {
  const tools = ["read", "mcp_call", "hana-max-thinking_thinking_status"];
  const p = computePolicy({ ...base, tier: TIER.BRIDGE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, ["mcp_call", "hana-max-thinking_thinking_status"]);
});

test("R43: anchor without the thinking tool keeps the previous results without empty entries", () => {
  const native = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: ["read", `${PREFIX}phase_begin`, "search_memory"] });
  assert.deepEqual(native.allowed, [`${PREFIX}phase_begin`, "search_memory"]);
  const bridge = computePolicy({ ...base, tier: TIER.BRIDGE, availableTools: ["read", "mcp_call"] });
  assert.deepEqual(bridge.allowed, ["mcp_call"]);
  for (const entry of [...native.allowed, ...bridge.allowed]) {
    assert.ok(typeof entry === "string" && entry.length > 0, "no empty/undefined entries");
  }
});

test("R43: anchor extra matcher keeps prefixed/bare thinking tools once and ignores others", () => {
  const tools = [
    "read", "mcp_call", "hana-max-thinking_thinking_status",
    "thinking_status", "hana-max-thinking_thinking_status",
  ];
  const p = computePolicy({ ...base, tier: TIER.BRIDGE, availableTools: tools });
  assert.deepEqual(p.allowed, ["mcp_call", "hana-max-thinking_thinking_status", "thinking_status"]);
  assert.equal(isAnchorExtraTool("hana-max-thinking_thinking_status"), true);
  assert.equal(isAnchorExtraTool("hana-max-thinking_other"), true);
  assert.equal(isAnchorExtraTool("thinking_status"), true);
  assert.equal(isAnchorExtraTool("thinking_status_extra"), false);
  assert.equal(isAnchorExtraTool("read"), false);
  assert.equal(isAnchorExtraTool(undefined), false);
  assert.equal(isAnchorExtraTool(42), false);
});

test("R29: post-anchor releases the full tool surface (no stage window)", () => {
  const tools = ["read", "ls", "grep", "write", "edit", `${PREFIX}tools_catalog`, `${PREFIX}phase_advance`];
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: tools, session: { ...base.session, guided: true }, priorAssistant: true });
  assert.deepEqual(p.allowed, tools);
  assert.ok(p.inject.stage?.includes("Current phase"));
  assert.equal(p.budget, null);
});

test("R29: postAnchorInjection=false suppresses post-anchor persona/stage/declaration", () => {
  const tools = ["read", "write"];
  const p = computePolicy({
    ...base,
    state: { ...base.state, postAnchorInjection: false },
    tier: TIER.NATIVE,
    availableTools: tools,
    session: { ...base.session, guided: true },
    priorAssistant: true,
  });
  assert.deepEqual(p.allowed, tools);
  assert.equal(p.inject.persona, undefined);
  assert.equal(p.inject.stage, undefined);
  assert.equal(p.inject.declaration, undefined);
  assert.equal(p.inject.proactivity, undefined);
  assert.equal(p.inject.bootstrap, undefined);
});

test("R29: postAnchorInjection=false keeps the anchor round unchanged", () => {
  const tools = ["read", `hana-minimal-mode_phase_begin`];
  const p = computePolicy({
    ...base,
    state: { ...base.state, postAnchorInjection: false },
    tier: TIER.NATIVE,
    availableTools: tools,
    priorAssistant: false,
  });
  assert.equal(p.anchor, true);
  assert.deepEqual(p.allowed, ["hana-minimal-mode_phase_begin"]);
  assert.ok(p.inject.persona?.includes("software engineer"));
  assert.ok(p.inject.anchorNotice?.includes("no work tools are open this round"));
});

test("bootstrap pending injects bootstrap text once", () => {
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: ["read", `${PREFIX}phase_begin`], session: { ...base.session, guided: true, bootstrapPending: true }, priorAssistant: true });
  assert.ok(p.inject.bootstrap?.length > 100);
});

test("platform packs open by keyword from round 2", () => {
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: ["read", "write"], session: { ...base.session, guided: true }, userTexts: ["帮我整理这个 Word 文档"], priorAssistant: true });
  assert.deepEqual(p.nextPacks, ["docs"]);
});

test("stagedUnlock false releases all tools", () => {
  const tools = ["read", "write", "computer"];
  const p = computePolicy({ ...base, state: { ...base.state, stagedUnlock: false }, tier: TIER.NATIVE, availableTools: tools, session: { ...base.session, stage: 0, guided: true }, priorAssistant: true });
  assert.deepEqual(p.allowed, tools);
});

test("stage 3 releases everything", () => {
  const tools = ["read", "write", "computer", "automation", `${PREFIX}tools_help`];
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: tools, session: { ...base.session, stage: 3, guided: true }, priorAssistant: true });
  assert.deepEqual(p.allowed, tools);
});

test("R37: capability digest maps live tool families and matched packs", () => {
  const tools = [
    "read", "write", "exec_command", "mcp_call", "search_memory",
    "tencent-docs_doc_read", "playwright_browser_click", "hana-minimal-mode_router_status",
  ];
  const text = buildAnchorCapabilityDigest(tools);
  assert.ok(text.includes("[Capability map]"));
  assert.ok(text.includes("open on demand"));
  assert.ok(text.includes("read, write, exec_command"), "core tools listed from the live list");
  assert.ok(text.includes("search_memory"), "memory tool listed");
  assert.ok(text.includes("nothing is trimmed"), "native-context statement present");
  assert.ok(text.includes("mcp_call"), "mcp bridge tool listed");
  assert.ok(text.includes("hana-minimal-mode_router_status"), "plugin meta tool listed");
  assert.match(text, /- platform packs: .*docs \(Word/);
  assert.match(text, /- platform packs: .*browser/);
  assert.ok(text.length < 1200, "digest stays compact: " + text.length);
});

test("R37: capability digest tolerates empty/malformed lists and still states native context", () => {
  const empty = buildAnchorCapabilityDigest([]);
  assert.ok(empty.includes("[Capability map]"));
  assert.ok(empty.includes("open on demand"));
  assert.ok(empty.includes("nothing is trimmed"));
  assert.ok(empty.includes("available: docs"), "empty list still names the available packs");
  assert.ok(empty.length < 1200);

  const messy = buildAnchorCapabilityDigest([null, 42, { name: "read" }, "read", "exec_command", "exec_command"]);
  assert.ok(messy.includes("read"));
  assert.equal(messy.match(/exec_command/g).length, 1, "duplicates are collapsed");
  assert.ok(messy.includes("nothing is trimmed"));
});

test("R37: anchor round injects the capability map while keeping the restricted tool face", () => {
  const tools = ["read", "mcp_call", `${PREFIX}phase_begin`, `${PREFIX}router_status`, "search_memory"];
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: tools });
  assert.equal(p.anchor, true);
  assert.ok(p.inject.capabilityMap?.includes("[Capability map]"));
  assert.ok(p.inject.capabilityMap?.includes(`${PREFIX}router_status`));
  assert.deepEqual(p.allowed, [`${PREFIX}phase_begin`, "search_memory"]);
});

test("memory muted strips memory mentions from stage text", () => {
  const p = computePolicy({ ...base, tier: TIER.NATIVE, availableTools: ["read"], session: { ...base.session, guided: true }, userTexts: ["不用记忆，直接干活"], priorAssistant: true });
  assert.ok(!p.inject.stage?.includes("search_memory"));
});
