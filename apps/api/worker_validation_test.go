package main
import "testing"

func TestCannotPassWithMissingWorkerChecks(t *testing.T){
 wanted:=expectedSmokeChecks(true,true)
 partial:=workerReply{Checks:[]SmokeCheck{{Name:wanted[0],Status:"passed"}}}
 got:=verifiedWorkerReply(partial,wanted)
 if got.Checks[0].Status!="failed"||got.Evidence.FailureKind!="invalid_worker_result"{
  t.Fatalf("partial green worker evidence accepted: %+v",got)
 }
 good:=workerReply{Checks:[]SmokeCheck{
  {Name:wanted[0],Status:"passed"},{Name:wanted[1],Status:"passed"}}}
 if got:=verifiedWorkerReply(good,wanted);len(got.Checks)!=2{t.Fatal("valid worker result rejected")}
 failed:=workerReply{Checks:[]SmokeCheck{{Name:wanted[0],Status:"failed"}}}
 if got:=verifiedWorkerReply(failed,wanted);got.Checks[0].Name!=wanted[0]{t.Fatal("early failure rejected")}
}
func TestFlowCheckIdentityVerification(t *testing.T){
 steps:=[]BrowserAction{{Op:"navigate",Path:"/"},{Op:"assert_text",Text:"Hello"}}
 want:=expectedFlowChecks(steps)
 wrong:=workerReply{Checks:[]SmokeCheck{{Name:"Completely different",Status:"passed"},
  {Name:want[1],Status:"passed"}}}
 if got:=verifiedWorkerReply(wrong,want);got.Checks[0].Status!="failed"{t.Fatal("spoofed check identities accepted")}
}
