const MODULE_VERSION = "0.4.7";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("../stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, getStageBucket, setStageBucket } = _state;
const { STAGES } = _stage;

export const name = "phase_advance";
export const description = "闯关推进：声明当前阶段已完成，进入下一阶段（解锁新工具）。一次一级，不跳级。仅阶段 2→3 前建议先 delivery_check。";
export const parameters = { type: "object", properties: { reason: { type: "string", description: "推进理由（可选，记录用）" } } };
export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({ kind: "plugin_config", summary: "推进极简模式路由阶段" }),
  resolveInvocation: () => {
    let ns = "phase_advance";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_phase_advance";
      }
    } catch { /* keep bare */ }
    return { action: "invoke", kind: "routine", capability: `${ns}.invoke` };
  },
};

export async function execute(input, toolCtx) {
  initStore(toolCtx?.dataDir);
  const key = sessionKeyOf(toolCtx);
  const sb = getStageBucket(key);
  if (sb.stage >= STAGES.length - 1) return "已在最后阶段（" + STAGES[sb.stage].name + "）；全量目录已开放。";
  const next = sb.stage + 1;
  setStageBucket(key, { stage: next, guided: true, lastAdvance: { at: Date.now(), reason: input?.reason || "phase_advance" } });
  return "已推进至阶段 " + next + "：「" + STAGES[next].name + "」。新解锁：" + STAGES[next].tools.join(", ") + "。";
}
function sessionKeyOf(toolCtx) {
  const c = [
    toolCtx?.sessionManager?.getSessionFile?.(),
    toolCtx?.sessionPath, toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionId, toolCtx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
  return c[0] || "global";
}