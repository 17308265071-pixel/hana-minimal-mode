import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../manifest.json" with { type: "json" };

const EXPECTED_KEYS = [
  "enabled",
  "routerMode",
  "stagedUnlock",
  "zeroToolAnchor",
  "bootstrapMaxTokens",
  "dynamicPacks",
  "postAnchorInjection",
  "networkGuard",
  "conversationControl",
];

const EXPECTED_DEFAULTS = {
  enabled: true,
  routerMode: "auto",
  stagedUnlock: true,
  zeroToolAnchor: true,
  bootstrapMaxTokens: 1024,
  dynamicPacks: true,
  postAnchorInjection: true,
  networkGuard: false,
  conversationControl: true,
};

test("manifest is full-access with exactly the nine behavior toggles (no targetAgent)", () => {
  assert.equal(manifest.trust, "full-access");
  assert.deepEqual(manifest.ui.hostCapabilities, []);
  const props = manifest.contributes.configuration.properties;
  assert.deepEqual(
    Object.keys(props).sort(),
    [...EXPECTED_KEYS].sort(),
    "configuration schema must be exactly the nine behavior properties",
  );
  assert.equal(Object.keys(props).length, 9);
  assert.equal(props.targetAgent, undefined, "targetAgent must be removed from the settings schema");
});

test("configuration properties are all Chinese", () => {
  const props = manifest.contributes.configuration.properties;
  for (const [key, prop] of Object.entries(props)) {
    assert.ok(prop.title, key + " needs a title");
    assert.ok(/[\u4e00-\u9fff]/.test(prop.title), key + " title must contain Chinese");
  }
});

test("key config defaults match state defaults", () => {
  const props = manifest.contributes.configuration.properties;
  const defaults = {};
  for (const [key, prop] of Object.entries(props)) {
    defaults[key] = prop.default;
  }
  assert.deepEqual(defaults, EXPECTED_DEFAULTS);
});

test("sidebar widget is declared with the Minimal Mode title, icon and /widget route", () => {
  const widget = manifest.contributes.widget;
  assert.ok(widget, "contributes.widget must be present (sidebar management panel)");
  assert.equal(widget.title.zh, "极简模式");
  assert.equal(widget.title.en, "Minimal Mode");
  assert.equal(widget.route, "/widget");
  assert.match(widget.icon, /^<svg[\s\S]*<\/svg>$/, "widget icon must be an inline SVG");
});

test("management is sidebar-only: no contributes.page surface", () => {
  assert.equal(manifest.contributes.page, undefined, "the full-size management page must stay removed");
  assert.ok(manifest.contributes.widget, "the sidebar widget must be the only surface");
});
