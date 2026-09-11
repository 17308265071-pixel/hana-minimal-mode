const MODULE_VERSION = "0.4.6";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("../stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, getStageBucket, setStageBucket } = _state;
const { STAGES } = _stage;

export const name = "phase_begin";
export const description = "确认开启本次会话：开始渐进式工具解锁（注入机制声明 + 解锁阶段 0 工具）。调用即开始。";
export const parameters = { type: "object", properties: {} };
export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({ kind: "plugin_config", summary: "开启极简模式路由会话并解锁阶段 0" }),
  resolveInvocation: () => {
    let ns = "phase_begin";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_phase_begin";
      }
    } catch { /* keep bare */ }
    return { action: "invoke", kind: "routine", capability: `${ns}.invoke` };
  },
};

export async function execute(_input, toolCtx) {
  initStore(toolCtx?.dataDir);
  const key = sessionKeyOf(toolCtx);
  const sb = getStageBucket(key);
  if (sb.guided) return "会话已开启：阶段 " + sb.stage + "（" + STAGES[sb.stage].name + "）；不重复注入引导。";
  setStageBucket(key, { guided: true, bootstrapPending: true, stage: 0 });
  return "会话已开启：阶段 0「了解/对齐」解锁。下一轮注入开启引导与阶段声明。";
}

function sessionKeyOf(toolCtx) {
  const c = [
    toolCtx?.sessionManager?.getSessionFile?.(),
    toolCtx?.sessionPath, toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionId, toolCtx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
  return c[0] || "global";
}