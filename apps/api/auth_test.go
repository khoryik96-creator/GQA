package main

import (
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
 "time"
)

func TestAdminPasswordPolicy(t *testing.T){
 if _,err:=newAuthenticator(nil,"short","http://localhost:3000",false);err==nil{t.Fatal("weak password accepted")}
 if _,err:=newAuthenticator(nil,"at-least-sixteen-character-password","http://localhost:3000",false);err!=nil{t.Fatal(err)}
 if _,err:=newAuthenticator(nil,"at-least-sixteen-character-password","http://evil.example",false);err==nil{t.Fatal("untrusted origin accepted")}
}

func TestRequireOriginOnWrites(t *testing.T){
 auth,_:=newAuthenticator(nil,"at-least-sixteen-character-password","http://localhost:3000",false)
 next:=auth.enforce(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){w.WriteHeader(204)}))
 for _,origin:=range []string{"","null","http://evil.example","http://localhost:3000.evil.example"}{
  req:=httptest.NewRequest("POST","http://localhost:8080/api/auth/login",strings.NewReader("{}"))
  if origin!=""{req.Header.Set("Origin",origin)}
  res:=httptest.NewRecorder()
  next.ServeHTTP(res,req)
  if res.Code!=403{t.Errorf("origin %q was allowed, status=%d",origin,res.Code)}
 }
 req:=httptest.NewRequest("POST","http://localhost:8080/api/auth/login",strings.NewReader("{}"))
 req.Header.Set("Origin","http://localhost:3000")
 res:=httptest.NewRecorder()
 next.ServeHTTP(res,req)
 if res.Code!=204{t.Fatalf("expected permitted login origin, got %d",res.Code)}
}

func TestRejectAnonymousAPIRequests(t *testing.T){
 auth,_:=newAuthenticator(nil,"at-least-sixteen-character-password","http://localhost:3000",false)
 called:=false
 next:=auth.enforce(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){called=true}))
 req:=httptest.NewRequest("GET","http://localhost:8080/api/projects",nil)
 res:=httptest.NewRecorder()
 next.ServeHTTP(res,req)
 if res.Code!=401 || called {t.Fatalf("anonymous API access: %d, invoked=%v",res.Code,called)}
 req=httptest.NewRequest("GET","http://localhost:8080/healthz",nil)
 res=httptest.NewRecorder()
 next.ServeHTTP(res,req)
 if !called{t.Fatal("healthz should be public")}
}

func TestLoginRateLimit(t *testing.T){
 auth,_:=newAuthenticator(nil,"at-least-sixteen-character-password","http://localhost:3000",false)
 ip:="127.0.0.1"
 for i:=0;i<maxLoginFailures;i++{
  if !auth.mayAttemptLogin(ip){t.Fatalf("blocked too early at attempt %d",i)}
  // Attempts are reserved under the mutex before password checking.
 }
 if auth.mayAttemptLogin(ip){t.Fatal("rate limit not enforced")}
 auth.failures[ip]=[]time.Time{time.Now().Add(-16*time.Minute)}
 if !auth.mayAttemptLogin(ip){t.Fatal("expired failures should be discarded")}
}

func TestCookieAttributes(t *testing.T){
 auth,_:=newAuthenticator(nil,"at-least-sixteen-character-password","http://localhost:3000",true)
 w:=httptest.NewRecorder()
 auth.cookie(w,strings.Repeat("a",64),3600)
 header:=w.Header().Get("Set-Cookie")
 for _,required:=range []string{"HttpOnly","SameSite=Strict","Secure","Path=/api"}{
  if !strings.Contains(header,required){t.Fatalf("cookie missing %q: %s",required,header)}
 }
}

func TestLoginReservationsAreAtomicForConcurrentRequests(t *testing.T){
 auth,_:=newAuthenticator(nil,"at-least-sixteen-character-password","http://localhost:3000",false)
 const requests=100
 accepted:=make(chan bool,requests)
 for i:=0;i<requests;i++{go func(){accepted<-auth.mayAttemptLogin("ip|test@example.com")}()}
 count:=0
 for i:=0;i<requests;i++{if <-accepted{count++}}
 if count!=maxLoginFailures{t.Fatalf("concurrent reservations allowed %d, expected %d",count,maxLoginFailures)}
 if !auth.mayAttemptLogin("ip|other@example.com"){t.Fatal("different user incorrectly shares account bucket")}
}
