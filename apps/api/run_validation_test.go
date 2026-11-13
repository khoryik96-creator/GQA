package main
import "testing"
func TestSmokeEvidenceRejectsPartialSuccess(t *testing.T){
 complete:=[]SmokeCheck{{Name:"API GET /healthz",Status:"passed"},
  {Name:"Browser homepage smoke",Status:"passed"}}
 if !validatedSmokeChecks(complete,true,true){t.Fatal("complete checks rejected")}
 for _,list:=range [][]SmokeCheck{
  complete[:1],
  {{Name:"Browser homepage smoke",Status:"passed"}},
  {{Name:"API GET /healthz",Status:"passed"},{Name:"Incorrect",Status:"passed"}},
  {{Name:"API GET /healthz",Status:"passed"},{Name:"Browser homepage smoke",Status:"skipped"}},
 }{
  if validatedSmokeChecks(list,true,true){t.Fatalf("invalid checks accepted: %+v",list)}
 }
}
func TestFlowEvidenceValidatesStepSequence(t *testing.T){
 steps:=[]BrowserAction{{Op:"navigate",Path:"/"},{Op:"click_role",Role:"button",Name:"Show details"},
  {Op:"assert_text",Text:"Details shown"}}
 full:=[]SmokeCheck{
  {Name:browserStepLabel(0,steps[0]),Status:"passed"},
  {Name:browserStepLabel(1,steps[1]),Status:"passed"},
  {Name:browserStepLabel(2,steps[2]),Status:"passed"}}
 if !validatedFlowChecks(full,steps){t.Fatal("complete flow rejected")}
 if validatedFlowChecks(full[:2],steps){t.Fatal("incomplete assertion accepted")}
 failed:=append([]SmokeCheck(nil),full[:2]...)
 failed[1].Status="failed"
 if !validatedFlowChecks(failed,steps){t.Fatal("early failure rejected")}
 if validatedFlowChecks(append(failed,full[2]),steps){t.Fatal("checks continued after failure")}
}
