import test from "node:test";
import assert from "node:assert/strict";
import { isNetworkCommand, extractCommandFromToolInput } from "../network-guard.js";

test("isNetworkCommand heuristic", () => {
  assert.equal(isNetworkCommand("curl https://example.com"), true);
  assert.equal(isNetworkCommand("git status"), false);
});

test("extractCommandFromToolInput", () => {
  assert.equal(extractCommandFromToolInput({ cmd: "ls -la" }), "ls -la");
  assert.equal(extractCommandFromToolInput({ args: { command: "pwd" } }), "pwd");
});
