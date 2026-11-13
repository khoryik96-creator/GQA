"use client";

import {useEffect,useMemo,useState} from "react";
import {
 AlertTriangle,Activity,BarChart3,
 CheckCircle2,ChevronDown,ChevronUp,RefreshCw,ShieldCheck
} from "lucide-react";

type TestOutcome="passed"|"failed"|"infrastructure_error";
type QualityPoint={run_id:string;status:TestOutcome;started_at:string};
type QualityCase={
 id:string;label:string;kind:"smoke"|"browser_flow";target_url:string;
 latest_run_id:string;previous_run_id?:string;status:TestOutcome;
 previous_status?:string;transition:string;failing_checks:string[];
 newly_failing_checks:string[];recovered_checks:string[];
 outcome_switches:number;unstable_pattern:boolean;observations:number;
 history:QualityPoint[];last_run_at:string;
};
type QualityDay={date:string;passed:number;failed:number;infrastructure:number};
type QualityReport={
 sample_runs:number;sample_limit:number;truncated:boolean;
 scenarios:number;passing:number;failing:number;regressions:number;
 recoveries:number;persistent_failures:number;unstable_patterns:number;
 infrastructure_failures:number;
 cases:QualityCase[];daily:QualityDay[];
};
type Filter="all"|"regressions"|"failures"|"recovered"|"switching"|"infrastructure";
const filters:{key:Filter;label:string}[]=[
 {key:"all",label:"All scenarios"},
 {key:"regressions",label:"Regressions"},
 {key:"failures",label:"Unresolved failures"},
 {key:"recovered",label:"Recoveries"},
 {key:"switching",label:"Outcome switching"},
 {key:"infrastructure",label:"Worker interruptions"}
];
const transitions:Record<string,string>={
 regression:"New regression",persistent_failure:"Repeated failure",
 new_failure:"First observed failure",recovered:"Recovered",
 stable_pass:"Continues passing",first_pass:"First observed pass",
 infrastructure_error:"Worker/infrastructure interruption"
};
const positive=new Set(["recovered","stable_pass","first_pass"]);
function shortDate(raw:string){
 return new Date(raw).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
}

function Scenario({item}:{item:QualityCase}){
 const [expanded,setExpanded]=useState(false);
 const isPositive=positive.has(item.transition);
 const isInfrastructure=item.status==="infrastructure_error";
 return <article className={"quality-scenario "+(item.status==="failed"?"quality-failure":"")}>
  <div className="quality-scenario-top">
   <span className={isInfrastructure?"quality-state caution":isPositive?"quality-state positive":"quality-state warning"}>
    {isPositive?<CheckCircle2 size={14}/>:<AlertTriangle size={14}/>}
    {transitions[item.transition]||item.transition.replaceAll("_"," ")}
   </span>
   <span className="quality-small">{item.kind==="smoke"?"API / browser smoke":"Reviewed browser flow"}</span>
   {item.unstable_pattern&&<span className="quality-state caution"><Activity size={14}/> Outcome switching</span>}
  </div>
  <div className="quality-scenario-main">
   <div className="quality-scenario-summary">
    <strong>{item.label}</strong>
    <small>{item.target_url}</small>
    <small>Last run {shortDate(item.last_run_at)} · {item.observations} sampled execution(s)</small>
   </div>
   <button type="button" className="button secondary" onClick={()=>setExpanded(x=>!x)}
      aria-expanded={expanded} aria-label={"Show historical comparisons for "+item.label}>
     {expanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}
     {expanded?"Hide evidence":"Compare runs"}
   </button>
  </div>
  {item.status==="failed"&&item.failing_checks.length>0&&
   <p className="quality-check-preview">Failing: {item.failing_checks.slice(0,3).join(" · ")}
      {item.failing_checks.length>3?" +"+(item.failing_checks.length-3)+" more":""}</p>}
  {expanded&&<div className="quality-scenario-details">
   <div className="quality-history">
    {item.history.map(point=><div key={point.run_id} className={"quality-history-mark "+point.status}
      title={point.status+" · "+shortDate(point.started_at)}>
      {point.status==="passed"?<CheckCircle2 size={14}/>:<AlertTriangle size={14}/>}
      <span>{point.status==="infrastructure_error"?"worker issue":point.status}</span>
    </div>)}
   </div>
   <p className="quality-small">Chronological recent results (oldest to newest). Compare only the same plan or reviewed flow on the same target.</p>
   <div className="quality-diff">
    <div><strong>New failing checks</strong>
     {item.newly_failing_checks.length>0?
      <ul>{item.newly_failing_checks.map(name=><li key={name}>{name}</li>)}</ul>:
      <p>No newly failing check names.</p>}
    </div>
    <div><strong>Recovered checks</strong>
     {item.recovered_checks.length>0?
      <ul>{item.recovered_checks.map(name=><li key={name}>{name}</li>)}</ul>:
      <p>No recovered check names.</p>}
    </div>
   </div>
   <div className="quality-run-ids">
    <span>Latest run: <code>{item.latest_run_id}</code></span>
    {item.previous_run_id&&<span>Previous run: <code>{item.previous_run_id}</code></span>}
   </div>
   {isInfrastructure&&<p className="quality-caution">
    This was an execution/infrastructure interruption. It is not counted as an application regression.
   </p>}
   {item.unstable_pattern&&<p className="quality-caution">
    Multiple pass/fail transitions occurred in the recent sample. This is an instability signal, not proof of a flaky test.
   </p>}
  </div>}
 </article>;
}

