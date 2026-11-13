"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { allowedTarget } = require("./policy.cjs");
const { validateFlow } = require("./browser-flow.cjs");
const { runIsolatedJob } = require("./job-supervisor.cjs");

const PORT=Number(process.env.PORT||8090);
const ALLOWLIST=process.env.GQA_SMOKE_TARGETS||"http://fixture:8081";
const TOKEN=process.env.GQA_RUNNER_TOKEN||"";
const BODY_LIMIT=16384;
let running=false;

function tokenMatches(actual,expected){
 if(typeof actual!=="string"||!expected)return false;
 const a=Buffer.from(actual),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function send(res,status,payload){
 if(res.destroyed||res.headersSent)return;
 res.writeHead(status,{"content-type":"application/json",
  "cache-control":"no-store","x-content-type-options":"nosniff"});
 res.end(JSON.stringify(payload));
}
const server=http.createServer((req,res)=>{
 if(req.method==="GET"&&req.url==="/healthz")
  return send(res,200,{status:"ok",busy:running,mode:"one-shot-job-process"});
 if(req.method!=="POST"||!["/run","/flow"].includes(req.url))
  return send(res,404,{error:"Not found"});
 if(!tokenMatches(req.headers["x-gqa-runner-token"],TOKEN))
  return send(res,401,{error:"Unauthorized"});
 if(running)return send(res,429,{error:"Runner busy"});

 // Reserve the ONLY worker slot before consuming the request body. Previously
 // two clients could both pass the busy check while streaming concurrently.
 running=true;
 let launched=false,released=false,aborted=false,tooLarge=false,bytes=0;
 const chunks=[];
 const release=()=>{
  if(released)return;
  released=true;running=false;
 };
 req.once("aborted",()=>{aborted=true;if(!launched)release();});
 req.once("error",()=>{aborted=true;if(!launched)release();});
 req.once("close",()=>{if(!req.complete&&!launched)release();});
 req.on("data",chunk=>{
  if(tooLarge||aborted)return;
  bytes+=chunk.length;
  if(bytes>BODY_LIMIT){tooLarge=true;chunks.length=0;return;}
  chunks.push(chunk);
 });
 req.on("end",async()=>{
  if(aborted){if(!launched)release();return;}
  if(tooLarge){release();return send(res,413,{error:"Payload exceeds limit"});}
  let input;
  try{input=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch{release();return send(res,400,{error:"Invalid JSON"});}
  if(!input||typeof input!=="object"||Array.isArray(input)||
    !allowedTarget(input.target_url,ALLOWLIST)){
   release();return send(res,403,{error:"Target is not approved"});
  }
  const kind=req.url==="/flow"?"flow":"smoke";
  if(kind==="flow"&&!validateFlow(input.steps)){
   release();return send(res,400,{error:"Browser flow is not valid"});
  }
  if(kind==="smoke"&&(typeof input.run_api!=="boolean"||
    typeof input.run_web!=="boolean"||(!input.run_api&&!input.run_web))){
   release();return send(res,400,{error:"Invalid smoke request"});
  }
  launched=true;
  try{
   const result=await runIsolatedJob({
    kind,target_url:input.target_url,
    ...(kind==="flow"?{steps:input.steps}:
      {run_api:input.run_api,run_web:input.run_web})
   });
   send(res,200,result);
  }catch{
   send(res,500,{error:"Unable to complete isolated job"});
  }finally{release();}
 });
});
server.requestTimeout=65000;
server.headersTimeout=10000;
server.listen(PORT,"0.0.0.0",()=>console.log("GQA one-shot worker supervisor ready on "+PORT));
