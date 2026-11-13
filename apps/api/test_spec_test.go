package main

import (
 "context"
 "net/http"
 "net/http/httptest"
 "encoding/json"
 "testing"
)

func sampleInput()PlannerInput{
  return PlannerInput{
    Prompt:"Test login and API validation",Environment:"staging",Application:"fullstack",Stack:"Go, React",
    Agents:[]AgentSelection{
      {ID:"repo-intelligence",Name:"Repo",Reason:"context"},
      {ID:"web",Name:"Web QA",Reason:"login"},
      {ID:"api",Name:"API QA",Reason:"contracts"},
    },
    Memories:[]MemoryReference{{ID:"3dca5f31-ea31-4f89-a0a5-3be5175aa211",Kind:"requirement",Content:"Login must reject expired sessions",Source:"user"}},
    Repository:RepoSnapshot{Repository:"example/demo",DefaultBranch:"main",Technologies:[]string{"Go"}},
  }
}

func TestRulesPlannerPreservesMemoryAndProvenance(t *testing.T){
 input:=sampleInput()
 doc:=heuristicSpecification(input)
 if doc.GenerationMode!="rules"||!doc.ReviewRequired||len(doc.Scenarios)!=2{
  t.Fatalf("unexpected rules plan %#v",doc)
 }
 for _,s:=range doc.Scenarios{
   if s.EvidenceStatus!="proposed"||len(s.Steps)==0||len(s.ExpectedResults)==0||
     len(s.RelatedMemoryIDs)!=1||s.RelatedMemoryIDs[0]!=input.Memories[0].ID{
      t.Fatalf("invalid scenario %#v",s)
   }
 }
 if doc.ContextDigest==""{t.Fatal("context digest missing")}
}

func TestRejectsUnselectedAgentAndInventedMemory(t *testing.T){
 input:=sampleInput()
 plan:=heuristicSpecification(input)
 plan.Scenarios[0].AgentID="security"
 if err:=validateModelSpecification(&plan,input);err==nil{t.Fatal("unselected agent should be rejected")}
 plan=heuristicSpecification(input)
 plan.Scenarios[0].RelatedMemoryIDs=[]string{"invented"}
 if err:=validateModelSpecification(&plan,input);err==nil{t.Fatal("invented memory source should be rejected")}
}

func TestValidateModelOverwritesUntrustedLabels(t *testing.T){
 input:=sampleInput()
 plan:=heuristicSpecification(input)
 plan.Scenarios[0].EvidenceStatus="passed"
 plan.GenerationMode="verified"
 plan.ReviewRequired=false
 if err:=validateModelSpecification(&plan,input);err!=nil{t.Fatal(err)}
 if !plan.ReviewRequired||plan.GenerationMode!="model"||plan.Scenarios[0].EvidenceStatus!="proposed"{
  t.Fatalf("model is not allowed to forge results: %#v",plan)
 }
}

func TestModelProviderJSONAndModelFailure(t *testing.T){
 input:=sampleInput()
 doc:=heuristicSpecification(input)
 doc.Strategy="Review user login and API behavior"
 doc.Version="";doc.GenerationMode="";doc.ContextDigest="";doc.Notices=nil
 doc.ReviewRequired=false
 for i:=range doc.Scenarios{doc.Scenarios[i].ID="spoofed";doc.Scenarios[i].EvidenceStatus="passed"}
 raw:=`{"strategy":"Review user login and API behavior","scenarios":[{"agent_id":"api","title":"Reject invalid session","priority":"P0","objective":"Validate login sessions","preconditions":[],"steps":["Use a test session","Request a documented protected API"],"expected_results":["Expired sessions are rejected"],"required_inputs":["Documented API endpoint"],"related_memory_ids":["3dca5f31-ea31-4f89-a0a5-3be5175aa211"]}],"missing_inputs":["Need API endpoint"]}`
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.Header.Get("Authorization")!="Bearer test-key"{t.Error("missing provider authorization")}
  w.Header().Set("Content-Type","application/json")
  encoded, _ := json.Marshal(raw)
  w.Write([]byte(`{"choices":[{"message":{"content":`+string(encoded)+`}}]}`))
 }))
 defer server.Close()
 provider:=planningProvider{URL:server.URL,Key:"test-key",Model:"mock",Client:server.Client()}
 result,err:=provider.generate(context.Background(),input)
 if err!=nil{t.Fatal(err)}
 if result.GenerationMode!="model"||!result.ReviewRequired||result.Scenarios[0].EvidenceStatus!="proposed"{t.Fatalf("incorrect model handling: %#v",result)}
 bad:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
   w.WriteHeader(503);w.Write([]byte("unavailable"))
 }))
 defer bad.Close()
 provider.URL=bad.URL
 if _,err:=provider.generate(context.Background(),input);err==nil{t.Fatal("503 should be an error")}
}