export default function RegressionIntelligence({projectId,apiBase}:{projectId:string;apiBase:string}){
 const [report,setReport]=useState<QualityReport|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [revision,setRevision]=useState(0);
 const [filter,setFilter]=useState<Filter>("all");
 const [refreshedAt,setRefreshedAt]=useState<Date|null>(null);

 useEffect(()=>{
  let active=true;
  setLoading(true);setError("");setReport(null);
  fetch(apiBase+"/api/projects/"+projectId+"/quality",{
   credentials:"include",cache:"no-store"
  }).then(async response=>{
   if(!response.ok){
    const body=await response.json().catch(()=>({error:"Unable to read run history"}));
    throw new Error(body.error||"Unable to read run history");
   }
   return response.json() as Promise<QualityReport>;
  }).then(result=>{if(active){setReport(result);setRefreshedAt(new Date())}})
  .catch(err=>{if(active)setError((err as Error).message)})
  .finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[apiBase,projectId,revision]);

 const filtered=useMemo(()=>{
  if(!report)return [] as QualityCase[];
  return report.cases.filter(c=>{
   switch(filter){
    case "regressions":return c.transition==="regression";
    case "failures":return c.status==="failed";
    case "recovered":return c.transition==="recovered";
    case "switching":return c.unstable_pattern;
    case "infrastructure":return c.status==="infrastructure_error";
    default:return true;
   }
  });
 },[report,filter]);

 return <div className="quality-page">
  <section className="card">
   <div className="card-head">
    <div><h2><BarChart3 size={18}/> Regression Intelligence</h2>
     <p>Compare only repeat runs of the same approved test and target. Results are read-only.</p></div>
    <button type="button" className="button secondary" disabled={loading}
       onClick={()=>setRevision(x=>x+1)}><RefreshCw size={15}/> Refresh results</button>
   </div>
   {error&&<div className="browser-flow-error"><AlertTriangle size={15}/>{error}</div>}
   {loading&&<p className="muted small">Analysing recent completed QA runs…</p>}
   {report&&<>
    {refreshedAt&&<p className="quality-small">Last refreshed {refreshedAt.toLocaleString()}</p>}
    <div className="quality-metrics">
     <div><span>Scenarios</span><strong>{report.scenarios}</strong><small>{report.sample_runs} completed runs sampled</small></div>
     <div><span>Passing</span><strong>{report.passing}</strong><small>Latest outcome by scenario</small></div>
     <div><span>Unresolved failures</span><strong>{report.failing}</strong><small>{report.persistent_failures} repeated</small></div>
     <div><span>Regressions</span><strong>{report.regressions}</strong><small>Pass → fail transitions</small></div>
     <div><span>Recovered</span><strong>{report.recoveries}</strong><small>Fail → pass transitions</small></div>
     <div><span>Worker issues</span><strong>{report.infrastructure_failures}</strong><small>Excluded from product regressions</small></div>
    </div>
    {report.truncated&&<p className="quality-caution">
     This view uses the most recent {report.sample_limit} completed runs. Older results were excluded, so a first observed result might have earlier history.
    </p>}
    {report.daily.length>0&&<div className="quality-timeline">
      <div className="quality-section-heading"><strong>Daily test executions</strong><span>Recent sampled days · UTC</span></div>
      <div className="quality-bars">
       {report.daily.map(day=>{
        const total=day.passed+day.failed+day.infrastructure;
        const pass=total===0?0:day.passed/total*100;
        const fail=total===0?0:day.failed/total*100;
        const max=Math.max(1,...report.daily.map(d=>d.passed+d.failed+d.infrastructure));
        return <div key={day.date} className="quality-day" title={day.date+": "+day.passed+" passed, "+day.failed+" failed, "+day.infrastructure+" worker interruptions"}>
         <strong>{total}</strong>
         <div className="quality-stack" style={{height:Math.max(18,Math.round(115*total/max))}}>
          <div className="quality-stack-infra" style={{height:(100-pass-fail)+"%"}}/>
          <div className="quality-stack-fail" style={{height:fail+"%"}}/>
          <div className="quality-stack-pass" style={{height:pass+"%"}}/>
         </div>
         <small>{day.date.slice(5)}</small>
        </div>;
       })}
      </div>
      <div className="quality-legend"><span><i className="pass"/> Passed</span><span><i className="fail"/> Failed</span><span><i className="infra"/> Worker issue</span></div>
    </div>}
    {report.daily.length>0&&<table className="quality-table">
     <caption>Accessible summary of daily QA execution outcomes (UTC)</caption>
     <thead><tr><th scope="col">Date</th><th scope="col">Passed</th>
      <th scope="col">Failed</th><th scope="col">Worker issue</th></tr></thead>
     <tbody>{report.daily.map(day=><tr key={day.date}>
      <th scope="row">{day.date}</th><td>{day.passed}</td><td>{day.failed}</td>
      <td>{day.infrastructure}</td>
     </tr>)}</tbody>
    </table>}
   </>}
  </section>
  <section className="card">
   <div className="card-head"><div>
    <h2><ShieldCheck size={18}/> Scenario change review</h2>
    <p>New regressions rank first. One run cannot establish a regression without a comparable earlier result.</p></div>
   </div>
   <div className="quality-filters" role="group" aria-label="Filter regression scenarios">
    {filters.map(f=><button key={f.key} type="button"
      aria-pressed={filter===f.key}
      className={filter===f.key?"quality-filter active":"quality-filter"}
      onClick={()=>setFilter(f.key)}>{f.label}</button>)}
   </div>
   {report && <p className="quality-small">{filtered.length} of {report.cases.length} scenarios in the selected view</p>}
   {!loading&&!error&&filtered.length===0&&<div className="quality-empty">
    <CheckCircle2 size={24}/>
    {report?.scenarios===0?
      <p>No completed QA runs yet. Execute a reviewed test or smoke check to establish the first observation.</p>:
      <p>No scenarios match this filter.</p>}
   </div>}
   <div className="quality-scenarios">
    {filtered.map(item=><Scenario key={item.id} item={item}/>)}
   </div>
   <p className="fine-print quality-disclaimer">
    A regression means the same flow or smoke plan passed previously and now fails on the same origin.
    Pass/fail switching is an investigation signal, not a definitive flaky-test diagnosis.
    Worker errors and interrupted runs are not interpreted as application regressions.
    Comparisons are based on recorded checks, not an AI-generated claim.
   </p>
  </section>
 </div>;
}
