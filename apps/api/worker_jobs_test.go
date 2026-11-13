package main
import "testing"

func TestBrokerManagementIsStrictlyOptIn(t *testing.T){
 t.Setenv("GQA_JOB_MANAGEMENT_ENABLED","")
 t.Setenv("GQA_RUNNER_URL","http://host.docker.internal:18090/run")
 if _,ok:=brokerJobURL("/jobs");ok{t.Fatal("Unenabled broker access was allowed")}
 t.Setenv("GQA_JOB_MANAGEMENT_ENABLED","true")
 for _,raw:=range []string{
  "http://runner:8090/run",
  "http://evil.example:18090/run",
  "http://host.docker.internal:18090/flow",
  "http://host.docker.internal:18090/run?redirect=1",
  "https://host.docker.internal:18090/run",
 }{
  t.Setenv("GQA_RUNNER_URL",raw)
  if _,ok:=brokerJobURL("/jobs");ok{t.Errorf("Accepted unsafe broker endpoint %s",raw)}
 }
 t.Setenv("GQA_RUNNER_URL","http://host.docker.internal:18090/run")
 expected,ok:=brokerJobURL("/jobs")
 if !ok || expected!="http://host.docker.internal:18090/jobs"{t.Fatal("Valid broker not accepted")}
 if _,ok:=brokerJobURL("/api/admin");ok{t.Fatal("Wrong route prefix accepted")}
}
