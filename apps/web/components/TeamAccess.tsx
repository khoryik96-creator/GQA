"use client";

import {useEffect,useState,type FormEvent} from "react";
import {AlertTriangle,CheckCircle2,Loader2,ShieldCheck,UserPlus,Users,X} from "lucide-react";
import AdminAccounts from "./AdminAccounts";

type Role="owner"|"qa"|"reviewer"|"viewer";
type Member={user_id:string;email:string;role:Role;added_at:string};
type User={id:string;email:string;global_role:string;active:boolean};
type Audit={id:string;action:string;old_role:string;new_role:string;actor_email:string;subject_email:string;created_at:string};
type Props={projectId:string;apiBase:string;isAdmin:boolean;selfUserId:string};
async function api<T>(base:string,path:string,init?:RequestInit):Promise<T>{
 const res=await fetch(base+path,{
   ...init,credentials:"include",cache:"no-store",
   headers:{"Content-Type":"application/json",...(init?.headers||{})}
 });
 if(!res.ok){
   const body=await res.json().catch(()=>({error:"Request failed"}));
   throw new Error(body.error||"Request failed");
 }
 if(res.status===204)return undefined as T;
 return res.json() as Promise<T>;
}
const roles:Role[]=["owner","qa","reviewer","viewer"];
const meanings:Record<Role,string>={
 owner:"Manage project members, write tests and approve corrections",
 qa:"Create plans, edit memory and execute approved tests",
 reviewer:"Read history and confirm verified repairs",
 viewer:"Read project history and evidence only"
};

export default function TeamAccess({projectId,apiBase,isAdmin,selfUserId}:Props){
 const [members,setMembers]=useState<Member[]>([]);
 const [audit,setAudit]=useState<Audit[]>([]);
 const [users,setUsers]=useState<User[]>([]);
 const [email,setEmail]=useState("");
 const [role,setRole]=useState<Role>("qa");
 const [newEmail,setNewEmail]=useState("");
 const [newPassword,setNewPassword]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [refresh,setRefresh]=useState(0);
 const prefix="/api/projects/"+projectId;
 useEffect(()=>{
  let cancelled=false;
  Promise.all([
    api<Member[]>(apiBase,prefix+"/members"),
    api<Audit[]>(apiBase,prefix+"/access-audit"),
    isAdmin?api<User[]>(apiBase,"/api/admin/users"):Promise.resolve([] as User[])
  ]).then(([m,a,u])=>{
   if(!cancelled){setMembers(m);setAudit(a);setUsers(u);}
  }).catch((err:Error)=>{if(!cancelled)setError(err.message)});
  return ()=>{cancelled=true};
 },[apiBase,prefix,isAdmin,refresh]);

 async function addMember(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError("");setMessage("");
  try{
   await api(apiBase,prefix+"/members",{method:"POST",
     body:JSON.stringify({email,role})});
   setEmail("");setMessage("Project access updated.");setRefresh(v=>v+1);
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 async function createUser(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError("");setMessage("");
  try{
   await api(apiBase,"/api/admin/users",{method:"POST",
     body:JSON.stringify({email:newEmail,password:newPassword})});
   setNewEmail("");setNewPassword("");
   setMessage("Account created. Assign a project role before the user can access project data.");
   setRefresh(v=>v+1);
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 async function removeMember(member:Member){
  if(member.user_id===selfUserId)return;
  if(!window.confirm("Revoke "+member.email+"'s access to this project?"))return;
  setBusy(true);setError("");setMessage("");
  try{
   await api(apiBase,prefix+"/members/"+member.user_id,{method:"DELETE"});
   setMessage("Project access revoked.");setRefresh(v=>v+1);
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 return <div className="team-grid">
  <section className="card">
   <div className="card-head"><div><h2><Users size={18}/> Project team</h2><p>Roles are enforced on the API, including test runs, memory and screenshots.</p></div></div>
   {error&&<div className="browser-flow-error"><AlertTriangle size={16}/>{error}</div>}
   {message&&<p className="team-success"><CheckCircle2 size={16}/>{message}</p>}
   <div className="team-members">
    {members.length===0&&<p className="muted small">No project-level team members assigned yet. Global administrators have access by default.</p>}
    {members.map(member=><div className="team-member" key={member.user_id}>
     <div><strong>{member.email}</strong><small>{meanings[member.role]}</small></div>
     <span className="pill neutral">{member.role}</span>
     {member.user_id!==selfUserId&&<button className="icon-btn" type="button"
       title={"Revoke "+member.email} disabled={busy} onClick={()=>removeMember(member)}><X size={16}/></button>}
    </div>)}
   </div>
   <form onSubmit={addMember} className="team-form">
    <h3><ShieldCheck size={16}/> Assign or change project access</h3>
    <label>Existing account email<input required type="email" value={email} maxLength={254}
       onChange={e=>setEmail(e.target.value)} placeholder="qa@example.com"/></label>
    <label>Role<select value={role} onChange={e=>setRole(e.target.value as Role)}>
      {roles.map(r=><option key={r} value={r}>{r} — {meanings[r]}</option>)}
    </select></label>
    <button className="button primary" type="submit" disabled={busy}>
     {busy?<Loader2 size={15} className="spin"/>:<UserPlus size={15}/>} Save access
    </button>
   </form>
  </section>
  <div className="team-side">
   {isAdmin&&<section className="card">
    <div className="card-head"><div><h2><UserPlus size={18}/> Create teammate account</h2>
      <p>Administrator-only provisioning. No public self-registration.</p></div></div>
    <form onSubmit={createUser} className="team-form">
     <label>Email<input required type="email" maxLength={254}
       value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="teammate@example.com"/></label>
     <label>Temporary password (16–72 characters)<input required type="password" minLength={16}
       maxLength={72} autoComplete="new-password"
       value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
     <p className="fine-print">Share the password securely outside GQA. Accounts have no project access until assigned above.</p>
     <button className="button secondary" disabled={busy} type="submit">
      {busy?<Loader2 size={15} className="spin"/>:<UserPlus size={15}/>} Create account
     </button>
    </form>
    <p className="small muted">{users.length} account(s) registered, including administrator.</p>
   </section>}
   {isAdmin&&<AdminAccounts apiBase={apiBase} users={users} selfUserId={selfUserId}
     onChanged={()=>setRefresh(v=>v+1)}/>}
   <section className="card">
    <div className="card-head"><div><h2>Access change history</h2><p>Who granted, changed or revoked membership.</p></div></div>
    {audit.length===0?<p className="muted small">No access changes recorded.</p>:
      <div className="team-audit">{audit.slice(0,20).map(a=><div key={a.id}>
       <strong>{a.subject_email}</strong><p>{a.action==="revoke"?"Access revoked":
         "Role "+(a.old_role||"unassigned")+" → "+a.new_role}</p>
       <small>By {a.actor_email} · {new Date(a.created_at).toLocaleString()}</small>
      </div>)}</div>}
   </section>
  </div>
 </div>;
}
