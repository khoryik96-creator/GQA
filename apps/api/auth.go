package main

import (
 "context"
 "crypto/rand"
 "crypto/sha256"
 "encoding/hex"
 "errors"
 "net"
 "net/http"
 "strings"
 "sync"
 "time"

 "github.com/jackc/pgx/v5/pgxpool"
 "golang.org/x/crypto/bcrypt"
)

const (
 sessionCookieName = "gqa_session"
 sessionLifetime = 12 * time.Hour
 failedLoginWindow = 15 * time.Minute
 maxLoginFailures = 5
 bootstrapEmail = "admin@gqa.local"
)

type authContextKey struct{}
type Account struct {
 ID string `json:"id"`
 Email string `json:"email"`
 GlobalRole string `json:"global_role"`
}
type authenticatedSession struct {
 Account Account
 Expires time.Time
}
func currentAccount(r *http.Request)(Account,bool){
 session,ok:=r.Context().Value(authContextKey{}).(authenticatedSession)
 return session.Account,ok
}

type authenticator struct {
 db *pgxpool.Pool
 bootstrapPassword string
 dummyHash []byte
 allowedOrigin string
 secureCookie bool
 mu sync.Mutex
 failures map[string][]time.Time
}

func newAuthenticator(db *pgxpool.Pool,password,allowedOrigin string,secure bool)(*authenticator,error){
 if len(password)<16 || len(password)>72 {
  return nil,errors.New("GQA_ADMIN_PASSWORD must contain 16-72 bytes; configure it in your local .env")
 }
 if !strings.HasPrefix(allowedOrigin,"http://localhost:") &&
  !strings.HasPrefix(allowedOrigin,"https://") {
  return nil,errors.New("ALLOWED_ORIGIN must be a trusted local or HTTPS frontend origin")
 }
 dummy,err:=bcrypt.GenerateFromPassword([]byte("invalid-gqa-user-password-sentinel"),bcrypt.DefaultCost)
 if err!=nil{return nil,err}
 return &authenticator{
  db:db,bootstrapPassword:password,dummyHash:dummy,
  allowedOrigin:allowedOrigin,secureCookie:secure,
  failures:make(map[string][]time.Time),
 },nil
}

// Bootstrap only if this installation has no accounts. Existing users and
// passwords are NOT silently overwritten on container restarts.
func (a *authenticator) bootstrap(ctx context.Context) error{
 var exists bool
 if err:=a.db.QueryRow(ctx,"SELECT EXISTS (SELECT 1 FROM gqa_users)").Scan(&exists);err!=nil{return err}
 if exists{return nil}
 hashed,err:=bcrypt.GenerateFromPassword([]byte(a.bootstrapPassword),bcrypt.DefaultCost)
 if err!=nil{return err}
 _,err=a.db.Exec(ctx,`
  INSERT INTO gqa_users(email,password_hash,global_role)
  VALUES($1,$2,'admin') ON CONFLICT DO NOTHING`,bootstrapEmail,string(hashed))
 return err
}

