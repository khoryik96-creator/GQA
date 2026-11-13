package main
import(
 "context"
 "errors"
 "strings"
 "testing"
 "github.com/jackc/pgx/v5/pgconn"
)
type fakeRecoverer struct{called bool;err error}
func(f *fakeRecoverer)Exec(_ context.Context,sql string,_ ...any)(pgconn.CommandTag,error){
 f.called=true
 if !strings.Contains(sql,"status='running'")||
   !strings.Contains(sql,"interval '2 minutes'")||
   !strings.Contains(sql,"status='failed'")||
   !strings.Contains(sql,"runner_unavailable"){
  f.err=errors.New("recovery query is not fail-closed")
 }
 return pgconn.CommandTag{},f.err
}
func TestInterruptedRunRecoveryIsFailClosed(t *testing.T){
 f:=&fakeRecoverer{}
 if err:=reconcileStaleRuns(context.Background(),f);err!=nil{t.Fatal(err)}
 if !f.called{t.Fatal("no reconciliation executed")}
}
