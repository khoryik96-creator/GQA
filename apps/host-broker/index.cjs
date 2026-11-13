"use strict";
const http=require("node:http");
const crypto=require("node:crypto");
const {allowedTarget}=require("../runner/policy.cjs");
const {validateFlow}=require("../runner/browser-flow.cjs");
const {FIXTURES,safeProjectName}=require("./launcher.cjs");
const {JobStore,ID}=require("./job-store.cjs");
const {Scheduler}=require("./scheduler.cjs");

const TOKEN=process.env.GQA_RUNNER_TOKEN||"";
const PROJECT=process.env.GQA_COMPOSE_PROJECT||"gqa";
const HOST=process.env.GQA_HOST_BROKER_BIND||"127.0.0.1";
const PORT=Number(process.env.GQA_HOST_BROKER_PORT||18090);
if(TOKEN.length<24||!safeProjectName(PROJECT) ||
  !Number.isInteger(PORT)||PORT<1024||PORT>65535) {
  throw new Error("Set a strong GQA_RUNNER_TOKEN and valid local project/port");
}
const scheduler=new Scheduler({
  store:new JobStore(process.env.GQA_BROKER_STATE_DIR),project:PROJECT
});

function tokenOK(value){
  const a=Buffer.from(value||""),b=Buffer.from(TOKEN);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function respond(res,status,value){
  res.writeHead(status,{"content-type":"application/json",
    "cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(JSON.stringify(value));
}
function readJSON(req){
  return new Promise((resolve,reject)=>{
    let size=0,parts=[],tooLarge=false;
    req.on("data",chunk=>{
      size+=chunk.length;
      if(size>16384){tooLarge=true;parts=[]}
      else if(!tooLarge)parts.push(chunk);
    });
    req.once("end",()=>{
      if(tooLarge)return reject(Object.assign(new Error("Request too large"),{status:413}));
      try{resolve(JSON.parse(Buffer.concat(parts).toString()))}
      catch{reject(Object.assign(new Error("Invalid JSON"),{status:400}))}
    });
    req.once("error",reject);
  });
}
function jobFromInput(kind,input){
  if(!input||typeof input!=="object"||Array.isArray(input)||
     !allowedTarget(input.target_url,FIXTURES)) {
    throw Object.assign(new Error("Only built-in fixtures are allowed"),{status:403});
  }
  if(kind==="flow"){
    if(!validateFlow(input.steps))
      throw Object.assign(new Error("Invalid browser flow"),{status:400});
    return {kind,target_url:input.target_url,steps:input.steps};
  }
  if(kind==="smoke"){
    if(typeof input.run_api!=="boolean"||typeof input.run_web!=="boolean"||
      (!input.run_api&&!input.run_web))
      throw Object.assign(new Error("Invalid smoke job"),{status:400});
    return {kind,target_url:input.target_url,run_api:input.run_api,run_web:input.run_web};
  }
  throw Object.assign(new Error("Unknown QA job type"),{status:400});
}
const server=http.createServer(async(req,res)=>{
  const route=(req.url||"").split("?")[0];
  if(req.method==="GET"&&route==="/healthz") {
    return respond(res,scheduler.ready?200:503,{
      status:scheduler.ready?"ok":"recovering",
      mode:"ephemeral_container",pending:scheduler.store.pending().length,
      queue_capacity:scheduler.capacity,
      recovery_required:!scheduler.ready
    });
  }
  // No job status, cancellation or execution is exposed anonymously.
  if(!tokenOK(req.headers["x-gqa-runner-token"]))
    return respond(res,401,{error:"Unauthorized"});
  if(req.method==="GET"&&route==="/jobs")
    return respond(res,200,scheduler.list().slice(0,100));
  const jobRoute=/^\/jobs\/([a-f0-9-]{36})(\/cancel|\/result)?$/.exec(route);
  if(jobRoute){
    const id=jobRoute[1];
    if(!ID.test(id))return respond(res,400,{error:"Invalid job identity"});
    if(req.method==="GET"&&jobRoute[2]==="/result"){
      const result=scheduler.getResult(id);
      return respond(res,result?200:404,result||{error:"Job evidence not found"});
    }
    if(req.method==="GET"&&!jobRoute[2]){
      const job=scheduler.get(id);
      return respond(res,job?200:404,job||{error:"Job not found"});
    }
    if(req.method==="POST"&&jobRoute[2]){
      const job=await scheduler.cancel(id);
      return respond(res,job?200:404,job||{error:"Job not found"});
    }
    return respond(res,405,{error:"Method not allowed"});
  }
  if(req.method!=="POST"||!["/run","/flow","/jobs"].includes(route))
    return respond(res,404,{error:"Not found"});
  try{
    const input=await readJSON(req);
    const kind=route==="/jobs"?input?.kind:route==="/flow"?"flow":"smoke";
    const job=jobFromInput(kind,input);
    if(route==="/jobs"){
      const queued=scheduler.enqueue(job);
      return respond(res,202,queued);
    }
    // Compatibility: existing Go API expects the original synchronous
    // runner response. The queue endpoint is asynchronous and opt-in.
    const submitted=scheduler.submitSync(job);
    const result=await submitted.done;
    return respond(res,200,result);
  }catch(err){
    return respond(res,err.status||500,{error:err.status?err.message:"Unable to schedule job"});
  }
});
server.requestTimeout=70000;
// Bind the intended endpoint before executing queued work. The old order
// could launch a job even when the port was already owned by another broker.
server.once("error",()=>{
  process.stderr.write("Host broker cannot bind its authorized endpoint.\n");
  process.exitCode=1;
  scheduler.store.releaseLease();
});
server.listen(PORT,HOST,async()=>{
  try{
    scheduler.store.acquireLease();
    await scheduler.start();
    console.log("GQA broker: durable local jobs enabled on "+HOST+":"+PORT);
  }catch(err){
    process.stderr.write("Broker startup/lease recovery failed: "+err.message+"\n");
    scheduler.store.releaseLease();
    server.close();
    process.exitCode=1;
  }
});
function shutdown(){
  // A forced stop can still leave a running job; the durable journal then
  // requires container reconciliation on the next startup.
  server.close(()=>{scheduler.store.releaseLease();process.exit(0)});
  setTimeout(()=>{scheduler.store.releaseLease();process.exit(1)},5000).unref();
}
process.once("SIGINT",shutdown);
process.once("SIGTERM",shutdown);
process.once("exit",()=>scheduler.store.releaseLease());
