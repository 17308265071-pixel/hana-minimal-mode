import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapAgentEntries, scanAgentsDir, pruneDeletedTargets } from "../agent-catalog.js";

test("mapAgentEntries filters invalid/deleted entries, dedupes and falls back to id", () => {
  const out = mapAgentEntries([
    null,
    undefined,
    { name: "no id" },
    { id: "", name: "empty id" },
    { id: "hanako", name: "Hanako" },
    { id: "hanako", name: "Hanako Duplicate" },
    { id: "ghost", name: "Ghost", deleted: true },
    { id: "zombie", name: "Zombie", deletedAt: "2026-01-01" },
    { id: "butler" },
  ]);
  assert.deepEqual(out.map((a) => a.id), ["hanako", "butler"]);
  assert.equal(out[0].name, "Hanako");
  assert.equal(out[1].name, "butler");
});

test("mapAgentEntries sorts primary agents first with stable order", () => {
  const out = mapAgentEntries([
    { id: "a", name: "A" },
    { id: "b", name: "B", isPrimary: true },
    { id: "c", name: "C" },
    { id: "d", name: "D", isPrimary: true },
  ]);
  assert.deepEqual(out.map((x) => x.id), ["b", "d", "a", "c"]);
  assert.deepEqual(out.map((x) => x.isPrimary), [true, true, false, false]);
});

test("scanAgentsDir lists live dirs with yaml names and filters tombstones", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-agents-"));
  try {
    fs.mkdirSync(path.join(tmp, "hanako"));
    fs.writeFileSync(path.join(tmp, "hanako", "config.yaml"), 'agent:\n  name: "Hanako"\n  model: gpt\n');
    fs.mkdirSync(path.join(tmp, "butler"));
    fs.writeFileSync(path.join(tmp, "butler", "config.yaml"), "agent:\n  model: gpt\n");
    fs.mkdirSync(path.join(tmp, "ghost"));
    fs.writeFileSync(path.join(tmp, "ghost", "config.yaml"), "agent:\n  name: Ghost\n");
    fs.writeFileSync(path.join(tmp, "ghost", ".deleted-agent.json"), "{}");
    fs.mkdirSync(path.join(tmp, ".hidden"));

    const out = scanAgentsDir(tmp);
    const byId = Object.fromEntries(out.map((a) => [a.id, a]));
    assert.deepEqual(Object.keys(byId).sort(), ["butler", "hanako"]);
    assert.equal(byId.hanako.name, "Hanako");
    assert.equal(byId.butler.name, "butler");
    assert.equal(byId.hanako.isPrimary, false);
    assert.deepEqual(scanAgentsDir(path.join(tmp, "does-not-exist")), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pruneDeletedTargets keeps live/missing dirs and removes tombstoned ones", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-prune-"));
  try {
    fs.mkdirSync(path.join(tmp, "hanako"));
    fs.mkdirSync(path.join(tmp, "ghost"));
    fs.writeFileSync(path.join(tmp, "ghost", ".deleted-agent.json"), "{}");

    const result = pruneDeletedTargets(["hanako", "ghost", "missing-agent"], tmp);
    assert.deepEqual(result.kept, ["hanako", "missing-agent"]);
    assert.deepEqual(result.removed, ["ghost"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
