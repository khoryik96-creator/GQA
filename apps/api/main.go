package main

import (
  "context"
  _ "embed"
  "encoding/json"
  "errors"
  "io"
  "log"
  "net/http"
  "net/url"
  "os"
  "regexp"
  "strings"
  "time"

  "github.com/jackc/pgx/v5"
  "github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type server struct { db *pgxpool.Pool }

type Project struct {
  ID        string    `json:"id"`
  Name      string    `json:"name"`
  RepoURL   string    `json:"repo_url"`
  AppType   string    `json:"app_type"`
  Stack     string    `json:"stack"`
  CreatedAt time.Time `json:"created_at"`
  MyRole string `json:"my_role"`
}

type Memory struct {
  ID           string    `json:"id"`
  ProjectID    string    `json:"project_id"`
  Kind         string    `json:"kind"`
  Content      string    `json:"content"`
  Source       string    `json:"source"`
  Status       string    `json:"status"`
  SupersedesID string    `json:"supersedes_id"`
  CreatedAt    time.Time `json:"created_at"`
}

type Plan struct {
  ID               string           `json:"id"`
  ProjectID        string           `json:"project_id"`
  RequestID        string           `json:"request_id"`
  Prompt           string           `json:"prompt"`
  Environment      string           `json:"environment"`
  SelectedAgents   []AgentSelection `json:"selected_agents"`
  Warnings         []string         `json:"warnings"`
  ApprovalRequired bool             `json:"approval_required"`
  ExecutionMode    string           `json:"execution_mode"`
  Status           string           `json:"status"`
  ConsultedMemories []MemoryReference `json:"consulted_memories"`
  RepositoryEvidence RepoSnapshot   `json:"repository_evidence"`
  TestSpec         TestSpecification `json:"test_spec"`
  CreatedAt        time.Time        `json:"created_at"`
}

func main() {
  conn := os.Getenv("DATABASE_URL")
  if conn == "" {
    log.Fatal("DATABASE_URL is required")
  }
  ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
  defer cancel()
  db, err := pgxpool.New(ctx, conn)
  if err != nil { log.Fatal(err) }
  defer db.Close()
  if err = db.Ping(ctx); err != nil { log.Fatal("database: ", err) }
  if _, err = db.Exec(ctx, schema, pgx.QueryExecModeSimpleProtocol); err != nil { log.Fatal("migrate schema: ", err) }
  s := &server{db: db}
  origin := os.Getenv("ALLOWED_ORIGIN")
  if origin == "" { origin = "http://localhost:3000" }
  auth,err:=newAuthenticator(db,os.Getenv("GQA_ADMIN_PASSWORD"),origin,
    os.Getenv("GQA_COOKIE_SECURE")=="true")
  if err!=nil{log.Fatal("authentication setup: ",err)}
  if err:=auth.bootstrap(ctx);err!=nil{log.Fatal("admin account bootstrap: ",err)}
  if len(os.Getenv("GQA_RUNNER_TOKEN"))<24 {
    log.Fatal("GQA_RUNNER_TOKEN must be a 24+ character secret in local .env")
  }
  mux := http.NewServeMux()
  mux.HandleFunc("POST /api/auth/login",auth.login)
  mux.HandleFunc("GET /api/auth/session",auth.session)
  mux.HandleFunc("POST /api/auth/logout",auth.logout)
  mux.HandleFunc("POST /api/auth/password",s.changePassword)
  mux.HandleFunc("POST /api/auth/revoke-sessions",s.revokeMySessions)
  mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, 200, map[string]string{"status":"ok"})
  })
  mux.HandleFunc("GET /api/projects", s.projects)
  mux.HandleFunc("POST /api/projects", auth.admin(s.projects))
  mux.HandleFunc("GET /api/projects/{id}/memories", auth.project("read",s.memories))
  mux.HandleFunc("POST /api/projects/{id}/memories", auth.project("qa",s.memories))
  mux.HandleFunc("GET /api/projects/{id}/plans", auth.project("read",s.plans))
  mux.HandleFunc("POST /api/projects/{id}/plans", auth.project("qa",s.plans))
  mux.HandleFunc("GET /api/projects/{id}/inspection", auth.project("read",s.inspection))
  mux.HandleFunc("POST /api/projects/{id}/inspection", auth.project("qa",s.inspection))
  mux.HandleFunc("GET /api/projects/{id}/flows", auth.project("read",s.browserFlows))
  mux.HandleFunc("POST /api/projects/{id}/flows", auth.project("qa",s.browserFlows))
  mux.HandleFunc("POST /api/projects/{id}/flows/{flowId}/execute", auth.project("qa",s.executeBrowserFlow))
  mux.HandleFunc("POST /api/projects/{id}/flows/{flowId}/propose-repair", auth.project("qa",s.proposeRepair))
  mux.HandleFunc("POST /api/projects/{id}/flows/{flowId}/confirm-repair", auth.project("review",s.confirmRepair))
  mux.HandleFunc("GET /api/projects/{id}/repairs", auth.project("read",s.reviewedRepairs))
  mux.HandleFunc("GET /api/projects/{id}/runs", auth.project("read",s.runs))
  mux.HandleFunc("POST /api/projects/{id}/runs", auth.project("qa",s.runs))
  mux.HandleFunc("GET /api/runs/{id}/screenshot", auth.screenshot(s.screenshot))
  mux.HandleFunc("GET /api/admin/users",auth.admin(s.users))
  mux.HandleFunc("POST /api/admin/users",auth.admin(s.users))
  mux.HandleFunc("POST /api/admin/users/{userId}/reset-password",auth.admin(s.adminResetPassword))
  mux.HandleFunc("POST /api/admin/users/{userId}/status",auth.admin(s.adminSetUserStatus))
  mux.HandleFunc("GET /api/admin/security-audit",auth.admin(s.accountSecurityAudit))
  mux.HandleFunc("GET /api/admin/broker-jobs",auth.admin(s.brokerJobs))
  mux.HandleFunc("GET /api/admin/broker-jobs/{id}",auth.admin(s.brokerJobs))
  mux.HandleFunc("POST /api/admin/broker-jobs/{id}/cancel",auth.admin(s.brokerJobs))
  mux.HandleFunc("GET /api/projects/{id}/members",auth.project("manage",s.projectMembers))
  mux.HandleFunc("POST /api/projects/{id}/members",auth.project("manage",s.projectMembers))
  mux.HandleFunc("DELETE /api/projects/{id}/members/{userId}",auth.project("manage",s.removeProjectMember))
  mux.HandleFunc("GET /api/projects/{id}/access-audit",auth.project("manage",s.accessAudit))
  mux.HandleFunc("OPTIONS /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
  port := os.Getenv("PORT")
  if port == "" { port = "8080" }
  log.Printf("GQA API listening on :%s", port)
  httpServer:=&http.Server{
    Addr:":"+port,Handler:cors(auth.enforce(mux),origin),
    ReadHeaderTimeout:5*time.Second,IdleTimeout:60*time.Second,
  }
  log.Fatal(httpServer.ListenAndServe())
}

