package main

import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "net/http"
 "sort"
 "strings"
 "time"
)

// A regression is a previously passing, IDENTICAL test case now failing.
// Test identity is scoped to a project by the API query and to the same
// flow or plan, target origin and execution kind. A new repaired flow is a
// separate scenario; we never imply the original expectations were met.
type QualityRun struct {
 ID string
 PlanID string
 FlowID string
 Kind string
 Target string
 Status string
 Checks []SmokeCheck
 StartedAt time.Time
}

type QualityPoint struct {
 RunID string `json:"run_id"`
 Status string `json:"status"`
 StartedAt time.Time `json:"started_at"`
}

type QualityCase struct {
 ID string `json:"id"`
 Label string `json:"label"`
 Kind string `json:"kind"`
 TargetURL string `json:"target_url"`
 LatestRunID string `json:"latest_run_id"`
 PreviousRunID string `json:"previous_run_id,omitempty"`
 Status string `json:"status"`
 PreviousStatus string `json:"previous_status,omitempty"`
 Transition string `json:"transition"`
 FailingChecks []string `json:"failing_checks"`
 NewlyFailingChecks []string `json:"newly_failing_checks"`
 RecoveredChecks []string `json:"recovered_checks"`
 OutcomeSwitches int `json:"outcome_switches"`
 UnstablePattern bool `json:"unstable_pattern"`
 Observations int `json:"observations"`
 History []QualityPoint `json:"history"`
 LastRunAt time.Time `json:"last_run_at"`
}

type QualityDay struct {
 Date string `json:"date"`
 Passed int `json:"passed"`
 Failed int `json:"failed"`
}

type QualityReport struct {
 SampleRuns int `json:"sample_runs"`
 SampleLimit int `json:"sample_limit"`
 Truncated bool `json:"truncated"`
 Scenarios int `json:"scenarios"`
 Passing int `json:"passing"`
 Failing int `json:"failing"`
 Regressions int `json:"regressions"`
 Recoveries int `json:"recoveries"`
 PersistentFailures int `json:"persistent_failures"`
 UnstablePatterns int `json:"unstable_patterns"`
 Cases []QualityCase `json:"cases"`
 Daily []QualityDay `json:"daily"`
}

const qualityRunLimit=200

func qualityIdentity(run QualityRun)(string,string,bool){
 if run.Status!="passed"&&run.Status!="failed"{return "","",false}
 if run.Target==""{return "","",false}
 var id string
 var name string
 switch run.Kind{
 case "smoke":
  if !uuidRE.MatchString(run.PlanID){return "","",false}
  id="smoke|"+run.PlanID+"|"+run.Target
  name="Smoke · plan "+run.PlanID[:8]
 case "browser_flow":
  if !uuidRE.MatchString(run.FlowID){return "","",false}
  id="flow|"+run.FlowID+"|"+run.Target
  name="Browser flow "+run.FlowID[:8]
 default:return "","",false
 }
 return id,name,true
}

func failedNames(checks []SmokeCheck) []string{
 seen:=map[string]bool{}
 result:=[]string{}
 for _,check:=range checks{
  name:=strings.TrimSpace(check.Name)
  if name==""||check.Status=="passed"||seen[name]{continue}
  seen[name]=true
  result=append(result,name)
 }
 sort.Strings(result)
 return result
}

func newlyAbsent(current,previous []string)[]string{
 used:=make(map[string]bool,len(previous))
 for _,name:=range previous{used[name]=true}
 delta:=[]string{}
 for _,name:=range current{if !used[name]{delta=append(delta,name)}}
 return delta
}

