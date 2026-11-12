package main

import (
 "testing"
 "strings"
)

func TestGitHubRepoParts(t *testing.T){
 cases:=[]struct{input string;ok bool}{
   {"https://github.com/acme/worker",true},
   {"https://github.com/acme/worker.git",true},
   {"https://github.com/acme/worker/tree/main",false},
   {"https://github.com.evil.test/acme/worker",false},
   {"http://github.com/acme/worker",false},
   {"https://github.com/acme/worker?token=secret",false},
 }
 for _,tc:=range cases{
   _,_,err:=githubRepoParts(tc.input)
   if (err==nil)!=tc.ok{t.Errorf("unexpected validity %q: %v",tc.input,err)}
 }
}

func TestDetectRepo(t *testing.T){
 tech,tests:=detectRepo([]string{"go.mod","apps/web/package.json","apps/web/tsconfig.json","apps/web/tests/login.spec.ts",".github/workflows/ci.yml"})
 if len(tech)<2 || len(tests)<2{t.Errorf("missing evidence: %v %v",tech,tests)}
 if !strings.Contains(strings.Join(tests,","),"Existing automated test files"){t.Fatal("test detection missing")}
}

func TestMemoryCanInfluenceRoutingWithoutBypassingProduction(t *testing.T){
 snapshot:=RepoSnapshot{Technologies:[]string{"TypeScript"}}
 mem:=[]MemoryReference{{Kind:"requirement",Content:"Critical API authentication is required"}}
 stack,prompt:=enrichedPlanningContext("React","Test user journeys",snapshot,mem)
 d:=selectAgents("web",stack,prompt,"production")
 if !containsAgent(d,"api") || !d.ApprovalRequired {
   t.Fatalf("context should add API QA without bypassing production policy: %#v",d)
 }
}
