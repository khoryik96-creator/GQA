"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { safeName, similarity, suggestFromCandidates } = require("./repair-hints.cjs");

const click = {op:"click_role",role:"button",name:"Show details"};
test("suggests uniquely matching visible control without changing assertion", () => {
 const suggestion = suggestFromCandidates(click, ["Reveal details", "Preview email"], 2);
 assert.ok(suggestion);
 assert.equal(suggestion.proposed_name,"Reveal details");
 assert.equal(suggestion.original_name,"Show details");
 assert.equal(suggestion.step_index,2);
 assert.equal(suggestion.basis,"visible_accessible_name");
 assert.ok(suggestion.confidence >= 0.4);
});
test("never suggests for assertions, missing controls, secrets or ambiguity", () => {
 assert.equal(suggestFromCandidates({op:"assert_text",text:"Checkout complete"},["Checkout failed"],1),null);
 assert.equal(suggestFromCandidates(click,[],1),null);
 assert.equal(suggestFromCandidates(click,["Password reset token"],1),null);
 assert.equal(suggestFromCandidates(click,["Show details 1","Show details 2"],1),null);
 assert.equal(safeName("token: abc"),false);
 assert.ok(similarity("Show details","Reveal details") > 0.4);
});
