"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {JobStore}=require("./job-store.cjs");
const {Scheduler}=require("./scheduler.cjs");
const spec={kind:"smoke",target_url:"http://fixture:8081",run_api:true,run_web:true};
const success={checks:[{name:"Smoke",status:"passed",detail:"OK",duration_ms:1}],
  screenshot_base64:"",evidence:{worker_lifecycle:"ephemeral_container",failure_kind:"none"}};
function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gqa-state-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("durable queue and private status metadata",async t=>{
 const dir=temp(t);
 let finish;
 const scheduler=new Scheduler({store:new JobStore(dir),cleanup:async()=>{},
  runJob:()=>new Promise(resolve=>{finish=resolve;})});
 await scheduler.start();
 const first=scheduler.enqueue(spec);
 const second=scheduler.enqueue(spec);
 assert.equal(first.status,"running");
 assert.equal(second.status,"queued");
 const before=new JobStore(dir);before.load();
 assert.equal(before.get(first.id).status,"running");
 assert.equal(before.get(second.id).status,"queued");
 assert.equal(Object.hasOwn(scheduler.get(first.id),"spec"),false);
 assert.equal((await scheduler.cancel(second.id)).status,"cancelled");
 await tick();
 finish(success);
 await tick();await tick();
 assert.equal(scheduler.get(first.id).status,"passed");
 const after=new JobStore(dir);after.load();
 assert.equal(after.get(first.id).status,"passed");
 assert.equal(after.get(second.id).status,"cancelled");
});

test("cancelling running test aborts, never reports pass",async t=>{
 const dir=temp(t);
 let onStart;
 const starting=new Promise(resolve=>{onStart=resolve;});
 const scheduler=new Scheduler({store:new JobStore(dir),cleanup:async()=>{},
  runJob:(_job,options)=>{
   onStart();
   return new Promise(resolve=>options.signal.addEventListener("abort",
    ()=>resolve(success),{once:true}));
  }});
 await scheduler.start();
 const launched=scheduler.submitSync(spec);
 await starting;
 assert.equal((await scheduler.cancel(launched.job.id)).status,"cancelling");
 const answer=await launched.done;
 assert.equal(answer.checks[0].status,"failed");
 assert.equal(answer.evidence.failure_kind,"worker_cancelled");
 await tick();
 assert.equal(scheduler.get(launched.job.id).status,"cancelled");
});

test("restart reconciles interrupted container before queued work",async t=>{
 const dir=temp(t);
 const store=new JobStore(dir);store.load();
 const previous=store.create(spec);
 store.transition(previous.id,{status:"running"});
 const queued=store.create(spec);
 const removed=[],started=[];
 const scheduler=new Scheduler({store:new JobStore(dir),
  cleanup:async id=>{removed.push(id);},
  runJob:async job=>{started.push(job);return success;}});
 await scheduler.start();await tick();await tick();
 assert.deepEqual(removed,[previous.id]);
 assert.equal(scheduler.get(previous.id).status,"interrupted");
 assert.equal(scheduler.get(queued.id).status,"passed");
 assert.equal(started.length,1);
});

test("failed cleanup fails startup closed",async t=>{
 const dir=temp(t),store=new JobStore(dir);store.load();
 const item=store.create(spec);
 store.transition(item.id,{status:"running"});
 const scheduler=new Scheduler({store:new JobStore(dir),
  cleanup:async()=>{throw Error("Docker inaccessible");}});
 await assert.rejects(scheduler.start(),/Docker inaccessible/);
 assert.equal(scheduler.ready,false);
 assert.equal(scheduler.get(item.id).status,"recovery_pending");
 assert.throws(()=>scheduler.enqueue(spec),/recovery incomplete/);
});

test("bounded FIFO queue never exceeds capacity",async t=>{
 const dir=temp(t);
 let finish;
 const calls=[];
 const scheduler=new Scheduler({store:new JobStore(dir),capacity:2,cleanup:async()=>{},
  runJob:job=>{
   calls.push(job);
   if(calls.length===1)return new Promise(resolve=>{finish=resolve;});
   return Promise.resolve(success);
  }});
 await scheduler.start();
 scheduler.enqueue({...spec,run_api:true});
 scheduler.enqueue({...spec,run_api:false});
 assert.throws(()=>scheduler.enqueue(spec),/capacity reached/);
 await tick();finish(success);
 await tick();await tick();
 assert.equal(calls.length,2);
 assert.equal(calls[0].run_api,true);
 assert.equal(calls[1].run_api,false);
});

