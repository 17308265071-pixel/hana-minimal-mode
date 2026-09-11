// Unit tests for registration-store: the registrations.json metadata layer that
// records which assistant is registered as the single target (sidebar panel,
// /minimal, conversation toggle), when and from where (R27/R34). Pure module:
// node:fs / node:path only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadRegistrations, saveRegistrations, registerAgent, unregisterAgent,
} from "../registration-store.js";

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hmm-reg-" + tag + "-"));
}

test("loadRegistrations defaults to an empty registration map", () => {
  const dir = tmpDir("load");
  try {
    assert.deepEqual(loadRegistrations(dir), { schemaVersion: 1, registrations: {} });
    fs.writeFileSync(path.join(dir, "registrations.json"), "{oops");
    assert.deepEqual(loadRegistrations(dir), { schemaVersion: 1, registrations: {} });
    fs.writeFileSync(path.join(dir, "registrations.json"), JSON.stringify([1, 2, 3]));
    assert.deepEqual(loadRegistrations(dir), { schemaVersion: 1, registrations: {} });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRegistrations tolerates bad records and normalizes fields", () => {
  const dir = tmpDir("tolerant");
  try {
    fs.writeFileSync(
      path.join(dir, "registrations.json"),
      JSON.stringify({
        schemaVersion: 1,
        registrations: {
          " hanako ": { registeredAt: 123, source: "page" },
          broken: "not-an-object",
          "": { registeredAt: 1, source: "x" },
          stale: { registeredAt: "nope" },
        },
      }),
    );
    assert.deepEqual(loadRegistrations(dir), {
      schemaVersion: 1,
      registrations: {
        hanako: { registeredAt: 123, source: "page" },
        stale: { registeredAt: 0, source: "unknown" },
      },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("register/unregister round-trip persists to registrations.json", () => {
  const dir = tmpDir("roundtrip");
  try {
    const afterRegister = registerAgent(dir, "hanako", "page");
    assert.deepEqual(Object.keys(afterRegister), ["hanako"]);
    assert.equal(afterRegister.hanako.source, "page");
    assert.equal(typeof afterRegister.hanako.registeredAt, "number");

    const file = path.join(dir, "registrations.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(raw.schemaVersion, 1);
    assert.equal(raw.registrations.hanako.source, "page");
    assert.deepEqual(loadRegistrations(dir).registrations, afterRegister);

    registerAgent(dir, "butler", "page");
    assert.deepEqual(Object.keys(loadRegistrations(dir).registrations), ["hanako", "butler"]);

    const afterUnregister = unregisterAgent(dir, "hanako");
    assert.deepEqual(Object.keys(afterUnregister), ["butler"]);
    assert.deepEqual(Object.keys(loadRegistrations(dir).registrations), ["butler"]);

    unregisterAgent(dir, "missing");
    assert.deepEqual(Object.keys(loadRegistrations(dir).registrations), ["butler"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("registerAgent refreshes registeredAt and preserves insertion order", async () => {
  const dir = tmpDir("refresh");
  try {
    registerAgent(dir, "hanako", "legacy");
    registerAgent(dir, "butler", "page");
    const before = loadRegistrations(dir).registrations.hanako.registeredAt;
    await new Promise((r) => setTimeout(r, 10));
    const after = registerAgent(dir, "hanako", "page");
    assert.ok(after.hanako.registeredAt > before, "re-register refreshes the timestamp");
    assert.equal(after.hanako.source, "page");
    assert.deepEqual(Object.keys(after), ["hanako", "butler"], "order is preserved");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveRegistrations is best-effort and reports failure instead of throwing", () => {
  assert.equal(saveRegistrations(null, { hanako: { registeredAt: 1, source: "page" } }), false);
  const dir = tmpDir("save");
  try {
    assert.equal(saveRegistrations(dir, { hanako: { registeredAt: 1, source: "page" } }), true);
    assert.equal(saveRegistrations(dir, "junk"), true, "junk input is normalized, not fatal");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
