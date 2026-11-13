package main
import (
 "testing"
 "context"
 "errors"
 "strings"
 "github.com/jackc/pgx/v5/pgconn"
)
func TestEvidenceRetentionIsExplicitOptIn(t *testing.T){
 t.Setenv("GQA_EVIDENCE_RETENTION_DAYS","")
 if days,err:=evidenceRetentionDays();err!=nil||days!=0{t.Fatalf("default retention: %d %v",days,err)}
 for _,bad:=range []string{"-1","invalid","4000"}{
  t.Setenv("GQA_EVIDENCE_RETENTION_DAYS",bad)
  if _,err:=evidenceRetentionDays();err==nil{t.Errorf("invalid retention %s accepted",bad)}
 }
 t.Setenv("GQA_EVIDENCE_RETENTION_DAYS","30")
 if days,err:=evidenceRetentionDays();err!=nil||days!=30{t.Fatalf("opt-in retention %d %v",days,err)}
}

// Prove that recovery targets only expired in-flight runs, not completed ones.
type recordingStaleRunExec struct { query string; calls int; err error }
func (r *recordingStaleRunExec) Exec(_ context.Context,q string,_ ...any)(pgconn.CommandTag,error){
 r.calls++
 r.query=q
 return pgconn.CommandTag{},r.err
}
func TestReconcileExpiredRunningRuns(t *testing.T){
 db:=&recordingStaleRunExec{}
 if err:=reconcileExpiredRunningRuns(context.Background(),db);err!=nil{t.Fatal(err)}
 if db.calls!=1{t.Fatalf("expected one recovery statement, got %d",db.calls)}
 for _,required:=range []string{
  "WHERE status='running'", "started_at < now() - interval '5 minutes'",
  "status='interrupted'", "runner_interrupted", "screenshot_available=false",
 }{
  if !strings.Contains(db.query,required){t.Errorf("missing recovery safeguard %q",required)}
 }
 cause:=errors.New("database unavailable")
 db.err=cause
 if err:=reconcileExpiredRunningRuns(context.Background(),db);!errors.Is(err,cause){
  t.Fatalf("recovery masked storage failure: %v",err)
 }
}
