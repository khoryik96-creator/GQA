"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runBrowserFlow } = require("./browser-flow.cjs");

test("unapproved target cannot reach Chromium or collect evidence", async () => {
  await assert.rejects(
    runBrowserFlow("http://unknown.example:8081",
      [{op:"navigate",path:"/"},{op:"assert_text",text:"hello"}],
      "http://fixture:8081"),
    /Invalid or unauthorized/
  );
});
