"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {ResultStore}=require("./result-store.cjs");

function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gqa-results-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
const id="12345678-1234-4234-8234-123456789abc";

test("durable async evidence excludes extra worker-controlled data and survives reload",t=>{
 const dir=temp(t);
 const store=new ResultStore(dir);
 store.save(id,{
  checks:[{name:"API GET /healthz",status:"passed",detail:"HTTP 200",duration_ms:12,
    secret:"do-not-store"}],
  screenshot_base64:"",
  evidence:{failure_kind:"none",worker_lifecycle:"untrusted",token:"do-not-store"},
  raw_logs:"do-not-store"
 });
 const reopened=new ResultStore(dir);
 const result=reopened.get(id);
 assert.ok(result);
 assert.equal(result.checks[0].status,"passed");
 assert.equal(result.checks[0].detail,"HTTP 200");
 assert.equal(result.evidence.job_id,id);
 assert.equal(JSON.stringify(result).includes("do-not-store"),false);
 assert.equal(reopened.exists(id),true);
 assert.throws(()=>store.save(id,{checks:[{name:"x"}]}),/already stored/);
 if(process.platform!=="win32"){
  assert.equal(fs.statSync(store.file(id)).mode&0o777,0o600);
 }
});
test("rejects unsafe result identifiers and invalid response lists",t=>{
 const store=new ResultStore(temp(t));
 for(const value of ["../../.env","123","x".repeat(36)]) {
  assert.throws(()=>store.file(value),/Invalid job ID/);
 }
 assert.throws(()=>store.save(id,{checks:[]}),/Invalid job checks/);
 assert.throws(()=>store.save(id,{checks:Array(30).fill({})}),/Invalid job checks/);
});
test("non-recorded old artifacts are removed without touching current job results",t=>{
 const store=new ResultStore(temp(t));
 const other="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 store.save(id,{checks:[{name:"one",status:"passed"}]});
 store.save(other,{checks:[{name:"two",status:"passed"}]});
 store.prune(new Set([id]));
 assert.ok(store.get(id));
 assert.equal(store.get(other),null);
});
test("symlink result directory is rejected on write",t=>{
 if(process.platform==="win32")return;
 const dir=temp(t),outside=temp(t);
 fs.symlinkSync(outside,path.join(dir,"results"));
 const store=new ResultStore(dir);
 assert.throws(()=>store.save(id,{checks:[{name:"check"}]}),/Unsafe result directory/);
});

test("corrupt or tampered persisted evidence is never returned as trustworthy",t=>{
 const dir=temp(t),store=new ResultStore(dir);
 store.save(id,{checks:[{name:"Verified",status:"passed",detail:"OK",duration_ms:1}]});
 const file=store.file(id);
 fs.writeFileSync(file,"{bad-json");
 assert.throws(()=>store.get(id),/Stored job evidence is invalid/);
 fs.writeFileSync(file,JSON.stringify({checks:[{name:"Tampered",status:"passed",
   detail:"not verified",duration_ms:1}],screenshot_base64:"",
   evidence:{job_id:"another-job",worker_lifecycle:"ephemeral_container",failure_kind:"none"}}));
 assert.throws(()=>store.get(id),/Stored job evidence is invalid/);
 store.discard(id);
 assert.equal(store.get(id),null);
 const empty=path.join(dir,"results","unrelated.txt");
 fs.writeFileSync(empty,"should survive");
 store.prune(new Set());
 assert.equal(fs.readFileSync(empty,"utf8"),"should survive");
});
test("unsafe result symlink cannot be accepted as saved evidence",t=>{
 if(process.platform==="win32")return;
 const dir=temp(t),outside=temp(t),store=new ResultStore(dir);
 fs.mkdirSync(path.dirname(store.file(id)),{recursive:true});
 fs.symlinkSync(path.join(outside,"secret.txt"),store.file(id));
 assert.throws(()=>store.get(id),/Stored job evidence is invalid|ENOENT/);
 assert.throws(()=>store.discard(id),/Unsafe broker result file/);
});
