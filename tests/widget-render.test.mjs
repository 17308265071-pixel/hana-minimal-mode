// Route-level coverage for the restored sidebar panel: GET /widget renders the
// Chinese registration UI (single-target register dropdown + collapsible
// registered list with inline two-step delete), follows the host route-shell
// conventions, and styles itself strictly with the host-injected theme
// variables following Hana's KAMI panel design language (flat surfaces, 4px
// radii, 0.5px lines, weights 400/500 only, no hardcoded colors).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

async function loadWidget(query = () => null) {
  const href = pathToFileURL(path.join(pluginRoot, "routes", "widget.js")).href + "?t=" + Date.now();
  const mod = await import(href);
  const handlers = {};
  const app = { get: (route, fn) => { handlers[route] = fn; } };
  mod.default(app, { pluginId: "hana-minimal-mode" });
  const c = { req: { query }, html: (s) => s };
  return { handlers, c };
}

function scriptOf(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "inline script present");
  return match[1];
}

test("GET /widget renders the single-target management UI", async () => {
  const { handlers, c } = await loadWidget();
  assert.equal(typeof handlers["/widget"], "function", "GET /widget handler must be registered");
  assert.equal(handlers["/page"], undefined, "no /page surface may be registered");
  const html = handlers["/widget"](c);
  assert.match(html, /极简模式/);
  assert.match(html, /id="enabledEl"/);
  assert.match(html, /id="routerMode"/);
  assert.match(html, /id="agentPick"/);
  assert.match(html, /id="registerBtn"/);
  assert.match(html, /<details id="registered" open>/);
  assert.match(html, /<summary>/);
  assert.match(html, /重注册/);
  assert.match(html, /删除注册/);
  assert.match(html, /确认删除/);
  assert.match(html, /取消注册不会修改助手的任何文件/);
  assert.match(html, /不裁剪/);
  assert.match(html, /不替换 Hana 的原生上下文/);
  for (const value of ["auto", "spec", "react", "weak", "mixed"]) {
    assert.match(html, new RegExp('<option value="' + value + '"'), "routerMode option: " + value);
  }
});

test("inline script parses; base derivation is a string slice; dynamic DOM uses textContent", async () => {
  const { handlers, c } = await loadWidget();
  const script = scriptOf(handlers["/widget"](c));
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /endsWith\('\/widget'\)/);
  assert.match(script, /slice\(0, -'\/widget'\.length\)/);
  assert.ok(!/pathname\.replace\(/.test(script), "base derivation must not use an ambiguous regex replace");
  assert.ok(!/innerHTML/.test(script), "dynamic data must not use innerHTML");
  assert.match(script, /textContent/);
  assert.match(script, /setInterval/);
  assert.match(script, /\/register/);
  assert.match(script, /\/unregister/);
  assert.match(script, /\/reregister/);
  assert.match(script, /重注册/);
  assert.match(script, /\/state/);
  assert.match(script, /X-Hana-Plugin-Surface-Session/);
  assert.match(script, /postMessage\(\{ type: 'ready' \}/);
  assert.match(script, /\/midnight\/i/);
});

test("route shell handles hana-css/hana-theme query params with escaped attributes", async () => {
  const { handlers, c } = await loadWidget((key) => {
    if (key === "hana-css") return 'https://x/a.css").evil(';
    if (key === "hana-theme") return 'dark" x="';
    return null;
  });
  const html = handlers["/widget"](c);
  assert.ok(html.includes('href="https://x/a.css&quot;).evil("'), "hana-css must be escaped into the link tag");
  assert.ok(html.includes('data-hana-theme="dark&quot; x=&quot;"'), "hana-theme must be escaped");
});

test("KAMI panel design: theme variables only, flat and hardcoded-color free", async () => {
  const { handlers, c } = await loadWidget();
  const html = handlers["/widget"](c);
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  assert.ok(css, "inline stylesheet present");
  for (const token of [
    "--bg-card", "--border", "--text", "--text-light", "--text-muted",
    "--accent", "--accent-hover", "--accent-light", "--accent-rgb",
    "--danger", "--danger-rgb", "--green", "--overlay-strong", "--select-arrow", "--link",
  ]) {
    assert.ok(css.includes("var(" + token), "panel CSS must use theme token: " + token);
  }
  assert.ok(!html.includes("--hana-plugin-"), "legacy --hana-plugin-* tokens must be gone");
  assert.ok(!html.includes("--hana-surface"), "legacy --hana-surface token must be gone");
  assert.ok(!html.includes("--hana-button-bg"), "legacy --hana-button-bg token must be gone");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no hardcoded hex colors inside the stylesheet");
  assert.ok(!/rgba?\(\s*\d/.test(css), "no literal rgb()/rgba() colors outside theme variables");
  assert.ok(!/box-shadow|gradient|blur\(/.test(css), "flat design: no shadow/gradient/blur");
  assert.ok(css.includes("border-radius: 4px"), "KAMI corner radius is 4px");
  assert.ok(!/border-radius:\s*(6px|10px|16px|999px)/.test(css), "no non-KAMI corner radii");
  assert.ok(!/font-weight:\s*(600|700|800|900)/.test(css), "KAMI allows weights 400/500 only");
  assert.ok(css.includes("background: transparent"), "KAMI buttons are transparent with an accent outline");
  assert.ok(css.includes("border: 0.5px solid var(--border)"), "KAMI structure lines are 0.5px");
});

test("R35: panel CSS is responsive (wrap, shrink, narrow-width block, no fixed width)", async () => {
  const { handlers, c } = await loadWidget();
  const html = handlers["/widget"](c);
  assert.ok(html.includes("*, *::before, *::after { box-sizing: border-box; }"), "global border-box for pseudo elements");
  assert.ok(html.includes("flex-wrap: wrap"), "flex rows must be allowed to wrap");
  assert.ok(html.includes("max-width: 100%"), "selects/buttons must cap at 100%");
  assert.ok(html.includes("min-width: 0"), "flex and text containers must be shrinkable");
  assert.ok(
    html.includes("overflow-wrap: anywhere") || html.includes("text-overflow: ellipsis"),
    "long names/messages must wrap or ellipsize",
  );
  assert.ok(html.includes("@media (max-width: 340px)"), "narrow-width adjustment block must exist");
  assert.ok(!/(^|[;\s{])width:\s*\d{3,}px/.test(html), "no fixed 360px-style panel width may remain");
});
