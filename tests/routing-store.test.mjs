// Unit tests for routing-store: the routing.json persistence layer that owns
// the target-assistant list after it was removed from the native config
// schema (R26). Pure module: node:fs / node:path only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRouting, loadRouting, saveRouting, migrateRouting } from "../routing-store.js";

test("parseRouting falls back to the hanako default for missing/invalid input", () => {
  assert.deepEqual(parseRouting(null), { targetAgents: ["hanako"] });
  assert.deepEqual(parseRouting("not-json"), { targetAgents: ["hanako"] });
  assert.deepEqual(parseRouting({ schemaVersion: 1 }), { targetAgents: ["hanako"] });
  assert.deepEqual(parseRouting({ targetAgents: 42 }), { targetAgents: ["hanako"] });
});

test("parseRouting trims, dedupes, filters non-strings and accepts JSON text", () => {
  assert.deepEqual(
    parseRouting({ targetAgents: [" a ", "b", "a", 7, null, "", "b"] }),
    { targetAgents: ["a", "b"] },
  );
  assert.deepEqual(
    parseRouting('{"schemaVersion":1,"targetAgents":["hanako","butler"]}'),
    { targetAgents: ["hanako", "butler"] },
  );
  assert.deepEqual(
    parseRouting({ targetAgents: "hanako, butler ,hanako" }),
    { targetAgents: ["hanako", "butler"] },
  );
});

test("parseRouting preserves an explicitly empty target list", () => {
  assert.deepEqual(parseRouting({ schemaVersion: 1, targetAgents: [] }), { targetAgents: [] });
});

test("saveRouting writes pretty routing.json and loadRouting round-trips it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-routing-save-"));
  try {
    assert.equal(saveRouting(dir, ["hanako", " butler ", "hanako"]), true);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "routing.json"), "utf8"));
    assert.equal(raw.schemaVersion, 1);
    assert.deepEqual(raw.targetAgents, ["hanako", "butler"]);
    assert.ok(fs.readFileSync(path.join(dir, "routing.json"), "utf8").includes("\n"), "pretty JSON");
    assert.deepEqual(loadRouting(dir), { targetAgents: ["hanako", "butler"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRouting falls back to the hanako default when the file is missing or corrupt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-routing-load-"));
  try {
    assert.deepEqual(loadRouting(dir), { targetAgents: ["hanako"] });
    fs.writeFileSync(path.join(dir, "routing.json"), "{oops");
    assert.deepEqual(loadRouting(dir), { targetAgents: ["hanako"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveRouting is best-effort and reports failure instead of throwing", () => {
  assert.equal(saveRouting(null, ["hanako"]), false);
});

test("migrateRouting uses legacy string/array config values and reports migrated", () => {
  assert.deepEqual(
    migrateRouting({ configValue: "hanako, butler", routingExists: false }),
    { ids: ["hanako", "butler"], migrated: true },
  );
  assert.deepEqual(
    migrateRouting({ configValue: ["a", "a", " b "], routingExists: false }),
    { ids: ["a", "b"], migrated: true },
  );
});

test("migrateRouting starts empty when there is no legacy value (fresh install)", () => {
  assert.deepEqual(
    migrateRouting({ configValue: undefined, routingExists: false }),
    { ids: [], migrated: true },
  );
  assert.deepEqual(
    migrateRouting({ configValue: "", routingExists: false }),
    { ids: [], migrated: true },
  );
  assert.deepEqual(
    migrateRouting({ configValue: [], routingExists: false }),
    { ids: [], migrated: true },
  );
});

test("migrateRouting is a no-op when routing.json already exists", () => {
  assert.deepEqual(
    migrateRouting({ configValue: "hanako", routingExists: true }),
    { ids: [], migrated: false },
  );
});

test("migrateRouting drops deleted targets via isDeleted or agentsDir tombstones", () => {
  assert.deepEqual(
    migrateRouting({ configValue: "a,b", routingExists: false, isDeleted: (id) => id === "b" }),
    { ids: ["a"], migrated: true },
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-routing-migrate-"));
  try {
    fs.mkdirSync(path.join(dir, "ghost"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ghost", ".deleted-agent.json"), "{}");
    fs.mkdirSync(path.join(dir, "live"), { recursive: true });
    assert.deepEqual(
      migrateRouting({ configValue: "ghost,live,missing", routingExists: false, agentsDir: dir }),
      { ids: ["live", "missing"], migrated: true },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
