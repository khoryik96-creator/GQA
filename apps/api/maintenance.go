package main

import (
 "context"
 "time"
 "os"
 "strconv"
 "errors"
 "path/filepath"
 "github.com/jackc/pgx/v5/pgxpool"
)

// A local one-instance API can safely mark in-flight runs left by a previous
// API process as interrupted on restart. They are infrastructure outcomes,
// not passing or failing application assertions.
func reconcileOrphanedRuns(ctx context.Context,db *pgxpool.Pool)error{
 _,err:=db.Exec(ctx,`
  UPDATE test_runs SET status='interrupted',finished_at=now(),
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
   _=pruneScreenshots(op,db)
   done()
  }
 }
}

func evidenceRetentionDays()(int,error){
 raw:=os.Getenv("GQA_EVIDENCE_RETENTION_DAYS")
 if raw==""||raw=="0"{return 0,nil}
 days,err:=strconv.Atoi(raw)
 if err!=nil||days<0||days>3650{return 0,errors.New("evidence retention must be 0-3650 days")}
 return days,nil
}
// Disabled by default: no user evidence is silently deleted on upgrade.
// When explicitly configured, delete only screenshot files whose completed
// runs exceed the retention window. Never delete test history.
func pruneScreenshots(ctx context.Context,db *pgxpool.Pool)error{
 days,err:=evidenceRetentionDays()
 if err!=nil{return err}
 if days==0{return nil}
 rows,err:=db.Query(ctx,`SELECT id::text FROM test_runs
  WHERE screenshot_available=true AND finished_at<now()-($1::integer*interval '1 day')
  ORDER BY finished_at LIMIT 100`,days)
 if err!=nil{return err}
 ids:=[]string{}
 for rows.Next(){
  var id string
  if err=rows.Scan(&id);err!=nil{break}
  ids=append(ids,id)
 }
 if err==nil{err=rows.Err()}
 rows.Close()
 if err!=nil{return err}
 dir:=os.Getenv("GQA_EVIDENCE_DIR")
 if dir==""{dir="/evidence"}
 for _,id:=range ids{
  if !uuidRE.MatchString(id){continue}
  file:=filepath.Join(dir,id+".png")
  err=os.Remove(file)
  if err!=nil&&!errors.Is(err,os.ErrNotExist){continue}
  if _,err=db.Exec(ctx,`UPDATE test_runs SET screenshot_available=false
    WHERE id=$1::uuid`,id);err!=nil{return err}
 }
 return nil
}
