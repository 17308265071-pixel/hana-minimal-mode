const MODULE_VERSION = "0.4.7";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("../stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, getStageBucket } = _state;
const { META_TOOLS, stageToolSet, markerFor } = _stage;
const { TOOL_PACKS } = _router;

export const name = "tools_catalog";
export const description = "渐进式披露：列出当前阶段建议使用的工具与可用的平台工具包（标注阶段/包归属）；所有工具实际调用时即自动开放，无需申请。";
export const parameters = { type: "object", properties: { query: { type: "string", description: "关键词（可选）" }, domain: { type: "string", description: "域筛选（可选）" } } };
export const sessionPermission = {
  readOnly: true,
  resolveInvocation: () => {
    let ns = "tools_catalog";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_tools_catalog";
      }
    } catch { /* keep bare */ }
    return { action: "read", kind: "read", capability: `${ns}.read` };
  },
};

export async function execute(input, toolCtx) {
  initStore(toolCtx?.dataDir);
  const key = sessionKeyOf(toolCtx);
  const sb = getStageBucket(key);
  const q = String(input?.query || "").toLowerCase();
  const rows = [];
  for (const name of [...stageToolSet(sb.stage), ...META_TOOLS]) {
    const mark = markerFor(name, sb.stage, sb.openedPacks || []);
    if (q && !name.toLowerCase().includes(q)) continue;
    if (!q && mark === "未解锁") continue;
    rows.push(`- ${name} [${mark}]`);
  }
  for (const [id, pack] of Object.entries(TOOL_PACKS)) {
    const mark = (sb.openedPacks || []).includes(id) ? "可调" : "未解锁";
    if (q && !(id + pack.title).toLowerCase().includes(q)) continue;
    if (!q && mark === "未解锁") continue;
    rows.push(`- pack:${id} [${mark}] — ${pack.title}`);
  }
  return rows.length ? rows.join("\n") : "（无匹配工具）";
}
function sessionKeyOf(toolCtx) {
  const c = [
    toolCtx?.sessionManager?.getSessionFile?.(),
    toolCtx?.sessionPath, toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionId, toolCtx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
  return c[0] || "global";
}