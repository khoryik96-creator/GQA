"use client";

import {useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,Loader2,RefreshCw,Square,Server} from "lucide-react";

type Job={
 id:string;kind:"flow"|"smoke";
 status:"queued"|"running"|"cancelling"|"passed"|"failed"|"cancelled"|"interrupted"|"recovery_pending";
 created_at:string;started_at:string|null;finished_at:string|null;
 failure_kind:string;check_count:number;
};

export default function AdminWorkerJobs({apiBase}:{apiBase:string}){
 const [enabled,setEnabled]=useState<boolean|null>(null);
 const [jobs,setJobs]=useState<Job[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;
  fetch(apiBase+"/api/admin/broker-jobs",{
    credentials:"include",cache:"no-store"
  }).then(async response=>{
    if(!active)return;
    if(response.status===501){setEnabled(false);return}
    if(!response.ok)throw Error("Unable to reach experimental host broker");
    const data=await response.json() as Job[];
    if(active){setEnabled(true);setJobs(data);}
  }).catch(err=>{if(active){setEnabled(true);setError((err as Error).message)}});
  return ()=>{active=false};
 },[apiBase,revision]);
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
 if(enabled===false||enabled===null)return null;
 return <section className="card broker-jobs">
   <div className="card-head">
    <div><h2><Server size={18}/> Disposable test jobs</h2>
      <p>Administrator view of the experimental broker queue and execution status.</p></div>
    <button className="button secondary" onClick={()=>setRevision(n=>n+1)}
      disabled={busy} type="button"><RefreshCw size={14}/> Refresh</button>
   </div>
   {error&&<div className="browser-flow-error"><AlertTriangle size={15}/>{error}</div>}
   {jobs.length===0?<p className="muted small">No broker jobs have been recorded.</p>:
    <div className="broker-job-list">{jobs.slice(0,30).map(job=>
      <div className="broker-job-row" key={job.id}>
       <div className="broker-job-identity">
        <strong>{job.kind==="flow"?"Browser flow":"API/browser smoke"} · {job.id.slice(0,8)}</strong>
        <small>{new Date(job.created_at).toLocaleString()} · {job.check_count} check(s)</small>
        {job.failure_kind&&job.failure_kind!=="none"&&<small>Result: {job.failure_kind.replaceAll("_"," ")}</small>}
       </div>
       <span className="pill neutral">{job.status.replaceAll("_"," ")}</span>
       {["queued","running","cancelling"].includes(job.status)&&
        <button type="button" className="button secondary" disabled={busy||job.status==="cancelling"}
          onClick={()=>cancel(job.id)}>
          {busy?<Loader2 size={14} className="spin"/>:<Square size={14}/>} Cancel
        </button>}
       {job.status==="passed"&&<CheckCircle2 color="#89d4be" size={17}/>}
      </div>
    )}</div>}
   <p className="fine-print">Queued work is persisted locally. In-progress jobs are not silently replayed after a broker crash. Cancellation requires explicit confirmation and is not a replacement for host-level process isolation.</p>
 </section>;
}
