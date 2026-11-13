package main

import (
 "errors"
 "net/http"
 "strings"
 "time"

 "github.com/jackc/pgx/v5"
 "golang.org/x/crypto/bcrypt"
)

// Passwords are measured in bytes to match bcrypt's 72-byte maximum.
// Do not accept NUL bytes, and do not log submitted credentials.
func validNewPassword(s string) bool {
 return len(s)>=16 && len(s)<=72 && !strings.ContainsRune(s,0)
}

func (s *server) changePassword(w http.ResponseWriter,r *http.Request) {
 account,ok:=currentAccount(r)
 if !ok{fail(w,401,"Sign in to change your password");return}
 var input struct {
  CurrentPassword string `json:"current_password"`
  NewPassword string `json:"new_password"`
 }
 if !parseJSON(w,r,&input){return}
 if !validNewPassword(input.NewPassword) || len(input.CurrentPassword)>256{
  fail(w,400,"New password must be 16-72 bytes");return
 }
 tx,err:=s.db.Begin(r.Context())
 if err!=nil{fail(w,500,"Unable to change password");return}
 defer tx.Rollback(r.Context())
 var hash string
 err=tx.QueryRow(r.Context(),`SELECT password_hash FROM gqa_users
  WHERE id=$1::uuid AND active=true FOR UPDATE`,account.ID).Scan(&hash)
 if err!=nil{fail(w,401,"Account is unavailable");return}
 if bcrypt.CompareHashAndPassword([]byte(hash),[]byte(input.CurrentPassword))!=nil {
  fail(w,401,"Current password is incorrect");return
 }
 if bcrypt.CompareHashAndPassword([]byte(hash),[]byte(input.NewPassword))==nil{
  fail(w,409,"Choose a new password different from the current password");return
 }
 replacement,err:=bcrypt.GenerateFromPassword([]byte(input.NewPassword),bcrypt.DefaultCost)
 if err!=nil{fail(w,500,"Unable to hash password");return}
 if _,err=tx.Exec(r.Context(),`UPDATE gqa_users SET password_hash=$2
   WHERE id=$1::uuid`,account.ID,string(replacement));err!=nil{
  fail(w,500,"Unable to change password");return
 }
 if _,err=tx.Exec(r.Context(),`UPDATE auth_sessions SET revoked_at=now()
   WHERE user_id=$1::uuid AND revoked_at IS NULL`,account.ID);err!=nil{
  fail(w,500,"Unable to revoke previous sessions");return
 }
 if _,err=tx.Exec(r.Context(),`INSERT INTO account_security_audit
   (actor_id,subject_id,action,reason)
   VALUES($1::uuid,$1::uuid,'password_change','self_service')`,account.ID);err!=nil{
  fail(w,500,"Unable to audit password change");return
 }
 if err=tx.Commit(r.Context());err!=nil{fail(w,500,"Unable to finalize password change");return}
 // Password rotation invalidates this browser and all other sessions.
 http.SetCookie(w,&http.Cookie{
  Name:sessionCookieName,Value:"",Path:"/api",
  MaxAge:-1,HttpOnly:true,Secure:strings.HasPrefix(r.Header.Get("Origin"),"https://"),
  SameSite:http.SameSiteStrictMode,
 })
 w.WriteHeader(http.StatusNoContent)
}

func (s *server) revokeMySessions(w http.ResponseWriter,r *http.Request){
 account,ok:=currentAccount(r)
 if !ok{fail(w,401,"Sign in to revoke sessions");return}
 _,err:=s.db.Exec(r.Context(),`UPDATE auth_sessions SET revoked_at=now()
  WHERE user_id=$1::uuid AND revoked_at IS NULL`,account.ID)
 if err!=nil{fail(w,500,"Unable to revoke sessions");return}
 http.SetCookie(w,&http.Cookie{Name:sessionCookieName,Value:"",
  Path:"/api",MaxAge:-1,HttpOnly:true,SameSite:http.SameSiteStrictMode})
 w.WriteHeader(http.StatusNoContent)
}

