"use client";

import { useEffect, useMemo, useState, useRef, type FormEvent } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2,
  Clock3, Database, FileCode2, FolderKanban, GitBranch, Globe2,
  History, Layers3, Loader2, Plus, Search, Send, ShieldCheck,
  Smartphone, Sparkles, Target, Workflow, X, LogOut, LockKeyhole, type LucideIcon
} from "lucide-react";
import dynamic from "next/dynamic";
import type { TestSpecification } from "../components/ScenarioReview";

// Panels are loaded only when their tab or workflow is opened. Avoid sending
// full QA history, administration and flow-editing UIs in the login bundle.
const ScenarioReview = dynamic(() => import("../components/ScenarioReview"));
const BrowserFlowStudio = dynamic(() => import("../components/BrowserFlowStudio"));
const TeamAccess = dynamic(() => import("../components/TeamAccess"));
const AccountSecurity = dynamic(() => import("../components/AccountSecurity"));
const RegressionIntelligence = dynamic(() => import("../components/RegressionIntelligence"));

type AppType = "fullstack" | "web" | "api" | "backend" | "mobile";
type Environment = "local" | "staging" | "production";
type MemoryKind = "architecture" | "requirement" | "correction" | "lesson" | "preference";

type AccessRole = "admin" | "owner" | "qa" | "reviewer" | "viewer";
type Account = { id:string;email:string;global_role:"admin" | "member" };
type AuthResponse = {authenticated:boolean;expires_at:string;user:Account};
type Project = {
  id: string; name: string; repo_url: string; app_type: AppType;
  stack: string; created_at: string; my_role:AccessRole;
};
type Agent = { id: string; name: string; reason: string };
type RepoSnapshot = { repository: string; default_branch: string; technologies: string[]; test_evidence: string[]; file_count: number; truncated: boolean; inspected_at: string };
type MemoryReference = { id: string; kind: string; content: string; source: string };
type Plan = {
  id: string; project_id: string; request_id: string; prompt: string;
  environment: Environment; selected_agents: Agent[]; warnings: string[];
  approval_required: boolean; execution_mode: string;
  consulted_memories: MemoryReference[];
  repository_evidence: RepoSnapshot;
  test_spec?: TestSpecification;
  status: string; created_at: string;
};
type SmokeCheck = { name: string; status: string; duration_ms: number; detail: string };
type TestRun = { id: string; project_id: string; plan_id: string; target_url: string; status: string; checks: SmokeCheck[]; screenshot_available: boolean; started_at: string; finished_at: string | null; flow_id?: string; execution_kind?: string; evidence?: {failure_kind?: string;worker_lifecycle?: string;job_id?: string} };
type Memory = {
  id: string; project_id: string; kind: MemoryKind; content: string;
  source: string; status: string; supersedes_id: string; created_at: string;
};
type MemoryPage = { items: Memory[]; next_cursor: string };
type PlanPage = { items: Plan[]; next_cursor: string };
type RunPage = { items: TestRun[]; next_cursor: string };

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const icons: Record<string, LucideIcon> = {
  "repo-intelligence": FileCode2,
  "web": Globe2,
  "mobile": Smartphone,
  "api": Workflow,
  "backend": Database,
  "performance": Activity,
  "security": ShieldCheck,
  "defect": Target
};
const labels: Record<AppType, string> = {
  fullstack: "Full-stack app", web: "Web application", api: "API service",
  backend: "Backend service", mobile: "Mobile application"
};
const kinds: MemoryKind[] = ["architecture", "requirement", "correction", "lesson", "preference"];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store"
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json() as Promise<T>;
}
function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function CommandCenter() {
  const [authStatus, setAuthStatus] = useState<"checking" | "anonymous" | "authenticated">("checking");
  const [password, setPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("admin@gqa.local");
  const [account, setAccount] = useState<Account | null>(null);
  const [loginError, setLoginError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A project switch invalidates all outstanding results from the old tab.
  const selectedProjectRef = useRef<string | null>(null);
  selectedProjectRef.current = selectedId;
  const isCurrentProject = (id:string) => selectedProjectRef.current===id;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planCursor, setPlanCursor] = useState("");
  const [runCursor, setRunCursor] = useState("");
  const [loadingHistory, setLoadingHistory] = useState<"plans" | "runs" | null>(null);
  const historyRequestVersion = useRef(0);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [inspection, setInspection] = useState<RepoSnapshot | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [runningSmoke, setRunningSmoke] = useState(false);
  const [smokeTarget, setSmokeTarget] = useState("http://fixture:8081");
  const [view, setView] = useState<"command" | "memory" | "team" | "insights">("command");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("Test the critical user journeys, API contracts, and backend data integrity. Highlight risks and missing coverage.");
  const [environment, setEnvironment] = useState<Environment>("staging");
  const [projectName, setProjectName] = useState("");
  const [repoURL, setRepoURL] = useState("");
  const [stack, setStack] = useState("");
  const [appType, setAppType] = useState<AppType>("fullstack");
  const [memoryKind, setMemoryKind] = useState<MemoryKind>("requirement");
  const [memoryText, setMemoryText] = useState("");
  const [supersedesId, setSupersedesId] = useState("");
  const [memorySearch, setMemorySearch] = useState("");
  const [activeMemoryQuery, setActiveMemoryQuery] = useState("");
  const [memoryNextCursor, setMemoryNextCursor] = useState("");
  const [loadingMemories, setLoadingMemories] = useState(false);
  const memoryRequestVersion = useRef(0);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewRevision, setOverviewRevision] = useState(0);

  const selected = useMemo(() => projects.find(p => p.id === selectedId), [projects, selectedId]);
  const latest = plans[0];
  const latestRun = runs[0];
  const isAdmin=account?.global_role==="admin";
  const projectRole=selected?.my_role;
  const canQA=projectRole==="admin"||projectRole==="owner"||projectRole==="qa";
  const canReview=projectRole==="admin"||projectRole==="owner"||projectRole==="reviewer";
  const canManage=projectRole==="admin"||projectRole==="owner";

  useEffect(() => {
    let cancelled = false;
    fetch(API + "/api/auth/session", { credentials: "include", cache: "no-store" })
      .then(async response => {
        if (!response.ok) return null;
        return response.json() as Promise<AuthResponse>;
      }).then(data => {
        if (!cancelled) {
          setAccount(data?.user||null);
          setAuthStatus(data?.user ? "authenticated" : "anonymous");
        }
      })
      .catch(() => { if (!cancelled) setAuthStatus("anonymous"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    setLoadingProjects(true);
    call<Project[]>("/api/projects")
      .then(list => {
        if (!cancelled) {
          setProjects(list);
          setSelectedId(previous => list.some(project => project.id === previous) ?
            previous : list[0]?.id || null);
        }
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [authStatus]);

  useEffect(() => {
    // Cancel outgoing project requests; a slow or failed endpoint must not
    // discard successful, independently useful project data.
    const controller = new AbortController();
    if (!selectedId || authStatus !== "authenticated") {
      setLoadingOverview(false);
      return () => controller.abort();
    }
    const requestedProject = selectedId;
    setLoadingOverview(true);
    setError("");
    setPlans([]);
    setMemories([]);
    setRuns([]);
    setPlanCursor(""); setRunCursor("");
    const historyVersion=++historyRequestVersion.current;
    setInspection(null);
    setMemoryNextCursor("");
    setActiveMemoryQuery("");
    const memoryVersion = ++memoryRequestVersion.current;
    const prefix = "/api/projects/" + requestedProject;
    Promise.allSettled([
      call<PlanPage>(prefix + "/plans?limit=25", { signal: controller.signal }),
      call<MemoryPage>(prefix + "/memories?limit=25", { signal: controller.signal }),
      call<RunPage>(prefix + "/runs?limit=25", { signal: controller.signal })
    ]).then(results => {
      if (controller.signal.aborted || !isCurrentProject(requestedProject)) return;
      const [plansResult, memoriesResult, runsResult] = results;
      if (plansResult.status === "fulfilled" && historyRequestVersion.current===historyVersion) {
        setPlans(plansResult.value.items);
        setPlanCursor(plansResult.value.next_cursor);
        const snapshot = plansResult.value.items[0]?.repository_evidence;
        if (snapshot?.repository) setInspection(snapshot);
      }
      if (memoriesResult.status === "fulfilled" && memoryRequestVersion.current === memoryVersion) {
        setMemories(memoriesResult.value.items);
        setMemoryNextCursor(memoriesResult.value.next_cursor);
      }
      if (runsResult.status === "fulfilled" && historyRequestVersion.current===historyVersion) {
        setRuns(runsResult.value.items);
        setRunCursor(runsResult.value.next_cursor);
      }
      const failed = results.flatMap((result, i) => result.status === "rejected"
        ? [["QA plans", "project memory", "test runs"][i]] : []);
      if (failed.length) setError("Unable to load " + failed.join(", ") + ". Other project data remains available.");
    }).finally(() => {
      if (!controller.signal.aborted && isCurrentProject(requestedProject)) setLoadingOverview(false);
    });
    return () => controller.abort();
  }, [selectedId, authStatus, overviewRevision]);


  function selectProject(id: string) {
    if (id === selectedId) return;
    // Clear project-scoped records and pending memory corrections in the same
    // React update as selection, before another project's panel can render.
    selectedProjectRef.current = id;
    memoryRequestVersion.current++;
    historyRequestVersion.current++;
    setLoadingHistory(null);setPlanCursor("");setRunCursor("");
    setPlans([]); setMemories([]); setRuns([]); setInspection(null);
    setMemoryNextCursor(""); setActiveMemoryQuery(""); setLoadingMemories(false);
    setMemoryText(""); setSupersedesId(""); setMemorySearch("");
    setError(""); setView("command");
    setSelectedId(id);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true); setLoginError("");
    try {
      const response = await fetch(API + "/api/auth/login", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({error:"Login unavailable"}));
        throw new Error(error.error || "Unable to log in");
      }
      const data=await response.json() as AuthResponse;
      setPassword("");setAccount(data.user);
      setAuthStatus("authenticated");
    } catch (err) { setLoginError((err as Error).message); }
    finally { setAuthBusy(false); }
  }

  function clearSessionUI() {
    selectedProjectRef.current=null;
    setProjects([]);setSelectedId(null);setPlans([]);setMemories([]);setRuns([]);
    setAuthStatus("anonymous");setPassword("");setAccount(null);
    setSecurityOpen(false);setView("command");
  }

  async function signOut() {
    setAuthBusy(true); setError("");
    try {
      const response = await fetch(API + "/api/auth/logout", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Unable to revoke session");
      clearSessionUI();
    } catch (err) { setError((err as Error).message); }
    finally { setAuthBusy(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!isAdmin)return;
    setBusy(true); setError("");
    try {
      const created = await call<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: projectName, repo_url: repoURL, app_type: appType, stack })
      });
      setProjects(list => [created, ...list]);
      selectProject(created.id);
      setShowCreate(false);
      setProjectName(""); setRepoURL(""); setStack("");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !canQA) return;
    const requestedProject=selectedId;
    setBusy(true); setError("");
    try {
      const plan = await call<Plan>("/api/projects/" + selectedId + "/plans", {
        method: "POST", body: JSON.stringify({ prompt, environment })
      });
      if(isCurrentProject(requestedProject)){
        setPlans(list => [plan, ...list]);
        if (plan.repository_evidence?.repository) setInspection(plan.repository_evidence);
      }
    } catch (err) { if(isCurrentProject(requestedProject))setError((err as Error).message); }
    finally { setBusy(false); }
  }


  async function inspectRepository() {
    if (!selectedId || !canQA) return;
    const requestedProject=selectedId;
    setInspecting(true); setError("");
    try {
      const snapshot = await call<RepoSnapshot>("/api/projects/" + selectedId + "/inspection", { method: "POST" });
      if(isCurrentProject(requestedProject))setInspection(snapshot);
    } catch (err) { if(isCurrentProject(requestedProject))setError((err as Error).message); }
    finally { setInspecting(false); }
  }

  async function executeSmoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !latest || !canQA) return;
    const requestedProject=selectedId;
    setRunningSmoke(true); setError("");
    try {
      const result = await call<TestRun>("/api/projects/" + selectedId + "/runs", {
        method: "POST", body: JSON.stringify({ plan_id: latest.id, target_url: smokeTarget })
      });
      if(isCurrentProject(requestedProject))setRuns(list => [result, ...list]);
    } catch (err) { if(isCurrentProject(requestedProject))setError((err as Error).message); }
    finally { setRunningSmoke(false); }
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !canQA) return;
    const requestedProject=selectedId;
    setSavingMemory(true); setError("");
    try {
      const memory = await call<Memory>("/api/projects/" + selectedId + "/memories", {
        method: "POST",
        body: JSON.stringify({ kind: memoryKind, content: memoryText, supersedes_id: supersedesId })
      });
      if(isCurrentProject(requestedProject)){
        setMemories(list => [
          memory,
          ...list.map(m => m.id === supersedesId ? { ...m, status: "superseded" } : m)
        ]);
        setMemoryText(""); setSupersedesId("");
      }
    } catch (err) { if(isCurrentProject(requestedProject))setError((err as Error).message); }
    finally { setSavingMemory(false); }
  }

  async function searchMemories(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || loadingMemories) return;
    const requestedProject=selectedId;
    const query=memorySearch.trim();
    const version=++memoryRequestVersion.current;
    setLoadingMemories(true);setError("");
    try {
      const page=await call<MemoryPage>("/api/projects/"+requestedProject+
        "/memories?limit=25&q="+encodeURIComponent(query));
      if(isCurrentProject(requestedProject)&&memoryRequestVersion.current===version){
        setActiveMemoryQuery(query);
        setMemories(page.items);setMemoryNextCursor(page.next_cursor);
      }
    }catch(err){
      if(isCurrentProject(requestedProject)&&memoryRequestVersion.current===version)
        setError((err as Error).message);
    }finally{
      if(isCurrentProject(requestedProject)&&memoryRequestVersion.current===version)
        setLoadingMemories(false);
    }
  }
  async function loadMoreMemories(){
    if(!selectedId||!memoryNextCursor||loadingMemories)return;
    const requestedProject=selectedId;
    const version=++memoryRequestVersion.current;
    setLoadingMemories(true);setError("");
    try{
      const page=await call<MemoryPage>("/api/projects/"+requestedProject+
        "/memories?limit=25&q="+encodeURIComponent(activeMemoryQuery)+
        "&cursor="+encodeURIComponent(memoryNextCursor));
      if(isCurrentProject(requestedProject)&&memoryRequestVersion.current===version){
        setMemories(previous=>{
          const existing=new Set(previous.map(m=>m.id));
          return [...previous,...page.items.filter(m=>!existing.has(m.id))];
        });
        setMemoryNextCursor(page.next_cursor);
      }
    }catch(err){
      if(isCurrentProject(requestedProject)&&memoryRequestVersion.current===version)
        setError((err as Error).message);
    }finally{
      if(isCurrentProject(requestedProject)&&memoryRequestVersion.current===version)
        setLoadingMemories(false);
    }
  }

  async function loadMoreHistory(kind:"plans"|"runs"){
    const requestedProject=selectedId;
    const cursor=kind==="plans"?planCursor:runCursor;
    if(!requestedProject||!cursor||loadingHistory)return;
    const requestVersion=historyRequestVersion.current;
    setLoadingHistory(kind);setError("");
    try{
      const path="/api/projects/"+requestedProject+"/"+kind+
        "?limit=25&cursor="+encodeURIComponent(cursor);
      if(kind==="plans"){
        const page=await call<PlanPage>(path);
        if(!isCurrentProject(requestedProject)||historyRequestVersion.current!==requestVersion)return;
        setPlans(prev=>{
          const ids=new Set(prev.map(item=>item.id));
          return [...prev,...page.items.filter(item=>!ids.has(item.id))];
        });
        setPlanCursor(page.next_cursor);
      }else{
        const page=await call<RunPage>(path);
        if(!isCurrentProject(requestedProject)||historyRequestVersion.current!==requestVersion)return;
        setRuns(prev=>{
          const ids=new Set(prev.map(item=>item.id));
          return [...prev,...page.items.filter(item=>!ids.has(item.id))];
        });
        setRunCursor(page.next_cursor);
      }
    }catch(err){
      if(isCurrentProject(requestedProject)&&historyRequestVersion.current===requestVersion)
        setError("Unable to load older "+kind+": "+(err as Error).message);
    }finally{
      if(isCurrentProject(requestedProject)&&historyRequestVersion.current===requestVersion)
        setLoadingHistory(null);
    }
  }

  function correctMemory(memory: Memory) {
    if (!canQA) return;
    setSupersedesId(memory.id);
    setMemoryKind("correction");
    setMemoryText(memory.content);
    setView("memory");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (authStatus !== "authenticated") {
    return <main className="login-screen">
      <div className="login-panel">
        <div className="login-symbol"><BrainCircuit size={31}/></div>
        <div className="eyebrow"><LockKeyhole size={14}/> GQA ACCOUNT ACCESS</div>
        <h1>{authStatus === "checking" ? "Checking session" : "Sign in to GQA"}</h1>
        <p>{authStatus === "checking"
          ? "Verifying your authenticated workspace..."
          : "Access the projects and QA activities permitted for your account."}</p>
        {authStatus === "anonymous" && <form onSubmit={signIn}>
          <label>Account email
            <input type="email" required autoComplete="username"
              maxLength={254} value={loginEmail} onChange={e=>setLoginEmail(e.target.value)}
              placeholder="admin@gqa.local"/>
          </label>
          <label>Password
            <input type="password" autoComplete="current-password" required
              value={password} maxLength={72} onChange={e => setPassword(e.target.value)}
              placeholder="Your assigned account password"/>
          </label>
          {loginError && <div className="browser-flow-error" role="alert"><AlertTriangle size={15}/>{loginError}</div>}
          <button className="button primary full-width" type="submit" disabled={authBusy || !password}>
            {authBusy ? <Loader2 size={16} className="spin"/> : <LockKeyhole size={16}/>}
            {authBusy ? "Signing in..." : "Sign in"}
          </button>
        </form>}
        <p className="fine-print">Local prototype with project-level roles. Accounts are provisioned by administrators, not through self-registration.</p>
      </div>
    </main>;
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <span className="brand-mark"><BrainCircuit size={22}/></span>
          <div><strong>GQA</strong><small>Principal QA Platform</small></div>
        </div>
        <div className="sidebar-section">
          <div className="section-title"><span>PROJECTS</span>{isAdmin&&<button className="icon-btn" title="Create project" onClick={() => setShowCreate(true)}><Plus size={16}/></button>}</div>
          {projects.map(p => (
            <button key={p.id} type="button" aria-pressed={selectedId === p.id} className={"project-item " + (selectedId === p.id ? "active" : "")} onClick={() => selectProject(p.id)}>
              <Layers3 size={16}/><span>{p.name}</span>
              {selectedId === p.id && <span className="selected-indicator"/>}
            </button>
          ))}
          {projects.length === 0 && !loadingProjects && <p className="sidebar-empty">No projects yet</p>}
          {loadingProjects && <span className="muted small">Loading projects…</span>}
        </div>
        <div className="sidebar-footer">
          <div className="status-dot"/><span>GQA · Local QA</span>
          <small>{account?.email} · {account?.global_role}</small>
        </div>
      </aside>

      <main className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumb"><FolderKanban size={17}/><span>Workspace</span><span className="slash">/</span><strong>{selected?.name || "Overview"}</strong></div>
          <div className="topbar-actions">
            <span className="preview-label"><span className="status-dot"/> {account?.email||"Local development"}</span>
            <button className="button secondary" type="button" onClick={()=>setSecurityOpen(open=>!open)}>
              <LockKeyhole size={15}/> Account security
            </button>
            <button className="button secondary" type="button" onClick={signOut} disabled={authBusy}>
              <LogOut size={15}/> Sign out
            </button>
          </div>
        </header>

        <div className="content">
          {securityOpen && account && <AccountSecurity apiBase={API} email={account.email}
            onClose={()=>setSecurityOpen(false)} onSignedOut={clearSessionUI}/>}
          {error && <div className="error-banner" role="alert"><AlertTriangle size={17}/><span>{error}</span><button onClick={() => setError("")} title="Dismiss"><X size={16}/></button></div>}
          {selected && loadingOverview && <p className="muted small" role="status" aria-live="polite">Loading project plans, memories and recent runs…</p>}
          {selected && error.startsWith("Unable to load ") && !loadingOverview &&
            <button className="button secondary" type="button" onClick={() => setOverviewRevision(n => n + 1)}>Retry project data</button>}

          {showCreate && isAdmin && (
            <section className="card modal-card">
              <div className="card-head"><div><h2>Create project</h2><p>Connect a GitHub repository and establish its project context.</p></div><button className="icon-btn" onClick={() => setShowCreate(false)} title="Close"><X size={18}/></button></div>
              <form onSubmit={createProject} className="form-grid">
                <label>Project name<input required minLength={2} maxLength={100} value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. HiringPlug"/></label>
                <label>GitHub repository URL<input required value={repoURL} onChange={e => setRepoURL(e.target.value)} placeholder="https://github.com/owner/repo"/></label>
                <label>Application type<select value={appType} onChange={e => setAppType(e.target.value as AppType)}>{Object.entries(labels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Technology stack (optional)<input maxLength={300} value={stack} onChange={e => setStack(e.target.value)} placeholder="e.g. Go, React, PostgreSQL"/></label>
                <div className="form-actions"><button type="button" className="button secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? "Creating..." : "Create project"} <ArrowRight size={16}/></button></div>
              </form>
            </section>
          )}

          {!selected ? (
            <section className="empty-state">
              <span className="empty-symbol"><BrainCircuit size={36}/></span>
              <h1>Build a smarter QA workflow.</h1>
              <p>Connect your first software project to create testing plans, retain engineering knowledge, and coordinate specialist QA agents.</p>
              {isAdmin?<button className="button primary" onClick={() => setShowCreate(true)}><Plus size={17}/> Create your first project</button>:
              <p className="muted small">Ask a project owner or administrator to assign your account to a project.</p>}
            </section>
          ) : (
            <>
              <div className="page-intro">
                <div><div className="eyebrow"><Sparkles size={14}/> PROJECT INTELLIGENCE</div><h1>{selected.name}</h1><p>Plan tests, investigate regressions and preserve verified project knowledge.</p></div>
                <div className="project-chip"><GitBranch size={16}/><span>{labels[selected.app_type]} · {projectRole}</span></div>
              </div>
              <div className="repo-strip"><GitBranch size={16}/><a href={selected.repo_url} target="_blank" rel="noreferrer">{selected.repo_url}</a><span className="subtle-divider"/> <span>{selected.stack || "Stack not recorded"}</span></div>

              <div className="tabs">
                <button className={view === "command" ? "current" : ""} onClick={() => setView("command")}><BrainCircuit size={17}/> QA Command</button>
                <button className={view === "memory" ? "current" : ""} onClick={() => setView("memory")}><Database size={17}/> Project Memory <span className="mini-count">{memories.length}</span></button>
                <button className={view === "insights" ? "current" : ""} onClick={() => setView("insights")}><Activity size={17}/> Regression Insights</button>
                {canManage&&<button className={view==="team"?"current":""} onClick={()=>setView("team")}><ShieldCheck size={17}/> Team Access</button>}
              </div>

              {view === "team" && canManage && account ? (
                <TeamAccess key={selected.id} projectId={selected.id} apiBase={API}
                  isAdmin={!!isAdmin} selfUserId={account.id}/>
              ) : view === "insights" ? (
                <RegressionIntelligence key={selected.id} projectId={selected.id} apiBase={API}/>
              ) : view === "command" ? (
                <div className="workspace-grid">
                  <div className="workspace-main">
                    <section className="card prompt-card">
                      <div className="card-head"><div><h2><Sparkles size={18}/> Ask your Principal QA Engineer</h2><p>Describe what you want tested. GQA will propose the right specialist team.</p></div><span className="pill">Plan mode</span></div>
                      <form onSubmit={createPlan}>
                        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} minLength={10} maxLength={10000} rows={6} disabled={!canQA} placeholder="Describe the workflows, risks, tests or issues to investigate..." required/>
                        <div className="prompt-actions"><label>Target <select value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="local">Local</option><option value="staging">Staging</option><option value="production">Production (approval required)</option></select></label><button className="button primary" type="submit" disabled={busy || !canQA}>{busy ? <Loader2 size={16} className="spin"/> : <Send size={16}/>} Generate QA plan</button></div>
                      </form>
                    </section>

                    {latest ? <section className="card">
                      <div className="card-head"><div><h2><Target size={18}/> Recommended QA team</h2><p>Selected for your latest request · {when(latest.created_at)}</p></div><span className={"pill " + (latest.approval_required ? "warning" : "neutral")}>{latest.approval_required ? "Approval required" : "Draft plan"}</span></div>
                      <div className="agent-grid">
                        {latest.selected_agents.map(a => { const Icon = icons[a.id] || BrainCircuit; return <div className="agent-card" key={a.id}><span className="agent-icon"><Icon size={20}/></span><div><strong>{a.name}</strong><p>{a.reason}</p></div><CheckCircle2 size={16} className="agent-check"/></div>; })}
                      </div>
                      <div className="notice"><ShieldCheck size={17}/><div><strong>Planning is memory-aware; execution stays separately controlled.</strong><p>Agent selection is deterministic, informed by repository evidence and confirmed project memories. This is not yet an LLM-generated QA strategy.</p></div></div>
                      <div className="context-panel">
                        <strong>Context used for this plan</strong>
                        <p>{latest.repository_evidence?.repository ? "GitHub: " + latest.repository_evidence.repository + " · " + (latest.repository_evidence.technologies || []).join(", ") : "Repository inspection not available."}</p>
                        <p>{latest.consulted_memories.length} confirmed project memory record(s) consulted.</p>
                        {latest.consulted_memories.slice(0,4).map(m => <div key={m.id} className="memory-excerpt"><span>{m.kind}</span>{m.content}</div>)}
                      </div>
                      {latest.warnings.filter(w => !w.startsWith("Planning only")).map(w => <div className="warning-line" key={w}><AlertTriangle size={15}/>{w}</div>)}
                    </section> : <section className="card placeholder-card"><Workflow size={28}/><h3>No QA plan yet</h3><p>Submit your first testing request to generate a project-specific agent selection plan.</p></section>}
                    {latest && <ScenarioReview spec={latest.test_spec}/>}
                    <BrowserFlowStudio
                      key={selectedId}
                      projectId={selectedId!}
                      planId={latest?.id}
                      hasWeb={!!latest?.selected_agents.some(a => a.id === "web")}
                      canDraft={canQA}
                      canReview={canReview}
                      canRun={canQA && !!latest && !latest.approval_required && latest.environment !== "production" &&
                        latest.selected_agents.some(a => a.id === "web")}
                      apiBase={API}
                      runs={runs}
                      onRunRecorded={run => {
                        if (isCurrentProject(selected.id)) setRuns(current =>
                          [run, ...current.filter(previous => previous.id !== run.id)]);
                      }}
                    />
                    <section className="card">
                      <div className="card-head"><div><h2><Activity size={18}/> Read-only smoke execution</h2><p>Real API and Playwright checks in a separate local Docker runner.</p></div><span className="pill neutral">Approved targets</span></div>
                      <form className="smoke-form" onSubmit={executeSmoke}>
                        <label>Approved test target<input value={smokeTarget} onChange={e => setSmokeTarget(e.target.value)} placeholder="http://fixture:8081"/></label>
                        <p className="fine-print">The built-in fixture works immediately. Other origins must be explicitly allowlisted in both Docker services. No write, load, or active security tests are permitted.</p>
                        <button className="button primary" type="submit" disabled={!canQA || !latest || latest.approval_required || runningSmoke || !latest.selected_agents.some(a => a.id === "api" || a.id === "web")}>
                          {runningSmoke ? <Loader2 size={16} className="spin"/> : <Activity size={16}/>}
                          {runningSmoke ? "Executing smoke checks..." : "Execute safe smoke checks"}
                        </button>
                      </form>
                      {latestRun && <div className="run-result">
                        <div className="run-heading"><strong>Latest run · {when(latestRun.started_at)}</strong><span className={"pill " + (latestRun.status === "passed" ? "" : "warning")}>{latestRun.status}</span></div>
                        {latestRun.evidence && <p className="fine-print">
                          Worker: {latestRun.evidence.worker_lifecycle === "ephemeral_container" ?
                            "disposable Docker container" :
                            latestRun.evidence.worker_lifecycle === "single_job_process" ?
                            "new process for this run" : "legacy"}
                          {latestRun.evidence.failure_kind && " · Result category: " + latestRun.evidence.failure_kind.replaceAll("_", " ")}
                        </p>}
                        {latestRun.checks.map((check, index) => <div className="check-row" key={index}>
                          {check.status === "passed" ? <CheckCircle2 size={16} className="check-pass"/> : <AlertTriangle size={16} className="check-fail"/>}
                          <div><strong>{check.name}</strong><p>{check.detail} · {check.duration_ms}ms</p></div>
                        </div>)}
                        {latestRun.screenshot_available && <a className="text-button" href={API + "/api/runs/" + latestRun.id + "/screenshot"} target="_blank" rel="noreferrer">Open browser screenshot <ArrowRight size={15}/></a>}
                      </div>}
                    </section>
                  </div>

                  <div className="workspace-side">
                    <section className="card side-card">
                      <div className="card-head"><div><h2><FileCode2 size={17}/> Repository intelligence</h2></div></div>
                      <p className="small muted">{inspection?.repository || "Repository not yet inspected"}</p>
                      {inspection && <>
                        <p className="small">Branch: {inspection.default_branch} · {inspection.file_count} files</p>
                        <p className="small muted">Stack: {inspection.technologies.length ? inspection.technologies.join(", ") : "Undetermined"}</p>
                        <p className="small muted">Test evidence: {inspection.test_evidence.length ? inspection.test_evidence.join(", ") : "No known test conventions detected"}</p>
                      </>}
                      <button className="button secondary full-width" onClick={inspectRepository} disabled={inspecting || !canQA}>
                        {inspecting ? <Loader2 size={15} className="spin"/> : <Search size={15}/>}
                        {inspecting ? "Inspecting..." : "Inspect public GitHub repository"}
                      </button>
                      <p className="fine-print">Public GitHub metadata only; private repository authentication will be added later.</p>
                    </section>
                    <section className="card side-card"><div className="card-head"><div><h2><Activity size={17}/> Project overview</h2></div></div><div className="stat-list"><div><span>QA plans</span><strong>{plans.length}</strong></div><div><span>Memories in view</span><strong>{memories.length}</strong></div><div><span>Smoke runs</span><strong>{runs.length}</strong></div></div></section>
                    <section className="card side-card"><div className="card-head"><div><h2><History size={17}/> Previous requests</h2></div></div>{plans.length === 0 ? <p className="muted small">Requests will appear here after you create a QA plan.</p> : <div className="history-list">{plans.map(p => <div className="history-item" key={p.id}><span className="history-marker"/><div><p>{p.prompt}</p><small><Clock3 size={12}/>{when(p.created_at)} · {p.environment}</small></div></div>)}</div>}
                      {planCursor&&<button className="button secondary" type="button" disabled={!!loadingHistory}
                        onClick={()=>loadMoreHistory("plans")}>{loadingHistory==="plans"?"Loading…":"Load older plans"}</button>}
                    </section>
                    <section className="card side-card">
                      <div className="card-head"><div><h2><Activity size={17}/> Execution history</h2><p>Most recent project runs, including browser flows.</p></div></div>
                      {runs.length===0?<p className="muted small">No execution records yet.</p>:
                        <div className="history-list">{runs.map(run=><div className="history-item" key={run.id}>
                          <span className="history-marker"/><div><p>{run.status} · {run.execution_kind||"smoke"}</p>
                          <small>{when(run.started_at)} · {run.target_url}</small></div>
                        </div>)}</div>}
                      {runCursor&&<button className="button secondary" type="button"
                        disabled={!!loadingHistory} onClick={()=>loadMoreHistory("runs")}>
                        {loadingHistory==="runs"?"Loading…":"Load older runs"}</button>}
                    </section>
                    <section className="card side-card help-card"><ShieldCheck size={22}/><strong>Memory-first architecture</strong><p>Document requirements, corrections and lessons so future QA plans can use verified project context.</p><button className="text-button" onClick={() => setView("memory")}>Open project memory <ArrowRight size={15}/></button></section>
                  </div>
                </div>
              ) : (
                <div className="memory-layout">
                  <section className="card">
                    <div className="card-head"><div><h2><Database size={18}/> Persistent project memory</h2><p>Verified facts, business rules, corrections and lessons for this specific project.</p></div></div>
                    <form onSubmit={searchMemories} className="search-row"><Search size={17}/><input placeholder="Search remembered knowledge..." value={memorySearch} onChange={e => setMemorySearch(e.target.value)}/><button className="button secondary" type="submit">Search</button></form>
                    <div className="memory-list">
                      {memories.length === 0 && <div className="memory-empty">No memory records found. Add the first project fact or correction.</div>}
                      {memories.map(m => <div className={"memory-item " + (m.status === "superseded" ? "superseded" : "")} key={m.id}><div className="memory-meta"><span className="pill neutral">{m.kind}</span><span>{when(m.created_at)}</span><span className={m.status === "confirmed" ? "memory-confirmed" : "memory-obsolete"}>{m.status}</span></div><p>{m.content}</p><div className="memory-actions"><span>Source: {m.source}</span>{m.status === "confirmed" && canQA && <button className="text-button" onClick={() => correctMemory(m)}>Correct / supersede <ArrowRight size={13}/></button>}</div></div>)}
                    </div>
                    {memoryNextCursor && <button className="button secondary" type="button"
                      onClick={loadMoreMemories} disabled={loadingMemories}>
                      {loadingMemories ? "Loading more…" : "Load 25 more memories"}
                    </button>}
                    {loadingMemories && <p className="muted small" role="status">Loading project memories…</p>}
                  </section>
                  {canQA && <section className="card memory-editor"><div className="card-head"><div><h2><Plus size={18}/> {supersedesId ? "Correct existing memory" : "Add project knowledge"}</h2><p>Human-confirmed knowledge is stored with provenance.</p></div></div>
                    <form onSubmit={saveMemory}>
                      <label>Category<select value={memoryKind} onChange={e => setMemoryKind(e.target.value as MemoryKind)}>{kinds.map(kind => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}</select></label>
                      {supersedesId && <div className="notice"><History size={16}/><span>New record supersedes the selected memory, preserving its history.</span><button type="button" className="icon-btn" onClick={() => { setSupersedesId(""); setMemoryText(""); }} title="Cancel correction"><X size={15}/></button></div>}
                      <label>Knowledge<textarea rows={6} required minLength={3} maxLength={10000} value={memoryText} onChange={e => setMemoryText(e.target.value)} placeholder="Enter an architectural fact, testing requirement, correction, or lesson learned..."/></label>
                      <button className="button primary full-width" disabled={savingMemory} type="submit">{savingMemory ? "Saving..." : "Save project memory"} <ArrowRight size={16}/></button>
                    </form>
                    <p className="fine-print">Do not store secrets, production credentials or personal data here. Changes are attributed to project members.</p>
                  </section>}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
