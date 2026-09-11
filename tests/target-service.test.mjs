// R33/R34 single-target service tests: getTarget tolerant reads; setTarget
// always leaves exactly one target in BOTH files (or none); reregisterTarget
// refreshes registeredAt only; collapseToSingle keeps the newest registeredAt
// and drops the rest.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTarget, setTarget, reregisterTarget, collapseToSingle } from "../target-service.js";

function env(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-target-" + tag + "-"));
  const dataDir = path.join(tmp, "plugins", "hana-minimal-mode");
  const agentsDir = path.join(tmp, "agents");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  return { tmp, dataDir, agentsDir };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function routingIds(dataDir) {
  return readJson(path.join(dataDir, "routing.json")).targetAgents;
}

function registrations(dataDir) {
  return readJson(path.join(dataDir, "registrations.json")).registrations;
}

test("getTarget: registrations single record wins, then routing fallback, else none", () => {
  const { tmp, dataDir } = env("get");
  try {
    assert.equal(getTarget(dataDir), "", "an empty dataDir must not resurrect the hanako default");

    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["qiushi"] });
    assert.equal(getTarget(dataDir), "qiushi", "routing fallback when registrations is empty");

    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: { butler: { registeredAt: 1, source: "page" } },
    });
    assert.equal(getTarget(dataDir), "butler", "a single registration wins over routing");

    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        butler: { registeredAt: 1, source: "page" },
        qiushi: { registeredAt: 2, source: "page" },
      },
    });
    assert.equal(getTarget(dataDir), "qiushi", "multi registrations fall back to a single routing target");

    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["butler", "qiushi"] });
    assert.equal(getTarget(dataDir), "", "more than one target reads as none");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setTarget from empty writes one target into BOTH files", () => {
  const { tmp, dataDir } = env("set");
  try {
    const result = setTarget(dataDir, "butler", { source: "command" });
    assert.deepEqual(result.previous, []);
    assert.deepEqual(result.next, ["butler"]);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(routingIds(dataDir), ["butler"]);
    const regs = registrations(dataDir);
    assert.deepEqual(Object.keys(regs), ["butler"]);
    assert.equal(regs.butler.source, "command");
    assert.equal(typeof regs.butler.registeredAt, "number");
    assert.equal(getTarget(dataDir), "butler");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setTarget switch removes the previous target from BOTH files", () => {
  const { tmp, dataDir } = env("switch");
  try {
    setTarget(dataDir, "butler", { source: "page" });
    const result = setTarget(dataDir, "qiushi", { source: "settings" });
    assert.deepEqual(result.previous, ["butler"]);
    assert.deepEqual(result.next, ["qiushi"]);
    assert.deepEqual(result.removed, ["butler"]);
    assert.deepEqual(routingIds(dataDir), ["qiushi"]);
    assert.deepEqual(Object.keys(registrations(dataDir)), ["qiushi"]);
    assert.equal(registrations(dataDir).qiushi.source, "settings");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setTarget clear empties BOTH files", () => {
  const { tmp, dataDir } = env("clear");
  try {
    setTarget(dataDir, "butler", { source: "page" });
    const result = setTarget(dataDir, "", { source: "command" });
    assert.deepEqual(result.next, []);
    assert.deepEqual(result.removed, ["butler"]);
    assert.deepEqual(routingIds(dataDir), []);
    assert.deepEqual(registrations(dataDir), {});
    assert.equal(getTarget(dataDir), "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("collapseToSingle keeps the newest registeredAt and removes the other from BOTH files", () => {
  const { tmp, dataDir } = env("collapse");
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["hahaka", "hanako"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        hahaka: { registeredAt: 111, source: "page" },
        hanako: { registeredAt: 222, source: "settings" },
      },
    });

    const result = collapseToSingle(dataDir);

    assert.equal(result.kept, "hanako");
    assert.deepEqual(result.removed, ["hahaka"]);
    assert.deepEqual(routingIds(dataDir), ["hanako"]);
    const regs = registrations(dataDir);
    assert.deepEqual(Object.keys(regs), ["hanako"]);
    assert.equal(regs.hanako.registeredAt, 222, "kept metadata (registeredAt) is preserved");
    assert.equal(regs.hanako.source, "settings", "kept metadata (source) is preserved");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("collapseToSingle tie-breaks on a live agent, then routing order", () => {
  const { tmp, dataDir, agentsDir } = env("tie");
  try {
    fs.mkdirSync(path.join(agentsDir, "qiushi"), { recursive: true });
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["butler", "qiushi"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        butler: { registeredAt: 100, source: "page" },
        qiushi: { registeredAt: 100, source: "page" },
      },
    });

    const result = collapseToSingle(dataDir);

    assert.equal(result.kept, "qiushi", "a live agent wins a registeredAt tie");
    assert.deepEqual(result.removed, ["butler"]);
    assert.deepEqual(routingIds(dataDir), ["qiushi"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("collapseToSingle drops stale metadata-only ids and keeps the runtime target", () => {
  const { tmp, dataDir } = env("stale");
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["hanako"] });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: {
        ghost: { registeredAt: 9999, source: "page" },
        hanako: { registeredAt: 1, source: "page" },
      },
    });

    const result = collapseToSingle(dataDir);

    assert.equal(result.kept, "hanako", "a metadata-only id must not become the runtime target");
    assert.deepEqual(result.removed, ["ghost"]);
    assert.deepEqual(routingIds(dataDir), ["hanako"]);
    assert.deepEqual(registrations(dataDir), { hanako: { registeredAt: 1, source: "page" } });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("reregisterTarget refreshes registeredAt in place and reports no-target", () => {
  const { tmp, dataDir } = env("reregister");
  try {
    assert.deepEqual(reregisterTarget(dataDir), { ok: false }, "no target: nothing to refresh");
    assert.equal(fs.existsSync(path.join(dataDir, "registrations.json")), false, "a refused call must not create the file");

    setTarget(dataDir, "butler", { source: "command" });
    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: { butler: { registeredAt: 1, source: "command" } },
    });
    const before = registrations(dataDir).butler;
    const result = reregisterTarget(dataDir, "panel");
    assert.equal(result.ok, true);
    assert.equal(result.registrations.butler.source, "panel", "the passed source wins");
    assert.ok(result.registrations.butler.registeredAt > before.registeredAt, "registeredAt must advance");
    assert.deepEqual(routingIds(dataDir), ["butler"], "routing.json must be untouched");
    assert.deepEqual(registrations(dataDir).butler, result.registrations.butler);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("collapseToSingle repairs a single inconsistent pair without dropping the target", () => {
  const { tmp, dataDir } = env("repair");
  try {
    writeJson(path.join(dataDir, "routing.json"), { schemaVersion: 1, targetAgents: ["qiushi"] });
    const result = collapseToSingle(dataDir);
    assert.equal(result.kept, "qiushi");
    assert.deepEqual(result.removed, []);
    assert.deepEqual(Object.keys(registrations(dataDir)), ["qiushi"]);
    assert.equal(registrations(dataDir).qiushi.source, "legacy", "missing registrations file materializes as legacy");

    writeJson(path.join(dataDir, "registrations.json"), {
      schemaVersion: 1,
      registrations: { qiushi: { registeredAt: 5, source: "page" } },
    });
    const again = collapseToSingle(dataDir);
    assert.equal(again.kept, "qiushi");
    assert.equal(registrations(dataDir).qiushi.registeredAt, 5, "consistent state is not rewritten");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
