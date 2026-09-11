export const TIER = Object.freeze({ NATIVE: "native", BRIDGE: "bridge", LEGACY: "legacy" });

const BRIDGE_NAMES = new Set(["mcp_call", "mcp_search_tools", "mcp_describe_tool"]);

export function isBridgeTool(name) {
  return typeof name === "string" && BRIDGE_NAMES.has(name);
}

export function stripPrefix(name, pluginPrefix) {
  if (typeof name !== "string") return name;
  return name.startsWith(pluginPrefix) ? name.slice(pluginPrefix.length) : name;
}

export function detectTier(availableTools, pluginPrefix) {
  const names = Array.isArray(availableTools) ? availableTools : [];
  if (names.some((n) => typeof n === "string" && n.startsWith(pluginPrefix))) return TIER.NATIVE;
  if (names.some((n) => isBridgeTool(n))) return TIER.BRIDGE;
  return TIER.LEGACY;
}

export function tierLabel(tier) {
  return { native: "原生直调", bridge: "桥接", legacy: "兼容" }[tier] || "兼容";
}
