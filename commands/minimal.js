const MODULE_VERSION = "0.4.7";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const _compat = await import(new URL("../compat.js?v=" + MODULE_VERSION, import.meta.url).href);
const _target = await import(new URL("../target-service.js?v=" + MODULE_VERSION, import.meta.url).href);
const { initStore, setState, getStageBucket, setStageBucket, clearAgentStages } = _state;
const { canonicalMode } = _router;
const { tierLabel } = _compat;
const { getTarget, setTarget } = _target;

export const name = "minimal";
export const aliases = ["minimal-mode"];
export const scope = "session";
export const permission = "owner";
export const description = "极简模式路由控制：/minimal status|on|off|stage <0..3>|mode <auto|spec|react|weak|mixed>";

const CONFIG_MISSING = "插件上下文不可用（config 缺失），请重启 Hana。";

export async function handler(ctx) {
  const args = String(ctx?.args ?? ctx?.input ?? ctx?.text ?? "").trim();
  const pluginCtx = resolvePluginContext(ctx);
  const cmdCtx = pluginCtx ? { ...pluginCtx, ...ctx } : ctx;
  const result = await execute(args, cmdCtx);
  return typeof result === "string" ? { reply: result } : result;
}

function resolvePluginContext(ctx) {
  try {
    const engine = ctx?.engine ?? ctx?.hub?.engine;
    const entry = engine?.pluginManager?.getPlugin?.("hana-minimal-mode");
    const pluginCtx = entry?.ctx;
    if (pluginCtx?.config && pluginCtx?.bus) return pluginCtx;
  } catch {}
  return null;
}

function currentAgentId(cmdCtx) {
  const direct = cmdCtx?.agentId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const sessionPath = cmdCtx?.sessionPath || cmdCtx?.sessionRef?.sessionPath || "";
  const m = String(sessionPath).replace(/\\/g, "/").match(/agents\/([^/]+)\//);
  return m?.[1] || null;
}

export async function execute(args, cmdCtx) {
  const arg = args.toLowerCase();
  initStore(cmdCtx?.dataDir);
  const agentId = currentAgentId(cmdCtx);
  if (arg === "status" || arg === "") {
    const state = (await readState(cmdCtx)) || {};
    const key = cmdCtx?.sessionPath || cmdCtx?.sessionRef?.sessionPath || cmdCtx?.sessionId || "global";
    const sb = getStageBucket(key);
    return [
      "极简模式: " + (state.enabled ? "ON" : "OFF"),
      "目标助手: " + (state.targetAgents || "(无)"),
      "模式: " + (state.routerMode || "auto"),
      "通道: " + tierLabel(sb.tier || "legacy"),
      "阶段: " + sb.stage + "/3" + (sb.guided ? "（已开启）" : "（未开启）"),
      "平台包: " + ((sb.openedPacks || []).join(", ") || "无"),
    ].join("\n");
  }
  if (arg === "on" || arg === "enable") {
    if (!cmdCtx?.config) return CONFIG_MISSING;
    if (!agentId) return "未检测到当前助手 id。请在侧边栏「极简模式」面板中注册。";
    const result = setTarget(cmdCtx?.dataDir, agentId, { source: "command" });
    for (const id of result.removed) clearAgentStages(id);
    await cmdCtx.config.set("enabled", true);
    setState({ targetAgents: result.next.join(","), enabled: true });
    return "已对当前助手「" + agentId + "」开启极简模式。";
  }
  if (arg === "off" || arg === "disable") {
    if (!cmdCtx?.config) return CONFIG_MISSING;
    if (!agentId) return "未检测到当前助手 id。";
    const result = setTarget(cmdCtx?.dataDir, "", { source: "command" });
    for (const id of result.removed) clearAgentStages(id);
    await cmdCtx.config.set("enabled", false);
    setState({ targetAgents: "", enabled: false });
    return "已对当前助手「" + agentId + "」关闭极简模式。";
  }
  if (arg.startsWith("stage ")) {
    const n = Number(arg.slice(6).trim());
    if (!Number.isInteger(n) || n < 0 || n > 3) return "阶段须为 0..3。";
    const key = cmdCtx?.sessionPath || cmdCtx?.sessionRef?.sessionPath || cmdCtx?.sessionId || "global";
    setStageBucket(key, { stage: n, guided: true });
    return "当前会话阶段已设为 " + n + "/3（调试操作）。";
  }
  if (arg.startsWith("mode ")) {
    if (!cmdCtx?.config) return CONFIG_MISSING;
    const mode = canonicalMode(arg.slice(5).trim());
    if (mode === null) return "模式须为 auto|spec|react|weak|mixed。";
    await cmdCtx.config.set("routerMode", mode);
    setState({ routerMode: mode });
    return "路由模式已设为 " + mode + "。";
  }
  return "用法: /minimal status|on|off|stage <0..3>|mode <auto|spec|react|weak|mixed>";
}

async function readState(cmdCtx) {
  try {
    const d = { enabled: true, routerMode: "auto" };
    return {
      enabled: (await cmdCtx.config.get("enabled")) ?? d.enabled,
      targetAgents: getTarget(cmdCtx?.dataDir),
      routerMode: (await cmdCtx.config.get("routerMode")) ?? d.routerMode,
    };
  } catch { return null; }
}
