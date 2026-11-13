package main

import (
 "context"
 "net/http"
 "time"
)

// A request's initial RBAC check is not a lease for its entire execution.
// Re-evaluate the original session AND project role while a long-running
// worker is active, including immediately before finalizing its evidence.
// This guards against account suspension, session revocation and membership
// changes after a request has already entered the execution handler.
func (s *server) executionStillAuthorized(ctx context.Context,r *http.Request,projectID string)(bool,error){
 account,ok:=currentAccount(r)
 if !ok{return false,nil}
 digest,err:=sessionDigest(r)
 if err!=nil{return false,nil}
 var allowed bool
 err=s.db.QueryRow(ctx,`
   SELECT EXISTS(
     SELECT 1 FROM auth_sessions ses
     JOIN gqa_users u ON u.id=ses.user_id
     WHERE ses.token_digest=$1::bytea
       AND ses.user_id=$2::uuid
       AND ses.revoked_at IS NULL
       AND ses.expires_at>now()
       AND u.active=true
       AND (
         u.global_role='admin' OR
         EXISTS(
           SELECT 1 FROM project_memberships m
           WHERE m.project_id=$3::uuid AND m.user_id=u.id
             AND m.role IN ('owner','qa')
         )
       )
   )
 `,digest,account.ID,projectID).Scan(&allowed)
 return allowed,err
}

// One permission probe every two seconds while a remote runner is active.
// Outages fail closed by cancelling the worker call. A separate final check
// ensures revocation isn't lost in a race after the last periodic tick.
func (s *server) monitorExecutionPermission(ctx context.Context,cancel context.CancelFunc,
 r *http.Request,projectID string){
 ticker:=time.NewTicker(2*time.Second)
 defer ticker.Stop()
 for{
   select{
   case <-ctx.Done():return
   case <-ticker.C:
     checkCtx,stop:=context.WithTimeout(ctx,1500*time.Millisecond)
     allowed,err:=s.executionStillAuthorized(checkCtx,r,projectID)
     stop()
     if err!=nil||!allowed{cancel();return}
   }
 }
}
