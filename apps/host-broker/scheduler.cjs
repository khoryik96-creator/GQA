"use strict";
const {JobStore,publicJob,TERMINAL,ID}=require("./job-store.cjs");
const {executeJob,removeJobContainer,failure}=require("./launcher.cjs");
const {ResultStore}=require("./result-store.cjs");

class Scheduler {
  constructor({store=new JobStore(),runJob=executeJob,
    cleanup=removeJobContainer,project="gqa",capacity=8}={}){
    this.store=store;this.runJob=runJob;this.cleanup=cleanup;
    this.results=new ResultStore(store.dir);
    this.project=project;this.capacity=capacity;
    this.ready=false;this.current=null;this.waiters=new Map();
  }
  async start(){
    this.store.load();
    this.results.prune(new Set(this.store.jobs.map(j=>j.id)));
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
  get(id){
    const job=this.store.get(id);
    return job?{...publicJob(job),result_available:this.results.exists(id)}:null;
  }
  getResult(id){
    const job=this.store.get(id);
    return job&&TERMINAL.has(job.status)?this.results.get(id):null;
  }
  list(){return this.store.list().map(j=>({...publicJob(j),result_available:this.results.exists(j.id)}))}
  hasInFlight(){return this.store.pending().length>0}
  enqueue(spec){
    if(!this.ready)throw Object.assign(new Error("Broker recovery incomplete"),{status:503});
    if(this.store.pending().length>=this.capacity)
      throw Object.assign(new Error("Job queue capacity reached"),{status:429});
    const item=this.store.create(spec);
    this.pump();
    return publicJob(item);
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
      try{this.results.save(id,failure("worker_cancelled",id))}
      catch{this.ready=false;throw Object.assign(new Error("Cannot save cancellation evidence"),{status:503})}
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
    this.store.transition(next.id,{status:"running",started_at:new Date().toISOString()});
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
      try{this.results.save(next.id,final)}
      catch{
        this.ready=false;
        const err=failure("evidence_persistence_failed",next.id);
        this.store.transition(next.id,{status:"failed",finished_at:new Date().toISOString(),
          failure_kind:"evidence_persistence_failed",check_count:1});
        this.settle(next.id,err);
        return;
      }
      const anyFailed=final.checks?.some(c=>c.status!=="passed")!==false;
      this.store.transition(next.id,{status:cancelled?"cancelled":anyFailed?"failed":"passed",
        finished_at:new Date().toISOString(),
        failure_kind:final.evidence?.failure_kind||"",
        check_count:final.checks?.length||0});
      this.results.prune(new Set(this.store.jobs.map(j=>j.id)));
      this.settle(next.id,final);
    }).catch(()=>{
      const final=failure(controller.signal.aborted?"worker_cancelled":"worker_error",next.id);
      try{this.results.save(next.id,final)}catch{this.ready=false}
      this.store.transition(next.id,{status:controller.signal.aborted?"cancelled":"failed",
        finished_at:new Date().toISOString(),failure_kind:final.evidence.failure_kind,
        check_count:1});
      this.settle(next.id,final);
    }).finally(()=>{
      this.current=null;
      this.pump();
    });
  }
}
module.exports={Scheduler};
