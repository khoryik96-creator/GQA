"use strict";

const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const exec = promisify(execFile);
const FIXTURES="http://fixture:8081,http://fixture-renamed:8081";
const IMAGE="gqa-job:local";
function dockerClientEnv(env) {
  // Do not inherit GQA application credentials in the host Docker subprocess.
  const keys=["PATH","HOME","USERPROFILE","APPDATA","LOCALAPPDATA",
    "DOCKER_HOST","DOCKER_CONTEXT","DOCKER_CONFIG","DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY","SystemRoot","TEMP","TMP"];
  const copy={};
  for (const key of keys) if (typeof env[key]==="string") copy[key]=env[key];
  return copy;
}


function safeProjectName(value) {
  return /^[a-z][a-z0-9_-]{0,32}$/.test(value);
}
function containerArgs(job,name,project="gqa") {
  if (!safeProjectName(project) || !/^gqa-qa-[a-f0-9-]{36}$/.test(name))
    throw new Error("Unapproved Docker project or job identity");
  const encoded=Buffer.from(JSON.stringify(job)).toString("base64");
  if (encoded.length>21000) throw new Error("QA job exceeds limit");
  return [
    "run","--rm","--pull","never","--name",name,
    "--network",project+"_qa_execution",
    "--read-only","--cap-drop","ALL",
    "--security-opt","no-new-privileges",
    "--pids-limit","128","--memory","2g","--memory-swap","2g",
    "--cpus","1.5","--shm-size","256m",
    "--tmpfs","/tmp:rw,nosuid,size=512m",
    "--user","pwuser","--label","com.gqa.component=ephemeral-job",
    "--label","com.gqa.project="+project,
    "--label","com.gqa.job-id="+name.substring("gqa-qa-".length),
    "--env","GQA_JOB_SPEC="+encoded,
    IMAGE,"node","/worker/container-job.cjs"
  ];
}
function failure(kind,id) {
  return {checks:[{name:"Ephemeral job lifecycle",status:"failed",duration_ms:0,
    detail:kind==="worker_timeout"?"Job exceeded its allowed runtime":"Container job did not return valid evidence"}],
    screenshot_base64:"",
    evidence:{job_id:id,worker_lifecycle:"ephemeral_container",
      failure_kind:kind,console_errors:0,page_exceptions:0,failed_requests:0,http_5xx:0}};
}
function validateResult(result,id) {
  if (!result || !Array.isArray(result.checks) || result.checks.length<1 ||
      result.checks.length>20 || result.checks.some(c=>
        !c || !["passed","failed"].includes(c.status) ||
        typeof c.name!=="string" || c.name.length>120 ||
        typeof c.detail!=="string" || c.detail.length>400) ||
      typeof result.screenshot_base64!=="string" ||
      result.screenshot_base64.length>1400000) return failure("invalid_worker_result",id);
  const evidence=result.evidence || {};
  return {...result,evidence:{...evidence,job_id:id,worker_lifecycle:"ephemeral_container"}};
}
const JOB_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function removeJobContainer(id,{run=exec}={}){
  if(!JOB_ID.test(id))throw new Error("Invalid container cleanup identity");
  const name="gqa-qa-"+id;
  try{
    await run("docker",["rm","-f",name],{timeout:8000,maxBuffer:20000,
      windowsHide:true,env:dockerClientEnv(process.env)});
  }catch(err){
    if(/No such container/i.test(String(err.stderr||"")))return;
    throw err;
  }
}

async function executeJob(job,{project="gqa",run=exec,timeoutMs=55000,
  id=crypto.randomUUID(),signal}={}) {
  if(!JOB_ID.test(id))throw new Error("Invalid generated job identity");
  const name="gqa-qa-"+id;
  let result;
  try {
    const args=containerArgs(job,name,project);
    const answer=await run("docker",args,{timeout:timeoutMs,maxBuffer:2200000,
      windowsHide:true,killSignal:"SIGKILL",signal,env:dockerClientEnv(process.env)});
    const output=answer.stdout.trim();
    if (output.length>1950000 || output.includes("\n")) {
      result=failure("invalid_worker_result",id);
    } else {
      result=validateResult(JSON.parse(output),id);
    }
  } catch (err) {
    result=failure(signal?.aborted?"worker_cancelled":
      err.killed || err.signal==="SIGKILL"?"worker_timeout":"worker_error",id);
  } finally {
    // The CLI may have timed out while its container continued. Make a
    // second best-effort cleanup attempt by exact generated container name.
    try { await removeJobContainer(id,{run}); }
    catch { result=failure("worker_cleanup_failed",id); }
  }
  return result;
}
module.exports={FIXTURES,IMAGE,safeProjectName,dockerClientEnv,
  containerArgs,failure,validateResult,executeJob,removeJobContainer};
