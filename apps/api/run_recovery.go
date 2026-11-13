package main

import (
 "context"
 "github.com/jackc/pgx/v5/pgconn"
)

// Only reconcile jobs past the maximum supported execution deadline.
// The stored result is a failure, never an inferred successful test.
const staleRunStatement=`
 UPDATE test_runs SET status='failed',finished_at=now(),
   screenshot_available=false,
   checks=jsonb_build_array(jsonb_build_object(
     'name','Run recovery','status','failed','duration_ms',0,
     'detail','Execution interrupted before results were durably recorded')),
   evidence=jsonb_build_object('failure_kind','runner_unavailable',
     'worker_lifecycle','unverified','console_errors',0,
     'page_exceptions',0,'failed_requests',0,'http_5xx',0)
 WHERE status='running' AND started_at<now()-interval '2 minutes'
`

type sqlExecutor interface{
 Exec(context.Context,string,...any)(pgconn.CommandTag,error)
}
func reconcileStaleRuns(ctx context.Context,exec sqlExecutor)error{
 _,err:=exec.Exec(ctx,staleRunStatement)
 return err
}
func (s *server) reconcileStaleRuns(ctx context.Context)error{
 return reconcileStaleRuns(ctx,s.db)
}

func (s *server) cleanupExpiredSessions(ctx context.Context)error{
 _,err:=s.db.Exec(ctx,`DELETE FROM auth_sessions WHERE
   expires_at<now()-interval '30 days'
   OR revoked_at<now()-interval '30 days'`)
 return err
}
func (s *server) cleanupExpiredLocatorCache(ctx context.Context)error{
 _,err:=s.db.Exec(ctx,`DELETE FROM browser_locator_cache WHERE expires_at<now()`)
 return err
}
