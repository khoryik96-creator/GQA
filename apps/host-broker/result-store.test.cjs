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