func (a *authenticator) validOrigin(origin string)bool{
 return origin!="" && origin==a.allowedOrigin
}
func clientIP(r *http.Request)string{
 host,_,err:=net.SplitHostPort(r.RemoteAddr)
 if err!=nil{return r.RemoteAddr}
 return host
}
func (a *authenticator) reserveLoginAttempt(key string,max int)bool{
 a.mu.Lock();defer a.mu.Unlock()
 now:=time.Now()
 // Bounded cleanup protects the process from unbounded key churn.
 if len(a.failures)>4096{
  for candidate,history:=range a.failures{
   if len(history)==0||now.Sub(history[len(history)-1])>=failedLoginWindow{
    delete(a.failures,candidate)
   }
  }
  if len(a.failures)>4096{
   // Fail closed when abusive unique-account attempts saturate memory.
   return false
  }
 }
 recent:=[]time.Time{}
 for _,when:=range a.failures[key]{
  if now.Sub(when)<failedLoginWindow{recent=append(recent,when)}
 }
 if len(recent)>=max{
  a.failures[key]=recent
  return false
 }
 // The allowance is reserved atomically, before any expensive bcrypt work.
 a.failures[key]=append(recent,now)
 return true
}
func (a *authenticator) mayAttemptLogin(key string)bool{
 return a.reserveLoginAttempt(key,maxLoginFailures)
}
func (a *authenticator) mayAttemptFromIP(ip string)bool{
 return a.reserveLoginAttempt("ip:"+ip,100)
}
func (a *authenticator) clearFailures(ip string){
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
func (a *authenticator) sessionIdentity(ctx context.Context,r *http.Request)(authenticatedSession,error){
 digest,err:=sessionDigest(r)
 if err!=nil{return authenticatedSession{},err}
 var identity authenticatedSession
 err=a.db.QueryRow(ctx,`
  SELECT s.expires_at,u.id::text,u.email,u.global_role
  FROM auth_sessions s
  JOIN gqa_users u ON u.id=s.user_id
  WHERE s.token_digest=$1::bytea AND s.revoked_at IS NULL
  AND s.expires_at>now() AND u.active=true`,digest).
  Scan(&identity.Expires,&identity.Account.ID,&identity.Account.Email,&identity.Account.GlobalRole)
 return identity,err
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
 var input struct{
  Email string `json:"email"`
  Password string `json:"password"`
 }
 if !parseJSON(w,r,&input){return}
 // Legacy local clients that supplied only an administrator password
 // continue to work; the UI always sends an explicit account email.
 input.Email=normalizeEmail(input.Email)
 if input.Email==""{input.Email=bootstrapEmail}
 if len(input.Password)>256{fail(w,400,"Invalid login request");return}
 accountLimitKey:=ip+"|"+input.Email
 if !a.mayAttemptLogin(accountLimitKey)||!a.mayAttemptFromIP(ip){
  w.Header().Set("Retry-After","900")
  fail(w,http.StatusTooManyRequests,"Too many login attempts. Try again later.")
  return
 }
 var account Account
 var passwordHash string
 err:=a.db.QueryRow(r.Context(),`
  SELECT id::text,email,global_role,password_hash FROM gqa_users
  WHERE email=$1 AND active=true`,input.Email).
  Scan(&account.ID,&account.Email,&account.GlobalRole,&passwordHash)
 hash:=a.dummyHash
 if err==nil{hash=[]byte(passwordHash)}
 validPassword:=bcrypt.CompareHashAndPassword(hash,[]byte(input.Password))==nil
 if err!=nil||!validPassword{
  fail(w,401,"Invalid account credentials")
  return
 }
 raw:=make([]byte,32)
 if _,err:=rand.Read(raw);err!=nil{fail(w,500,"Unable to initialize session");return}
 hashed:=sha256.Sum256(raw)
 expires:=time.Now().UTC().Add(sessionLifetime)
 _,err=a.db.Exec(r.Context(),`
  INSERT INTO auth_sessions(token_digest,user_id,expires_at)
  VALUES($1::bytea,$2::uuid,$3)`,hashed[:],account.ID,expires)
 if err!=nil{fail(w,500,"Unable to save session");return}
 a.clearFailures(accountLimitKey)
 a.cookie(w,hex.EncodeToString(raw),int(sessionLifetime.Seconds()))
 writeJSON(w,200,map[string]any{"authenticated":true,"expires_at":expires,"user":account})
}
func (a *authenticator) session(w http.ResponseWriter,r *http.Request){
 identity,ok:=r.Context().Value(authContextKey{}).(authenticatedSession)
 if !ok{fail(w,401,"Not authenticated");return}
 writeJSON(w,200,map[string]any{
  "authenticated":true,"expires_at":identity.Expires,"user":identity.Account,
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

// Check current session and user status on EVERY API call, so revocations,
// account suspension, and role changes are effective without re-login.
func (a *authenticator) enforce(next http.Handler)http.Handler{
 return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.Method==http.MethodOptions{
   next.ServeHTTP(w,r);return
  }
  if r.Method!=http.MethodGet&&r.Method!=http.MethodHead &&
    !a.validOrigin(r.Header.Get("Origin")){
   fail(w,http.StatusForbidden,"Request origin is not authorized");return
  }
  if strings.HasPrefix(r.URL.Path,"/api/") &&
     r.URL.Path!="/api/auth/login"{
   session,err:=a.sessionIdentity(r.Context(),r)
   if err!=nil{
    fail(w,http.StatusUnauthorized,"Account login required");return
   }
   r=r.WithContext(context.WithValue(r.Context(),authContextKey{},session))
  }
  next.ServeHTTP(w,r)
 })
}

// This helper is kept simple: passwords are never stored in the clear.