func cors(next http.Handler, origin string) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if r.Header.Get("Origin")==origin {
      w.Header().Set("Access-Control-Allow-Origin",origin)
      w.Header().Set("Access-Control-Allow-Credentials","true")
    }
    w.Header().Set("Vary","Origin")
    w.Header().Set("Access-Control-Allow-Methods","GET, POST, DELETE, OPTIONS")
    w.Header().Set("Access-Control-Allow-Headers","Content-Type")
    w.Header().Set("X-Content-Type-Options","nosniff")
    w.Header().Set("X-Frame-Options","DENY")
    w.Header().Set("Referrer-Policy","no-referrer")
    w.Header().Set("Cache-Control","no-store")
    next.ServeHTTP(w, r)
  })
}

func writeJSON(w http.ResponseWriter, status int, v any) {
  w.Header().Set("Content-Type", "application/json")
  w.WriteHeader(status)
  if err := json.NewEncoder(w).Encode(v); err != nil { log.Printf("JSON response: %v", err) }
}

func fail(w http.ResponseWriter, status int, message string) {
  writeJSON(w, status, map[string]string{"error": message})
}

func parseJSON(w http.ResponseWriter, r *http.Request, dest any) bool {
  r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
  decoder := json.NewDecoder(r.Body)
  decoder.DisallowUnknownFields()
  if err := decoder.Decode(dest); err != nil {
    fail(w, 400, "Invalid JSON payload: "+err.Error())
    return false
  }
  var extra any
  if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
    fail(w, 400, "Unexpected trailing JSON data")
    return false
  }
  return true
}

