"use client";

import {useCallback,useEffect,useMemo,useState,type FormEvent} from "react";
import {
 AlertTriangle,Bug,ChevronDown,ChevronUp,FileCode2,FlaskConical,GitCommit,
 Loader2,RefreshCw,ScanSearch,ShieldCheck
} from "lucide-react";

type Severity="critical"|"high"|"medium"|"low"|"info";
type Finding={
 id:string;file:string;line_start:number;line_end:number;severity:Severity;category:string;
 title:string;description:string;evidence:string;recommendation:string;suggested_test:string;
 confidence:"high"|"medium"|"low";status:string;
};
type CoverageGap={area:string;reason:string;suggested_tests:string[]};
type Review={
 id:string;status:"running"|"completed"|"failed";provider:string;repository:string;commit_sha:string;
 focus:string;files_reviewed:string[];files_skipped:number;findings:Finding[];coverage_gaps:CoverageGap[];
 summary:string;severity_counts:Record<string,number>;discarded_unverifiable:number;notices:string[];
 error?:string;created_at:string;completed_at?:string;
};

const severities:Severity[]=["critical","high","medium","low","info"];

async function api<T>(base:string,path:string,init?:RequestInit):Promise<T>{
 const res=await fetch(base+path,{
   ...init,credentials:"include",cache:"no-store",
   headers:{"Content-Type":"application/json",...(init?.headers||{})}
 });
 if(!res.ok){
   const body=await res.json().catch(()=>({error:"Request failed"}));
   throw new Error(body.error||"Request failed");
 }
 return res.json() as Promise<T>;
}

function when(raw?:string){
 return raw?new Date(raw).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}):"";
}

function fileLink(review:Review,f:Finding){
 if(!review.repository||!review.commit_sha)return "";
 const lines=f.line_end>f.line_start?`#L${f.line_start}-L${f.line_end}`:`#L${f.line_start}`;
 return `https://github.com/${review.repository}/blob/${review.commit_sha}/${f.file}${lines}`;
}

function FindingCard({review,finding}:{review:Review;finding:Finding}){
 const [open,setOpen]=useState(finding.severity==="critical"||finding.severity==="high");
 const link=fileLink(review,finding);
 return <article className={"review-finding sev-"+finding.severity}>
  <div className="review-finding-top">
   <span className={"review-sev sev-"+finding.severity}>{finding.severity}</span>
   <span className="review-tag">{finding.category}</span>
   <span className="review-tag">confidence: {finding.confidence}</span>
   <span className="review-tag suspected">{finding.status}</span>
   <code className="review-id">{finding.id}</code>
  </div>
  <div className="review-finding-main">
   <div className="review-finding-summary">
    <strong>{finding.title}</strong>
    <small>
     {link?<a href={link} target="_blank" rel="noreferrer">{finding.file}:{finding.line_start}{finding.line_end>finding.line_start?"-"+finding.line_end:""}</a>
      :<>{finding.file}:{finding.line_start}</>}
    </small>
   </div>
   <button type="button" className="button secondary" onClick={()=>setOpen(x=>!x)}
     aria-expanded={open} aria-label={(open?"Hide":"Show")+" details for "+finding.title}>
    {open?<ChevronUp size={15}/>:<ChevronDown size={15}/>}{open?"Hide":"Details"}
   </button>
  </div>
  {open&&<div className="review-finding-details">
   {finding.description&&<p>{finding.description}</p>}
   <div className="review-label">Evidence (verified against the reviewed commit)</div>
   <pre className="review-evidence">{finding.evidence}</pre>
   {finding.recommendation&&<><div className="review-label">Recommended fix</div><p>{finding.recommendation}</p></>}
   {finding.suggested_test&&<><div className="review-label"><FlaskConical size={13}/> Test that would confirm it</div><p>{finding.suggested_test}</p></>}
  </div>}
 </article>;
}

