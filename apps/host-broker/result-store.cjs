"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const ID=/^[a-f0-9-]{36}$/;
function syncDirectory(dir){
 if(process.platform==="win32")return;
 const fd=fs.openSync(dir,"r");
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function validPersistedResult(result,id){
 return !!result && typeof result==="object" && !Array.isArray(result) &&
  Object.keys(result).sort().join(",")==="checks,evidence,screenshot_base64" &&
  Array.isArray(result.checks) && result.checks.length>=1 && result.checks.length<=20 &&
  result.checks.every(c=>c && typeof c==="object" &&
   Object.keys(c).sort().join(",")==="detail,duration_ms,name,status" &&
   typeof c.name==="string" && c.name.length<=120 &&
   typeof c.detail==="string" && c.detail.length<=400 &&
   ["passed","failed"].includes(c.status) &&
   Number.isInteger(c.duration_ms) && c.duration_ms>=0) &&
  typeof result.screenshot_base64==="string" &&
  result.screenshot_base64.length<=1400000 &&
  /^[a-zA-Z0-9+/=]*$/.test(result.screenshot_base64) &&
  !!result.evidence && typeof result.evidence==="object" &&
  Object.keys(result.evidence).sort().join(",")==="failure_kind,job_id,worker_lifecycle" &&
  result.evidence.job_id===id &&
  result.evidence.worker_lifecycle==="ephemeral_container" &&
  typeof result.evidence.failure_kind==="string" &&
  result.evidence.failure_kind.length<=80;
}
class ResultStore{
 constructor(root){this.dir=path.join(root,"results")}
 file(id){if(!ID.test(id))throw Error("Invalid job ID");return path.join(this.dir,id+".json")}
 exists(id){return ID.test(id)&&fs.existsSync(this.file(id))}
 save(id,result){
  if(!result||!Array.isArray(result.checks)||!result.checks.length||result.checks.length>20)
   throw Error("Invalid job checks");
  const checks=result.checks.map(c=>({
   name:String(c.name||"").slice(0,120),
   detail:String(c.detail||"").slice(0,400),
   status:c.status==="passed"?"passed":"failed",
   duration_ms:Number.isFinite(c.duration_ms)?Math.max(0,Math.round(c.duration_ms)):0
  }));
  const image=typeof result.screenshot_base64==="string"&&
   result.screenshot_base64.length<=1400000&&
   /^[a-zA-Z0-9+/=]*$/.test(result.screenshot_base64)?result.screenshot_base64:"";
  const ev=result.evidence||{};
  const evidence={job_id:id,worker_lifecycle:"ephemeral_container",
   failure_kind:String(ev.failure_kind||"unknown").slice(0,80)};
  const raw=JSON.stringify({checks,screenshot_base64:image,evidence});
  if(Buffer.byteLength(raw)>1900000)throw Error("Evidence exceeds quota");
  fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
  if(fs.lstatSync(this.dir).isSymbolicLink())throw Error("Unsafe result directory");
  const dest=this.file(id);
  if(fs.existsSync(dest))throw Error("Result already stored");
  const temp=dest+"."+crypto.randomBytes(6).toString("hex")+".tmp";
  try{
   fs.writeFileSync(temp,raw,{mode:0o600,flag:"wx"});
   const fd=fs.openSync(temp,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
   fs.renameSync(temp,dest);
   // Persist the directory entry as well as the file contents: a durable
   // successful worker result must survive a sudden host power loss.
   syncDirectory(this.dir);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
 }
 get(id){
  const p=this.file(id);
  let info;
  try{info=fs.lstatSync(p)}
  catch(err){if(err.code==="ENOENT")return null;throw err}
  if(!info.isFile()||info.isSymbolicLink()||info.size>1900000||info.size===0)
    throw new Error("Stored job evidence is invalid");
  let value;
  try{value=JSON.parse(fs.readFileSync(p,"utf8"))}
  catch(err){
   if(err instanceof SyntaxError)throw new Error("Stored job evidence is invalid");
   throw err;
  }
  if(!validPersistedResult(value,id))
    throw new Error("Stored job evidence is invalid");
  return value;
 }
 discard(id){
  const p=this.file(id);
  let info;
  try{info=fs.lstatSync(p)}
  catch(err){if(err.code==="ENOENT")return;throw err}
  if(!info.isFile()||info.isSymbolicLink())
    throw new Error("Unsafe broker result file");
  fs.unlinkSync(p);
  syncDirectory(this.dir);
 }
 prune(ids){
  if(!fs.existsSync(this.dir))return;
  for(const name of fs.readdirSync(this.dir)){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
   const id=name.slice(0,-5);
   if(!ids.has(id))fs.rmSync(this.file(id),{force:true});
  }
 }
}
module.exports={ResultStore};
