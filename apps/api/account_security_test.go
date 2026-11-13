package main

import (
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
)

func TestNewPasswordPolicy(t *testing.T){
 for _,pw:=range []string{"short",strings.Repeat("x",73),"valid-password-with-\x00-null"}{
  if validNewPassword(pw){t.Fatalf("invalid password accepted: length %d",len(pw))}
 }
 for _,pw:=range []string{"correct-horse-battery-staple",strings.Repeat("z",72)}{
  if !validNewPassword(pw){t.Fatal("valid password rejected")}
 }
}
func TestStatusChangeRequiresExplicitReason(t *testing.T){
 for _,reason:=range []string{"security_review","team_change","access_cleanup","account_recovery"}{
  if !validStatusReason(reason){t.Errorf("valid reason rejected: %s",reason)}
 }
 for _,reason:=range []string{"","none","password:secret","freeform sensitive data"}{
  if validStatusReason(reason){t.Errorf("invalid reason accepted: %s",reason)}
 }
}
func TestAdminPasswordEndpointIsProtectedByOrigin(t *testing.T){
 auth,_:=newAuthenticator(nil,"16-character-password","http://localhost:3000",false)
 handler:=auth.enforce(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  w.WriteHeader(204)
 }))
 req:=httptest.NewRequest(http.MethodPost,"http://localhost:8080/api/auth/password",strings.NewReader("{}"))
 res:=httptest.NewRecorder()
 handler.ServeHTTP(res,req)
 if res.Code!=403{t.Fatalf("expected write origin denial, got %d",res.Code)}
}
