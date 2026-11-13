"use client";

import {useState,type FormEvent} from "react";
import {AlertTriangle,CheckCircle2,KeyRound,Loader2,LogOut,ShieldCheck,X} from "lucide-react";

type Props={apiBase:string;email:string;onClose:()=>void;onSignedOut:()=>void};

export default function AccountSecurity({apiBase,email,onClose,onSignedOut}:Props){
 const [current,setCurrent]=useState("");
 const [replacement,setReplacement]=useState("");
 const [repeat,setRepeat]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 async function post(path:string,body:object){
  const response=await fetch(apiBase+path,{
   method:"POST",credentials:"include",cache:"no-store",
   headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  if(!response.ok){
   const data=await response.json().catch(()=>({error:"Request failed"}));
   throw new Error(data.error || "Account update failed");
  }
 }
 async function changePassword(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(replacement!==repeat){setError("New passwords do not match.");return}
  setBusy(true);setError("");setSuccess("");
  try{
   await post("/api/auth/password",{current_password:current,new_password:replacement});
   setCurrent("");setReplacement("");setRepeat("");
   onSignedOut();
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 async function revokeAll(){
  if(!window.confirm("Sign out every device and browser using your GQA account?"))return;
  setBusy(true);setError("");setSuccess("");
  try{
   await post("/api/auth/revoke-sessions",{});
   onSignedOut();
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 return <section className="card account-security">
  <div className="card-head">
   <div><h2><ShieldCheck size={18}/> Account security</h2>
    <p>Manage credentials and active sessions for {email}.</p></div>
   <button className="icon-btn" type="button" title="Close account security" onClick={onClose}>
    <X size={18}/>
   </button>
  </div>
  {error&&<div className="browser-flow-error"><AlertTriangle size={16}/>{error}</div>}
  {success&&<p className="team-success"><CheckCircle2 size={16}/>{success}</p>}
  <div className="account-security-grid">
   <form onSubmit={changePassword} className="team-form">
    <h3><KeyRound size={16}/> Change your password</h3>
    <label>Current password<input required type="password" autoComplete="current-password"
      maxLength={256} value={current} onChange={e=>setCurrent(e.target.value)}/></label>
    <label>New password (16–72 bytes)<input required type="password"
      autoComplete="new-password" minLength={16} maxLength={72}
      value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>
    <label>Repeat new password<input required type="password"
      autoComplete="new-password" minLength={16} maxLength={72}
      value={repeat} onChange={e=>setRepeat(e.target.value)}/></label>
    <p className="fine-print">Use a unique password. After changing it, all sessions are revoked and you'll sign in again.</p>
    <button className="button primary" disabled={busy||!replacement||replacement!==repeat}
      type="submit">{busy?<Loader2 size={15} className="spin"/>:<KeyRound size={15}/>} Change password</button>
   </form>
   <div className="account-sessions">
    <h3><LogOut size={16}/> Sign out everywhere</h3>
    <p>Revoke every active session belonging to your account, including this browser.</p>
    <button className="button secondary" type="button" disabled={busy} onClick={revokeAll}>
     <LogOut size={15}/> Revoke all sessions
    </button>
    <p className="fine-print">A test that has already started might finish; revocation blocks subsequent API calls.</p>
   </div>
  </div>
 </section>;
}
