"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { safePath, validateFlow } = require("./browser-flow.cjs");
const valid = [
  { op: "navigate", path: "/" },
  { op: "click_role", role: "button", name: "Show details" },
  { op: "assert_text", text: "Fixture details visible" }
];
test("accepts bounded, assertive browser actions", () => {
  assert.equal(validateFlow(valid), true);
  assert.equal(validateFlow([
    { op: "navigate", path: "/test" },
    { op: "fill_label", label: "Email", value: "qa@example.test" },
    { op: "assert_visible_role", role: "heading", name: "Finished" }
  ]), true);
});
test("rejects arbitrary or sensitive actions", () => {
  assert.equal(validateFlow([{ op: "navigate", path: "/" }]), false);
  assert.equal(validateFlow([...valid, { op: "eval", text: "process.exit(0)" }]), false);
  assert.equal(validateFlow([...valid, { op: "click_role", role: "heading", name: "Something" }]), false);
  assert.equal(validateFlow([...valid, { op: "fill_label", label: "Password", value: "secret" }]), false);
  assert.equal(validateFlow([{ op: "assert_text", text: "ok" }, ...valid]), false);
  assert.equal(validateFlow(Array(9).fill({ op: "navigate", path: "/" })), false);
  assert.equal(validateFlow([...valid, { op: "click_role", role: "button", name: "Yes", script: "evil" }]), false);
});
test("rejects dangerous paths", () => {
  for (const path of ["//evil.example", "/../admin", "/?token=secret", "/\\evil",
      "https://example.com", "/#fragment", "/a/../b"]) {
    assert.equal(safePath(path), false, path);
  }
  assert.equal(safePath("/"), true);
  assert.equal(safePath("/docs"), true);
});
