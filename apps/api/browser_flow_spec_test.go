package main

import "testing"

func TestBrowserActionValidation(t *testing.T){
  good:=[]BrowserAction{{Op:"navigate",Path:"/"},{Op:"click_role",Role:"button",Name:"Show details"},
    {Op:"assert_text",Text:"Fixture details visible"}}
  if err:=validBrowserActions(good);err!=nil{t.Fatal(err)}
  cases:=[][]BrowserAction{
    {{Op:"navigate",Path:"/"}},
    {{Op:"navigate",Path:"//evil.example"},{Op:"assert_text",Text:"yes"}},
    {{Op:"navigate",Path:"/../admin"},{Op:"assert_text",Text:"yes"}},
    {{Op:"navigate",Path:"/"},{Op:"click_role",Role:"button",Name:"Delete"}},
    {{Op:"navigate",Path:"/"},{Op:"fill_label",Label:"Password",Value:"secret"},{Op:"assert_text",Text:"yes"}},
    {{Op:"navigate",Path:"/"},{Op:"eval",Text:"evil"},{Op:"assert_text",Text:"yes"}},
  }
  for i,tc:=range cases{if err:=validBrowserActions(tc);err==nil{t.Errorf("unsafe example %d was accepted",i)}}
}

func TestFixtureFallbackIsExplicitAndHasAssertion(t *testing.T){
  draft:=ruleBasedBrowserDraft(BrowserFlowContext{Prompt:"Open details and verify email preview"})
  if draft.GenerationMode!="rules"||len(draft.Steps)<4{t.Fatalf("missing actions: %#v",draft)}
  if err:=validBrowserActions(draft.Steps);err!=nil{t.Fatal(err)}
  if draft.Warning==""{t.Fatal("offline fallback needs disclosure")}
  if browserFlowDigest(draft.Steps)==""{t.Fatal("flow digest missing")}
}
