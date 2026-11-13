"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {allowedTarget}=require("./policy.cjs");
const {validateFlow}=require("./browser-flow.cjs");

test("container-only input contract retains strict fixture and typed step gates",()=>{
 const fixtures="http://fixture:8081,http://fixture-renamed:8081";
 assert.equal(allowedTarget("http://fixture:8081",fixtures),true);
 for(const bad of ["http://db:5432","http://api:8080","http://127.0.0.1:8080",
   "https://example.com","http://fixture:8081@evil.example"]) {
  assert.equal(allowedTarget(bad,fixtures),false,bad);
 }
 assert.equal(validateFlow([
  {op:"navigate",path:"/"},{op:"click_role",role:"button",name:"Show details"},
  {op:"assert_text",text:"Fixture details visible"}]),true);
});
