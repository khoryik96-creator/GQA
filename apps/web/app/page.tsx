"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2,
  Clock3, Database, FileCode2, FolderKanban, GitBranch, Globe2,
  History, Layers3, Loader2, Plus, Search, Send, ShieldCheck,
  Smartphone, Sparkles, Target, Workflow, X, type LucideIcon
} from "lucide-react";

type AppType = "fullstack" | "web" | "api" | "backend" | "mobile";
type Environment = "local" | "staging" | "production";
type MemoryKind = "architecture" | "requirement" | "correction" | "lesson" | "preference";

type Project = {
  id: string; name: string; repo_url: string; app_type: AppType;
  stack: string; created_at: string;
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
  status: string; created_at: string;
};
type SmokeCheck = { name: string; status: string; duration_ms: number; detail: string };
type TestRun = { id: string; project_id: string; plan_id: string; target_url: string; status: string; checks: SmokeCheck[]; screenshot_available: boolean; started_at: string; finished_at: string | null };
type Memory = {
  id: string; project_id: string; kind: MemoryKind; content: string;
  source: string; status: string; supersedes_id: string; created_at: string;
};

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [inspection, setInspection] = useState<RepoSnapshot | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [runningSmoke, setRunningSmoke] = useState(false);
  const [smokeTarget, setSmokeTarget] = useState("http://fixture:8081");
  const [view, setView] = useState<"command" | "memory">("command");
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
  const [loadingProjects, setLoadingProjects] = useState(true);

  const selected = useMemo(() => projects.find(p => p.id === selectedId), [projects, selectedId]);
  const latest = plans[0];
  const latestRun = runs[0];

  useEffect(() => {
    call<Project[]>("/api/projects")
      .then(list => {
        setProjects(list);
        if (list.length) setSelectedId(list[0].id);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setPlans([]);
    setMemories([]);
    setRuns([]);
    setInspection(null);
    Promise.all([
      call<Plan[]>("/api/projects/" + selectedId + "/plans"),
      call<Memory[]>("/api/projects/" + selectedId + "/memories"),
      call<TestRun[]>("/api/projects/" + selectedId + "/runs")
    ]).then(([newPlans, newMemories, newRuns]) => {
      if (!cancelled) {
        setPlans(newPlans); setMemories(newMemories); setRuns(newRuns);
        if (newPlans[0]?.repository_evidence?.repository) setInspection(newPlans[0].repository_evidence);
      }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const created = await call<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: projectName, repo_url: repoURL, app_type: appType, stack })
      });
      setProjects(list => [created, ...list]);
      setSelectedId(created.id);
      setShowCreate(false);
      setProjectName(""); setRepoURL(""); setStack("");
      setView("command");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true); setError("");
    try {
      const plan = await call<Plan>("/api/projects/" + selectedId + "/plans", {
        method: "POST", body: JSON.stringify({ prompt, environment })
      });
      setPlans(list => [plan, ...list]);
      if (plan.repository_evidence?.repository) setInspection(plan.repository_evidence);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }


  async function inspectRepository() {
    if (!selectedId) return;
    setInspecting(true); setError("");
    try {
      const snapshot = await call<RepoSnapshot>("/api/projects/" + selectedId + "/inspection", { method: "POST" });
      setInspection(snapshot);
    } catch (err) { setError((err as Error).message); }
    finally { setInspecting(false); }
  }

  async function executeSmoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !latest) return;
    setRunningSmoke(true); setError("");
    try {
      const result = await call<TestRun>("/api/projects/" + selectedId + "/runs", {
        method: "POST", body: JSON.stringify({ plan_id: latest.id, target_url: smokeTarget })
      });
      setRuns(list => [result, ...list]);
    } catch (err) { setError((err as Error).message); }
    finally { setRunningSmoke(false); }
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setSavingMemory(true); setError("");
    try {
      const memory = await call<Memory>("/api/projects/" + selectedId + "/memories", {
        method: "POST",
        body: JSON.stringify({ kind: memoryKind, content: memoryText, supersedes_id: supersedesId })
      });
      setMemories(list => [
        memory,
        ...list.map(m => m.id === supersedesId ? { ...m, status: "superseded" } : m)
      ]);
      setMemoryText(""); setSupersedesId("");
    } catch (err) { setError((err as Error).message); }
    finally { setSavingMemory(false); }
  }

  async function searchMemories(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setError("");
    try {
      const result = await call<Memory[]>("/api/projects/" + selectedId + "/memories?q=" + encodeURIComponent(memorySearch));
      setMemories(result);
    } catch (err) { setError((err as Error).message); }
  }

  function correctMemory(memory: Memory) {
    setSupersedesId(memory.id);
    setMemoryKind("correction");
    setMemoryText(memory.content);
    setView("memory");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><BrainCircuit size={22}/></span>
          <div><strong>GQA</strong><small>Principal QA Platform</small></div>
        </div>
        <div className="sidebar-section">
          <div className="section-title"><span>PROJECTS</span><button className="icon-btn" title="Create project" onClick={() => setShowCreate(true)}><Plus size={16}/></button></div>
          {projects.map(p => (
            <button key={p.id} className={"project-item " + (selectedId === p.id ? "active" : "")} onClick={() => { setSelectedId(p.id); setView("command"); setError(""); }}>
              <Layers3 size={16}/><span>{p.name}</span>
              {selectedId === p.id && <span className="selected-indicator"/>}
            </button>
          ))}
          {projects.length === 0 && !loadingProjects && <p className="sidebar-empty">No projects yet</p>}
          {loadingProjects && <span className="muted small">Loading projects…</span>}
        </div>
        <div className="sidebar-footer">
          <div className="status-dot"/><span>Foundation v0.1</span>
          <small>Local prototype · Planning only</small>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb"><FolderKanban size={17}/><span>Workspace</span><span className="slash">/</span><strong>{selected?.name || "Overview"}</strong></div>
          <span className="preview-label"><span className="status-dot"/> LOCAL DEVELOPMENT</span>
        </header>

        <div className="content">
          {error && <div className="error-banner"><AlertTriangle size={17}/><span>{error}</span><button onClick={() => setError("")} title="Dismiss"><X size={16}/></button></div>}

          {showCreate && (
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
              <button className="button primary" onClick={() => setShowCreate(true)}><Plus size={17}/> Create your first project</button>
            </section>
          ) : (
            <>
              <div className="page-intro">
                <div><div className="eyebrow"><Sparkles size={14}/> PROJECT INTELLIGENCE</div><h1>{selected.name}</h1><p>Plan intelligent testing with persistent project memory and specialist agent selection.</p></div>
                <div className="project-chip"><GitBranch size={16}/><span>{labels[selected.app_type]}</span></div>
              </div>
              <div className="repo-strip"><GitBranch size={16}/><a href={selected.repo_url} target="_blank" rel="noreferrer">{selected.repo_url}</a><span className="subtle-divider"/> <span>{selected.stack || "Stack not recorded"}</span></div>

              <div className="tabs">
                <button className={view === "command" ? "current" : ""} onClick={() => setView("command")}><BrainCircuit size={17}/> QA Command</button>
                <button className={view === "memory" ? "current" : ""} onClick={() => setView("memory")}><Database size={17}/> Project Memory <span className="mini-count">{memories.length}</span></button>
              </div>

              {view === "command" ? (
                <div className="workspace-grid">
                  <div className="workspace-main">
                    <section className="card prompt-card">
                      <div className="card-head"><div><h2><Sparkles size={18}/> Ask your Principal QA Engineer</h2><p>Describe what you want tested. GQA will propose the right specialist team.</p></div><span className="pill">Plan mode</span></div>
                      <form onSubmit={createPlan}>
                        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} minLength={10} maxLength={10000} rows={6} placeholder="Describe the workflows, risks, tests or issues to investigate..." required/>
                        <div className="prompt-actions"><label>Target <select value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="local">Local</option><option value="staging">Staging</option><option value="production">Production (approval required)</option></select></label><button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin"/> : <Send size={16}/>} Generate QA plan</button></div>
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
                    <section className="card">
                      <div className="card-head"><div><h2><Activity size={18}/> Read-only smoke execution</h2><p>Real API and Playwright checks in a separate local Docker runner.</p></div><span className="pill neutral">v0.2</span></div>
                      <form className="smoke-form" onSubmit={executeSmoke}>
                        <label>Approved test target<input value={smokeTarget} onChange={e => setSmokeTarget(e.target.value)} placeholder="http://fixture:8081"/></label>
                        <p className="fine-print">The built-in fixture works immediately. Other origins must be explicitly allowlisted in both Docker services. No write, load, or active security tests are permitted.</p>
                        <button className="button primary" type="submit" disabled={!latest || latest.approval_required || runningSmoke || !latest.selected_agents.some(a => a.id === "api" || a.id === "web")}>
                          {runningSmoke ? <Loader2 size={16} className="spin"/> : <Activity size={16}/>}
                          {runningSmoke ? "Executing smoke checks..." : "Execute safe smoke checks"}
                        </button>
                      </form>
                      {latestRun && <div className="run-result">
                        <div className="run-heading"><strong>Latest run · {when(latestRun.started_at)}</strong><span className={"pill " + (latestRun.status === "passed" ? "" : "warning")}>{latestRun.status}</span></div>
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
                      <button className="button secondary full-width" onClick={inspectRepository} disabled={inspecting}>
                        {inspecting ? <Loader2 size={15} className="spin"/> : <Search size={15}/>}
                        {inspecting ? "Inspecting..." : "Inspect public GitHub repository"}
                      </button>
                      <p className="fine-print">Public GitHub metadata only; private repository authentication will be added later.</p>
                    </section>
                    <section className="card side-card"><div className="card-head"><div><h2><Activity size={17}/> Project overview</h2></div></div><div className="stat-list"><div><span>QA plans</span><strong>{plans.length}</strong></div><div><span>Memories in view</span><strong>{memories.length}</strong></div><div><span>Smoke runs</span><strong>{runs.length}</strong></div></div></section>
                    <section className="card side-card"><div className="card-head"><div><h2><History size={17}/> Previous requests</h2></div></div>{plans.length === 0 ? <p className="muted small">Requests will appear here after you create a QA plan.</p> : <div className="history-list">{plans.slice(0,7).map(p => <div className="history-item" key={p.id}><span className="history-marker"/><div><p>{p.prompt}</p><small><Clock3 size={12}/>{when(p.created_at)} · {p.environment}</small></div></div>)}</div>}</section>
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
                      {memories.map(m => <div className={"memory-item " + (m.status === "superseded" ? "superseded" : "")} key={m.id}><div className="memory-meta"><span className="pill neutral">{m.kind}</span><span>{when(m.created_at)}</span><span className={m.status === "confirmed" ? "memory-confirmed" : "memory-obsolete"}>{m.status}</span></div><p>{m.content}</p><div className="memory-actions"><span>Source: {m.source}</span>{m.status === "confirmed" && <button className="text-button" onClick={() => correctMemory(m)}>Correct / supersede <ArrowRight size={13}/></button>}</div></div>)}
                    </div>
                  </section>
                  <section className="card memory-editor"><div className="card-head"><div><h2><Plus size={18}/> {supersedesId ? "Correct existing memory" : "Add project knowledge"}</h2><p>Human-confirmed knowledge is stored with provenance.</p></div></div>
                    <form onSubmit={saveMemory}>
                      <label>Category<select value={memoryKind} onChange={e => setMemoryKind(e.target.value as MemoryKind)}>{kinds.map(kind => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}</select></label>
                      {supersedesId && <div className="notice"><History size={16}/><span>New record supersedes the selected memory, preserving its history.</span><button type="button" className="icon-btn" onClick={() => { setSupersedesId(""); setMemoryText(""); }} title="Cancel correction"><X size={15}/></button></div>}
                      <label>Knowledge<textarea rows={6} required minLength={3} maxLength={10000} value={memoryText} onChange={e => setMemoryText(e.target.value)} placeholder="Enter an architectural fact, testing requirement, correction, or lesson learned..."/></label>
                      <button className="button primary full-width" disabled={savingMemory} type="submit">{savingMemory ? "Saving..." : "Save project memory"} <ArrowRight size={16}/></button>
                    </form>
                    <p className="fine-print">Do not store secrets, production credentials or personal data here. This local MVP has no user authentication.</p>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
