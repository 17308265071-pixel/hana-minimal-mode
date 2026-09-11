import test from "node:test";
import assert from "node:assert/strict";
import { TIER, detectTier, stripPrefix, isBridgeTool, tierLabel } from "../compat.js";

const PREFIX = "hana-minimal-mode_";

test("detectTier: native when plugin tools present", () => {
  const tools = ["read", "edit", `${PREFIX}phase_begin`, `${PREFIX}tools_catalog`];
  assert.equal(detectTier(tools, PREFIX), TIER.NATIVE);
});

test("detectTier: bridge when only mcp_call present", () => {
  const tools = ["read", "edit", "mcp_call", "mcp_search_tools"];
  assert.equal(detectTier(tools, PREFIX), TIER.BRIDGE);
});

test("detectTier: legacy otherwise", () => {
  const tools = ["read", "edit", "exec_command"];
  assert.equal(detectTier(tools, PREFIX), TIER.LEGACY);
});

test("detectTier: empty list is legacy", () => {
  assert.equal(detectTier([], PREFIX), TIER.LEGACY);
});

test("stripPrefix/isBridgeTool/tierLabel", () => {
  assert.equal(stripPrefix(`${PREFIX}phase_begin`, PREFIX), "phase_begin");
  assert.equal(stripPrefix("read", PREFIX), "read");
  assert.equal(isBridgeTool("mcp_call"), true);
  assert.equal(isBridgeTool("read"), false);
  assert.equal(tierLabel(TIER.NATIVE), "原生直调");
  assert.equal(tierLabel(TIER.BRIDGE), "桥接");
  assert.equal(tierLabel(TIER.LEGACY), "兼容");
});
