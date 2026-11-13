package main

import (
  "bytes"
  "context"
  "crypto/subtle"
  "encoding/base64"
  "encoding/json"
  "errors"
  "fmt"
  "net/http"
  "net/url"
  "os"
  "path/filepath"
  "strings"
  "time"

  "github.com/jackc/pgx/v5"
)

type SmokeCheck struct{
  Repair *RepairHint `json:"repair,omitempty"`
  Name string `json:"name"`
  Status string `json:"status"`
  DurationMS int64 `json:"duration_ms"`
  Detail string `json:"detail"`
}
type TestRun struct{
  ID string `json:"id"`
  ProjectID string `json:"project_id"`
  PlanID string `json:"plan_id"`
  FlowID string `json:"flow_id,omitempty"`
  ExecutionKind string `json:"execution_kind"`
  TargetURL string `json:"target_url"`
  Status string `json:"status"`
  Checks []SmokeCheck `json:"checks"`
  Evidence RunEvidence `json:"evidence"`
  ScreenshotAvailable bool `json:"screenshot_available"`
  StartedAt time.Time `json:"started_at"`
  FinishedAt *time.Time `json:"finished_at"`
}

type workerReply struct {
  Checks []SmokeCheck `json:"checks"`
  Evidence RunEvidence `json:"evidence"`
  ScreenshotBase64 string `json:"screenshot_base64"`
}

func canonicalTarget(raw string)(string,error) {
  raw=strings.TrimSpace(raw)
  u,err:=url.Parse(raw)
  if err!=nil || u.Hostname()=="" || (u.Scheme!="http" && u.Scheme!="https") || u.User!=nil ||
    u.RawQuery!="" || u.Fragment!="" || (u.Path!="" && u.Path!="/") {
    return "", errors.New("Test target must be an HTTP(S) origin without path, query or credentials")
  }
  return strings.TrimSuffix(u.String(),"/"),nil
}

func allowedSmokeTarget(target string,configured string)bool{
  candidate,err:=canonicalTarget(target)
  if err!=nil{return false}
  for _,allowed:=range strings.Split(configured,","){
    approved,parseErr:=canonicalTarget(allowed)
    if parseErr==nil && subtle.ConstantTimeCompare([]byte(candidate),[]byte(approved))==1{return true}
  }
  return false
}

