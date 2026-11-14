"use client";

import {useEffect,useState,type FormEvent} from "react";
import {AlertTriangle,CheckCircle2,Cpu,Eye,EyeOff,KeyRound,Loader2,PlugZap,ShieldCheck,X} from "lucide-react";

type ProviderName="deepseek"|"openai"|"gemini"|"anthropic"|"custom";
type ProviderView={
 provider:ProviderName;key_configured:boolean;key_hint:string;key_source:""|"dashboard"|"environment";key_unreadable:boolean;
 model:string;default_model:string;endpoint:string;default_endpoint:string;
};
type SettingsView={
 source:"dashboard"|"environment";provider:ProviderName;send_project_context:boolean;
 ready:boolean;active_label:string;encryption_available:boolean;providers:ProviderView[];updated_at?:string;
};
type Draft={api_key:string;clear_key:boolean;model:string;endpoint:string};
type TestResult={ok:boolean;provider:string;latency_ms:number;error?:string};

const meta:Record<ProviderName,{label:string;hint:string;keyUrl?:string}>={
 deepseek:{label:"DeepSeek",hint:"Lowest cost. Default model deepseek-v4-flash; deepseek-v4-pro for deeper reviews.",keyUrl:"https://platform.deepseek.com/api_keys"},
 openai:{label:"OpenAI (GPT)",hint:"Chat Completions API.",keyUrl:"https://platform.openai.com/api-keys"},
 gemini:{label:"Google Gemini",hint:"OpenAI-compatible endpoint. Enter a model name, e.g. a current Gemini Flash model.",keyUrl:"https://aistudio.google.com/apikey"},
 anthropic:{label:"Anthropic Claude",hint:"Official SDK. Default claude-opus-5-5; claude-sonnet-5-5 or claude-haiku-5-5 cost less.",keyUrl:"https://console.anthropic.com/settings/keys"},
 custom:{label:"Custom (OpenAI-compatible)",hint:"Any HTTPS chat completions endpoint. Endpoint and model are required."},
};

async function api<T>(base:string,path:string,init?:RequestInit):Promise<T>{
 const res=await fetch(base+path,{...init,credentials:"include",cache:"no-store",
  headers:{"Content-Type":"application/json",...(init?.headers||{})}});
 if(!res.ok){
  const body=await res.json().catch(()=>({error:"Request failed"}));
  throw new Error(body.error||"Request failed");
 }
 return res.json() as Promise<T>;
}

function emptyDrafts(view:SettingsView):Record<string,Draft>{
 const out:Record<string,Draft>={};
 for(const p of view.providers)out[p.provider]={api_key:"",clear_key:false,model:p.model,endpoint:p.endpoint};
 return out;
}

