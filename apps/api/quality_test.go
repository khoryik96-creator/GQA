package main

import (
 "testing"
 "time"
 "reflect"
)

const qPlan="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const qFlow="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
func qualityRun(id,kind,target,status string,offset int,checks ...SmokeCheck) QualityRun{
 return QualityRun{
  ID:id,PlanID:qPlan,FlowID:qFlow,Kind:kind,Target:target,
  Status:status,Checks:checks,StartedAt:time.Date(2026,11,13,0,0,0,0,time.UTC).Add(time.Duration(offset)*time.Minute),
 }
}
func ck(name,status string)SmokeCheck{return SmokeCheck{Name:name,Status:status,Detail:"redacted for quality"}}
func TestRegressionIdentityAndTransitions(t *testing.T){
 runs:=[]QualityRun{
  qualityRun("new","browser_flow","http://fixture:8081","failed",3,ck("show button","failed"),ck("visible text","passed")),
  qualityRun("middle","browser_flow","http://fixture:8081","passed",2,ck("show button","passed"),ck("visible text","passed")),
  qualityRun("old","browser_flow","http://fixture:8081","passed",1,ck("show button","passed"),ck("visible text","passed")),
 }
 got:=summarizeQuality(runs,200)
 if got.Scenarios!=1||got.Regressions!=1||got.Failing!=1{t.Fatalf("unexpected: %+v",got)}
 c:=got.Cases[0]
 if c.Transition!="regression" || c.PreviousRunID!="middle" || c.LatestRunID!="new"{
  t.Fatalf("bad comparison %+v",c)
 }
 if !reflect.DeepEqual(c.NewlyFailingChecks,[]string{"show button"}){t.Fatalf("delta %+v",c.NewlyFailingChecks)}
 if c.UnstablePattern{t.Fatal("one result switch is not a flaky pattern")}
}
func TestQualityIsolationBetweenDifferentFlowsAndTargets(t *testing.T){
 a:=qualityRun("first","browser_flow","http://fixture:8081","passed",1,ck("ok","passed"))
 b:=qualityRun("second","browser_flow","http://fixture-renamed:8081","failed",2,ck("ok","failed"))
 c:=qualityRun("third","browser_flow","http://fixture:8081","failed",3,ck("ok","failed"))
 c.FlowID="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
 got:=summarizeQuality([]QualityRun{c,b,a},200)
 if got.Scenarios!=3 || got.Regressions!=0{
  t.Fatalf("unrelated flow/target results mixed: %+v",got)
 }
}
func TestQualityRecoversAndTracksChangedChecks(t *testing.T){
 old:=qualityRun("old","smoke","http://fixture:8081","failed",1,ck("B","failed"),ck("A","failed"))
 newrun:=qualityRun("new","smoke","http://fixture:8081","passed",2,ck("A","passed"),ck("B","passed"))
 got:=summarizeQuality([]QualityRun{newrun,old},200).Cases[0]
 if got.Transition!="recovered" || !reflect.DeepEqual(got.RecoveredChecks,[]string{"A","B"}) {
  t.Fatalf("recovery not detected %+v",got)
 }
}
func TestQualityRecentOutcomeSwitchingIsNotDeclaredFlakiness(t *testing.T){
 records:=[]QualityRun{
  qualityRun("4","smoke","http://fixture:8081","passed",4),
  qualityRun("3","smoke","http://fixture:8081","failed",3),
  qualityRun("2","smoke","http://fixture:8081","passed",2),
  qualityRun("1","smoke","http://fixture:8081","failed",1),
 }
 c:=summarizeQuality(records,200).Cases[0]
 if c.OutcomeSwitches!=3 || !c.UnstablePattern || c.Transition!="recovered"{
  t.Fatalf("unexpected switching pattern %+v",c)
 }
}
func TestQualityIgnoresRunningAndLimitsSamples(t *testing.T){
 recent:=qualityRun("done","smoke","http://fixture:8081","passed",4)
 running:=qualityRun("running","smoke","http://fixture:8081","running",5)
 old:=qualityRun("old","smoke","http://fixture:8081","failed",3)
 got:=summarizeQuality([]QualityRun{running,recent,old},2)
 if !got.Truncated||got.SampleRuns!=2||got.Scenarios!=1||got.Cases[0].Transition!="first_pass"{
  t.Fatalf("window incorrectly reported %+v",got)
 }
}
func TestQualityNoData(t *testing.T){
 got:=summarizeQuality(nil,200)
 if got.SampleRuns!=0 || got.Scenarios!=0 || got.Truncated || got.Cases==nil || got.Daily==nil{
  t.Fatalf("empty quality view invalid %+v",got)
 }
}

func TestInfrastructureFailureExcludedFromProductRegressions(t *testing.T){
 valid:=qualityRun("1","smoke","http://fixture:8081","passed",1,ck("API GET /healthz","passed"))
 brokenWorker:=qualityRun("2","smoke","http://fixture:8081","failed",2,ck("Runner availability","failed"))
 brokenWorker.Evidence=RunEvidence{FailureKind:"runner_unavailable"}
 got:=summarizeQuality([]QualityRun{brokenWorker,valid},200)
 if got.Regressions!=0||got.ExcludedInfrastructure!=1||
  got.Scenarios!=1||got.Cases[0].Status!="passed"{
  t.Fatalf("Infrastructure outage misclassified as application regression: %+v",got)
 }
}
