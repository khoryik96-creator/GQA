package main

import "testing"

func TestEvidenceSanitization(t *testing.T) {
 invalid:=RunEvidence{JobID:"something",WorkerLifecycle:"container_vm",
  FailureKind:"untrusted_pass",LastPath:"/customer?token=secret",
  ConsoleErrors:-5,PageExceptions:5000}
 result:=cleanRunEvidence(invalid,"failed")
 if result.JobID!=""||result.WorkerLifecycle!="unverified"||
    result.FailureKind!="unknown"||result.LastPath!=""||
    result.ConsoleErrors!=0||result.PageExceptions!=999{
   t.Fatalf("unsafe evidence not sanitized: %#v",result)
 }
 i:=2
 valid:=cleanRunEvidence(RunEvidence{JobID:"632d90ca-d098-48c2-89a2-1993860d706e",
   WorkerLifecycle:"single_job_process",FailureKind:"locator_rename_candidate",
   FailedStepIndex:&i,LastPath:"/checkout",ConsoleErrors:1},"failed")
 if valid.FailureKind!="locator_rename_candidate"||*valid.FailedStepIndex!=2||valid.LastPath!="/checkout" {
  t.Fatalf("valid diagnostic not retained: %#v",valid)
 }
 passed:=cleanRunEvidence(valid,"passed")
 if passed.FailureKind!="none"||passed.FailedStepIndex!=nil{t.Fatal("passing result kept a failure classification")}
}

func TestEphemeralContainerEvidence(t *testing.T) {
 e:=cleanRunEvidence(RunEvidence{
  JobID:"632d90ca-d098-48c2-89a2-1993860d706e",
  WorkerLifecycle:"ephemeral_container",FailureKind:"none",
 },"passed")
 if e.WorkerLifecycle!="ephemeral_container" || e.FailureKind!="none"{
  t.Fatalf("Container evidence lost: %#v",e)
 }
}
