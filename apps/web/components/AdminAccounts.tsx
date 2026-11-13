"use client";

import {useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,KeyRound,Loader2,ShieldAlert,UserCheck,UserX} from "lucide-react";

type User={id:string;email:string;global_role:string;active:boolean};
type Event={id:string;actor_email:string;subject_email:string;action:string;reason:string;created_at:string};
type Reason="security_review"|"team_change"|"access_cleanup"|"account_recovery";
type Props={apiBase:string;users:User[];selfUserId:string;onChanged:()=>void};
const reasons:Reason[]=["security_review","team_change","access_cleanup","account_recovery"];
async function call(base:string,path:string,body?:object){
 const response=await fetch(base+path,{
  method:body===undefined?"GET":"POST",credentials:"include",cache:"no-store",
  headers:{"Content-Type":"application/json"},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!response.ok){
  const v=await response.json().catch(()=>({error:"Request failed"}));
  throw new Error(v.error||"Unable to update account");
 }
 return response.status===204?undefined:response.json();
}
export default function AdminAccounts({apiBase,users,selfUserId,onChanged}:Props){
 const [audit,setAudit]=useState<Event[]>([]);
 const [selected,setSelected]=useState("");
 const [password,setPassword]=useState("");
 const [reason,setReason]=useState<Reason>("security_review");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const user=users.find(u=>u.id===selected);
 useEffect(()=>{
  let active=true;
  call(apiBase,"/api/admin/security-audit").then((items:Event[])=>{
   if(active)setAudit(items);
  }).catch((err:Error)=>{if(active)setError(err.message)});
  return ()=>{active=false};
 },[apiBase,users]);
 async function changeStatus(){
  if(!user||user.global_role==="admin")return;
  const active=!user.active;
  if(!window.confirm((active?"Reactivate ":"Suspend ")+user.email+"? All prior sessions will be revoked."))return;
  setBusy(true);setError("");setMessage("");
  try{
   await call(apiBase,"/api/admin/users/"+user.id+"/status",{active,reason});
   setMessage("Account status updated and existing sessions revoked.");
   onChanged();
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 async function resetPassword(){
  if(!user||user.global_role==="admin"||password.length<16||password.length>72)return;
  if(!window.confirm("Reset "+user.email+"'s password and revoke every existing session?"))return;
  setBusy(true);setError("");setMessage("");
  try{
   await call(apiBase,"/api/admin/users/"+user.id+"/reset-password",{new_password:password});
   setPassword("");setMessage("Password reset. Transfer the new credential securely.");
   onChanged();
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 return <section className="card">
  <div className="card-head"><div><h2><ShieldAlert size={18}/> Account administration</h2>
   <p>Global administrator only. Suspend accounts, rotate credentials, and audit changes.</p></div></div>
  {error&&<div className="browser-flow-error"><AlertTriangle size={16}/>{error}</div>}
  {message&&<p className="team-success"><CheckCircle2 size={16}/>{message}</p>}
  <div className="team-form">
   <label>Account
    <select value={selected} onChange={e=>{setSelected(e.target.value);setPassword("")}}>
     <option value="">Select a teammate</option>
     {users.filter(u=>u.id!==selfUserId).map(u=><option key={u.id} value={u.id}>
      {u.email} — {u.active?"Active":"Suspended"}
     </option>)}
    </select>
   </label>
   {user&&<div className="account-admin-actions">
    <div><span className="pill neutral">{user.global_role} · {user.active?"Active":"Suspended"}</span></div>
    {user.global_role==="member"?<>
     <label>Reason for access change
      <select value={reason} onChange={e=>setReason(e.target.value as Reason)}>
       {reasons.map(r=><option key={r} value={r}>{r.replaceAll("_"," ")}</option>)}
      </select>
     </label>
     <button className="button secondary" disabled={busy} type="button" onClick={changeStatus}>
      {busy?<Loader2 size={15} className="spin"/>:
       user.active?<UserX size={15}/>:<UserCheck size={15}/>}
      {user.active?"Suspend account":"Reactivate account"}
     </button>
     <label>Set replacement password (16–72 bytes)
      <input type="password" autoComplete="new-password" minLength={16}
       maxLength={72} value={password} onChange={e=>setPassword(e.target.value)}/>
     </label>
     <button className="button secondary" disabled={busy||password.length<16||password.length>72}
      type="button" onClick={resetPassword}><KeyRound size={15}/> Reset password & revoke sessions</button>
    </>:<p className="fine-print">Administrator credentials can only be changed by their owner.</p>}
   </div>}
  </div>
  <div className="team-audit account-audit">
   <strong>Recent account security changes</strong>
   {audit.length===0?<p className="muted small">No account security events yet.</p>:
    audit.slice(0,15).map(ev=><div key={ev.id}>
     <strong>{ev.subject_email}</strong>
     <p>{ev.action.replaceAll("_"," ")} · {ev.reason.replaceAll("_"," ")}</p>
     <small>By {ev.actor_email} · {new Date(ev.created_at).toLocaleString()}</small>
    </div>)}
  </div>
 </section>;
}
