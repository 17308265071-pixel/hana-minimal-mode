// Upgrade regression: simulates HanaAgent's freshImport() behavior when a
// plugin version is replaced in place while the host process is running.
//
// freshImport(entry) cache-busts only the entry file (`index.js?t=...`), but
// that entry's nested relative specifiers keep their plain URL and are cached
// per process by Node's ESM loader. Without versioned internal imports, the
// freshly imported index.js links against the OLD cached state.js and throws
// "does not provide an export named 'defaultConfig'".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

test("in-place upgrade: fresh entry links against the replaced internals", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-upgrade-"));
  try {
    // 1. Fake installed OLD version: state.js lacking defaultConfig.
    fs.writeFileSync(path.join(tmp, "state.js"), "export const setState = () => {};\n");
    fs.writeFileSync(
      path.join(tmp, "index.js"),
      'import { setState } from "./state.js";\nexport default class OldPlugin {}\n',
    );
    const oldMod = await import(pathToFileURL(path.join(tmp, "index.js")).href + "?t=old" + Date.now());
    assert.equal(typeof oldMod.default, "function");

    // 2. Drag-install the REAL plugin over the old version (index.js/state.js
    //    overwritten in place; the host process keeps the old state.js cached).
    fs.cpSync(pluginRoot, tmp, { recursive: true, force: true });

    // 3. freshImport the replaced entry with a new cache-busting query.
    const mod = await import(pathToFileURL(path.join(tmp, "index.js")).href + "?t=new" + Date.now());

    // With versioned internal imports this resolves; without them it throws
    // the module link error from the bug report.
    assert.equal(typeof mod.default, "function");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
