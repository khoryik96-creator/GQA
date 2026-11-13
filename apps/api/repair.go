package main

import (
 "encoding/json"
 "errors"
 "fmt"
 "net/http"
 "reflect"
 "regexp"
 "strings"
 "time"

 "github.com/jackc/pgx/v5"
)

type RepairHint struct {
 StepIndex int `json:"step_index"`
 Op string `json:"op"`
 Role string `json:"role"`
 OriginalName string `json:"original_name"`
 ProposedName string `json:"proposed_name"`
 Confidence float64 `json:"confidence"`
 Basis string `json:"basis"`
 Note string `json:"note"`
}

type RepairReview struct {
 RepairedFlowID string `json:"repaired_flow_id"`
 RepairedFromFlowID string `json:"repaired_from_flow_id"`
 OriginalFailureRunID string `json:"original_failure_run_id"`
 TargetURL string `json:"target_url"`
 OldName string `json:"old_name"`
 NewName string `json:"new_name"`
 AppRevision string `json:"app_revision"`
 MemoryID string `json:"memory_id"`
 AcceptedAt time.Time `json:"accepted_at"`
}

var appRevisionRE=regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$`)

func repairFromEvidence(original []BrowserAction, checks []SmokeCheck)([]BrowserAction,RepairHint,error) {
 if err:=validBrowserActions(original);err!=nil{return nil,RepairHint{},err}
 for index,check:=range checks {
  if check.Status!="failed" || check.Repair==nil {continue}
  h:=*check.Repair
  if index!=h.StepIndex || index>=len(original) || h.StepIndex<0 ||
    h.Op!="click_role" || h.Basis!="visible_accessible_name" ||
    h.Confidence<0.4 || h.Confidence>1 ||
    len(h.ProposedName)<2||len(h.ProposedName)>120 ||
    strings.ContainsAny(h.ProposedName,"\r\n") ||
    containsSensitiveLabel(h.ProposedName) {
    return nil,RepairHint{},errors.New("Repair hint is invalid or untrusted")
  }
  action:=original[index]
  if action.Op!=h.Op || action.Role!=h.Role || action.Name!=h.OriginalName ||
    h.ProposedName==h.OriginalName {
    return nil,RepairHint{},errors.New("Repair hint conflicts with original action")
  }
  revised:=append([]BrowserAction(nil),original...)
  revised[index].Name=h.ProposedName
  if err:=validBrowserActions(revised);err!=nil{return nil,RepairHint{},err}
  if !preservesAssertions(original,revised,index) {
    return nil,RepairHint{},errors.New("Repair changed an assertion or unrelated step")
  }
  return revised,h,nil
 }
 return nil,RepairHint{},errors.New("No safe locator repair suggestion in this failure")
}

func preservesAssertions(original,revised []BrowserAction,index int)bool {
 if len(original)!=len(revised)||index<0||index>=len(original){return false}
 for i:=range original {
  if i!=index && !reflect.DeepEqual(original[i],revised[i]) {return false}
 }
 before,after:=original[index],revised[index]
 return before.Op=="click_role" && after.Op=="click_role" &&
   before.Role==after.Role && before.Path==after.Path &&
   before.Label==after.Label && before.Value==after.Value &&
   before.Text==after.Text && before.Name!=after.Name
}

func (s *server) proposeRepair(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r);if !ok{return}
 flowID:=r.PathValue("flowId")
 if !uuidRE.MatchString(flowID){fail(w,400,"Invalid browser flow ID");return}
 var input struct{FailedRunID string `json:"failed_run_id"`}
 if !parseJSON(w,r,&input){return}
 if !uuidRE.MatchString(input.FailedRunID){fail(w,400,"Invalid failure run ID");return}
 var planID,prompt,objective,originalDigest,targetURL,runStatus,flowStatus string
 var actionsJSON,checksJSON []byte
 err:=s.db.QueryRow(r.Context(),`
  SELECT f.plan_id::text,f.prompt,f.objective,f.steps,f.digest,
         t.target_url,t.status,t.checks,COALESCE(t.flow_id::text,'')
  FROM browser_flows f
  JOIN test_runs t ON t.flow_id=f.id AND t.project_id=f.project_id
  WHERE f.id=$1::uuid AND f.project_id=$2::uuid AND t.id=$3::uuid`,
  flowID,projectID,input.FailedRunID).
  Scan(&planID,&prompt,&objective,&actionsJSON,&originalDigest,&targetURL,&runStatus,&checksJSON,&flowStatus)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Original flow or failed run not found");return}
 if err!=nil{fail(w,500,"Unable to inspect failure evidence");return}
 if runStatus!="failed"||flowStatus!=flowID{fail(w,409,"This run is not an eligible failed browser flow");return}
 var actions []BrowserAction
 var checks []SmokeCheck
 if json.Unmarshal(actionsJSON,&actions)!=nil||json.Unmarshal(checksJSON,&checks)!=nil{
  fail(w,500,"Stored repair evidence is malformed");return
 }
 if browserFlowDigest(actions)!=originalDigest{fail(w,409,"Source flow digest does not match");return}
 repaired,hint,err:=repairFromEvidence(actions,checks)
 if err!=nil{fail(w,422,err.Error());return}
 newDigest:=browserFlowDigest(repaired)
 stepsRaw,_:=json.Marshal(repaired)
 warning:=fmt.Sprintf("Unverified locator proposal: step %d, %q to %q. Original assertions were preserved. Review the exact steps and rerun against the same authorized target.",hint.StepIndex+1,hint.OriginalName,hint.ProposedName)
 revised:=BrowserFlow{
  ProjectID:projectID,PlanID:planID,Prompt:prompt,
  Objective:objective,Steps:repaired,Digest:newDigest,GenerationMode:"rules",
  Warning:warning,RepairSourceFlowID:flowID,RepairSourceRunID:input.FailedRunID,
  RepairTarget:targetURL,
 }
 actor,_:=currentAccount(r)
 err=s.db.QueryRow(r.Context(),`
  INSERT INTO browser_flows (
   project_id,plan_id,prompt,objective,steps,digest,generation_mode,warning,
   repaired_from_flow_id,repaired_from_run_id,repair_target,created_by)
  VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,'rules',$7,$8::uuid,$9::uuid,$10,$11::uuid)
  RETURNING id::text,created_at`,
  projectID,planID,prompt,objective,string(stepsRaw),newDigest,warning,
  flowID,input.FailedRunID,targetURL,actor.ID).
  Scan(&revised.ID,&revised.CreatedAt)
 if err!=nil{fail(w,409,"A repair may already exist for this failed run");return}
 writeJSON(w,201,revised)
}

// Acceptance records the specific version and environment where the repair
// was proven, but never installs it silently or rewrites business assertions.
func (s *server) confirmRepair(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r);if !ok{return}
 flowID:=r.PathValue("flowId")
 if !uuidRE.MatchString(flowID){fail(w,400,"Invalid repaired flow ID");return}
 var input struct {
  SuccessfulRunID string `json:"successful_run_id"`
  Revision string `json:"app_revision"`
 }
 if !parseJSON(w,r,&input){return}
 if !uuidRE.MatchString(input.SuccessfulRunID)||
    !appRevisionRE.MatchString(input.Revision){
  fail(w,400,"A successful run and application revision (3-80 safe characters) are required");return
 }
 tx,err:=s.db.Begin(r.Context())
 if err!=nil{fail(w,500,"Could not start repair transaction");return}
 defer tx.Rollback(r.Context())
 var sourceFlowID,failedRunID,targetURL,oldDigest,newDigest,originalStatus,successStatus,successTarget string
 var sourceJSON,repairedJSON,failedChecks []byte
 err=tx.QueryRow(r.Context(),`
  SELECT old.id::text,r.repaired_from_run_id::text,r.repair_target,
         old.digest,r.digest,old.steps,r.steps,failed.checks,
         failed.status,passed.status,passed.target_url
  FROM browser_flows r
  JOIN browser_flows old ON old.id=r.repaired_from_flow_id AND old.project_id=r.project_id
  JOIN test_runs failed ON failed.id=r.repaired_from_run_id AND failed.flow_id=old.id
  JOIN test_runs passed ON passed.flow_id=r.id AND passed.id=$3::uuid
  WHERE r.id=$1::uuid AND r.project_id=$2::uuid AND passed.project_id=r.project_id`,
  flowID,projectID,input.SuccessfulRunID).
  Scan(&sourceFlowID,&failedRunID,&targetURL,&oldDigest,&newDigest,&sourceJSON,&repairedJSON,&failedChecks,
   &originalStatus,&successStatus,&successTarget)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"No matching verified replay or repair lineage");return}
 if err!=nil{fail(w,500,"Unable to inspect repair history");return}
 if originalStatus!="failed"||successStatus!="passed"||successTarget!=targetURL{
  fail(w,409,"Repair must have a passing replay against the original failing target");return
 }
 var original,revised []BrowserAction
 var checks []SmokeCheck
 if json.Unmarshal(sourceJSON,&original)!=nil||json.Unmarshal(repairedJSON,&revised)!=nil||
  json.Unmarshal(failedChecks,&checks)!=nil{fail(w,500,"Repair evidence is malformed");return}
 candidate,hint,err:=repairFromEvidence(original,checks)
 if err!=nil||!reflect.DeepEqual(candidate,revised)||browserFlowDigest(original)!=oldDigest||
  browserFlowDigest(revised)!=newDigest {
  fail(w,409,"Repair did not preserve the original test and assertions");return
 }
 // Repeat confirmations are rejected: an accepted lesson is immutable.
 var existingID string
 err=tx.QueryRow(r.Context(),"SELECT id::text FROM repair_acceptances WHERE repaired_flow_id=$1::uuid",flowID).Scan(&existingID)
 if err==nil{fail(w,409,"Repair has already been accepted");return}
 if !errors.Is(err,pgx.ErrNoRows){fail(w,500,"Unable to check repair acceptance");return}
 note:=fmt.Sprintf("Validated UI locator correction for user-declared revision %s at authorized target %s: in browser step %d, the %s accessible name changed from %q to %q. Original test assertions passed after a separately reviewed replay. This is a version-scoped testing lesson, not a change to product requirements.",
  input.Revision,targetURL,hint.StepIndex+1,hint.Role,hint.OriginalName,hint.ProposedName)
 var memoryID string
 err=tx.QueryRow(r.Context(),`
  INSERT INTO memories(project_id,kind,content,source,status)
  VALUES($1::uuid,'lesson',$2,'verified_qa_repair','confirmed') RETURNING id::text`,
  projectID,note).Scan(&memoryID)
 if err!=nil{fail(w,500,"Unable to record repair lesson");return}
 actor,_:=currentAccount(r)
 var accepted RepairReview
 accepted=RepairReview{
  RepairedFlowID:flowID,RepairedFromFlowID:sourceFlowID,OriginalFailureRunID:failedRunID,
  TargetURL:targetURL,OldName:hint.OriginalName,NewName:hint.ProposedName,
  AppRevision:input.Revision,MemoryID:memoryID,
 }
 err=tx.QueryRow(r.Context(),`
  INSERT INTO repair_acceptances(
   project_id,original_flow_id,repaired_flow_id,original_failure_run_id,verified_run_id,
   app_revision,target_url,step_index,old_name,new_name,memory_id,reviewed_by)
  VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11::uuid,$12::uuid)
  RETURNING accepted_at`,
  projectID,sourceFlowID,flowID,failedRunID,input.SuccessfulRunID,input.Revision,
  targetURL,hint.StepIndex,hint.OriginalName,hint.ProposedName,memoryID,actor.ID).
  Scan(&accepted.AcceptedAt)
 if err!=nil{fail(w,409,"Repair acceptance conflict");return}
 _,err=tx.Exec(r.Context(),`
  INSERT INTO browser_locator_cache(
   project_id,original_flow_digest,target_origin,app_revision,step_index,
   proposed_name,verified_flow_id,expires_at)
  VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,now()+interval '14 days')
  ON CONFLICT(project_id,original_flow_digest,target_origin,app_revision,step_index)
  DO UPDATE SET proposed_name=EXCLUDED.proposed_name,verified_flow_id=EXCLUDED.verified_flow_id,
                expires_at=EXCLUDED.expires_at`,
  projectID,oldDigest,targetURL,input.Revision,hint.StepIndex,hint.ProposedName,flowID)
 if err!=nil{fail(w,500,"Unable to cache versioned locator hint");return}
 if err=tx.Commit(r.Context());err!=nil{fail(w,500,"Unable to commit repair acceptance");return}
 writeJSON(w,201,accepted)
}

func (s *server) reviewedRepairs(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r);if !ok{return}
 rows,err:=s.db.Query(r.Context(),`
 SELECT repaired_flow_id::text,original_flow_id::text,original_failure_run_id::text,
        target_url,old_name,new_name,app_revision,memory_id::text,accepted_at
 FROM repair_acceptances WHERE project_id=$1::uuid ORDER BY accepted_at DESC LIMIT 50`,
 projectID)
 if err!=nil{fail(w,500,"Unable to retrieve repair lessons");return}
 defer rows.Close()
 reviews:=[]RepairReview{}
 for rows.Next(){
  var review RepairReview
  if err:=rows.Scan(&review.RepairedFlowID,&review.RepairedFromFlowID,&review.OriginalFailureRunID,
    &review.TargetURL,&review.OldName,&review.NewName,&review.AppRevision,&review.MemoryID,&review.AcceptedAt);err!=nil{
   fail(w,500,"Unable to decode repair lessons");return
  }
  reviews=append(reviews,review)
 }
 if rows.Err()!=nil{fail(w,500,"Unable to read repair lessons");return}
 writeJSON(w,200,reviews)
}
