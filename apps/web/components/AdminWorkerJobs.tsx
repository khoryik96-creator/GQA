"use client";

import {useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,Loader2,RefreshCw,Square,Server} from "lucide-react";

type Job={
 id:string;kind:"flow"|"smoke";
 status:"queued"|"running"|"cancelling"|"passed"|"failed"|"cancelled"|"interrupted"|"recovery_pending";
 created_at:string;started_at:string|null;finished_at:string|null;
 failure_kind:string;check_count:number;result_available?:boolean;
};

type JobEvidence={checks:{name:string;status:string;detail:string}[];
 screenshot_base64:string};
export default function AdminWorkerJobs({apiBase}:{apiBase:string}){
 const [enabled,setEnabled]=useState<boolean|null>(null);
 const [jobs,setJobs]=useState<Job[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [revision,setRevision]=useState(0);
 const [selectedResultId,setSelectedResultId]=useState("");
 const [result,setResult]=useState<JobEvidence|null>(null);
 const [refreshedAt,setRefreshedAt]=useState<Date|null>(null);
 // Poll only while this administrator panel is mounted and enabled.
 // This is deliberately bounded; errors continue to use the manual retry UI.
 useEffect(()=>{
  if(enabled!==true||!!error)return;
  const handle=setInterval(()=>{
   if(!document.hidden&&!busy)setRevision(v=>v+1);
  },15000);
  return ()=>clearInterval(handle);
 },[enabled,busy,error]);
 useEffect(()=>{
  let active=true;
  fetch(apiBase+"/api/admin/broker-jobs",{
    credentials:"include",cache:"no-store"
  }).then(async response=>{
    if(!active)return;
    if(response.status===501){setEnabled(false);return}
    if(!response.ok)throw Error("Unable to reach experimental host broker");
    const data=await response.json() as Job[];
    if(active){setEnabled(true);setJobs(data);setError("");setRefreshedAt(new Date());}
  }).catch(err=>{if(active){setEnabled(true);setError((err as Error).message)}});
  return ()=>{active=false};
 },[apiBase,revision]);
 async function inspect(id:string){
  if(selectedResultId===id){setSelectedResultId("");setResult(null);return}
  setBusy(true);setError("");
  try{
   const response=await fetch(apiBase+"/api/admin/broker-jobs/"+id+"/result",{
    credentials:"include",cache:"no-store"
   });
   if(!response.ok)throw Error("Unable to read stored QA evidence");
   setResult(await response.json() as JobEvidence);
   setSelectedResultId(id);
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 async function cancel(id:string){
  if(!window.confirm("Cancel this GQA test job? A running container will be stopped and its result recorded as cancelled."))return;
  setBusy(true);setError("");
  try{
   const response=await fetch(apiBase+"/api/admin/broker-jobs/"+id+"/cancel",{
    method:"POST",credentials:"include",cache:"no-store",
    headers:{"Content-Type":"application/json"}
   });
   if(!response.ok)throw Error("Unable to request job cancellation");
   setRevision(n=>n+1);
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 if(enabled===false)return null;
 if(enabled===null)return <p className="muted small" role="status">Checking experimental job monitor availability…</p>;
 return <section className="card broker-jobs">
   <div className="card-head">
    <div><h2><Server size={18}/> Disposable test jobs</h2>
      <p>Administrator view of the experimental broker queue and execution status.</p></div>
    <button className="button secondary" onClick={()=>setRevision(n=>n+1)}
      disabled={busy} type="button"><RefreshCw size={14}/> Refresh</button>
   </div>
   {error&&<div className="browser-flow-error" role="alert"><AlertTriangle size={15}/>{error}</div>}
   {refreshedAt&&<p className="muted small" role="status">Job data refreshed {refreshedAt.toLocaleTimeString()}</p>}
   {jobs.length===0?<p className="muted small">No broker jobs have been recorded.</p>:
    <div className="broker-job-list">{jobs.slice(0,30).map(job=>
      <div className="broker-job-row" key={job.id}>
       <div className="broker-job-identity">
        <strong>{job.kind==="flow"?"Browser flow":"API/browser smoke"} · {job.id.slice(0,8)}</strong>
        <small>{new Date(job.created_at).toLocaleString()} · {job.check_count} check(s)</small>
        {job.failure_kind&&job.failure_kind!=="none"&&<small>Result: {job.failure_kind.replaceAll("_"," ")}</small>}
       </div>
       <span className="pill neutral">{job.status.replaceAll("_"," ")}</span>
       {job.result_available&&<button className="button secondary" type="button"
         disabled={busy} onClick={()=>inspect(job.id)}>
         {selectedResultId===job.id?"Hide evidence":"View evidence"}
       </button>}
       {["queued","running","cancelling"].includes(job.status)&&
        <button type="button" className="button secondary" disabled={busy||job.status==="cancelling"}
          onClick={()=>cancel(job.id)}>
          {busy?<Loader2 size={14} className="spin"/>:<Square size={14}/>} Cancel
        </button>}
       {job.status==="passed"&&<CheckCircle2 color="#89d4be" size={17}/>}
      </div>
    )}</div>}
   {selectedResultId&&result&&<div className="broker-result">
    <strong>Saved QA evidence · {selectedResultId.slice(0,8)}</strong>
    {result.checks.map((check,index)=><div className="broker-result-check" key={index}>
     <strong>{check.status} · {check.name}</strong>
     <small>{check.detail}</small>
    </div>)}
    {result.screenshot_base64&&<img className="broker-result-image"
     src={"data:image/png;base64,"+result.screenshot_base64}
     alt="Screenshot captured by the reviewed disposable browser test"/>}
   </div>}
   <p className="fine-print">Queued work is persisted locally. In-progress jobs are not silently replayed after a broker crash. Cancellation requires explicit confirmation and is not a replacement for host-level process isolation.</p>
 </section>;
}
