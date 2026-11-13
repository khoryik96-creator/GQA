package main

import (
  "bytes"
  "context"
  "crypto/subtle"
  "encoding/base64"
  "encoding/json"
  "errors"
  "fmt"
  "io"
  "net/http"
  "os"
  "path/filepath"
  "strings"
  "time"

  "github.com/jackc/pgx/v5"
)

type BrowserFlow struct {
  ID             string          `json:"id"`
  ProjectID      string          `json:"project_id"`
  PlanID         string          `json:"plan_id"`
  Prompt         string          `json:"prompt"`
  Objective      string          `json:"objective"`
  Steps          []BrowserAction `json:"steps"`
  Digest         string          `json:"digest"`
  GenerationMode string          `json:"generation_mode"`
  Warning        string          `json:"warning"`
  RepairSourceFlowID string      `json:"repaired_from_flow_id,omitempty"`
  RepairSourceRunID string       `json:"repaired_from_run_id,omitempty"`
  RepairTarget string            `json:"repair_target,omitempty"`
  CreatedAt      time.Time       `json:"created_at"`
}

func (s *server) browserFlows(w http.ResponseWriter,r *http.Request){
  projectID,ok:=validProjectID(w,r)
  if !ok{return}
  if r.Method==http.MethodGet{
    rows,err:=s.db.Query(r.Context(),`
      SELECT id::text,project_id::text,plan_id::text,prompt,objective,steps,digest,generation_mode,warning,
        COALESCE(repaired_from_flow_id::text,''),COALESCE(repaired_from_run_id::text,''),repair_target,created_at
      FROM browser_flows WHERE project_id=$1::uuid ORDER BY created_at DESC LIMIT 30`,projectID)
    if err!=nil{fail(w,500,"Unable to list browser flows");return}
    defer rows.Close()
    flows:=[]BrowserFlow{}
    for rows.Next(){
      var flow BrowserFlow
      var stepsJSON []byte
      if err:=rows.Scan(&flow.ID,&flow.ProjectID,&flow.PlanID,&flow.Prompt,
          &flow.Objective,&stepsJSON,&flow.Digest,&flow.GenerationMode,&flow.Warning,
          &flow.RepairSourceFlowID,&flow.RepairSourceRunID,&flow.RepairTarget,&flow.CreatedAt);err!=nil{
        fail(w,500,"Unable to read browser flow");return
      }
      if err:=json.Unmarshal(stepsJSON,&flow.Steps);err!=nil{fail(w,500,"Invalid saved browser flow");return}
      flows=append(flows,flow)
    }
    if rows.Err()!=nil{fail(w,500,"Unable to read browser flows");return}
    writeJSON(w,200,flows)
    return
  }

  var input struct{
    PlanID string `json:"plan_id"`
    Prompt string `json:"prompt"`
  }
  if !parseJSON(w,r,&input){return}
  input.Prompt=strings.TrimSpace(input.Prompt)
  if !uuidRE.MatchString(input.PlanID) || len(input.Prompt)<10 || len(input.Prompt)>2000{
    fail(w,400,"Provide a valid plan ID and a 10-2000 character browser request");return
  }
  var agentJSON,memoryJSON,repoJSON []byte
  err:=s.db.QueryRow(r.Context(),`
    SELECT p.selected_agents,p.consulted_memories,p.repo_context
    FROM plans p WHERE p.id=$1::uuid AND p.project_id=$2::uuid`,
    input.PlanID,projectID).Scan(&agentJSON,&memoryJSON,&repoJSON)
  if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Plan not found in this project");return}
  if err!=nil{fail(w,500,"Unable to read QA plan");return}
  var agents []AgentSelection
  var memories []MemoryReference
  var repository RepoSnapshot
  if json.Unmarshal(agentJSON,&agents)!=nil || json.Unmarshal(memoryJSON,&memories)!=nil ||
    json.Unmarshal(repoJSON,&repository)!=nil{
    fail(w,500,"Saved plan context is invalid");return
  }
  hasWeb:=false
  for _,a:=range agents{if a.ID=="web"{hasWeb=true;break}}
  if !hasWeb{fail(w,400,"Choose a QA plan that selects the Web QA agent");return}

  draft:=generateBrowserDraft(r.Context(),BrowserFlowContext{
    Prompt:input.Prompt,Repository:repository,Memories:memories,
  })
  if err:=validBrowserActions(draft.Steps);err!=nil{
    fail(w,500,"Browser draft did not pass action policy");return
  }
  stepsJSON,_:=json.Marshal(draft.Steps)
  flow:=BrowserFlow{
    ProjectID:projectID,PlanID:input.PlanID,Prompt:input.Prompt,
    Objective:draft.Objective,Steps:draft.Steps,Digest:browserFlowDigest(draft.Steps),
    GenerationMode:draft.GenerationMode,Warning:draft.Warning,
  }
  err=s.db.QueryRow(r.Context(),`
    INSERT INTO browser_flows(project_id,plan_id,prompt,objective,steps,digest,generation_mode,warning)
    VALUES ($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7,$8)
    RETURNING id::text,created_at`,
    projectID,flow.PlanID,flow.Prompt,flow.Objective,string(stepsJSON),flow.Digest,
    flow.GenerationMode,flow.Warning).Scan(&flow.ID,&flow.CreatedAt)
  if err!=nil{fail(w,500,"Unable to save browser flow");return}
  writeJSON(w,201,flow)
}

