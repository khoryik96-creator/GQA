package main

import (
 "net/http"
 "sync"
 "time"
)

// Bounded per-user/project request budget for model and browser operations.
// This is a local single-instance control, not a distributed billing quota.
type actionBudget struct {
 mu sync.Mutex
 attempts map[string][]time.Time
}
var executionBudget=&actionBudget{attempts:make(map[string][]time.Time)}
func (b *actionBudget) allow(key string,limit int,window time.Duration)bool{
 b.mu.Lock()
 defer b.mu.Unlock()
 now:=time.Now()
 if len(b.attempts)>10000 {
  // A bounded, conservative in-memory eviction policy to prevent unlimited
  // growth from old project/user combinations.
  for id,events:=range b.attempts{
   if len(events)==0||now.Sub(events[len(events)-1])>window{delete(b.attempts,id)}
  }
  if len(b.attempts)>10000{return false}
 }
 kept:=[]time.Time{}
 for _,at:=range b.attempts[key]{
  if now.Sub(at)<window{kept=append(kept,at)}
 }
 if len(kept)>=limit{b.attempts[key]=kept;return false}
 b.attempts[key]=append(kept,now)
 return true
}
func budgetedAction(category string,limit int,next http.HandlerFunc)http.HandlerFunc{
 return func(w http.ResponseWriter,r *http.Request){
  account,ok:=currentAccount(r)
  if !ok{fail(w,401,"Sign in to perform this operation");return}
  key:=account.ID+"|"+r.PathValue("id")+"|"+category
  if !executionBudget.allow(key,limit,time.Hour){
   w.Header().Set("Retry-After","3600")
   fail(w,429,"QA operation budget reached for this project and account")
   return
  }
  next(w,r)
 }
}
