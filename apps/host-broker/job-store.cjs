"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {allowedTarget}=require("../runner/policy.cjs");
const {validateFlow}=require("../runner/browser-flow.cjs");
const {FIXTURES}=require("./launcher.cjs");

const TERMINAL=new Set(["passed","failed","cancelled","interrupted"]);
const RECOVERABLE=new Set(["running","cancelling","recovery_pending"]);
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validStoredSpec(spec){
 if(!spec||typeof spec!=="object"||Array.isArray(spec)||
    !allowedTarget(spec.target_url,FIXTURES))return false;
 const fields=Object.keys(spec).sort();
 if(spec.kind==="smoke"){
   return JSON.stringify(fields)===JSON.stringify(
     ["kind","run_api","run_web","target_url"]) &&
     typeof spec.run_api==="boolean"&&typeof spec.run_web==="boolean"&&
     (spec.run_api||spec.run_web);
 }
 if(spec.kind==="flow"){
   return JSON.stringify(fields)===JSON.stringify(["kind","steps","target_url"]) &&
     validateFlow(spec.steps);
 }
 return false;
}

function validStoredJob(job){
 if(!job||typeof job!=="object"||Array.isArray(job)||
    !ID.test(job.id)||!["flow","smoke"].includes(job.kind)||
    !["queued","running","cancelling","recovery_pending",...TERMINAL].includes(job.status)||
    !validStoredSpec(job.spec)||job.spec.kind!==job.kind||
    !ISO.test(job.created_at)||!ISO.test(job.updated_at)||
    (job.started_at!==null&&!ISO.test(job.started_at))||
    (job.finished_at!==null&&!ISO.test(job.finished_at))||
    typeof job.failure_kind!=="string"||job.failure_kind.length>80||
    !Number.isInteger(job.check_count)||job.check_count<0||job.check_count>20)return false;
 return true;
}

class JobStore {
  constructor(dir=path.join(process.cwd(),".gqa-broker-state")){
    this.dir=dir;
    this.file=path.join(dir,"jobs.json");
    this.jobs=[];
  }
  load(){
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    if(fs.lstatSync(this.dir).isSymbolicLink())throw new Error("Unsafe broker directory");
    if(!fs.existsSync(this.file)){this.jobs=[];return}
    if(fs.lstatSync(this.file).isSymbolicLink())throw new Error("Unsafe broker state link");
    const size=fs.statSync(this.file).size;
    if(size>2400000)throw new Error("Broker journal unexpectedly large");
    const value=JSON.parse(fs.readFileSync(this.file,"utf8"));
    if(!Array.isArray(value)||value.length>150||value.some(j=>
      !validStoredJob(j)||JSON.stringify(j.spec).length>16000)) {
      throw new Error("Invalid broker journal; refusing to resume");
    }
    if(new Set(value.map(j=>j.id)).size!==value.length)throw new Error("Duplicate broker job");
    this.jobs=value;
  }
  save(){
    // Persist every transition before acting. Atomically replace the journal;
    // never persist result screenshots, session cookies, or API tokens.
    const records=this.jobs.filter(j=>!TERMINAL.has(j.status));
    const terminal=this.jobs.filter(j=>TERMINAL.has(j.status)).slice(-100);
    this.jobs=[...records,...terminal].sort((a,b)=>a.created_at.localeCompare(b.created_at));
    const temp=this.file+"."+process.pid+"."+crypto.randomBytes(6).toString("hex")+".tmp";
    const buffer=JSON.stringify(this.jobs);
    if(buffer.length>2400000)throw new Error("Broker journal capacity exceeded");
    try {
      fs.writeFileSync(temp,buffer,{mode:0o600,flag:"wx"});
      const fd=fs.openSync(temp,"r");
      try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      fs.renameSync(temp,this.file);
      fs.chmodSync(this.file,0o600);
      // The directory entry must also be synced on POSIX to make the
      // rename resilient to sudden power loss, not only process crashes.
      if(process.platform!=="win32"){
        const directory=fs.openSync(this.dir,"r");
        try{fs.fsyncSync(directory)}finally{fs.closeSync(directory)}
      }
    } finally {
      if(fs.existsSync(temp))fs.unlinkSync(temp);
    }
  }
  get(id){return this.jobs.find(j=>j.id===id)}
  list(){return this.jobs.slice().reverse()}
  pending(){return this.jobs.filter(j=>["queued","running","cancelling"].includes(j.status))}
  queued(){return this.jobs.find(j=>j.status==="queued")}
  recoverable(){return this.jobs.filter(j=>RECOVERABLE.has(j.status))}
  create(spec){
    if(!validStoredSpec(spec))throw new Error("Refusing unapproved broker job");
    const stamp=new Date().toISOString();
    const record={id:crypto.randomUUID(),kind:spec.kind,spec,status:"queued",
      created_at:stamp,updated_at:stamp,started_at:null,finished_at:null,
      failure_kind:"",check_count:0};
    const before=this.jobs;
    this.jobs=[...before,record];
    try{this.save()}catch(err){this.jobs=before;throw err}
    return record;
  }
  transition(id,changes){
    const item=this.get(id);
    if(!item)throw new Error("Unknown broker job");
    const before=this.jobs;
    const revised={...item,...changes,updated_at:new Date().toISOString()};
    this.jobs=before.map(j=>j.id===id?revised:j);
    try{this.save()}catch(err){this.jobs=before;throw err}
    return revised;
  }
}

function publicJob(item){
 return {
   id:item.id,kind:item.kind,status:item.status,
   created_at:item.created_at,updated_at:item.updated_at,
   started_at:item.started_at,finished_at:item.finished_at,
   failure_kind:item.failure_kind||"",check_count:item.check_count||0
 };
}
module.exports={JobStore,publicJob,TERMINAL,ID,validStoredSpec,validStoredJob};
