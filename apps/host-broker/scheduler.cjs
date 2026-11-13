"use strict";
const {JobStore,publicJob,TERMINAL,ID}=require("./job-store.cjs");
const {executeJob,removeJobContainer,failure}=require("./launcher.cjs");

class Scheduler {
  constructor({store=new JobStore(),runJob=executeJob,
    cleanup=removeJobContainer,project="gqa",capacity=8}={}){
    this.store=store;this.runJob=runJob;this.cleanup=cleanup;
    this.project=project;this.capacity=capacity;
    this.ready=false;this.current=null;this.waiters=new Map();
  }
  async start(){
    this.store.load();
    // A previously running or cancelling job must NEVER automatically
    // run again. Reconcile its named Docker container before accepting work.
    for(const job of this.store.recoverable()){
      this.store.transition(job.id,{status:"recovery_pending",failure_kind:"broker_restart"});
      await this.cleanup(job.id);
      this.store.transition(job.id,{status:"interrupted",finished_at:new Date().toISOString(),
        failure_kind:"broker_restart"});
    }
    this.ready=true;
    this.pump();
  }
  get(id){const job=this.store.get(id);return job?publicJob(job):null}
  list(){return this.store.list().map(publicJob)}
  hasInFlight(){return this.store.pending().length>0}
  enqueue(spec){
    if(!this.ready)throw Object.assign(new Error("Broker recovery incomplete"),{status:503});
    if(this.store.pending().length>=this.capacity)
      throw Object.assign(new Error("Job queue capacity reached"),{status:429});
    const item=this.store.create(spec);
    this.pump();
    return this.get(item.id);
  }
  submitSync(spec){
    if(this.hasInFlight())
      throw Object.assign(new Error("Broker has another active job"),{status:429});
    const item=this.enqueue(spec);
    return {job:item,done:new Promise(resolve=>{
      this.waiters.set(item.id,resolve);
      // Let the waiter register before the worker starts.
      this.pump();
    })};
  }
  async cancel(id){
    if(!ID.test(id))return null;
    const record=this.store.get(id);
    if(!record)return null;
    if(TERMINAL.has(record.status))return publicJob(record);
    if(record.status==="queued"){
      this.store.transition(id,{status:"cancelled",finished_at:new Date().toISOString(),
        failure_kind:"worker_cancelled"});
      this.settle(id,failure("worker_cancelled",id));
      this.pump();
    }else if(record.status==="running" || record.status==="cancelling"){
      this.store.transition(id,{status:"cancelling",failure_kind:"worker_cancelled"});
      if(this.current?.id===id)this.current.controller.abort();
    }
    return this.get(id);
  }
  settle(id,result){
    const cb=this.waiters.get(id);
    this.waiters.delete(id);
    if(cb)cb(result);
  }
  pump(){
    if(!this.ready||this.current)return;
    const next=this.store.queued();
    if(!next)return;
    const controller=new AbortController();
    this.current={id:next.id,controller};
    try{
      this.store.transition(next.id,{status:"running",started_at:new Date().toISOString()});
    }catch{
      // No worker may run unless its running state was durably recorded.
      this.ready=false;this.current=null;
      this.settle(next.id,failure("worker_journal_failed",next.id));
      return;
    }
    Promise.resolve().then(()=>this.runJob(next.spec,{
      project:this.project,signal:controller.signal,id:next.id,
      timeoutMs:next.kind==="smoke"?24000:55000
    })).then(result=>{
      const cleanupFailed=result?.evidence?.failure_kind==="worker_cleanup_failed";
      if(cleanupFailed){
        // The container could still exist. Block new tests until a later
        // restart reconciles the exact orphan identity.
        this.ready=false;
        this.store.transition(next.id,{status:"recovery_pending",
          failure_kind:"worker_cleanup_failed",check_count:1});
        this.settle(next.id,result);
        return;
      }
      const cancelled=controller.signal.aborted;
      const final=cancelled?failure("worker_cancelled",next.id):result;
      // Never durably copy arbitrary worker detail strings or page content.
      const safeChecks=(final.checks||[]).slice(0,20).map(c=>({
        name:String(c.name||"").slice(0,120),status:c.status
      }));
      const screenshotSaved=!cancelled&&this.store.persistScreenshot(
        next.id,final.screenshot_base64||"");
      const anyFailed=final.checks?.some(c=>c.status!=="passed")!==false;
      this.store.transition(next.id,{status:cancelled?"cancelled":anyFailed?"failed":"passed",
        finished_at:new Date().toISOString(),
        failure_kind:final.evidence?.failure_kind||"",
        check_count:final.checks?.length||0,
        result_checks:safeChecks,screenshot_available:screenshotSaved});
      this.settle(next.id,final);
    }).catch(()=>{
      // A job result/journal failure is not safe to treat as a completed run.
      this.ready=false;
      const final=failure(controller.signal.aborted?"worker_cancelled":"worker_error",next.id);
      try{
        this.store.transition(next.id,{status:controller.signal.aborted?"cancelled":"failed",
          finished_at:new Date().toISOString(),failure_kind:final.evidence.failure_kind,
          check_count:1});
        this.settle(next.id,final);
      }catch{
        // A failed journal write means we cannot assert any terminal status.
        this.ready=false;
        this.settle(next.id,failure("worker_journal_failed",next.id));
      }
    }).finally(()=>{
      this.current=null;
      this.pump();
    });
  }
}
module.exports={Scheduler};
