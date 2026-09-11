const MODULE_VERSION = "0.4.7";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("../stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const _compat = await import(new URL("../compat.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, getState, getStageBucket } = _state;
const { stageSummary } = _stage;
const { tierLabel } = _compat;
const { modelFamily } = _router;

export const name = "router_status";
export const description = "报告当前极简模式路由状态：通道、阶段、已解锁工具、模型家族、平台包、最近晋级。";
export const parameters = { type: "object", properties: {} };
export const sessionPermission = {
  readOnly: true,
  resolveInvocation: () => {
    let ns = "router_status";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_router_status";
      }
    } catch { /* keep bare */ }
    return { action: "read", kind: "read", capability: `${ns}.read` };
  },
};

export async function execute(_input, toolCtx) {
  initStore(toolCtx?.dataDir);
  const state = getState();
  const key = sessionKeyOf(toolCtx);
  const sb = getStageBucket(key);
  const mi = modelIdOf(toolCtx);
  const modelLabel = mi.provider ? `${mi.provider}/${mi.id}` : mi.id;
  const sum = stageSummary(sb.stage, sb.openedPacks || []);
  return [
    "Minimal mode: " + (state.enabled ? "ON" : "OFF"),
    "Target agents: " + state.targetAgents,
    "Channel: " + tierLabel(sb.tier || "legacy"),
    "Phase: " + sum.name + " (" + sum.stage + "/3)",
    "Unlocked: " + sum.unlocked.join(", "),
    "Packs open: " + ((sb.openedPacks || []).join(", ") || "none"),
    "Model: " + modelLabel + " (" + (modelFamily(mi.id) || "unknown") + "-family)",
    "Last advance: " + (sb.lastAdvance ? new Date(sb.lastAdvance.at).toISOString() + " (" + sb.lastAdvance.reason + ")" : "none"),
  ].join("\n");
}
function modelIdOf(toolCtx) {
  const m = toolCtx?.model;
  if (typeof m === "string" && m.trim()) return { id: m.trim(), provider: "" };
  if (m && typeof m === "object") {
    const id = String(m.id || m.modelId || m.model || m.name || "").trim();
    const provider = String(m.provider || m.providerId || "").trim();
    if (id) return { id, provider };
  }
  return { id: "unknown", provider: "" };
}
function sessionKeyOf(toolCtx) {
  const c = [
    toolCtx?.sessionManager?.getSessionFile?.(),
    toolCtx?.sessionPath, toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionId, toolCtx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
  return c[0] || "global";
}