func (s *server) runs(w http.ResponseWriter,r *http.Request){
  id,ok:=validProjectID(w,r);if !ok{return}
  if r.Method==http.MethodGet {
    limit,cursor,paged,pageErr:=parseHistoryPageRequest(r)
    if pageErr!=nil{fail(w,400,pageErr.Error());return}
    const selectRuns=`
      SELECT id::text,project_id::text,plan_id::text,target_url,status,checks,started_at,finished_at,
      screenshot_available,COALESCE(flow_id::text,''),execution_kind,evidence
      FROM test_runs WHERE project_id=$1::uuid`
    var rows pgx.Rows
    var err error
    if paged{
      rows,err=s.db.Query(r.Context(),selectRuns+
        " AND ($2::timestamptz IS NULL OR (started_at,id)<($2::timestamptz,$3::uuid)) ORDER BY started_at DESC,id DESC LIMIT $4",
        id,historyCursorTime(cursor),historyCursorID(cursor),limit+1)
    }else{
      rows,err=s.db.Query(r.Context(),selectRuns+
        " ORDER BY started_at DESC,id DESC LIMIT 30",id)
    }
    if err!=nil{fail(w,500,"Unable to retrieve runs");return}
    defer rows.Close()
    runs:=[]TestRun{}
    for rows.Next(){
      var run TestRun
      var raw, evidenceJSON []byte
      if err:=rows.Scan(&run.ID,&run.ProjectID,&run.PlanID,&run.TargetURL,&run.Status,&raw,&run.StartedAt,&run.FinishedAt,&run.ScreenshotAvailable,&run.FlowID,&run.ExecutionKind,&evidenceJSON);err!=nil{
        fail(w,500,"Unable to read runs");return
      }
      if err:=json.Unmarshal(raw,&run.Checks);err!=nil{fail(w,500,"Invalid run checks");return}
      if err:=json.Unmarshal(evidenceJSON,&run.Evidence);err!=nil{fail(w,500,"Invalid run diagnostics");return}
      runs=append(runs,run)
    }
    if rows.Err()!=nil{fail(w,500,"Unable to read runs");return}
    if paged{
      nextCursor:=""
      if len(runs)>limit{
        runs=runs[:limit]
        last:=runs[len(runs)-1]
        nextCursor=historyNextCursor(last.StartedAt,last.ID)
      }
      writeJSON(w,200,listPage[TestRun]{Items:runs,NextCursor:nextCursor})
    }else{writeJSON(w,200,runs)}
    return
  }

  var input struct{
    PlanID string `json:"plan_id"`
    TargetURL string `json:"target_url"`
  }
  if !parseJSON(w,r,&input){return}
  if !uuidRE.MatchString(input.PlanID){fail(w,400,"Invalid plan ID");return}
  target:=strings.TrimSpace(input.TargetURL)
  if target==""{target="http://fixture:8081"}
  allowlist:=os.Getenv("GQA_SMOKE_TARGETS")
  if allowlist==""{allowlist="http://fixture:8081"}
  if !allowedSmokeTarget(target,allowlist){
    fail(w,403,"Target is not an approved smoke-test origin. Configure GQA_SMOKE_TARGETS on both API and runner.")
    return
  }
  var approval bool
  var environment string
  var agentData []byte
  err:=s.db.QueryRow(r.Context(),`
    SELECT p.approval_required,q.environment,p.selected_agents
    FROM plans p JOIN qa_requests q ON q.id=p.request_id
    WHERE p.id=$1::uuid AND p.project_id=$2::uuid`,input.PlanID,id).Scan(&approval,&environment,&agentData)
  if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Plan not found for project");return}
  if err!=nil{fail(w,500,"Unable to retrieve plan permissions");return}
  if approval || environment=="production"{
    fail(w,403,"Plan requires approval; production/high-impact test execution is disabled in this MVP")
    return
  }
  var agents []AgentSelection
  if err:=json.Unmarshal(agentData,&agents);err!=nil{fail(w,500,"Invalid plan agents");return}
  runAPI,runWeb:=false,false
  for _,a:=range agents{
    if a.ID=="api"{runAPI=true}
    if a.ID=="web"{runWeb=true}
  }
  if !runAPI && !runWeb{fail(w,400,"Plan has no supported smoke agents (API or Web QA)");return}

  var run TestRun
  run.ProjectID=id;run.PlanID=input.PlanID;run.TargetURL=target
  actor,_:=currentAccount(r)
  err=s.db.QueryRow(r.Context(),`
    INSERT INTO test_runs(project_id,plan_id,target_url,status,initiated_by)
    VALUES ($1::uuid,$2::uuid,$3,'running',$4::uuid) RETURNING id::text,started_at`,id,input.PlanID,target,actor.ID).Scan(&run.ID,&run.StartedAt)
  if err!=nil{fail(w,500,"Unable to initialize run");return}
  run.Status="running"
  run.ExecutionKind="smoke"

  body,_:=json.Marshal(map[string]any{"target_url":target,"run_api":runAPI,"run_web":runWeb})
  runnerURL:=os.Getenv("GQA_RUNNER_URL")
  if runnerURL==""{runnerURL="http://runner:8090/run"}
  ctx,cancel:=context.WithTimeout(context.Background(),75*time.Second)
  defer cancel()
  req,err:=http.NewRequestWithContext(ctx,http.MethodPost,runnerURL,bytes.NewReader(body))
  if err!=nil{fail(w,500,"Unable to initialize runner request");return}
  req.Header.Set("Content-Type","application/json")
  req.Header.Set("X-GQA-Runner-Token",os.Getenv("GQA_RUNNER_TOKEN"))
  resp,err:=(&http.Client{Timeout:70*time.Second,CheckRedirect:func(*http.Request,[]*http.Request)error{return http.ErrUseLastResponse}}).Do(req)
  reply:=workerReply{Checks:[]SmokeCheck{}}
  if err==nil{
    defer resp.Body.Close()
    if resp.StatusCode==http.StatusOK{
      reply,err=decodeWorkerReply(resp.Body)
    }else{err=fmt.Errorf("runner returned HTTP %d",resp.StatusCode)}
  }
  if err!=nil {
     reply=recordedRunnerFailure("Runner availability")
   }else if !validatedSmokeChecks(reply.Checks,runAPI,runWeb){
     reply=invalidEvidence()
   }
   run.Checks=reply.Checks
  if len(run.Checks)==0{run.Checks=[]SmokeCheck{{Name:"Runner evidence",Status:"failed",Detail:"Runner produced no checks"}}}
  run.Status="passed"
  for _,check:=range run.Checks{if check.Status!="passed"{run.Status="failed";break}}
  run.Evidence=cleanRunEvidence(reply.Evidence,run.Status)

  if reply.ScreenshotBase64!="" && len(reply.ScreenshotBase64)<1500000{
    if raw,err:=base64.StdEncoding.DecodeString(reply.ScreenshotBase64);err==nil && len(raw)>8 &&
      bytes.Equal(raw[:8],[]byte{0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a}) {
      evidenceDir:=os.Getenv("GQA_EVIDENCE_DIR")
      if evidenceDir==""{evidenceDir="/evidence"}
      if os.MkdirAll(evidenceDir,0700)==nil{
        if os.WriteFile(filepath.Join(evidenceDir,run.ID+".png"),raw,0600)==nil{
          run.ScreenshotAvailable=true
        }
      }
    }
  }
  resultJSON,_:=json.Marshal(run.Checks)
  evidenceJSON,_:=json.Marshal(run.Evidence)
  finalCtx,finishCancel:=context.WithTimeout(context.Background(),10*time.Second)
   defer finishCancel()
   err=s.db.QueryRow(finalCtx,`
     UPDATE test_runs SET checks=$2::jsonb,status=$3,screenshot_available=$4,
    evidence=$5::jsonb,finished_at=now() WHERE id=$1::uuid RETURNING finished_at`,
    run.ID,string(resultJSON),run.Status,run.ScreenshotAvailable,string(evidenceJSON)).Scan(&run.FinishedAt)
  if err!=nil{fail(w,500,"Run completed but could not save results");return}
  writeJSON(w,201,run)
}

func (s *server) screenshot(w http.ResponseWriter,r *http.Request){
  id:=r.PathValue("id")
  if !uuidRE.MatchString(id){fail(w,400,"Invalid run ID");return}
  var exists bool
  err:=s.db.QueryRow(r.Context(),"SELECT screenshot_available FROM test_runs WHERE id=$1::uuid",id).Scan(&exists)
  if err!=nil || !exists{fail(w,404,"Screenshot not found");return}
  evidenceDir:=os.Getenv("GQA_EVIDENCE_DIR")
  if evidenceDir==""{evidenceDir="/evidence"}
  w.Header().Set("Cache-Control","no-store")
  http.ServeFile(w,r,filepath.Join(evidenceDir,id+".png"))
}

var _ = pgx.ErrNoRows