func validProjectID(w http.ResponseWriter, r *http.Request) (string, bool) {
  id := r.PathValue("id")
  if !uuidRE.MatchString(id) { fail(w, 400, "Invalid project ID"); return "", false }
  return id, true
}

func validGitHubURL(input string) bool {
  u, err := url.Parse(input)
  if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, "github.com") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
    return false
  }
  p := strings.Trim(strings.TrimSuffix(u.Path, ".git"), "/")
  parts := strings.Split(p, "/")
  return len(parts) == 2 && parts[0] != "" && parts[1] != ""
}

func isOneOf(input string, allowed ...string) bool {
  for _, value := range allowed { if input == value { return true } }
  return false
}

func (s *server) projects(w http.ResponseWriter, r *http.Request) {
  if r.Method == http.MethodGet {
    account,ok:=currentAccount(r)
    if !ok {fail(w,401,"Account login required");return}
    sql:=`SELECT p.id::text,p.name,p.repo_url,p.app_type,p.stack,p.created_at,
       'admin'::text AS my_role
       FROM projects p ORDER BY p.created_at DESC LIMIT 100`
    var rows pgx.Rows
    var err error
    if account.GlobalRole=="admin" {
      rows,err=s.db.Query(r.Context(),sql)
    } else {
      sql=`SELECT p.id::text,p.name,p.repo_url,p.app_type,p.stack,p.created_at,
        m.role AS my_role
        FROM projects p JOIN project_memberships m ON m.project_id=p.id
        WHERE m.user_id=$1::uuid ORDER BY p.created_at DESC LIMIT 100`
      rows,err=s.db.Query(r.Context(),sql,account.ID)
    }
    if err != nil { fail(w, 500, "Unable to retrieve projects"); return }
    defer rows.Close()
    projects := []Project{}
    for rows.Next() {
      var p Project
      if err := rows.Scan(&p.ID, &p.Name, &p.RepoURL, &p.AppType, &p.Stack, &p.CreatedAt,&p.MyRole); err != nil {
        fail(w, 500, "Unable to read projects"); return
      }
      projects = append(projects, p)
    }
    if rows.Err() != nil { fail(w, 500, "Unable to read projects"); return }
    writeJSON(w, 200, projects)
    return
  }

  var input struct {
    Name string `json:"name"`
    RepoURL string `json:"repo_url"`
    AppType string `json:"app_type"`
    Stack string `json:"stack"`
  }
  if !parseJSON(w,r,&input) { return }
  input.Name = strings.TrimSpace(input.Name)
  input.RepoURL = strings.TrimSpace(input.RepoURL)
  input.Stack = strings.TrimSpace(input.Stack)
  if len(input.Name) < 2 || len(input.Name) > 100 || len(input.Stack) > 300 ||
    !validGitHubURL(input.RepoURL) || !isOneOf(input.AppType,"fullstack","web","mobile","api","backend") {
    fail(w, 400, "Provide a 2-100 character name, GitHub repository URL, valid application type and optional stack")
    return
  }
  var p Project
  err := s.db.QueryRow(r.Context(),
    "INSERT INTO projects (name,repo_url,app_type,stack) VALUES ($1,$2,$3,$4) RETURNING id::text,name,repo_url,app_type,stack,created_at",
    input.Name,input.RepoURL,input.AppType,input.Stack,
  ).Scan(&p.ID,&p.Name,&p.RepoURL,&p.AppType,&p.Stack,&p.CreatedAt)
  if err != nil { fail(w,500,"Unable to create project"); return }
  p.MyRole="admin"
  writeJSON(w,201,p)
}

