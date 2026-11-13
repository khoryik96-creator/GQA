package main

import (
 "context"
 "time"
 "github.com/jackc/pgx/v5/pgxpool"
)

// A local one-instance API can safely mark in-flight runs left by a previous
// API process as interrupted on restart. They are infrastructure outcomes,
// not passing or failing application assertions.
func reconcileOrphanedRuns(ctx context.Context,db *pgxpool.Pool)error{
 _,err:=db.Exec(ctx,`
  UPDATE test_runs SET status='failed',finished_at=now(),
   checks='[{"name":"Runner interrupted","status":"failed","duration_ms":0,"detail":"The API restarted before run evidence was finalized"}]'::jsonb,
   evidence='{"failure_kind":"runner_interrupted","worker_lifecycle":"unverified","console_errors":0,"page_exceptions":0,"failed_requests":0,"http_5xx":0}'::jsonb,
   screenshot_available=false
  WHERE status='running'`)
 return err
}
func pruneExpiredMetadata(ctx context.Context,db *pgxpool.Pool)error{
 if _,err:=db.Exec(ctx,`DELETE FROM auth_sessions
  WHERE expires_at<now()-interval '1 day'
     OR (revoked_at IS NOT NULL AND revoked_at<now()-interval '1 day')`);err!=nil{return err}
 _,err:=db.Exec(ctx,`DELETE FROM browser_locator_cache WHERE expires_at<now()`)
 return err
}
func maintainLocalMetadata(ctx context.Context,db *pgxpool.Pool){
 ticker:=time.NewTicker(time.Hour)
 defer ticker.Stop()
 for {
  select{
  case <-ctx.Done():return
  case <-ticker.C:
   op,done:=context.WithTimeout(ctx,10*time.Second)
   _=pruneExpiredMetadata(op,db)
   done()
  }
 }
}
