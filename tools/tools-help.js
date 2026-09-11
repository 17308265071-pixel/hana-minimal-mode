const MODULE_VERSION = "0.4.7";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("../stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, getStageBucket } = _state;
const { markerFor, stageInfo } = _stage;
const { TOOL_PACKS } = _router;

export const name = "tools_help";
export const description = "查询单个工具的解锁阶段与当前可调状态（不返回参数 schema；参数请直接按工具调用契约传递）。";
export const parameters = { type: "object", properties: { name: { type: "string", description: "工具名（tools_catalog 里查到的）" } }, required: ["name"] };
export const sessionPermission = {
  readOnly: true,
  resolveInvocation: () => {
    let ns = "tools_help";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_tools_help";
      }
    } catch { /* keep bare */ }
    return { action: "read", kind: "read", capability: `${ns}.read` };
  },
};

export async function execute(input, toolCtx) {
  initStore(toolCtx?.dataDir);
  const key = sessionKeyOf(toolCtx);
  const sb = getStageBucket(key);
  const target = String(input?.name || "").trim();
  const info = stageInfo(target);
  if (info.kind === "host") {
    const packId = Object.keys(TOOL_PACKS).find((id) => TOOL_PACKS[id].tools.some((s) => s === target || (s.endsWith("*") && target.startsWith(s.slice(0, -1)))));
    return `工具: ${target}\n解锁: ${(sb.openedPacks || []).includes(packId) || sb.stage >= 3 ? "可调" : packId ? `解锁于打开平台包「${packId}」或阶段 3 全量` : "宿主工具：阶段 3 全量开放"}`;
  }
  const mark = markerFor(target, sb.stage, sb.openedPacks || []);
  return `工具: ${target} [${mark}]\n解锁阶段: ${info.kind === "meta" ? "常驻" : info.stage}（当前调用 ${mark === "未解锁" ? "会被拒绝" : "可调"}）`;
}
function sessionKeyOf(toolCtx) {
  const c = [
    toolCtx?.sessionManager?.getSessionFile?.(),
    toolCtx?.sessionPath, toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionId, toolCtx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
  return c[0] || "global";
}