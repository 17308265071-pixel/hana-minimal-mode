import test from "node:test";
import assert from "node:assert/strict";

test("esm baseline", () => {
  assert.equal(typeof import.meta.url, "string");
});
