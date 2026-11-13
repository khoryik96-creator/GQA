"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {containerArgs,safeProjectName,dockerClientEnv,validateResult,executeJob,FIXTURES,IMAGE}=require("./launcher.cjs");
const {allowedTarget}=require("../runner/policy.cjs");
const {validateFlow}=require("../runner/browser-flow.cjs");

const name="gqa-qa-00000000-0000-4000-8000-000000000001";
const smoke={kind:"smoke",target_url:"http://fixture:8081",run_api:true,run_web:true};

test("container command always isolates the controlled fixture job",()=>{
 const args=containerArgs(smoke,name,"gqa");
 assert.deepEqual(args.slice(0,3),["run","--rm","--pull"]);
 assert.ok(args.includes("--read-only"));
 assert.ok(args.includes("--cap-drop"));
 assert.ok(args.includes("--security-opt"));
 assert.ok(args.includes("no-new-privileges"));
 assert.ok(args.includes("--pids-limit"));
 assert.ok(args.includes("--memory"));
 assert.ok(args.includes("--cpus"));
 assert.ok(args.includes("--tmpfs"));
 assert.ok(args.includes("--user"));
 assert.ok(args.includes("pwuser"));
 assert.ok(args.includes("gqa_qa_execution"));
 assert.ok(!args.includes("--privileged"));
 assert.ok(!args.includes("--mount"));
 assert.ok(!args.includes("--volume"));
 assert.ok(!args.includes("--publish"));
 assert.ok(!args.includes("host"));
 assert.equal(args.at(-3),IMAGE);
 assert.equal(args.at(-2),"node");
 assert.equal(args.at(-1),"/worker/container-job.cjs");
 assert.ok(args.find(a=>a.startsWith("GQA_JOB_SPEC=")));
 assert.ok(!args.some(a=>a.includes("GQA_RUNNER_TOKEN")||a.includes("DOCKER_HOST")));
});
test("project and job name cannot inject docker arguments",()=>{
 assert.equal(safeProjectName("gqa"),true);
 for(const p of ["","../bad","--privileged","demo project","A","gqa;id"]){
  assert.equal(safeProjectName(p),false,p);
  assert.throws(()=>containerArgs(smoke,name,p));
 }
 assert.throws(()=>containerArgs(smoke,"--privileged","gqa"));
});
test("job result is bounded and lifecycle cannot be spoofed",()=>{
 const id="00000000-0000-4000-8000-000000000001";
 const r=validateResult({checks:[{name:"API",status:"passed",detail:"HTTP 200",duration_ms:1}],
    screenshot_base64:"",evidence:{worker_lifecycle:"vm"}},id);
 assert.equal(r.evidence.worker_lifecycle,"ephemeral_container");
 assert.equal(r.evidence.job_id,id);
 const bad=validateResult({checks:[{name:"API",status:"unknown",detail:"x"}],
    screenshot_base64:""},id);
 assert.equal(bad.checks[0].status,"failed");
});
test("launcher cleans up exact container on success",async()=>{
 const calls=[];
 const run=async (file,args)=>{
  assert.equal(file,"docker");
  calls.push(args);
  if(args[0]==="run")return {stdout:JSON.stringify({
   checks:[{name:"API",status:"passed",detail:"HTTP 200",duration_ms:1}],
   screenshot_base64:"",evidence:{failure_kind:"none"}
  }),stderr:""};
  return {stdout:"",stderr:""};
 };
 const result=await executeJob(smoke,{run});
 assert.equal(result.checks[0].status,"passed");
 assert.equal(result.evidence.worker_lifecycle,"ephemeral_container");
 assert.equal(calls.length,2);
 assert.equal(calls[1][0],"rm");
 assert.equal(calls[1][1],"-f");
 assert.equal(calls[1][2],calls[0][calls[0].indexOf("--name")+1]);
});
test("launch failures cannot report success and still request cleanup",async()=>{
 const calls=[];
 const run=async(_,args)=>{
  calls.push(args);
  if(args[0]==="run")throw Object.assign(new Error("timeout"),{killed:true});
  return {stdout:""};
 };
 const result=await executeJob(smoke,{run});
 assert.equal(result.checks[0].status,"failed");
 assert.equal(result.evidence.failure_kind,"worker_timeout");
 assert.equal(calls[1][0],"rm");
});
test("cross-origin targets and arbitrary Playwright scripts remain rejected",()=>{
 assert.equal(allowedTarget("http://fixture:8081",FIXTURES),true);
 assert.equal(allowedTarget("http://api:8080",FIXTURES),false);
 assert.equal(allowedTarget("https://example.com",FIXTURES),false);
 assert.equal(validateFlow([
  {op:"navigate",path:"/"},{op:"eval",text:"arbitrary script"}
 ]),false);
});

test("Docker CLI only receives operational environment",()=>{
 const env=dockerClientEnv({PATH:"/bin",HOME:"/home/user",
   GQA_RUNNER_TOKEN:"secret",GQA_ADMIN_PASSWORD:"secret",DATABASE_URL:"secret"});
 assert.equal(env.PATH,"/bin");
 assert.equal(env.HOME,"/home/user");
 assert.equal(env.GQA_RUNNER_TOKEN,undefined);
 assert.equal(env.GQA_ADMIN_PASSWORD,undefined);
 assert.equal(env.DATABASE_URL,undefined);
});

test("Docker cleanup failure is never reported as successful",async()=>{
 const stub=async(_,args)=>{
  if(args[0]==="rm")throw Object.assign(new Error("daemon offline"),{stderr:"Cannot connect to Docker daemon"});
  return {stdout:JSON.stringify({checks:[{name:"API",status:"passed",detail:"HTTP 200"}],
    screenshot_base64:"",evidence:{failure_kind:"none"}})};
 };
 const result=await executeJob(smoke,{run:stub});
 assert.equal(result.checks[0].status,"failed");
 assert.equal(result.evidence.failure_kind,"worker_cleanup_failed");
});

test("invalid worker output and cleanup failure is fail-closed",async()=>{
 const result=await executeJob(smoke,{run:async(_,args)=>{
  if(args[0]==="rm")throw Object.assign(new Error("Docker unavailable"),{stderr:"Cannot connect to Docker daemon"});
  return {stdout:"broken\\nworker-output"};
 }});
 assert.equal(result.evidence.failure_kind,"worker_cleanup_failed");
 assert.equal(result.checks[0].status,"failed");
});
