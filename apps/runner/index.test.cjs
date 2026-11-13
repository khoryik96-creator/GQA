"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const net=require("node:net");
const {spawn}=require("node:child_process");
const path=require("node:path");

async function freePort(){
 const srv=net.createServer();
 await new Promise(resolve=>srv.listen(0,"127.0.0.1",resolve));
 const port=srv.address().port;
 await new Promise(resolve=>srv.close(resolve));
 return port;
}
async function health(port){
 const response=await fetch("http://127.0.0.1:"+port+"/healthz");
 return response.json();
}
test("reservation is acquired before a slow HTTP request can finish",async t=>{
 const port=await freePort(),token="test-runner-token-at-least-24-bytes";
 const child=spawn(process.execPath,[path.join(__dirname,"index.cjs")],{
  env:{...process.env,PORT:String(port),GQA_RUNNER_TOKEN:token,
   GQA_SMOKE_TARGETS:"http://fixture:8081"},
  stdio:"ignore"
 });
 t.after(()=>child.kill("SIGKILL"));
 let available=false;
 for(let i=0;i<50;i++){
  try{await health(port);available=true;break;}catch{await new Promise(r=>setTimeout(r,30));}
 }
 assert.ok(available,"runner did not listen");
 const first=http.request({
  hostname:"127.0.0.1",port,path:"/run",method:"POST",
  headers:{"X-GQA-Runner-Token":token,"Content-Type":"application/json"}
 });
 first.on("error",()=>{});
 first.write('{"target_url":"http://fixture:8081",');
 for(let i=0;i<40;i++){
  if((await health(port)).busy)break;
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal((await health(port)).busy,true);
 const second=await fetch("http://127.0.0.1:"+port+"/run",{
  method:"POST",headers:{"X-GQA-Runner-Token":token,"Content-Type":"application/json"},
  body:JSON.stringify({target_url:"http://fixture:8081",run_api:true,run_web:false})
 });
 assert.equal(second.status,429);
 first.destroy();
 for(let i=0;i<30;i++){
  if(!(await health(port)).busy)break;
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal((await health(port)).busy,false);
});