test("corrupt persistent journal is rejected",t=>{
 const dir=temp(t);
 const store=new JobStore(dir);store.load();
 fs.writeFileSync(path.join(dir,"jobs.json"),"invalid JSON");
 assert.throws(()=>new JobStore(dir).load());
});

test("worker cleanup failure blocks subsequent job launches",async t=>{
 const dir=temp(t);
 const scheduler=new Scheduler({store:new JobStore(dir),cleanup:async()=>{},
   runJob:async(_job,options)=>({
     checks:[{name:"Cleanup",status:"failed",detail:"Unremoved container"}],
     screenshot_base64:"",
     evidence:{job_id:options.id,worker_lifecycle:"ephemeral_container",
       failure_kind:"worker_cleanup_failed"}
   })});
 await scheduler.start();
 const launched=scheduler.submitSync(spec);
 const result=await launched.done;
 assert.equal(result.evidence.failure_kind,"worker_cleanup_failed");
 assert.equal(scheduler.get(launched.job.id).status,"recovery_pending");
 assert.equal(scheduler.ready,false);
 assert.throws(()=>scheduler.enqueue(spec),/recovery incomplete/);
});

test("corrupted or widened durable queue cannot re-execute after restart", t=>{
 const dir=temp(t);
 const file=path.join(dir,"jobs.json");
 const store=new JobStore(dir);store.load();
 const queued=store.create(spec);
 const tampered=(replacement)=>{
   const data=JSON.parse(fs.readFileSync(file,"utf8"));
   data[0].spec=replacement;
   fs.writeFileSync(file,JSON.stringify(data));
   assert.throws(()=>new JobStore(dir).load(),/Invalid broker journal/);
 };
 tampered({...spec,target_url:"http://api:8080"});
 tampered({...spec,kind:"flow",steps:[{op:"navigate",path:"/"},{op:"eval",script:"evil"}]});
 tampered({...spec,extra:"--privileged"});
 assert.ok(queued.id);
});
test("only exact, bounded fixture job specs enter the journal",t=>{
 const dir=temp(t),store=new JobStore(dir);store.load();
 assert.throws(()=>store.create({...spec,target_url:"http://db:5432"}),/unapproved broker job/);
 assert.throws(()=>store.create({...spec,extra:"hidden"}),/unapproved broker job/);
 assert.throws(()=>store.create({...spec,run_api:false,run_web:false}),/unapproved broker job/);
 const saved=store.create(spec);
 assert.equal(saved.status,"queued");
});

test("journal lease rejects a simultaneous broker and permits clean release",t=>{
 const dir=temp(t);
 const first=new JobStore(dir),second=new JobStore(dir);
 first.acquireLease();
 assert.throws(()=>second.acquireLease(),/Another broker still holds/);
 first.releaseLease();
 second.acquireLease();
 second.releaseLease();
});
test("stale journal lease can only be reclaimed after owning process dies",t=>{
 const dir=temp(t);
 const fs=require("node:fs");
 fs.writeFileSync(path.join(dir,"broker.lease"),
   JSON.stringify({pid:2147483647,nonce:"a".repeat(32)}));
 const store=new JobStore(dir);
 store.acquireLease();
 assert.equal(store.leaseToken.length,32);
 store.releaseLease();
});

test("asynchronous jobs keep sanitized result evidence after completion",async t=>{
 const dir=temp(t);
 const scheduler=new Scheduler({store:new JobStore(dir),cleanup:async()=>{},
  runJob:async()=>({...success,secret:"not stored"})});
 await scheduler.start();
 const job=scheduler.enqueue(spec);
 await tick();await tick();await tick();
 assert.equal(scheduler.get(job.id).status,"passed");
 assert.equal(scheduler.get(job.id).result_available,true);
 const result=scheduler.getResult(job.id);
 assert.equal(result.checks[0].status,"passed");
 assert.equal(JSON.stringify(result).includes("not stored"),false);
 const restored=new Scheduler({store:new JobStore(dir),cleanup:async()=>{}});
 await restored.start();
 assert.equal(restored.getResult(job.id).checks[0].status,"passed");
});