func summarizeQuality(records []QualityRun,limit int) QualityReport{
 report:=QualityReport{Cases:[]QualityCase{},Daily:[]QualityDay{},SampleLimit:limit}
 if limit<=0{limit=qualityRunLimit;report.SampleLimit=limit}
 report.Truncated=len(records)>limit
 if len(records)>limit{records=records[:limit]}
 report.SampleRuns=len(records)

 // The query sends newest-first; replay history in chronological order.
 history:=append([]QualityRun(nil),records...)
 sort.SliceStable(history,func(i,j int)bool{
  if history[i].StartedAt.Equal(history[j].StartedAt){return history[i].ID<history[j].ID}
  return history[i].StartedAt.Before(history[j].StartedAt)
 })
 grouped:=map[string][]QualityRun{}
 days:=map[string]*QualityDay{}
 for _,run:=range history{
  key,_,valid:=qualityIdentity(run)
  if !valid{continue}
  grouped[key]=append(grouped[key],run)
  day:=run.StartedAt.UTC().Format("2006-01-02")
  if days[day]==nil{days[day]=&QualityDay{Date:day}}
  if run.Status=="passed"{days[day].Passed++}else{days[day].Failed++}
 }
 for key,runs:=range grouped{
  latest:=runs[len(runs)-1]
  _,label,_:=qualityIdentity(latest)
  hashed:=sha256.Sum256([]byte(key))
  c:=QualityCase{ID:hex.EncodeToString(hashed[:8]),Label:label,
   Kind:latest.Kind,TargetURL:latest.Target,LatestRunID:latest.ID,
   Status:latest.Status,LastRunAt:latest.StartedAt,Observations:len(runs),
   FailingChecks:failedNames(latest.Checks),
   NewlyFailingChecks:[]string{},RecoveredChecks:[]string{},History:[]QualityPoint{}}
  recent:=runs
  if len(recent)>6{recent=recent[len(recent)-6:]}
  for _,run:=range recent{
   c.History=append(c.History,QualityPoint{RunID:run.ID,Status:run.Status,StartedAt:run.StartedAt})
  }
  switches:=0
  for i:=1;i<len(recent);i++{
   if recent[i].Status!=recent[i-1].Status{switches++}
  }
  c.OutcomeSwitches=switches
  c.UnstablePattern=len(recent)>=4&&switches>=2

  if len(runs)<2{
   if latest.Status=="failed"{c.Transition="new_failure"}else{c.Transition="first_pass"}
   c.NewlyFailingChecks=append(c.NewlyFailingChecks,c.FailingChecks...)
  }else{
   prev:=runs[len(runs)-2]
   c.PreviousRunID=prev.ID
   c.PreviousStatus=prev.Status
   oldFailed:=failedNames(prev.Checks)
   c.NewlyFailingChecks=newlyAbsent(c.FailingChecks,oldFailed)
   c.RecoveredChecks=newlyAbsent(oldFailed,c.FailingChecks)
   switch{
   case prev.Status=="passed"&&latest.Status=="failed":c.Transition="regression"
   case prev.Status=="failed"&&latest.Status=="passed":c.Transition="recovered"
   case prev.Status=="failed"&&latest.Status=="failed":c.Transition="persistent_failure"
   default:c.Transition="stable_pass"
   }
  }
  report.Cases=append(report.Cases,c)
  if c.Status=="passed"{report.Passing++}else{report.Failing++}
  if c.Transition=="regression"{report.Regressions++}
  if c.Transition=="recovered"{report.Recoveries++}
  if c.Transition=="persistent_failure"{report.PersistentFailures++}
  if c.UnstablePattern{report.UnstablePatterns++}
 }
 report.Scenarios=len(report.Cases)
 sort.Slice(report.Cases,func(i,j int)bool{
  // Prioritize unresolved regressions, then other failures, then recovery.
  priority:=func(x QualityCase)int{
   if x.Transition=="regression"{return 0}
   if x.Status=="failed"{return 1}
   if x.UnstablePattern{return 2}
   if x.Transition=="recovered"{return 3}
   return 4
  }
  a,b:=priority(report.Cases[i]),priority(report.Cases[j])
  if a!=b{return a<b}
  if !report.Cases[i].LastRunAt.Equal(report.Cases[j].LastRunAt){
   return report.Cases[i].LastRunAt.After(report.Cases[j].LastRunAt)
  }
  return report.Cases[i].ID<report.Cases[j].ID
 })
 for _,day:=range days{report.Daily=append(report.Daily,*day)}
 sort.Slice(report.Daily,func(i,j int)bool{return report.Daily[i].Date<report.Daily[j].Date})
 if len(report.Daily)>14{report.Daily=report.Daily[len(report.Daily)-14:]}
 return report
}

func (s *server) quality(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r);if !ok{return}
 rows,err:=s.db.Query(r.Context(),`
  SELECT id::text,plan_id::text,COALESCE(flow_id::text,''),
    execution_kind,target_url,status,checks,started_at
  FROM test_runs
  WHERE project_id=$1::uuid AND status IN ('passed','failed')
  ORDER BY started_at DESC,id DESC LIMIT $2`,projectID,qualityRunLimit+1)
 if err!=nil{fail(w,500,"Unable to retrieve quality history");return}
 defer rows.Close()
 input:=[]QualityRun{}
 for rows.Next(){
  var run QualityRun
  var checksJSON []byte
  if err:=rows.Scan(&run.ID,&run.PlanID,&run.FlowID,&run.Kind,
     &run.Target,&run.Status,&checksJSON,&run.StartedAt);err!=nil{
    fail(w,500,"Unable to read quality history");return
  }
  if err:=json.Unmarshal(checksJSON,&run.Checks);err!=nil{
    fail(w,500,"Invalid saved run checks");return
  }
  if len(run.Checks)>100{fail(w,500,"Excessive saved check count");return}
  input=append(input,run)
 }
 if rows.Err()!=nil{fail(w,500,"Unable to finish quality history");return}
 result:=summarizeQuality(input,qualityRunLimit)
 w.Header().Set("Cache-Control","no-store")
 writeJSON(w,http.StatusOK,result)
}
