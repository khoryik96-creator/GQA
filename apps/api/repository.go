package main

import (
  "context"
  "encoding/json"
  "errors"
  "fmt"
  "io"
  "net/http"
  "net/url"
  "sort"
  "strings"
  "time"
)

type RepoSnapshot struct {
  Repository    string    `json:"repository"`
  DefaultBranch string    `json:"default_branch"`
  Technologies  []string  `json:"technologies"`
  TestEvidence  []string  `json:"test_evidence"`
  FileCount     int       `json:"file_count"`
  Truncated     bool      `json:"truncated"`
  InspectedAt   time.Time `json:"inspected_at"`
}

var githubReadClient = &http.Client{
  Timeout: 12 * time.Second,
  CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
}

func githubRepoParts(raw string) (string, string, error) {
  if !validGitHubURL(raw) { return "", "", errors.New("GitHub URL must be https://github.com/owner/repository") }
  parsed, _ := url.Parse(raw)
  pieces := strings.Split(strings.Trim(strings.TrimSuffix(parsed.Path, ".git"), "/"), "/")
  return pieces[0], pieces[1], nil
}

func githubReadJSON(ctx context.Context, path string, dest any) error {
  req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com"+path, nil)
  if err != nil { return err }
  req.Header.Set("Accept", "application/vnd.github+json")
  req.Header.Set("User-Agent", "GQA-Repo-Inspector/0.2")
  resp, err := githubReadClient.Do(req)
  if err != nil { return err }
  defer resp.Body.Close()
  if resp.StatusCode != http.StatusOK { return fmt.Errorf("GitHub API status %d (private repositories require future authenticated integration)", resp.StatusCode) }
  return json.NewDecoder(io.LimitReader(resp.Body, 5<<20)).Decode(dest)
}

func detectRepo(files []string) (tech, tests []string) {
  techSet := map[string]bool{}
  testSet := map[string]bool{}
  for _, file := range files {
    name := strings.ToLower(file)
    base := name[strings.LastIndex(name, "/")+1:]
    switch {
    case base == "go.mod": techSet["Go"] = true
    case base == "package.json": techSet["Node.js / TypeScript / JavaScript"] = true
    case base == "tsconfig.json": techSet["TypeScript"] = true
    case base == "pyproject.toml" || base == "requirements.txt": techSet["Python"] = true
    case base == "pom.xml" || base == "build.gradle" || base == "build.gradle.kts": techSet["Java / Kotlin"] = true
    case base == "pubspec.yaml": techSet["Flutter / Dart"] = true
    case base == "cargo.toml": techSet["Rust"] = true
    case base == "package.swift": techSet["Swift"] = true
    }
    if strings.HasPrefix(base,"playwright.config.") { testSet["Playwright configuration"] = true }
    if strings.HasPrefix(base,"vitest.config.") { testSet["Vitest configuration"] = true }
    if base == "pytest.ini" || base == "conftest.py" { testSet["pytest configuration"] = true }
    if base == "jest.config.js" || base == "jest.config.ts" { testSet["Jest configuration"] = true }
    if strings.HasSuffix(base,".spec.ts") || strings.HasSuffix(base,".spec.js") ||
       strings.HasSuffix(base,".test.ts") || strings.HasSuffix(base,".test.js") ||
       strings.HasSuffix(base,"_test.go") || strings.HasPrefix(base,"test_") {
       testSet["Existing automated test files"] = true
    }
    if strings.HasPrefix(name, ".github/workflows/") { testSet["GitHub Actions workflows"] = true }
  }
  for k := range techSet { tech = append(tech,k) }
  for k := range testSet { tests = append(tests,k) }
  sort.Strings(tech); sort.Strings(tests)
  return
}

func inspectGitHubRepo(ctx context.Context, rawURL string) (RepoSnapshot, error) {
  owner, name, err := githubRepoParts(rawURL)
  if err != nil { return RepoSnapshot{},err }
  path := "/repos/"+url.PathEscape(owner)+"/"+url.PathEscape(name)
  var repoInfo struct {
    DefaultBranch string `json:"default_branch"`
  }
  if err = githubReadJSON(ctx,path,&repoInfo);err!=nil { return RepoSnapshot{},err }
  if repoInfo.DefaultBranch=="" { return RepoSnapshot{},errors.New("Repository has no default branch") }
  var tree struct {
    Tree []struct { Path string `json:"path"`; Type string `json:"type"` } `json:"tree"`
    Truncated bool `json:"truncated"`
  }
  if err = githubReadJSON(ctx,path+"/git/trees/"+url.PathEscape(repoInfo.DefaultBranch)+"?recursive=1",&tree);err!=nil {
    return RepoSnapshot{},err
  }
  fileNames:=make([]string,0,len(tree.Tree))
  for _,entry:=range tree.Tree { if entry.Type=="blob" {fileNames=append(fileNames,entry.Path)} }
  technologies,testEvidence:=detectRepo(fileNames)
  return RepoSnapshot{
    Repository: owner+"/"+name, DefaultBranch:repoInfo.DefaultBranch,
    Technologies:technologies, TestEvidence:testEvidence,
    FileCount:len(fileNames), Truncated:tree.Truncated,InspectedAt:time.Now().UTC(),
  },nil
}

func (s *server) storedInspection(ctx context.Context,id string) (RepoSnapshot,error) {
  var b []byte
  err:=s.db.QueryRow(ctx,"SELECT snapshot FROM repo_inspections WHERE project_id=$1::uuid",id).Scan(&b)
  if err!=nil{return RepoSnapshot{},err}
  var result RepoSnapshot
  if err=json.Unmarshal(b,&result);err!=nil{return RepoSnapshot{},err}
  return result,nil
}

func (s *server) refreshInspection(ctx context.Context,id,repoURL string)(RepoSnapshot,error){
  snapshot,err:=inspectGitHubRepo(ctx,repoURL)
  if err!=nil{return RepoSnapshot{},err}
  data,_:=json.Marshal(snapshot)
  _,err=s.db.Exec(ctx,
    "INSERT INTO repo_inspections(project_id,snapshot) VALUES($1::uuid,$2::jsonb) ON CONFLICT(project_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,updated_at=now()",
    id,string(data))
  return snapshot,err
}

func (s *server) snapshotForPlan(ctx context.Context,id,repoURL string)(RepoSnapshot,string) {
  snapshot,err:=s.storedInspection(ctx,id)
  if err==nil && time.Since(snapshot.InspectedAt)<24*time.Hour {return snapshot,""}
  newSnapshot,refreshErr:=s.refreshInspection(ctx,id,repoURL)
  if refreshErr==nil {return newSnapshot,""}
  if err==nil {return snapshot,"Repository re-inspection failed; using the previous snapshot: "+refreshErr.Error()}
  return RepoSnapshot{},"Repository inspection unavailable: "+refreshErr.Error()
}

func (s *server) inspection(w http.ResponseWriter,r *http.Request){
  id,ok:=validProjectID(w,r);if !ok{return}
  if r.Method==http.MethodGet {
    snapshot,err:=s.storedInspection(r.Context(),id)
    if err!=nil { fail(w,404,"No repository inspection yet");return }
    writeJSON(w,200,snapshot);return
  }
  var repoURL string
  if err:=s.db.QueryRow(r.Context(),"SELECT repo_url FROM projects WHERE id=$1::uuid",id).Scan(&repoURL);err!=nil{
    fail(w,404,"Project not found");return
  }
  snapshot,err:=s.refreshInspection(r.Context(),id,repoURL)
  if err!=nil{fail(w,502,err.Error());return}
  writeJSON(w,200,snapshot)
}
