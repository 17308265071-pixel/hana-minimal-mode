// Deferred-tool bridge contract (R31/R42): every meta tool must export a
// synchronous sessionPermission.resolveInvocation(input) descriptor. Without it
// hosts fail closed with TOOL_INVOCATION_RESOLVER_FAILED when the model calls
// the tool (through mcp_call on the deferred bridge; through the live
// invocation-permission validator on native hosts). The capability namespace is
// context sensitive — empirically verified on Hana 0.449.0:
//   - native/live tier requires the BARE tool name "<tool>.<action>"
//     (direct calls reject the prefixed form: "Invocation capability must be
//     phase_begin.invoke." / "Invocation capability must be router_status.read.");
//   - the deferred bridge catalog requires the PREFIXED catalog name
//     "hana-minimal-mode_<tool>.<action>" (mcp_call succeeds with it).
// The resolver picks the namespace from the stack-frame context.
import test from "node:test";
import assert from "node:assert/strict";
import * as phaseBegin from "../tools/phase-begin.js";
import * as phaseAdvance from "../tools/phase-advance.js";
import * as toolsCatalog from "../tools/tools-catalog.js";
import * as toolsHelp from "../tools/tools-help.js";
import * as routerStatus from "../tools/router-status.js";
import * as deliveryCheck from "../tools/delivery-check.js";
import * as requestTools from "../tools/request-tools.js";
import * as personaReconcile from "../tools/persona-reconcile.js";

const TOOLS = [
  phaseBegin,
  phaseAdvance,
  toolsCatalog,
  toolsHelp,
  routerStatus,
  deliveryCheck,
  requestTools,
  personaReconcile,
];

const VALID_KINDS = new Set(["read", "routine", "review"]);

// Named exactly resolveBuiltinInvocation so the name lands on the stack frame,
// reproducing the deferred bridge's permission resolver context.
function resolveBuiltinInvocation(fn) {
  return fn();
}

test("all meta tools expose sessionPermission.resolveInvocation", () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.sessionPermission, "object", tool.name + " must keep sessionPermission");
    assert.equal(
      typeof tool.sessionPermission.resolveInvocation,
      "function",
      tool.name + " must expose a synchronous resolveInvocation",
    );
  }
});

test("native/live stack: minimal 3-key descriptor with the bare capability namespace", () => {
  for (const tool of TOOLS) {
    const d = tool.sessionPermission.resolveInvocation({});
    assert.ok(d && typeof d === "object", tool.name + " must return a descriptor");
    assert.deepEqual(Object.keys(d).sort(), ["action", "capability", "kind"], tool.name + " descriptor must be minimal");
    assert.ok(VALID_KINDS.has(d.kind), tool.name + " kind must be read|routine|review");
    assert.match(d.action, /^[a-z][a-z0-9_]*$/, tool.name + " action must be a stable lowercase id");
    assert.equal(d.capability, tool.name + "." + d.action, tool.name + " live capability must use the bare namespace");
    const again = tool.sessionPermission.resolveInvocation({ input: { sample: true } });
    assert.deepEqual(again, d, tool.name + " descriptor must be stable across native/live calls");
  }
});

test("bridge stack: capability switches to the prefixed catalog namespace", () => {
  for (const tool of TOOLS) {
    const live = tool.sessionPermission.resolveInvocation({});
    const bridged = resolveBuiltinInvocation(() => tool.sessionPermission.resolveInvocation({}));
    assert.equal(bridged.action, live.action, tool.name + " action must not change per context");
    assert.equal(bridged.kind, live.kind, tool.name + " kind must not change per context");
    assert.equal(
      bridged.capability,
      "hana-minimal-mode_" + tool.name + "." + bridged.action,
      tool.name + " bridge capability must use the prefixed namespace",
    );
    const bridgedAgain = resolveBuiltinInvocation(() => tool.sessionPermission.resolveInvocation({ input: { sample: true } }));
    assert.deepEqual(bridgedAgain, bridged, tool.name + " descriptor must be stable across bridge calls");
  }
});

test("descriptor action/kind mapping matches the bridge contract", () => {
  const expected = {
    phase_begin: { action: "invoke", kind: "routine" },
    phase_advance: { action: "invoke", kind: "routine" },
    tools_catalog: { action: "read", kind: "read" },
    tools_help: { action: "read", kind: "read" },
    router_status: { action: "read", kind: "read" },
    delivery_check: { action: "read", kind: "read" },
    request_tools: { action: "invoke", kind: "routine" },
    persona_reconcile: { action: "invoke", kind: "review" },
  };
  for (const tool of TOOLS) {
    const d = tool.sessionPermission.resolveInvocation({});
    assert.deepEqual(
      { action: d.action, kind: d.kind },
      expected[tool.name],
      tool.name + " must keep its declared action/kind",
    );
  }
});

test("resolver is synchronous and never throws", () => {
  for (const tool of TOOLS) {
    let d;
    assert.doesNotThrow(() => {
      d = tool.sessionPermission.resolveInvocation({});
    }, tool.name + " resolver must not throw");
    assert.equal(typeof d.then, "undefined", tool.name + " descriptor must be synchronous, not a Promise");
  }
});
