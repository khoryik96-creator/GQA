package main

import "fmt"

// A green result requires every expected check in its approved sequence.
// A terminal failure may stop the flow early, but a prefix of green checks
// can never be mistaken for a completed successful test.
func verifiedWorkerReply(reply workerReply, expected []string) workerReply {
 invalid:=len(reply.Checks)==0||len(reply.Checks)>20||len(reply.Checks)>len(expected)
 allPassed:=!invalid
 for i,c:=range reply.Checks{
  if c.Status!="passed" && c.Status!="failed"{invalid=true}
  if c.Status!="passed"{allPassed=false}
  if len(c.Name)==0||len(c.Name)>120||len(c.Detail)>400{invalid=true}
  if i>=len(expected)||c.Name!=expected[i]{invalid=true}
 }
 if allPassed&&len(reply.Checks)!=len(expected){invalid=true}
 if len(reply.Checks)>0 && len(reply.Checks)<len(expected) &&
   reply.Checks[len(reply.Checks)-1].Status!="failed"{invalid=true}
 if invalid{
  return workerReply{Checks:[]SmokeCheck{{Name:"Worker evidence completeness",
    Status:"failed",Detail:"Worker returned incomplete or incompatible test evidence"}},
    Evidence:RunEvidence{FailureKind:"invalid_worker_result"}}
 }
 return reply
}
func expectedSmokeChecks(api,web bool)[]string{
 result:=[]string{}
 if api{result=append(result,"API GET /healthz")}
 if web{result=append(result,"Browser homepage smoke")}
 return result
}
func expectedFlowChecks(steps []BrowserAction)[]string{
 names:=map[string]string{"navigate":"Navigate","click_role":"Click accessible element",
  "fill_label":"Fill labeled field","assert_text":"Assert visible text",
  "assert_visible_role":"Assert accessible role","assert_url_path":"Assert URL path"}
 result:=[]string{}
 for i,step:=range steps{
  result=append(result,fmt.Sprintf("Browser step %d: %s",i+1,names[step.Op]))
 }
 return result
}
