"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalOrigin, allowedTarget } = require("./policy.cjs");

test("only exact configured origin can run", () => {
 const list = "http://fixture:8081,https://staging.example.com";
 assert.equal(allowedTarget("http://fixture:8081", list), true);
 assert.equal(allowedTarget("http://fixture:8081/evil", list), false);
 assert.equal(allowedTarget("http://fixture:8081.evil.example", list), false);
 assert.equal(allowedTarget("https://other.example", list), false);
 assert.equal(allowedTarget("file:///etc/passwd", list), false);
 assert.equal(canonicalOrigin("https://staging.example.com"), "https://staging.example.com");
});
