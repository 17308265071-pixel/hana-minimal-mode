import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDeliveryCheck } from "../tools/delivery-check.js";
import * as phaseBegin from "../tools/phase-begin.js";
import * as phaseAdvance from "../tools/phase-advance.js";
import * as toolsCatalog from "../tools/tools-catalog.js";
import * as toolsHelp from "../tools/tools-help.js";
import * as routerStatus from "../tools/router-status.js";
import * as requestTools from "../tools/request-tools.js";
import * as personaReconcile from "../tools/persona-reconcile.js";

test("deliveryCheck: missing file fails", () => {
  const r = runDeliveryCheck("", null, null);
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.name === "file-exists" && !c.pass));
});

test("deliveryCheck: evidence gate", () => {
  const file = fileURLToPath(new URL("./fixtures/hello.txt", import.meta.url));
  const r = runDeliveryCheck(file, null, { items: [] });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.name === "delivery-evidence" && !c.pass));
});

test("deliveryCheck: url without reviewed visual evidence fails", () => {
  const file = fileURLToPath(new URL("./fixtures/hello.txt", import.meta.url));
  const r = runDeliveryCheck(file, "https://example.com/page", { items: [{ label: "code", kind: "file", target: file }] });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.name === "delivery-evidence" && !c.pass && c.detail.includes("reviewed visual")));
});

test("deliveryCheck: url with reviewed image evidence passes", () => {
  const file = fileURLToPath(new URL("./fixtures/hello.txt", import.meta.url));
  const r = runDeliveryCheck(file, "https://example.com/page", { items: [{ label: "shot", kind: "image", target: file, reviewed: true }] });
  assert.equal(r.ok, true);
});

test("all meta tools export valid shapes", async () => {
  for (const t of [phaseBegin, phaseAdvance, toolsCatalog, toolsHelp, routerStatus, requestTools, personaReconcile]) {
    assert.equal(typeof t.name, "string");
    assert.ok(t.name.length > 0);
    assert.equal(typeof t.description, "string");
    assert.equal(typeof t.execute, "function");
    assert.ok(t.parameters?.type === "object");
  }
});

test("routerStatus: object model context shows provider/id and family", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-router-status-"));
  const out = await routerStatus.execute({}, {
    model: { provider: "deepseek", id: "deepseek-v4-pro" },
    dataDir: dir,
    sessionPath: "C:/x/agents/hanako/sessions/s.jsonl",
  });
  assert.ok(out.includes("deepseek/deepseek-v4-pro"));
  assert.ok(out.includes("(pro-family)"));
});

test("routerStatus: string model context shows id and family", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-router-status-"));
  const out = await routerStatus.execute({}, {
    model: "deepseek-v4-flash",
    dataDir: dir,
    sessionPath: "C:/x/agents/hanako/sessions/s.jsonl",
  });
  assert.ok(out.includes("deepseek-v4-flash"));
  assert.ok(out.includes("(flash-family)"));
});

test("routerStatus: missing model falls back to unknown", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-router-status-"));
  const out = await routerStatus.execute({}, {
    dataDir: dir,
    sessionPath: "C:/x/agents/hanako/sessions/s.jsonl",
  });
  assert.ok(out.includes("unknown"));
});