export default function CodeReview({projectId,apiBase,canRun}:{projectId:string;apiBase:string;canRun:boolean}){
 const [reviews,setReviews]=useState<Review[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [loading,setLoading]=useState(true);
 const [starting,setStarting]=useState(false);
 const [error,setError]=useState("");
 const [focus,setFocus]=useState("");
 const [filter,setFilter]=useState<Severity|"all">("all");
 const prefix="/api/projects/"+projectId+"/code-reviews";

 const load=useCallback(async()=>{
  try{
   const list=await api<Review[]>(apiBase,prefix);
   setReviews(list);
   setSelectedId(current=>current&&list.some(r=>r.id===current)?current:(list[0]?.id||""));
   setError("");
  }catch(err){setError((err as Error).message)}
  finally{setLoading(false)}
 },[apiBase,prefix]);

 useEffect(()=>{setLoading(true);load()},[load]);
 const running=reviews.some(r=>r.status==="running");
 useEffect(()=>{
  if(!running)return;
  const timer=setInterval(load,4000);
  return ()=>clearInterval(timer);
 },[running,load]);

 async function start(e:FormEvent){
  e.preventDefault();
  setStarting(true);setError("");
  try{
   const created=await api<Review>(apiBase,prefix,{method:"POST",body:JSON.stringify({focus})});
   setSelectedId(created.id);
   await load();
  }catch(err){setError((err as Error).message)}
  finally{setStarting(false)}
 }

 const review=reviews.find(r=>r.id===selectedId);
 const shown=useMemo(()=>review?review.findings.filter(f=>filter==="all"||f.severity===filter):[],[review,filter]);

 return <div className="review-page">
  <section className="card">
   <div className="card-head">
    <div>
     <h2><ScanSearch size={18}/> AI code review</h2>
     <p>GQA reads the repository source, asks the configured model for defects and missing tests, and keeps only findings whose quoted code matches the reviewed commit.</p>
    </div>
    <span className="pill warning">Findings are suspected until tested</span>
   </div>
   <form onSubmit={start} className="review-form">
    <label htmlFor="review-focus">Focus (optional)</label>
    <textarea id="review-focus" rows={2} maxLength={1000} value={focus} onChange={e=>setFocus(e.target.value)}
      disabled={!canRun} placeholder="e.g. authentication, payments, database transactions, API input validation"/>
    <div className="review-actions">
     <button className="button primary" type="submit" disabled={!canRun||starting||running}>
      {starting||running?<Loader2 size={16} className="spin"/>:<ScanSearch size={16}/>}
      {running?"Review in progress…":"Review repository"}
     </button>
     <button className="button secondary" type="button" onClick={()=>load()} aria-label="Refresh code reviews">
      <RefreshCw size={15}/> Refresh
     </button>
     {!canRun&&<span className="quality-small">Your project role can view reviews but not start them.</span>}
    </div>
   </form>
   {error&&<div className="warning-line" role="alert"><AlertTriangle size={15}/>{error}</div>}
  </section>

  {loading?<section className="card placeholder-card"><Loader2 size={24} className="spin"/><p>Loading reviews…</p></section>
  :!review?<section className="card placeholder-card"><Bug size={28}/><h3>No code review yet</h3><p>Start a review to get evidence-backed findings, severity and recommended fixes.</p></section>
  :<section className="card">
   <div className="card-head">
    <div>
     <h2><FileCode2 size={18}/> {review.repository||"Repository"} review</h2>
     <p>
      {review.commit_sha&&<><GitCommit size={12}/> <code>{review.commit_sha.slice(0,12)}</code> · </>}
      {review.provider} · started {when(review.created_at)}{review.completed_at?" · finished "+when(review.completed_at):""}
     </p>
    </div>
    {reviews.length>1&&<label className="review-history">History
     <select value={review.id} onChange={e=>setSelectedId(e.target.value)}>
      {reviews.map(r=><option key={r.id} value={r.id}>{when(r.created_at)} · {r.status}</option>)}
     </select>
    </label>}
   </div>

   {review.status==="running"&&<div className="notice"><Loader2 size={17} className="spin"/><div><strong>Reviewing source files…</strong><p>Large repositories are reviewed in several batches and can take a few minutes. This page refreshes automatically.</p></div></div>}
   {review.status==="failed"&&<div className="warning-line" role="alert"><AlertTriangle size={15}/>{review.error||"The review failed."}</div>}

   {review.status==="completed"&&<>
    <div className="quality-metrics review-metrics">
     {severities.map(s=><div key={s} className={"sev-"+s}><span>{s}</span><strong>{review.severity_counts?.[s]||0}</strong></div>)}
    </div>
    <p className="quality-small">{review.files_reviewed.length} files reviewed{review.files_skipped?` · ${review.files_skipped} not included (size/budget limits)`:""}{review.discarded_unverifiable?` · ${review.discarded_unverifiable} unverifiable model claims discarded`:""}{review.focus?` · focus: ${review.focus}`:""}</p>
    {review.summary&&<div className="review-summary">{review.summary.split("\n\n").map((p,i)=><p key={i}>{p}</p>)}</div>}

    <div className="quality-filters" role="group" aria-label="Filter findings by severity">
     {(["all",...severities] as const).map(s=><button key={s} type="button"
       className={"quality-filter"+(filter===s?" active":"")} aria-pressed={filter===s} onClick={()=>setFilter(s)}>
       {s==="all"?`All (${review.findings.length})`:`${s} (${review.severity_counts?.[s]||0})`}
     </button>)}
    </div>
    <div className="review-findings">
     {shown.length===0?<p className="quality-small">{review.findings.length===0?"No verifiable findings. This does not prove the code is correct.":"No findings at this severity."}</p>
      :shown.map(f=><FindingCard key={f.id} review={review} finding={f}/>)}
    </div>

    {review.coverage_gaps.length>0&&<>
     <h3 className="review-subhead"><FlaskConical size={15}/> Missing test coverage</h3>
     <div className="review-gaps">
      {review.coverage_gaps.map((g,i)=><div key={i} className="review-gap">
       <strong>{g.area}</strong><p>{g.reason}</p>
       {g.suggested_tests.length>0&&<ul>{g.suggested_tests.map((t,j)=><li key={j}>{t}</li>)}</ul>}
      </div>)}
     </div>
    </>}
    {review.notices.map(n=><div key={n} className="notice"><ShieldCheck size={17}/><div><p>{n}</p></div></div>)}
   </>}
  </section>}
 </div>;
}
