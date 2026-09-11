const MODULE_VERSION = "0.5.0";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, getStageBucket, setStageBucket } = _state;
const { TOOL_PACKS, expandPackTools } = _router;

export const name = "request_tools";
export const description = "按需打开平台工具包（docs/sheets/slides/smartsheet/browser/desktop/media）。打开后本会话持续可用。";
export const parameters = {
  type: "object",
  properties: { packs: { type: "array", items: { type: "string", enum: Object.keys(TOOL_PACKS) }, description: "包 id 列表" } },
  required: ["packs"],
};
export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({ kind: "plugin_config", summary: "打开极简模式的平台工具包" }),
  resolveInvocation: () => {
    let ns = "request_tools";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_request_tools";
      }
    } catch { /* keep bare */ }
    return { action: "invoke", kind: "routine", capability: `${ns}.invoke` };
  },
};

export async function execute(input, toolCtx) {
  initStore(toolCtx?.dataDir);
  const key = sessionKeyOf(toolCtx);
  const sb = getStageBucket(key);
  const requested = Array.isArray(input?.packs) ? input.packs.filter((p) => typeof p === "string" && TOOL_PACKS[p]) : [];
  const merged = [...(sb.openedPacks || [])];
  for (const id of requested) if (!merged.includes(id)) merged.push(id);
  setStageBucket(key, { openedPacks: merged });
  return "已打开包: " + merged.join(", ") + "。新增工具： " + expandPackTools(merged).join(", ");
}
function sessionKeyOf(toolCtx) {
  const c = [
    toolCtx?.sessionManager?.getSessionFile?.(),
    toolCtx?.sessionPath, toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionId, toolCtx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
  return c[0] || "global";
}