func (s *server) memories(w http.ResponseWriter, r *http.Request) {
  id, ok := validProjectID(w,r)
  if !ok { return }

  if r.Method == http.MethodGet {
    query := strings.TrimSpace(r.URL.Query().Get("q"))
    if len(query) > 200 { fail(w,400,"Memory search too long"); return }
    rows, err := s.db.Query(r.Context(),
      "SELECT id::text,project_id::text,kind,content,source,status,COALESCE(supersedes_id::text,''),created_at FROM memories WHERE project_id=$1::uuid AND ($2='' OR search_document @@ plainto_tsquery('english',$2)) ORDER BY created_at DESC LIMIT 100",
      id,query)
    if err != nil { fail(w,500,"Unable to retrieve memories"); return }
    defer rows.Close()
    memories := []Memory{}
    for rows.Next() {
      var m Memory
      if err := rows.Scan(&m.ID,&m.ProjectID,&m.Kind,&m.Content,&m.Source,&m.Status,&m.SupersedesID,&m.CreatedAt); err != nil {
        fail(w,500,"Unable to read memories"); return
      }
      memories = append(memories,m)
    }
    if rows.Err() != nil { fail(w,500,"Unable to read memories"); return }
    writeJSON(w,200,memories)
    return
  }

  var input struct {
    Kind string `json:"kind"`
    Content string `json:"content"`
    SupersedesID string `json:"supersedes_id"`
  }
  if !parseJSON(w,r,&input) { return }
  input.Content = strings.TrimSpace(input.Content)
  if !isOneOf(input.Kind,"architecture","requirement","correction","lesson","preference") ||
    len(input.Content) < 3 || len(input.Content) > 10000 {
    fail(w,400,"Choose a valid memory category and provide 3-10000 characters")
    return
  }
  if input.SupersedesID != "" && !uuidRE.MatchString(input.SupersedesID) {
    fail(w,400,"Invalid supersedes memory ID"); return
  }

  tx, err := s.db.Begin(r.Context())
  if err != nil { fail(w,500,"Could not open memory transaction"); return }
  defer tx.Rollback(r.Context())
  if input.SupersedesID != "" {
    var previousID string
    err = tx.QueryRow(r.Context(),
      "UPDATE memories SET status='superseded' WHERE id=$1::uuid AND project_id=$2::uuid AND status='confirmed' RETURNING id::text",
      input.SupersedesID,id).Scan(&previousID)
    if errors.Is(err,pgx.ErrNoRows) { fail(w,404,"Memory to supersede not found in this project"); return }
    if err != nil { fail(w,500,"Could not supersede memory"); return }
  }
  var m Memory
  err = tx.QueryRow(r.Context(),
    "INSERT INTO memories (project_id,kind,content,source,status,supersedes_id) VALUES ($1::uuid,$2,$3,'user','confirmed',NULLIF($4,'')::uuid) RETURNING id::text,project_id::text,kind,content,source,status,COALESCE(supersedes_id::text,''),created_at",
    id,input.Kind,input.Content,input.SupersedesID,
  ).Scan(&m.ID,&m.ProjectID,&m.Kind,&m.Content,&m.Source,&m.Status,&m.SupersedesID,&m.CreatedAt)
  if err != nil { fail(w,500,"Unable to save memory (check project ID)"); return }
  if err = tx.Commit(r.Context()); err != nil { fail(w,500,"Unable to commit memory"); return }
  writeJSON(w,201,m)
}

