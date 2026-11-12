"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const TERMINAL=new Set(["passed","failed","cancelled","interrupted"]);
const RECOVERABLE=new Set(["running","cancelling","recovery_pending"]);
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
      !j||!ID.test(j.id)||!["flow","smoke"].includes(j.kind)||
      !["queued","running","cancelling","recovery_pending",...TERMINAL].includes(j.status)||
      !j.spec||JSON.stringify(j.spec).length>16000)) {
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
    const stamp=new Date().toISOString();
    const record={id:crypto.randomUUID(),kind:spec.kind,spec,status:"queued",
      created_at:stamp,updated_at:stamp,started_at:null,finished_at:null,
      failure_kind:"",check_count:0};
    this.jobs.push(record);this.save();return record;
  }
  transition(id,changes){
    const item=this.get(id);
    if(!item)throw new Error("Unknown broker job");
    Object.assign(item,changes,{updated_at:new Date().toISOString()});
    this.save();return item;
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
module.exports={JobStore,publicJob,TERMINAL,ID};
