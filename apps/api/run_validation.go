package main

import (
 "fmt"
 "io"
 "bytes"
 "encoding/json"
 "errors"
)

// The execution worker is not trusted to declare success unless its result
// covers every check requested by the reviewable test specification.
func validatedSmokeChecks(checks []SmokeCheck, api,web bool)bool {
 expected:=[]string{}
 if api{expected=append(expected,"API GET /healthz")}
 if web{expected=append(expected,"Browser homepage smoke")}
 if len(checks)!=len(expected){return false}
 for i,c:=range checks {
  if c.Name!=expected[i]||!isOneOf(c.Status,"passed","failed")||
   len(c.Detail)>400||c.DurationMS<0{return false}
 }
 return true
}
func browserStepLabel(i int,step BrowserAction)string {
 labels:=map[string]string{
  "navigate":"Navigate","click_role":"Click accessible element",
  "fill_label":"Fill labeled field","assert_text":"Assert visible text",
  "assert_visible_role":"Assert accessible role","assert_url_path":"Assert URL path",
 }
 return fmt.Sprintf("Browser step %d: %s",i+1,labels[step.Op])
}
func validatedFlowChecks(checks []SmokeCheck,steps []BrowserAction)bool {
 if len(checks)==1&&checks[0].Name=="Browser runner initialization"&&checks[0].Status=="failed"{return true}
 if len(checks)==0||len(checks)>len(steps){return false}
 for i,c:=range checks{
  if c.Name!=browserStepLabel(i,steps[i])||!isOneOf(c.Status,"passed","failed")||
   len(c.Detail)>400||c.DurationMS<0{return false}
  if c.Status=="failed"&&i!=len(checks)-1{return false}
 }
 return checks[len(checks)-1].Status=="failed"||len(checks)==len(steps)
}
func invalidEvidence()workerReply{
 return workerReply{
  Checks:[]SmokeCheck{{Name:"Runner evidence validation",Status:"failed",
   Detail:"Worker result does not match the approved test specification"}},
  Evidence:RunEvidence{FailureKind:"invalid_worker_result"},
 }
}
func recordedRunnerFailure(name string)workerReply{
 return workerReply{Checks:[]SmokeCheck{{Name:name,Status:"failed",
   Detail:"Runner unavailable or returned unusable evidence"}},
   Evidence:RunEvidence{FailureKind:"runner_unavailable"}}
}

const maxWorkerReplyBytes=2<<20
// A worker may fail or be corrupted. Reject oversized, unknown, or trailing
// data instead of accepting the first syntactically valid JSON object.
func decodeWorkerReply(body io.Reader)(workerReply,error){
 var result workerReply
 raw,err:=io.ReadAll(io.LimitReader(body,maxWorkerReplyBytes+1))
 if err!=nil{return result,err}
 if len(raw)>maxWorkerReplyBytes{
  return result,errors.New("worker response exceeded quota")
 }
 dec:=json.NewDecoder(bytes.NewReader(raw))
 dec.DisallowUnknownFields()
 if err:=dec.Decode(&result);err!=nil{return workerReply{},err}
 var trailing any
 if err:=dec.Decode(&trailing);err!=io.EOF{
  return workerReply{},errors.New("worker response contains trailing or invalid content")
 }
 return result,nil
}
