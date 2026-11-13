package main

import (
 "testing"
 "context"
 "encoding/json"
 "net/http"
 "net/http/httptest"
)

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

func TestModelBrowserFlowProvider(t *testing.T){
  server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
    if r.Header.Get("Authorization")!="Bearer test-key"{t.Errorf("missing authorization")}
    raw:=`{"objective":"Check the fixture","steps":[{"op":"navigate","path":"/"},{"op":"assert_visible_role","role":"heading","name":"GQA Read-Only Smoke Target"}]}`
    encoded,_:=json.Marshal(raw)
    w.Header().Set("Content-Type","application/json")
    w.Write([]byte(`{"choices":[{"message":{"content":`+string(encoded)+`}}]}`))
  }))
  defer server.Close()
  p:=planningProvider{URL:server.URL,Model:"mock",Key:"test-key",Client:server.Client()}
  result,err:=p.proposeBrowserFlow(context.Background(),BrowserFlowContext{Prompt:"Verify homepage"})
  if err!=nil{t.Fatal(err)}
  if result.GenerationMode!="model"||len(result.Steps)!=2{t.Fatalf("bad model draft: %#v",result)}
}

func TestFlowRequiresPostconditionAfterFinalAction(t *testing.T){
  flow:=[]BrowserAction{{Op:"navigate",Path:"/"},{Op:"assert_text",Text:"Home"},
    {Op:"click_role",Role:"button",Name:"Show details"}}
  if validBrowserActions(flow)==nil{t.Fatal("click without subsequent assertion accepted")}
  flow=append(flow,BrowserAction{Op:"assert_text",Text:"Details shown"})
  if err:=validBrowserActions(flow);err!=nil{t.Fatal(err)}
}