func persistFlowEvidence(ctx context.Context,db *server,run *TestRun,reply workerReply)error{
  run.Checks=reply.Checks
  if len(run.Checks)==0{
    run.Checks=[]SmokeCheck{{Name:"Browser runner evidence",Status:"failed",Detail:"No check evidence returned"}}
  }
  run.Status="passed"
  for _,check:=range run.Checks{if check.Status!="passed"{run.Status="failed";break}}
  run.Evidence=cleanRunEvidence(reply.Evidence,run.Status)
  if reply.ScreenshotBase64!=""&&len(reply.ScreenshotBase64)<1500000{
    if raw,err:=base64.StdEncoding.DecodeString(reply.ScreenshotBase64);err==nil&&len(raw)>8&&
      bytes.Equal(raw[:8],[]byte{0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a}){
      dir:=os.Getenv("GQA_EVIDENCE_DIR")
      if dir==""{dir="/evidence"}
      if os.MkdirAll(dir,0700)==nil&&os.WriteFile(filepath.Join(dir,run.ID+".png"),raw,0600)==nil{
        run.ScreenshotAvailable=true
      }
    }
  }
  raw,_:=json.Marshal(run.Checks)
  diagnostics,_:=json.Marshal(run.Evidence)
  return db.db.QueryRow(ctx,`
    UPDATE test_runs SET checks=$2::jsonb,status=$3,screenshot_available=$4,
    evidence=$5::jsonb,finished_at=now()
    WHERE id=$1::uuid RETURNING finished_at`,
    run.ID,string(raw),run.Status,run.ScreenshotAvailable,string(diagnostics)).Scan(&run.FinishedAt)
}