func (s *server) plans(w http.ResponseWriter, r *http.Request) {
  id, ok := validProjectID(w,r)
  if !ok { return }
  if r.Method == http.MethodGet {
    rows, err := s.db.Query(r.Context(),
      "SELECT p.id::text,p.project_id::text,p.request_id::text,q.prompt,q.environment,p.selected_agents,p.warnings,p.approval_required,p.status,p.created_at,p.consulted_memories,p.repo_context,p.test_spec FROM plans p JOIN qa_requests q ON q.id=p.request_id WHERE p.project_id=$1::uuid ORDER BY p.created_at DESC LIMIT 50",
      id)
    if err != nil { fail(w,500,"Unable to retrieve plans"); return }
    defer rows.Close()
    plans := []Plan{}
    for rows.Next() {
      var p Plan
      var agentsJSON, warningsJSON, memoriesJSON, repoJSON, specJSON []byte
      if err := rows.Scan(&p.ID,&p.ProjectID,&p.RequestID,&p.Prompt,&p.Environment,&agentsJSON,&warningsJSON,&p.ApprovalRequired,&p.Status,&p.CreatedAt,&memoriesJSON,&repoJSON,&specJSON); err != nil {
        fail(w,500,"Unable to read plans"); return
      }
      if json.Unmarshal(agentsJSON,&p.SelectedAgents) != nil || json.Unmarshal(warningsJSON,&p.Warnings) != nil || json.Unmarshal(memoriesJSON,&p.ConsultedMemories) != nil || json.Unmarshal(repoJSON,&p.RepositoryEvidence) != nil || json.Unmarshal(specJSON,&p.TestSpec) != nil {
        fail(w,500,"Invalid stored plan"); return
      }
      p.ExecutionMode = "plan_only"
      plans = append(plans,p)
    }
    if rows.Err() != nil { fail(w,500,"Unable to read plans"); return }
    writeJSON(w,200,plans)
    return
  }

  var input struct {
    Prompt string `json:"prompt"`
    Environment string `json:"environment"`
  }
  if !parseJSON(w,r,&input) { return }
  input.Prompt = strings.TrimSpace(input.Prompt)
  if input.Environment == "" { input.Environment = "staging" }
  if len(input.Prompt) < 10 || len(input.Prompt) > 10000 ||
    !isOneOf(input.Environment,"local","staging","production") {
    fail(w,400,"Provide a 10-10000 character prompt and a valid environment"); return
  }
  var appType, stack string
  err := s.db.QueryRow(r.Context(),"SELECT app_type,stack FROM projects WHERE id=$1::uuid",id).Scan(&appType,&stack)
  if errors.Is(err,pgx.ErrNoRows) { fail(w,404,"Project not found"); return }
  if err != nil { fail(w,500,"Unable to inspect project"); return }

  memories,err:=s.relevantMemories(r.Context(),id,input.Prompt)
  if err!=nil{fail(w,500,"Unable to retrieve confirmed project memory");return}
  repoURL:=""
  if err:=s.db.QueryRow(r.Context(),"SELECT repo_url FROM projects WHERE id=$1::uuid",id).Scan(&repoURL);err!=nil{
    fail(w,500,"Unable to identify repository");return
  }
  snapshot,repoWarning:=s.snapshotForPlan(r.Context(),id,repoURL)
  enrichedStack,enrichedPrompt:=enrichedPlanningContext(stack,input.Prompt,snapshot,memories)
  decision := selectAgents(appType,enrichedStack,enrichedPrompt,input.Environment)
  if repoWarning!=""{decision.Warnings=append(decision.Warnings,repoWarning)}
  spec:=generateTestSpecification(r.Context(),PlannerInput{
    Prompt:input.Prompt,Environment:input.Environment,
    Application:appType,Stack:enrichedStack,
    Agents:decision.Agents,Memories:memories,Repository:snapshot,
  })
  agentsJSON, _ := json.Marshal(decision.Agents)
  warningsJSON, _ := json.Marshal(decision.Warnings)
  memoriesJSON,_:=json.Marshal(memories)
  repoJSON,_:=json.Marshal(snapshot)
  specJSON,_:=json.Marshal(spec)
  tx, err := s.db.Begin(r.Context())
  if err != nil { fail(w,500,"Unable to start plan transaction"); return }
  defer tx.Rollback(r.Context())
  var plan Plan
  plan.ProjectID=id
  plan.Prompt=input.Prompt
  plan.Environment=input.Environment
  plan.SelectedAgents=decision.Agents
  plan.Warnings=decision.Warnings
  plan.ApprovalRequired=decision.ApprovalRequired
  plan.ExecutionMode=decision.ExecutionMode
  plan.Status="draft"
  plan.ConsultedMemories=memories
  plan.RepositoryEvidence=snapshot
  plan.TestSpec=spec
  err = tx.QueryRow(r.Context(),
    "INSERT INTO qa_requests (project_id,prompt,environment) VALUES ($1::uuid,$2,$3) RETURNING id::text",
    id,input.Prompt,input.Environment).Scan(&plan.RequestID)
  if err != nil { fail(w,500,"Unable to save QA request"); return }
  err = tx.QueryRow(r.Context(),
    "INSERT INTO plans (project_id,request_id,selected_agents,warnings,approval_required,consulted_memories,repo_context,test_spec) VALUES ($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING id::text,created_at",
    id,plan.RequestID,string(agentsJSON),string(warningsJSON),decision.ApprovalRequired,string(memoriesJSON),string(repoJSON),string(specJSON)).Scan(&plan.ID,&plan.CreatedAt)
  if err != nil { fail(w,500,"Unable to save QA plan"); return }
  if err = tx.Commit(r.Context()); err != nil { fail(w,500,"Unable to commit QA plan"); return }
  writeJSON(w,201,plan)
}

