package main

import (
 "crypto/subtle"
 "encoding/json"
 "errors"
 "net/http"

 "github.com/jackc/pgx/v5"
)

// POST inserts a successor rather than changing any executed, reviewed, or
// evidence-linked flow. A unique predecessor index prevents competing forks.
// Browser actions remain typed data and pass the same executor safety policy.
func (s *server) createFlowRevision(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r);if !ok{return}
 sourceID:=r.PathValue("flowId")
 if !uuidRE.MatchString(sourceID){fail(w,400,"Invalid browser flow ID");return}
 var input struct {
   SourceDigest string `json:"source_digest"`
   Steps []BrowserAction `json:"steps"`
 }
 if !parseJSON(w,r,&input){return}
 if len(input.SourceDigest)!=64 {fail(w,400,"Provide the complete source review digest");return}
 if err:=validBrowserActions(input.Steps);err!=nil{fail(w,400,err.Error());return}

 var original BrowserFlow
 var stepsRaw []byte
 err:=s.db.QueryRow(r.Context(),`
  SELECT plan_id::text,prompt,objective,steps,digest,generation_mode,warning,
  COALESCE(repaired_from_run_id::text,''),COALESCE(revised_from_flow_id::text,'')
  FROM browser_flows WHERE id=$1::uuid AND project_id=$2::uuid
 `,sourceID,projectID).Scan(&original.PlanID,&original.Prompt,&original.Objective,
  &stepsRaw,&original.Digest,&original.GenerationMode,&original.Warning,
  &original.RepairSourceRunID,&original.RevisedFromFlowID)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Browser flow not found");return}
 if err!=nil{fail(w,500,"Unable to read browser flow");return}
 if original.RepairSourceRunID!=""{
   fail(w,409,"Repair proposals cannot be manually revised; retain their evidence-only lineage");return
 }
 if subtle.ConstantTimeCompare([]byte(input.SourceDigest),[]byte(original.Digest))!=1 {
   fail(w,409,"Flow changed since review; reload the current revision");return
 }
 var originalSteps []BrowserAction
 if json.Unmarshal(stepsRaw,&originalSteps)!=nil ||
   validBrowserActions(originalSteps)!=nil ||
   browserFlowDigest(originalSteps)!=original.Digest{
   fail(w,409,"Stored source flow failed integrity validation");return
 }
 digest:=browserFlowDigest(input.Steps)
 if digest==original.Digest{
   fail(w,409,"Edited steps must differ from the saved version");return
 }
 stepsJSON,_:=json.Marshal(input.Steps)
 creator,_:=currentAccount(r)
 revision:=BrowserFlow{
   ProjectID:projectID,PlanID:original.PlanID,Prompt:original.Prompt,
   Objective:original.Objective,Steps:input.Steps,Digest:digest,
   GenerationMode:original.GenerationMode,
   Warning:"User-edited browser actions: verify every step, data input, origin, and assertion before executing.",
   RevisedFromFlowID:sourceID,
 }
 err=s.db.QueryRow(r.Context(),`
  INSERT INTO browser_flows(project_id,plan_id,prompt,objective,steps,digest,
    generation_mode,warning,created_by,revised_from_flow_id)
  VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7,$8,$9::uuid,$10::uuid)
  ON CONFLICT DO NOTHING
  RETURNING id::text,created_at
 `,projectID,revision.PlanID,revision.Prompt,revision.Objective,string(stepsJSON),
   revision.Digest,revision.GenerationMode,revision.Warning,creator.ID,sourceID).
   Scan(&revision.ID,&revision.CreatedAt)
 if errors.Is(err,pgx.ErrNoRows){
   fail(w,409,"This flow already has a newer revision; reload history before editing");return
 }
 if err!=nil{fail(w,500,"Unable to save browser flow revision");return}
 writeJSON(w,201,revision)
}

// GET returns the linear immutable ancestry and successors for any version.
// Bound recursive traversals so a corrupted relationship cannot grow forever.
func (s *server) flowRevisionHistory(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r);if !ok{return}
 flowID:=r.PathValue("flowId")
 if !uuidRE.MatchString(flowID){fail(w,400,"Invalid browser flow ID");return}
 rows,err:=s.db.Query(r.Context(),`
  WITH RECURSIVE ancestors(id,parent,depth) AS (
    SELECT id,revised_from_flow_id,0 FROM browser_flows
     WHERE id=$1::uuid AND project_id=$2::uuid
    UNION ALL
    SELECT f.id,f.revised_from_flow_id,a.depth+1
     FROM browser_flows f JOIN ancestors a ON a.parent=f.id
     WHERE f.project_id=$2::uuid AND a.depth<100
  ), root AS (
    SELECT id FROM ancestors
    WHERE parent IS NULL ORDER BY depth DESC LIMIT 1
  ), descendants(id,depth) AS (
    SELECT id,0 FROM root
    UNION ALL
    SELECT f.id,d.depth+1 FROM browser_flows f
    JOIN descendants d ON f.revised_from_flow_id=d.id
    WHERE f.project_id=$2::uuid AND d.depth<100
  )
  SELECT f.id::text,f.project_id::text,f.plan_id::text,f.prompt,f.objective,
    f.steps,f.digest,f.generation_mode,f.warning,
    COALESCE(f.repaired_from_flow_id::text,''),
    COALESCE(f.repaired_from_run_id::text,''),f.repair_target,
    COALESCE(f.revised_from_flow_id::text,''),f.created_at
  FROM descendants d JOIN browser_flows f ON f.id=d.id
  ORDER BY d.depth ASC LIMIT 101
 `,flowID,projectID)
 if err!=nil{fail(w,500,"Unable to read browser flow history");return}
 defer rows.Close()
 history:=[]BrowserFlow{}
 for rows.Next(){
   var item BrowserFlow
   var stepsRaw []byte
   if err:=rows.Scan(&item.ID,&item.ProjectID,&item.PlanID,&item.Prompt,
     &item.Objective,&stepsRaw,&item.Digest,&item.GenerationMode,&item.Warning,
     &item.RepairSourceFlowID,&item.RepairSourceRunID,&item.RepairTarget,
     &item.RevisedFromFlowID,&item.CreatedAt);err!=nil{
     fail(w,500,"Unable to decode browser flow history");return
   }
   if json.Unmarshal(stepsRaw,&item.Steps)!=nil{
     fail(w,500,"Invalid stored browser flow history");return
   }
   history=append(history,item)
 }
 if rows.Err()!=nil{fail(w,500,"Unable to read browser flow history");return}
 if len(history)==0{fail(w,404,"Browser flow not found");return}
 if len(history)>100 {fail(w,409,"Flow history exceeds the review limit of 100 versions");return}
 // A valid repair proposal is a distinct, non-editor lineage; it still has
 // one entry and can be reviewed without being changed by the editor.
 writeJSON(w,200,history)
}

