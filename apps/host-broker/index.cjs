"use strict";
const http=require("node:http");
const crypto=require("node:crypto");
const {allowedTarget}=require("../runner/policy.cjs");
const {validateFlow}=require("../runner/browser-flow.cjs");
const {executeJob,FIXTURES,safeProjectName}=require("./launcher.cjs");

const TOKEN=process.env.GQA_RUNNER_TOKEN||"";
const PROJECT=process.env.GQA_COMPOSE_PROJECT||"gqa";
const HOST=process.env.GQA_HOST_BROKER_BIND||"127.0.0.1";
const PORT=Number(process.env.GQA_HOST_BROKER_PORT||18090);
if(TOKEN.length<24||!safeProjectName(PROJECT) ||
  !Number.isInteger(PORT)||PORT<1024||PORT>65535) {
  throw new Error("Set a strong GQA_RUNNER_TOKEN and valid local project/port");
}
let running=false;
function tokenOK(input){
  const a=Buffer.from(input||""),b=Buffer.from(TOKEN);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function send(res,status,value){
  res.writeHead(status,{"content-type":"application/json","cache-control":"no-store",
    "x-content-type-options":"nosniff"});
  res.end(JSON.stringify(value));
}
const server=http.createServer((req,res)=>{
  if(req.method==="GET" && req.url==="/healthz") {
    return send(res,200,{status:"ok",mode:"ephemeral_container",busy:running});
  }
  if(req.method!=="POST"||!["/run","/flow"].includes(req.url))return send(res,404,{error:"Not found"});
  if(!tokenOK(req.headers["x-gqa-runner-token"]))return send(res,401,{error:"Unauthorized"});
  if(running)return send(res,429,{error:"One local container job at a time"});
  let bytes=0,parts=[],tooLarge=false;
  req.on("data",chunk=>{bytes+=chunk.length;if(bytes>16384){tooLarge=true;parts=[];}
    else if(!tooLarge)parts.push(chunk)});
  req.on("end",async()=>{
    if(tooLarge)return send(res,413,{error:"Job request too large"});
    let input;
    try{input=JSON.parse(Buffer.concat(parts).toString())}
    catch{return send(res,400,{error:"Invalid JSON"})}
    if(!input||typeof input!=="object"||Array.isArray(input)||
      !allowedTarget(input.target_url,FIXTURES)) {
      return send(res,403,{error:"Only built-in demo fixtures are permitted"});
    }
    const kind=req.url==="/flow"?"flow":"smoke";
    if(kind==="flow"?!validateFlow(input.steps):
      typeof input.run_api!=="boolean"||typeof input.run_web!=="boolean"||
      (!input.run_api&&!input.run_web))return send(res,400,{error:"Invalid QA job"});
    const job={kind,target_url:input.target_url,
      ...(kind==="flow"?{steps:input.steps}:{run_api:input.run_api,run_web:input.run_web})};
    running=true;
    try{send(res,200,await executeJob(job,{project:PROJECT,
      timeoutMs:kind==="smoke"?24000:55000}))}
    finally{running=false}
  });
});
server.requestTimeout=65000;
server.listen(PORT,HOST,()=>console.log("GQA local experimental host broker listening on "+HOST+":"+PORT));