func (s *server) adminResetPassword(w http.ResponseWriter,r *http.Request){
 target:=r.PathValue("userId")
 if !uuidRE.MatchString(target){fail(w,400,"Invalid account ID");return}
 actor,ok:=currentAccount(r)
 if !ok || actor.GlobalRole!="admin"{fail(w,403,"Administrator required");return}
 if actor.ID==target{fail(w,409,"Administrators must change their own password through Account Security");return}
 var input struct{NewPassword string `json:"new_password"`}
 if !parseJSON(w,r,&input){return}
 if !validNewPassword(input.NewPassword){
  fail(w,400,"New password must be 16-72 bytes");return
 }
 tx,err:=s.db.Begin(r.Context())
 if err!=nil{fail(w,500,"Unable to reset account password");return}
 defer tx.Rollback(r.Context())
 var oldHash,role string
 err=tx.QueryRow(r.Context(),`SELECT password_hash,global_role FROM gqa_users
  WHERE id=$1::uuid FOR UPDATE`,target).Scan(&oldHash,&role)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Account not found");return}
 if err!=nil{fail(w,500,"Unable to inspect account");return}
 if role!="member"{fail(w,403,"Bootstrap administrator password must be changed by its owner");return}
 if bcrypt.CompareHashAndPassword([]byte(oldHash),[]byte(input.NewPassword))==nil{
  fail(w,409,"New password must differ from the previous password");return
 }
 hash,err:=bcrypt.GenerateFromPassword([]byte(input.NewPassword),bcrypt.DefaultCost)
 if err!=nil{fail(w,500,"Unable to hash password");return}
 _,err=tx.Exec(r.Context(),`UPDATE gqa_users SET password_hash=$2 WHERE id=$1::uuid`,
  target,string(hash))
 if err!=nil{fail(w,500,"Unable to reset password");return}
 _,err=tx.Exec(r.Context(),`UPDATE auth_sessions SET revoked_at=now()
  WHERE user_id=$1::uuid AND revoked_at IS NULL`,target)
 if err!=nil{fail(w,500,"Unable to revoke account sessions");return}
 _,err=tx.Exec(r.Context(),`INSERT INTO account_security_audit
  (actor_id,subject_id,action,reason)
  VALUES($1::uuid,$2::uuid,'admin_password_reset','account_recovery')`,actor.ID,target)
 if err!=nil{fail(w,500,"Unable to audit password reset");return}
 if err=tx.Commit(r.Context());err!=nil{fail(w,500,"Unable to finalize password reset");return}
 w.WriteHeader(http.StatusNoContent)
}

func validStatusReason(s string)bool{
 return isOneOf(s,"security_review","team_change","access_cleanup","account_recovery")
}
func (s *server) adminSetUserStatus(w http.ResponseWriter,r *http.Request){
 target:=r.PathValue("userId")
 if !uuidRE.MatchString(target){fail(w,400,"Invalid account ID");return}
 actor,ok:=currentAccount(r)
 if !ok||actor.GlobalRole!="admin"{fail(w,403,"Administrator required");return}
 if actor.ID==target{fail(w,409,"You cannot suspend your own administrator account");return}
 var input struct{
  Active *bool `json:"active"`
  Reason string `json:"reason"`
 }
 if !parseJSON(w,r,&input){return}
 if input.Active==nil || !validStatusReason(input.Reason){
  fail(w,400,"Specify active and a supported reason");return
 }
 tx,err:=s.db.Begin(r.Context())
 if err!=nil{fail(w,500,"Unable to update account status");return}
 defer tx.Rollback(r.Context())
 var role string
 var active bool
 err=tx.QueryRow(r.Context(),`SELECT global_role,active FROM gqa_users
  WHERE id=$1::uuid FOR UPDATE`,target).Scan(&role,&active)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Account not found");return}
 if err!=nil{fail(w,500,"Unable to inspect account");return}
 if role!="member"{fail(w,403,"Administrator accounts cannot be suspended via this endpoint");return}
 if active==*input.Active{fail(w,409,"Account is already in the requested state");return}
 _,err=tx.Exec(r.Context(),`UPDATE gqa_users SET active=$2 WHERE id=$1::uuid`,
  target,*input.Active)
 if err!=nil{fail(w,500,"Unable to update account");return}
 // Reactivation also requires a new login; never resurrect old cookies.
 _,err=tx.Exec(r.Context(),`UPDATE auth_sessions SET revoked_at=now()
   WHERE user_id=$1::uuid AND revoked_at IS NULL`,target)
 if err!=nil{fail(w,500,"Unable to revoke sessions");return}
 action:="account_suspended"
 if *input.Active{action="account_reactivated"}
 _,err=tx.Exec(r.Context(),`INSERT INTO account_security_audit
   (actor_id,subject_id,action,reason)
   VALUES($1::uuid,$2::uuid,$3,$4)`,actor.ID,target,action,input.Reason)
 if err!=nil{fail(w,500,"Unable to audit account change");return}
 if err=tx.Commit(r.Context());err!=nil{fail(w,500,"Unable to finalize account status");return}
 writeJSON(w,200,map[string]any{"user_id":target,"active":*input.Active})
}

type AccountSecurityEvent struct {
 ID string `json:"id"`
 ActorEmail string `json:"actor_email"`
 SubjectEmail string `json:"subject_email"`
 Action string `json:"action"`
 Reason string `json:"reason"`
 CreatedAt time.Time `json:"created_at"`
}
func (s *server) accountSecurityAudit(w http.ResponseWriter,r *http.Request){
 rows,err:=s.db.Query(r.Context(),`SELECT a.id::text,actor.email,subject.email,
   a.action,a.reason,a.created_at
   FROM account_security_audit a
   JOIN gqa_users actor ON actor.id=a.actor_id
   JOIN gqa_users subject ON subject.id=a.subject_id
   ORDER BY a.created_at DESC LIMIT 100`)
 if err!=nil{fail(w,500,"Unable to inspect account security audit");return}
 defer rows.Close()
 events:=[]AccountSecurityEvent{}
 for rows.Next(){
  var ev AccountSecurityEvent
  if err:=rows.Scan(&ev.ID,&ev.ActorEmail,&ev.SubjectEmail,&ev.Action,
   &ev.Reason,&ev.CreatedAt);err!=nil{fail(w,500,"Unable to read security audit");return}
  events=append(events,ev)
 }
 if rows.Err()!=nil{fail(w,500,"Unable to retrieve audit");return}
 writeJSON(w,200,events)
}