export default function AiSettings({apiBase,onClose}:{apiBase:string;onClose:()=>void}){
 const [view,setView]=useState<SettingsView|null>(null);
 const [provider,setProvider]=useState<ProviderName>("deepseek");
 const [consent,setConsent]=useState(false);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [reveal,setReveal]=useState<Record<string,boolean>>({});
 const [busy,setBusy]=useState(false);
 const [testing,setTesting]=useState(false);
 const [error,setError]=useState("");
 const [saved,setSaved]=useState("");
 const [test,setTest]=useState<TestResult|null>(null);

 function apply(v:SettingsView){
  setView(v);setProvider(v.provider);setConsent(v.send_project_context);setDrafts(emptyDrafts(v));
 }
 useEffect(()=>{
  api<SettingsView>(apiBase,"/api/admin/ai-settings").then(apply).catch(e=>setError((e as Error).message));
 },[apiBase]);

 function update(name:string,patch:Partial<Draft>){
  setDrafts(d=>({...d,[name]:{...d[name],...patch}}));setSaved("");
 }

 async function save(e:FormEvent){
  e.preventDefault();
  if(!view)return;
  setBusy(true);setError("");setSaved("");setTest(null);
  const providers:Record<string,object>={};
  for(const p of view.providers){
   const d=drafts[p.provider];
   const change:Record<string,unknown>={};
   if(d.api_key.trim())change.api_key=d.api_key.trim();
   else if(d.clear_key)change.clear_key=true;
   if(d.model!==p.model)change.model=d.model.trim();
   if(d.endpoint!==p.endpoint)change.endpoint=d.endpoint.trim();
   if(Object.keys(change).length)providers[p.provider]=change;
  }
  try{
   const next=await api<SettingsView>(apiBase,"/api/admin/ai-settings",{method:"POST",
    body:JSON.stringify({provider,send_project_context:consent,providers})});
   apply(next);setReveal({});
   setSaved(next.ready?"Saved. GQA will use "+next.active_label+".":"Saved, but AI features stay off until the selected provider has a key and sending project context is allowed.");
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }

 async function runTest(){
  setTesting(true);setTest(null);setError("");
  try{setTest(await api<TestResult>(apiBase,"/api/admin/ai-settings/test",{method:"POST",body:"{}"}))}
  catch(err){setError((err as Error).message)}
  finally{setTesting(false)}
 }

 const dirty=!!view&&(provider!==view.provider||consent!==view.send_project_context||
  view.providers.some(p=>{const d=drafts[p.provider];return d&&(d.api_key.trim()!==""||d.clear_key||d.model!==p.model||d.endpoint!==p.endpoint)}));

 return <section className="card modal-card ai-settings" aria-labelledby="ai-settings-title">
  <div className="card-head">
   <div>
    <h2 id="ai-settings-title"><Cpu size={18}/> AI settings</h2>
    <p>Choose the model provider for code review, QA planning and browser-flow drafting, and enter API keys. Keys are encrypted on the server and never shown again; only the last four characters are displayed.</p>
   </div>
   <button className="icon-btn" type="button" onClick={onClose} title="Close AI settings" aria-label="Close AI settings"><X size={18}/></button>
  </div>

  {!view?(error?<div className="warning-line" role="alert"><AlertTriangle size={15}/>{error}</div>
   :<p className="muted small"><Loader2 size={14} className="spin"/> Loading AI settings…</p>)
  :<form onSubmit={save}>
   <div className={"ai-status "+(view.ready?"ok":"off")} role="status">
    {view.ready?<CheckCircle2 size={16}/>:<AlertTriangle size={16}/>}
    <span>{view.ready?<>Active: <strong>{view.active_label}</strong></>:"AI features are off"}
     {" · "}{view.source==="dashboard"?"configured here":"using .env values (nothing saved here yet)"}</span>
   </div>
   {!view.encryption_available&&<div className="warning-line" role="alert"><AlertTriangle size={15}/>
    <span>API keys cannot be saved because <code>GQA_SECRETS_KEY</code> is not set. Run the installer again (it adds one) or add 32+ random characters to <code>.env</code>, then restart GQA.</span></div>}

   <fieldset className="ai-providers">
    <legend>Provider used by GQA</legend>
    {view.providers.map(p=>{
     const d=drafts[p.provider]||{api_key:"",clear_key:false,model:"",endpoint:""};
     const m=meta[p.provider];
     const selected=provider===p.provider;
     return <div key={p.provider} className={"ai-provider"+(selected?" selected":"")}>
      <label className="ai-provider-pick">
       <input type="radio" name="ai-provider" value={p.provider} checked={selected} onChange={()=>{setProvider(p.provider);setSaved("")}}/>
       <span><strong>{m.label}</strong><small>{m.hint}</small></span>
       <span className={"ai-key-state"+(p.key_unreadable?" bad":p.key_configured?" set":"")}>
        {p.key_unreadable?"Key unreadable, enter again":p.key_configured?(p.key_source==="environment"?"Key from .env":"Key ••••"+p.key_hint):"No key"}
       </span>
      </label>
      <div className="ai-provider-fields">
       <label>API key
        <span className="ai-key-input">
         <input type={reveal[p.provider]?"text":"password"} autoComplete="off" spellCheck={false}
          value={d.api_key} disabled={!view.encryption_available}
          placeholder={p.key_configured&&p.key_source==="dashboard"?"Saved (••••"+p.key_hint+"). Type to replace.":"Paste API key"}
          onChange={e=>update(p.provider,{api_key:e.target.value,clear_key:false})}/>
         <button type="button" className="icon-btn" onClick={()=>setReveal(r=>({...r,[p.provider]:!r[p.provider]}))}
          aria-label={(reveal[p.provider]?"Hide ":"Show ")+m.label+" key"} title={reveal[p.provider]?"Hide":"Show"}>
          {reveal[p.provider]?<EyeOff size={15}/>:<Eye size={15}/>}
         </button>
        </span>
       </label>
       <label>Model
        <input value={d.model} maxLength={200} spellCheck={false}
         placeholder={p.default_model?"Default: "+p.default_model:"Required"} onChange={e=>update(p.provider,{model:e.target.value})}/>
       </label>
       {p.provider==="custom"&&<label className="ai-wide">Endpoint (HTTPS chat completions URL)
        <input value={d.endpoint} maxLength={500} spellCheck={false} placeholder="https://…/v1/chat/completions"
         onChange={e=>update(p.provider,{endpoint:e.target.value})}/>
       </label>}
       <div className="ai-provider-links">
        {m.keyUrl&&<a href={m.keyUrl} target="_blank" rel="noreferrer">Get a {m.label} key</a>}
        {p.key_configured&&p.key_source==="dashboard"&&<label className="ai-clear">
         <input type="checkbox" checked={d.clear_key} onChange={e=>update(p.provider,{clear_key:e.target.checked,api_key:""})}/> Remove saved key
        </label>}
       </div>
      </div>
     </div>;
    })}
   </fieldset>

   <label className="ai-consent">
    <input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);setSaved("")}}/>
    <span><strong>Allow sending project context and source code to the selected provider</strong>
     <small>Required for AI features. Code review sends repository source files to this third party. Only enable it for code you are authorized to share.</small></span>
   </label>

   {error&&<div className="warning-line" role="alert"><AlertTriangle size={15}/>{error}</div>}
   {saved&&<div className="ai-saved" role="status"><ShieldCheck size={15}/>{saved}</div>}
   {test&&<div className={test.ok?"ai-saved":"warning-line"} role="status">
    {test.ok?<CheckCircle2 size={15}/>:<AlertTriangle size={15}/>}
    {test.ok?`Connection works: ${test.provider} answered in ${(test.latency_ms/1000).toFixed(1)}s.`:`${test.provider}: ${test.error}`}
   </div>}

   <div className="ai-actions">
    <button className="button primary" type="submit" disabled={busy||!dirty}>
     {busy?<Loader2 size={16} className="spin"/>:<KeyRound size={16}/>} Save settings
    </button>
    <button className="button secondary" type="button" onClick={runTest} disabled={testing||busy||dirty||!view.ready}
     title={dirty?"Save your changes first":!view.ready?"Configure a provider first":"Send one tiny request to the active provider"}>
     {testing?<Loader2 size={16} className="spin"/>:<PlugZap size={16}/>} Test connection
    </button>
   </div>
  </form>}
 </section>;
}