func (s *server) executeBrowserFlow(w http.ResponseWriter,r *http.Request){
  projectID,ok:=validProjectID(w,r)
  if !ok{return}
  flowID:=r.PathValue("flowId")
  if !uuidRE.MatchString(flowID){fail(w,400,"Invalid browser flow ID");return}
  var input struct {
    TargetURL string `json:"target_url"`
    AcknowledgedDigest string `json:"acknowledged_digest"`
  }
  if !parseJSON(w,r,&input){return}
  if input.TargetURL==""{input.TargetURL="http://fixture:8081"}
  allowed:=os.Getenv("GQA_SMOKE_TARGETS")
  if allowed==""{allowed="http://fixture:8081"}
  if !allowedSmokeTarget(input.TargetURL,allowed){
    fail(w,403,"Browser execution target is not in the approved allowlist");return
  }
  canonicalInput,_:=canonicalTarget(input.TargetURL)
  input.TargetURL=canonicalInput
  var flow BrowserFlow
  var stepsRaw,agentRaw []byte
  var approval bool
  var environment string
  err:=s.db.QueryRow(r.Context(),`
    SELECT f.plan_id::text,f.steps,f.digest,p.approval_required,q.environment,p.selected_agents,f.repair_target
    FROM browser_flows f JOIN plans p ON p.id=f.plan_id
    JOIN qa_requests q ON q.id=p.request_id
    WHERE f.id=$1::uuid AND f.project_id=$2::uuid`,
    flowID,projectID).Scan(&flow.PlanID,&stepsRaw,&flow.Digest,&approval,&environment,&agentRaw,&flow.RepairTarget)
  if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Browser flow not found");return}
  if err!=nil{fail(w,500,"Unable to load browser flow");return}
  if approval || environment=="production"{
    fail(w,403,"Production/high-impact plans cannot execute browser actions");return
  }
  if flow.RepairTarget!="" {
    originalTarget,err:=canonicalTarget(flow.RepairTarget)
    if err!=nil || originalTarget!=input.TargetURL {
      fail(w,403,"Repaired flows can only be replayed against the originally failing test target");return
    }
  }
  if len(input.AcknowledgedDigest)!=64 ||
    subtle.ConstantTimeCompare([]byte(input.AcknowledgedDigest),[]byte(flow.Digest))!=1{
    fail(w,403,"Review the current browser steps and acknowledge their exact digest");return
  }
  if err:=json.Unmarshal(stepsRaw,&flow.Steps);err!=nil{fail(w,500,"Invalid stored flow");return}
  if err:=validBrowserActions(flow.Steps);err!=nil||
    browserFlowDigest(flow.Steps)!=flow.Digest{
    fail(w,403,"Stored flow failed validation or its review digest changed");return
  }
  var agents []AgentSelection
  if json.Unmarshal(agentRaw,&agents)!=nil{fail(w,500,"Invalid saved plan agents");return}
  hasWeb:=false
  for _,agent:=range agents{if agent.ID=="web"{hasWeb=true;break}}
  if !hasWeb{fail(w,403,"Web QA agent not selected for this plan");return}

  run:=TestRun{ProjectID:projectID,PlanID:flow.PlanID,TargetURL:input.TargetURL,
    FlowID:flowID,ExecutionKind:"browser_flow",Status:"running"}
  err=s.db.QueryRow(r.Context(),`
    INSERT INTO test_runs(project_id,plan_id,target_url,status,flow_id,execution_kind)
    VALUES ($1::uuid,$2::uuid,$3,'running',$4::uuid,'browser_flow')
    RETURNING id::text,started_at`,
    projectID,flow.PlanID,input.TargetURL,flowID).Scan(&run.ID,&run.StartedAt)
  if err!=nil{fail(w,500,"Unable to initialize browser run");return}

  body,_:=json.Marshal(map[string]any{"target_url":input.TargetURL,"steps":flow.Steps})
  endpoint:=os.Getenv("GQA_RUNNER_FLOW_URL")
  if endpoint==""{endpoint="http://runner:8090/flow"}
  ctx,cancel:=context.WithTimeout(context.WithoutCancel(r.Context()),60*time.Second)
  defer cancel()
  reply:=workerReply{Checks:[]SmokeCheck{}}
  req,err:=http.NewRequestWithContext(ctx,http.MethodPost,endpoint,bytes.NewReader(body))
  if err==nil{
    req.Header.Set("Content-Type","application/json")
    req.Header.Set("X-GQA-Runner-Token",os.Getenv("GQA_RUNNER_TOKEN"))
    var resp *http.Response
    resp,err=(&http.Client{Timeout:60*time.Second}).Do(req)
    if err==nil{
      defer resp.Body.Close()
      if resp.StatusCode==200{
        err=json.NewDecoder(io.LimitReader(resp.Body,2<<20)).Decode(&reply)
      }else{
        err=fmt.Errorf("browser runner HTTP %d",resp.StatusCode)
      }
    }
  }
  if err!=nil{
    reply=workerReply{Checks:[]SmokeCheck{{
      Name:"Browser runner availability",Status:"failed",
      Detail:"Runner was unavailable or returned unusable evidence",
    }}}
  }
  reply=verifiedWorkerReply(reply,expectedFlowChecks(flow.Steps))
  persistCtx,persistCancel:=context.WithTimeout(context.Background(),10*time.Second)
  defer persistCancel()
  if err:=persistFlowEvidence(persistCtx,s,&run,reply);err!=nil{
    fail(w,500,"Browser run finished but results could not be saved");return
  }
  writeJSON(w,201,run)
}
