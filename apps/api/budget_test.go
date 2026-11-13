package main
import (
 "sync"
 "testing"
 "time"
)
func TestConcurrentOperationBudgetIsAtomic(t *testing.T){
 budget:=&actionBudget{attempts:map[string][]time.Time{}}
 const maximum=7
 var group sync.WaitGroup
 accepted:=make(chan bool,80)
 for i:=0;i<80;i++{
  group.Add(1)
  go func(){
   defer group.Done()
   accepted<-budget.allow("user|project|execution",maximum,time.Minute)
  }()
 }
 group.Wait();close(accepted)
 counted:=0
 for yes:=range accepted{if yes{counted++}}
 if counted!=maximum{t.Fatalf("budget allowed %d requests instead of %d",counted,maximum)}
 if !budget.allow("other-user|project|execution",maximum,time.Minute){
  t.Fatal("another user was incorrectly throttled")
 }
}
func TestOperationBudgetAgesOut(t *testing.T){
 b:=&actionBudget{attempts:map[string][]time.Time{
  "key":{time.Now().Add(-2*time.Hour)},
 }}
 if !b.allow("key",1,time.Hour){t.Fatal("expired reservation was not released")}
 if b.allow("key",1,time.Hour){t.Fatal("budget should reject repeated request")}
}
