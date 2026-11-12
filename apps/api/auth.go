package main

import (
 "context"
 "crypto/rand"
 "crypto/sha256"
 "crypto/subtle"
 "encoding/hex"
 "errors"
 "net"
 "net/http"
 "os"
 "strings"
 "sync"
 "time"

 "github.com/jackc/pgx/v5/pgxpool"
)

// GQA v0.6 uses a single local administrator, not a multi-tenant identity system.
// No credential material or raw session tokens are stored in PostgreSQL.
const (
 sessionCookieName = "gqa_session"
 sessionLifetime   = 12 * time.Hour
 failedLoginWindow = 15 * time.Minute
 maxLoginFailures  = 5
)

type authContextKey struct{}

type authenticator struct {
 db *pgxpool.Pool
 passwordDigest [32]byte
 allowedOrigin string
 secureCookie bool
 mu sync.Mutex
 failures map[string][]time.Time
}

func newAuthenticator(db *pgxpool.Pool, password, allowedOrigin string, secure bool) (*authenticator,error) {
 if len(password)<16 || len(password)>256 {
  return nil,errors.New("GQA_ADMIN_PASSWORD must contain 16-256 characters; configure it in your local .env")
 }
 if !strings.HasPrefix(allowedOrigin,"http://localhost:") &&
  !strings.HasPrefix(allowedOrigin,"https://") {
  return nil,errors.New("ALLOWED_ORIGIN must be a trusted local or HTTPS frontend origin")
 }
 return &authenticator{
  db:db,passwordDigest:sha256.Sum256([]byte(password)),
  allowedOrigin:allowedOrigin,secureCookie:secure,
  failures:make(map[string][]time.Time),
 },nil
}

func (a *authenticator) validOrigin(origin string) bool {
 return origin!="" && origin==a.allowedOrigin
}

func clientIP(r *http.Request) string {
 host,_,err:=net.SplitHostPort(r.RemoteAddr)
 if err!=nil {return r.RemoteAddr}
 return host // Never trust X-Forwarded-For on a direct local listener.
}

func (a *authenticator) mayAttemptLogin(ip string) bool {
 a.mu.Lock();defer a.mu.Unlock()
 now:=time.Now()
 recent:=make([]time.Time,0,maxLoginFailures)
 for _,when:=range a.failures[ip] {
  if now.Sub(when)<failedLoginWindow{recent=append(recent,when)}
 }
 if len(recent)==0{delete(a.failures,ip)}else{a.failures[ip]=recent}
 return len(recent)<maxLoginFailures
}

func (a *authenticator) recordLoginFailure(ip string) {
 a.mu.Lock();defer a.mu.Unlock()
 a.failures[ip]=append(a.failures[ip],time.Now())
}

func (a *authenticator) clearFailures(ip string) {
 a.mu.Lock();defer a.mu.Unlock()
 delete(a.failures,ip)
}

func sessionDigest(r *http.Request)([]byte,error){
 cookie,err:=r.Cookie(sessionCookieName)
 if err!=nil{return nil,err}
 if len(cookie.Value)!=64{return nil,errors.New("invalid session token size")}
 raw,err:=hex.DecodeString(cookie.Value)
 if err!=nil||len(raw)!=32{return nil,errors.New("invalid session token")}
 digest:=sha256.Sum256(raw)
 return digest[:],nil
}

func (a *authenticator) sessionExpires(ctx context.Context,r *http.Request)(time.Time,error){
 digest,err:=sessionDigest(r)
 if err!=nil{return time.Time{},err}
 var expires time.Time
 err=a.db.QueryRow(ctx,`
  SELECT expires_at FROM auth_sessions
  WHERE token_digest=$1::bytea AND revoked_at IS NULL AND expires_at>now()`,digest).Scan(&expires)
 return expires,err
}

func (a *authenticator) cookie(w http.ResponseWriter,value string,maxAge int){
 http.SetCookie(w,&http.Cookie{
  Name:sessionCookieName,Value:value,Path:"/api",HttpOnly:true,
  SameSite:http.SameSiteStrictMode,Secure:a.secureCookie,
  MaxAge:maxAge,Expires:time.Now().Add(time.Duration(maxAge)*time.Second),
 })
}

func (a *authenticator) login(w http.ResponseWriter,r *http.Request){
 ip:=clientIP(r)
 if !a.mayAttemptLogin(ip){
  w.Header().Set("Retry-After","900")
  fail(w,http.StatusTooManyRequests,"Too many login attempts. Try again later.")
  return
 }
 var input struct{Password string `json:"password"`}
 if !parseJSON(w,r,&input){return}
 if len(input.Password)>256{fail(w,http.StatusBadRequest,"Invalid login request");return}
 candidate:=sha256.Sum256([]byte(input.Password))
 if subtle.ConstantTimeCompare(candidate[:],a.passwordDigest[:])!=1{
  a.recordLoginFailure(ip)
  fail(w,http.StatusUnauthorized,"Invalid administrator password")
  return
 }
 raw:=make([]byte,32)
 if _,err:=rand.Read(raw);err!=nil{fail(w,500,"Unable to initialize session");return}
 hashed:=sha256.Sum256(raw)
 expires:=time.Now().UTC().Add(sessionLifetime)
 _,err:=a.db.Exec(r.Context(),`
  INSERT INTO auth_sessions(token_digest,expires_at) VALUES($1::bytea,$2)`,
  hashed[:],expires)
 if err!=nil{fail(w,500,"Unable to save session");return}
 a.clearFailures(ip)
 a.cookie(w,hex.EncodeToString(raw),int(sessionLifetime.Seconds()))
 writeJSON(w,http.StatusOK,map[string]any{"authenticated":true,"expires_at":expires})
}

func (a *authenticator) session(w http.ResponseWriter,r *http.Request){
 expiry,ok:=r.Context().Value(authContextKey{}).(time.Time)
 if !ok {fail(w,401,"Not authenticated");return}
 writeJSON(w,http.StatusOK,map[string]any{
  "authenticated":true,"expires_at":expiry,
 })
}

func (a *authenticator) logout(w http.ResponseWriter,r *http.Request){
 digest,err:=sessionDigest(r)
 if err==nil{
  if _,err=a.db.Exec(r.Context(),`
    UPDATE auth_sessions SET revoked_at=now()
    WHERE token_digest=$1::bytea AND revoked_at IS NULL`,digest);err!=nil{
    fail(w,500,"Unable to revoke session");return
  }
 }
 a.cookie(w,"",-1)
 w.WriteHeader(http.StatusNoContent)
}

// Guard the entire /api namespace, not individual handlers.
// Exact Origin is required for all writes, including login and logout.
// Read-only health checks stay public for Docker diagnostics.
func (a *authenticator) enforce(next http.Handler)http.Handler{
 return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.Method==http.MethodOptions{
   next.ServeHTTP(w,r);return
  }
  if r.Method!=http.MethodGet&&r.Method!=http.MethodHead{
   if !a.validOrigin(r.Header.Get("Origin")){
    fail(w,http.StatusForbidden,"Request origin is not authorized");return
   }
  }
  if strings.HasPrefix(r.URL.Path,"/api/") &&
     r.URL.Path!="/api/auth/login"{
    expires,err:=a.sessionExpires(r.Context(),r)
    if err!=nil{
     fail(w,http.StatusUnauthorized,"Administrator login required");return
    }
    r=r.WithContext(context.WithValue(r.Context(),authContextKey{},expires))
  }
  next.ServeHTTP(w,r)
 })
}

var _ = os.Getenv
