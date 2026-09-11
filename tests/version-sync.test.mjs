// Version-sync guard: the cache-busting version literal must stay in lockstep
// with the manifest, and shipped plugin files must use versioned dynamic
// imports for internals instead of statically linked relative imports (which
// Node caches per process and which caused the in-place upgrade link error).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../manifest.json" with { type: "json" };

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", "tests"]);

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectJsFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const pluginFiles = collectJsFiles(pluginRoot);

test("versioned internals: MODULE_VERSION matches manifest and no static relative imports", () => {
  const versionRe = /const MODULE_VERSION = "([^"]+)"/g;
  const staticImportRe = /^\s*import\s[^;]*?from\s+["']\.\.?\//m;
  let declarations = 0;
  for (const file of pluginFiles) {
    const src = fs.readFileSync(file, "utf8");
    for (const match of src.matchAll(versionRe)) {
      declarations += 1;
      assert.equal(
        match[1],
        manifest.version,
        path.relative(pluginRoot, file) + " MODULE_VERSION must equal manifest.version",
      );
    }
    const staticImport = src.match(staticImportRe);
    assert.equal(
      staticImport,
      null,
      path.relative(pluginRoot, file) + " must not statically import a relative module: " + (staticImport?.[0] || ""),
    );
  }
  assert.ok(declarations > 0, "expected at least one MODULE_VERSION declaration");
});
