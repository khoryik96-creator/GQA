package main

import (
 "errors"
 "net/http"
 "regexp"
 "strings"

 "github.com/jackc/pgx/v5"
)

var emailPattern=regexp.MustCompile(`^[a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,}$`)
func normalizeEmail(email string)string{return strings.ToLower(strings.TrimSpace(email))}
func validEmail(email string)bool{return len(email)<=254&&emailPattern.MatchString(email)}

const (
 roleOwner="owner"
 roleQA="qa"
 roleReviewer="reviewer"
 roleViewer="viewer"
)
func canAccess(role,capability string)bool{
 switch capability{
 case "read":return isOneOf(role,roleOwner,roleQA,roleReviewer,roleViewer)
 case "qa":return isOneOf(role,roleOwner,roleQA)
 case "review":return isOneOf(role,roleOwner,roleReviewer)
 case "manage":return role==roleOwner
 }
 return false
}
func (a *authenticator) projectRole(r *http.Request,projectID string)(string,error){
 account,ok:=currentAccount(r)
 if !ok{return "",errors.New("missing account context")}
 if account.GlobalRole=="admin"{return "admin",nil}
 var role string
 err:=a.db.QueryRow(r.Context(),`
  SELECT role FROM project_memberships
  WHERE project_id=$1::uuid AND user_id=$2::uuid`,projectID,account.ID).Scan(&role)
 return role,err
}
func (a *authenticator) allowedProject(w http.ResponseWriter,r *http.Request,
 projectID,capability string)bool{
 if !uuidRE.MatchString(projectID){fail(w,400,"Invalid project ID");return false}
 role,err:=a.projectRole(r,projectID)
 if errors.Is(err,pgx.ErrNoRows){
  fail(w,404,"Project not found");return false
 }
 if err!=nil{fail(w,500,"Unable to check project permission");return false}
 if role!="admin"&&!canAccess(role,"read"){
  fail(w,404,"Project not found");return false
 }
 if role!="admin"&&!canAccess(role,capability){
  fail(w,403,"Your project role does not allow this action");return false
 }
 return true
}
func (a *authenticator) project(capability string,h http.HandlerFunc)http.HandlerFunc{
 return func(w http.ResponseWriter,r *http.Request){
  if !a.allowedProject(w,r,r.PathValue("id"),capability){return}
  h(w,r)
 }
}
func (a *authenticator) admin(h http.HandlerFunc)http.HandlerFunc{
 return func(w http.ResponseWriter,r *http.Request){
  account,ok:=currentAccount(r)
  if !ok||account.GlobalRole!="admin"{
   fail(w,403,"Administrator access required");return
  }
  h(w,r)
 }
}
func (a *authenticator) screenshot(h http.HandlerFunc)http.HandlerFunc{
 return func(w http.ResponseWriter,r *http.Request){
  runID:=r.PathValue("id")
  if !uuidRE.MatchString(runID){fail(w,400,"Invalid run ID");return}
  var projectID string
  err:=a.db.QueryRow(r.Context(),`
   SELECT project_id::text FROM test_runs WHERE id=$1::uuid`,runID).Scan(&projectID)
  if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Run not found");return}
  if err!=nil{fail(w,500,"Unable to check run permission");return}
  if !a.allowedProject(w,r,projectID,"read"){return}
  h(w,r)
 }
}
