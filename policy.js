const MODULE_VERSION = "0.4.6";
const _router = await import(new URL("./router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("./stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const _compat = await import(new URL("./compat.js?v=" + MODULE_VERSION, import.meta.url).href);
const { RL_PERSONA, packsForText, TOOL_PACKS, matchesToolSpec } = _router;
const {
  stageText, PROGRESSIVE_DECL, PRESSURE_GUIDE, BOOTSTRAP, memoryMuted, firstUserTask,
} = _stage;
const { TIER, isBridgeTool, stripPrefix } = _compat;

// R36: Hana's memory/recall/status tools stay callable during the anchoring
// round; the task itself still cannot start (no read/ls/grep/edit/exec_command).
const ANCHOR_MEMORY_TOOLS = ["search_memory", "recall_experience", "current_status"];

// R43: the thinking plugin's tools stay callable during the anchoring round so
// the model can check/align its thinking level from the very first turn. The
// host exposes the tool as `hana-max-thinking_thinking_status`; the bare
// `thinking_status` name is kept for compatibility.
const ANCHOR_EXTRA_TOOL_PREFIX = "hana-max-thinking_";

export function isAnchorExtraTool(name) {
  if (typeof name !== "string") return false;
  return name === "thinking_status" || name.startsWith(ANCHOR_EXTRA_TOOL_PREFIX);
}

// R37: the anchoring round advertises the full live tool surface as a compact
// capability map, so the model can judge which tool families the task needs
// even though the callable set stays restricted for this turn.
const PLUGIN_PREFIX = "hana-minimal-mode_";

const CORE_WORK_TOOLS = [
  "read", "write", "edit", "ls", "grep", "find", "exec_command",
  "write_stdin", "todo_write", "subagent", "web_search", "web_fetch",
];

const CAPABILITY_HEADER =
  "[Capability map] Tools open on demand after this anchor round — state in one line which families this task needs.";

const NATIVE_CONTEXT_NOTE =
  "Hana native memory documents/skills/workspace files are intact; nothing is trimmed";

function capNames(items, max) {
  if (items.length <= max) return items.join(", ");
  return items.slice(0, max).join(", ") + " (+" + String(items.length - max) + " more)";
}

/** R37: compact capability map built from the LIVE tool list of this request.
 *  Never throws; tolerates non-string entries, duplicates and an empty list
 *  (empty still emits the header, the open-on-demand line and the
 *  Hana-native-context statement). */
export function buildAnchorCapabilityDigest(toolNames) {
  try {
    const names = [];
    for (const entry of Array.isArray(toolNames) ? toolNames : []) {
      if (typeof entry === "string" && entry && !names.includes(entry)) names.push(entry);
    }
    const core = CORE_WORK_TOOLS.filter((n) => names.includes(n));
    const memory = ANCHOR_MEMORY_TOOLS.filter((n) => names.includes(n));
    const packIds = Object.keys(TOOL_PACKS);
    const packs = [];
    for (const [id, pack] of Object.entries(TOOL_PACKS)) {
      const specs = Array.isArray(pack?.tools) ? pack.tools : [];
      if (specs.some((spec) => names.some((n) => matchesToolSpec(n, spec)))) {
        const title = typeof pack?.title === "string" ? pack.title : "";
        const short = /\(([^)]*)\)/.exec(title);
        packs.push(short ? id + " (" + short[1] + ")" : id);
      }
    }
    const mcp = names.filter((n) => n.startsWith("mcp_"));
    const meta = names.filter((n) => n.startsWith(PLUGIN_PREFIX));
    return [
      CAPABILITY_HEADER,
      "- core work tools: " + (core.length ? capNames(core, 12) : "none listed this round"),
      "- memory & context: " + (memory.length ? memory.join(", ") : "none listed this round")
        + " (" + NATIVE_CONTEXT_NOTE + ")",
      "- platform packs: " + (packs.length ? packs.join(", ") : "none matched this round; available: " + packIds.join(", ")),
      "- MCP / plugin tools: mcp bridge: " + (mcp.length ? capNames(mcp, 4) : "none")
        + "; plugin meta: " + (meta.length ? capNames(meta, 5) : "none"),
      "- skills: follow the skill sections already present in the system prompt.",
      "If this task needs documents/sheets/slides/browser/desktop/media/MCP tools, say so now; the next round exposes everything.",
    ].join("\n");
  } catch {
    return CAPABILITY_HEADER + "\n- memory & context: (" + NATIVE_CONTEXT_NOTE + ")";
  }
}

export function computePolicy({ state, session, tier, availableTools, userTexts, priorAssistant }) {
  const tools = Array.isArray(availableTools) ? availableTools : [];
  const st = session || { stage: 0, guided: false, bootstrapPending: false, openedPacks: [] };
  const muted = memoryMuted(Array.isArray(userTexts) ? userTexts : []);
  const taskText = firstUserTask(Array.isArray(userTexts) ? userTexts : []);
  const packs = Array.isArray(st.openedPacks) ? st.openedPacks : [];
  const nextPacks = [];
  if (state.dynamicPacks && st.guided) {
    for (const id of packsForText((Array.isArray(userTexts) ? userTexts : []).join(" "))) {
      if (!packs.includes(id)) nextPacks.push(id);
    }
  }
  const allPacks = [...packs, ...nextPacks];

  // ── T0 锚定轮：无先前 assistant 回复且开启锚定 ──
  const anchor = state.zeroToolAnchor && !priorAssistant && !st.guided && st.stage === 0;

  // R29: 锚定后注入开关（默认开）。关闭时锚定轮本身不变，锚定之后不再注入
  // persona/阶段/声明/引导；工具面始终全量。
  const postInjection = state.postAnchorInjection !== false;

  let allowed;
  if (anchor) {
    // 锚定轮：native 档只留 phase_begin；bridge/legacy 档没有 phase_begin，
    // 只保留桥工具（mcp_call / mcp_search_tools / mcp_describe_tool），
    // 插件工具经桥在次轮按阶段开放。桥工具缺席时工具面为空。
    // R36：Hana 原生记忆/回忆/状态工具（存在即保留）随锚定核心一起放行，
    // 保证路由插件永不阻断 Hana 的记忆能力；核心顺序在前，不重复。
    // R43：Thinking 插件工具（hana-max-thinking_* / thinking_status，存在即保留）
    // 排在记忆工具之后，让模型首轮即可检查/对齐思考档位，同样不重复。
    const core = tier === TIER.NATIVE
      ? tools.filter((n) => n === "phase_begin" || n === "hana-minimal-mode_phase_begin" || (n.startsWith("hana-minimal-mode_") && stripPrefix(n, "hana-minimal-mode_") === "phase_begin"))
      : tools.filter((n) => isBridgeTool(n));
    const memory = ANCHOR_MEMORY_TOOLS.filter((n) => tools.includes(n) && !core.includes(n));
    const extra = [];
    for (const n of tools) {
      if (typeof n === "string" && isAnchorExtraTool(n)
        && !core.includes(n) && !memory.includes(n) && !extra.includes(n)) extra.push(n);
    }
    allowed = [...core, ...memory, ...extra];
  } else {
    // R29: 锚定后全量释放——模型需要什么工具就直接调用，不再隐藏、不再返回
    // "not found"；平台包在调用命中时自动打开（extensions/router.js tool_call）。
    allowed = [...tools];
  }

  const inject = {};
  if (anchor || postInjection) inject.persona = RL_PERSONA;
  if (anchor) {
    inject.anchorNotice = "This is the anchoring round: no work tools are open this round (memory/recall tools, the thinking plugin's tools, and the plugin bridge, if present, stay available). Do NOT read files, run commands, or start the task. Acknowledge the task and state your approach; tools open automatically on the next round.";
    if (state.zeroToolAnchor && tier !== TIER.NATIVE) {
      inject.anchorNotice += " (Plugin tools are bridged on this Hana version; stage tools open automatically next round.)";
    }
    // R37: give the model the live surface map now (the callable set above is
    // still restricted for this turn).
    inject.capabilityMap = buildAnchorCapabilityDigest(tools);
  }
  if (st.bootstrapPending && !anchor && postInjection) {
    inject.bootstrap = BOOTSTRAP;
  }
  if (!anchor && st.guided && postInjection) {
    inject.stage = stageText(st.stage, allPacks, taskText, muted);
    inject.declaration = PROGRESSIVE_DECL;
    inject.proactivity = PRESSURE_GUIDE;
  }

  return {
    allowed,
    anchor,
    inject,
    budget: anchor && state.bootstrapMaxTokens > 0 ? state.bootstrapMaxTokens : null,
    nextPacks,
  };
}
