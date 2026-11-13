"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleCheck, ClipboardCheck,
  FileCode2, Loader2, Play, ShieldAlert, WandSparkles
} from "lucide-react";

type BrowserAction = {
  op: string; path?: string; role?: string; name?: string;
  label?: string; value?: string; text?: string;
};
type BrowserFlow = {
  id: string; project_id: string; plan_id: string; prompt: string;
  objective: string; steps: BrowserAction[]; digest: string;
  generation_mode: "rules" | "model"; warning: string; created_at: string;
  repaired_from_flow_id?: string; repaired_from_run_id?: string; repair_target?: string;
};
type RepairHint = {
  step_index: number; role: string; original_name: string; proposed_name: string;
  confidence: number; basis: string; note: string;
};
type SmokeCheck = { name: string; status: string; detail: string; duration_ms: number; repair?: RepairHint };
type RepairReview = {
  repaired_flow_id: string; repaired_from_flow_id: string; original_failure_run_id: string;
  target_url: string; old_name: string; new_name: string; app_revision: string; revision_provenance?: string;
  memory_id: string; accepted_at: string;
};
type RunEvidence = {
  job_id?: string; worker_lifecycle?: string; failure_kind?: string;
  failed_step_index?: number | null; last_path?: string;
  console_errors?: number; page_exceptions?: number;
  failed_requests?: number; http_5xx?: number;
};
type TestRun = {
  id: string; flow_id?: string; status: string; checks: SmokeCheck[];
  screenshot_available: boolean; started_at: string; execution_kind?: string;
  evidence?: RunEvidence;
};
type Props = {
  projectId: string;
  planId?: string;
  canRun: boolean;
  canDraft: boolean;
  canReview: boolean;
  hasWeb: boolean;
  apiBase: string;
  runs: TestRun[];
  onRunRecorded: (run: TestRun) => void;
};

function describeAction(a: BrowserAction) {
  switch (a.op) {
    case "navigate": return "Navigate to " + a.path;
    case "click_role": return "Click " + a.role + ' “' + a.name + "”";
    case "fill_label": return "Fill “" + a.label + "” with demo data";
    case "assert_text": return 'Verify visible text “' + a.text + "”";
    case "assert_visible_role": return "Verify " + a.role + ' “' + a.name + "” is visible";
    case "assert_url_path": return "Verify URL path is " + a.path;
    default: return "Unknown action";
  }
}

async function requestJSON<T>(api: string, path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(api + path, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store"
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error || "Request failed");
  }
  return resp.json() as Promise<T>;
}

export default function BrowserFlowStudio({ projectId, planId, canRun, canDraft, canReview, hasWeb, apiBase, runs, onRunRecorded }: Props) {
  const [prompt, setPrompt] = useState("Open the homepage, click Show details and verify the detail panel is visible.");
  const [target, setTarget] = useState("http://fixture:8081");
  const [flows, setFlows] = useState<BrowserFlow[]>([]);
  const [reviews, setReviews] = useState<RepairReview[]>([]);
  const [repairing, setRepairing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [revision, setRevision] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const visible = useMemo(() => flows.filter(f => f.plan_id === planId), [flows, planId]);
  const selected = visible.find(f => f.id === selectedId) || visible[0];
  const latestRun = runs.find(r => r.flow_id === selected?.id);
  const suggestion = latestRun?.status === "failed" ?
    latestRun.checks.find(check => check.repair)?.repair : undefined;
  const acceptedReview = reviews.find(r => r.repaired_flow_id === selected?.id);

  useEffect(() => {
    let cancelled = false;
    setFlows([]); setReviews([]); setSelectedId(""); setAcknowledged(false); setError("");
    Promise.all([
      requestJSON<BrowserFlow[]>(apiBase, "/api/projects/" + projectId + "/flows"),
      requestJSON<RepairReview[]>(apiBase, "/api/projects/" + projectId + "/repairs")
    ]).then(([newFlows, newReviews]) => {
      if (!cancelled) { setFlows(newFlows); setReviews(newReviews); }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [projectId, apiBase]);

  useEffect(() => { setAcknowledged(false); }, [planId]);

  async function draftFlow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!planId || !canDraft) return;
    setDrafting(true); setError(""); setAcknowledged(false);
    try {
      const draft = await requestJSON<BrowserFlow>(apiBase, "/api/projects/" + projectId + "/flows", {
        method: "POST", body: JSON.stringify({ plan_id: planId, prompt })
      });
      setFlows(existing => [draft, ...existing]);
      setSelectedId(draft.id);
    } catch (err) { setError((err as Error).message); }
    finally { setDrafting(false); }
  }

  async function executeFlow() {
    if (!selected || !acknowledged || !canRun) return;
    setExecuting(true); setError("");
    try {
      const run = await requestJSON<TestRun>(
        apiBase, "/api/projects/" + projectId + "/flows/" + selected.id + "/execute", {
          method: "POST",
          body: JSON.stringify({ target_url: target, acknowledged_digest: selected.digest })
        }
      );
      onRunRecorded(run);
      setAcknowledged(false);
    } catch (err) { setError((err as Error).message); }
    finally { setExecuting(false); }
  }


  async function proposeRepair() {
    if (!selected || !latestRun || !suggestion || !canDraft) return;
    setRepairing(true); setError(""); setAcknowledged(false);
    try {
      const draft = await requestJSON<BrowserFlow>(
        apiBase, "/api/projects/" + projectId + "/flows/" + selected.id + "/propose-repair", {
          method: "POST", body: JSON.stringify({ failed_run_id: latestRun.id })
        }
      );
      setFlows(existing => [draft, ...existing]);
      setSelectedId(draft.id);
      setTarget(draft.repair_target || target);
      setRevision("");
    } catch (err) { setError((err as Error).message); }
    finally { setRepairing(false); }
  }

  async function acceptRepair() {
    if (!selected?.repaired_from_run_id || !latestRun || latestRun.status !== "passed" ||
        !revision.trim() || acceptedReview || !canReview) return;
    setAccepting(true); setError("");
    try {
      const review = await requestJSON<RepairReview>(
        apiBase, "/api/projects/" + projectId + "/flows/" + selected.id + "/confirm-repair", {
          method: "POST",
          body: JSON.stringify({successful_run_id: latestRun.id, app_revision: revision.trim()})
        }
      );
      setReviews(existing => [review, ...existing]);
    } catch (err) { setError((err as Error).message); }
    finally { setAccepting(false); }
  }

  return (
    <section className="card browser-studio">
      <div className="card-head">
        <div>
          <h2><WandSparkles size={18}/> Browser Flow Studio</h2>
          <p>Turn a natural-language request into a reviewed Playwright action sequence.</p>
        </div>
        <span className="pill neutral">Reviewed browser actions</span>
      </div>
      {!hasWeb && <div className="notice">
        <ShieldAlert size={17}/>
        <span>First create a QA plan that selects the Web QA specialist. Browser flow execution is gated by the original plan.</span>
      </div>}
      <form onSubmit={draftFlow} className="browser-draft-form">
        <label>Describe the browser journey to test
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} minLength={10} maxLength={2000} rows={3}
            placeholder="Open the app, click Show details, and verify that details are displayed."/>
        </label>
        <button className="button secondary" type="submit" disabled={!canDraft || !planId || !hasWeb || drafting}>
          {drafting ? <Loader2 size={16} className="spin"/> : <FileCode2 size={16}/>}
          {drafting ? "Drafting steps..." : "Draft browser flow"}
        </button>
      </form>

      {error && <div className="browser-flow-error"><AlertTriangle size={16}/>{error}</div>}
      {visible.length>0 && <div className="browser-flow-review">
        {visible.length > 1 && <label>Saved flows for current plan
          <select value={selected?.id || ""} onChange={e => {setSelectedId(e.target.value); setAcknowledged(false);}}>
            {visible.map(f => <option key={f.id} value={f.id}>{f.repaired_from_run_id ? "[Repair proposal] " : ""}{f.prompt.slice(0,75)}</option>)}
          </select>
        </label>}
        {selected && <>
          <div className="browser-flow-head">
            <strong>Review: {selected.objective}</strong>
            <span className={"pill " + (selected.generation_mode==="model" ? "" : "neutral")}>
              {selected.repaired_from_run_id ? "Locator repair proposal" : selected.generation_mode==="model" ? "AI drafted" : "Fixture demo"}
            </span>
          </div>
          <p className="browser-flow-warning"><ShieldAlert size={15}/>{selected.warning}</p>
          {selected.repaired_from_run_id && <p className="fine-print">
            Repair lineage: derived from failed run {selected.repaired_from_run_id.slice(0,8)}.
            The original assertions are unchanged and the replay is restricted to the same test target.
          </p>}
          <ol className="typed-actions">
            {selected.steps.map((step,i) => <li key={i}>
              <span>{String(i+1).padStart(2,"0")}</span>
              <div><strong>{step.op.replaceAll("_"," ")}</strong><p>{describeAction(step)}</p></div>
              {step.op.startsWith("assert_") && <CircleCheck size={16}/>}
            </li>)}
          </ol>
          <div className="browser-execution-control">
            <label>Approved test origin
              <input value={target} onChange={e => {setTarget(e.target.value);setAcknowledged(false);}}
                readOnly={!!selected.repaired_from_run_id}
                placeholder="http://fixture:8081"/>
            </label>
            <label className="browser-acknowledge">
              <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>
              <span>I reviewed every action and assertion, and this target is authorized for testing.</span>
            </label>
            <button type="button" className="button primary" disabled={!canRun || !acknowledged || executing} onClick={executeFlow}>
              {executing ? <Loader2 size={16} className="spin"/> : <Play size={16}/>}
              {executing ? "Running Playwright..." : "Execute reviewed flow"}
            </button>
            {!canRun && <p className="fine-print">Execution blocked: this plan is missing Web QA or requires restricted-environment approval.</p>}
          </div>
        </>}
        {latestRun && <div className="browser-flow-result">
          <div className="run-heading"><strong><ClipboardCheck size={16}/> Browser flow results</strong>
            <span className={"pill " + (latestRun.status==="passed" ? "" : "warning")}>{latestRun.status}</span>
          </div>
          {latestRun.evidence && <div className="browser-evidence">
            <strong>Execution diagnostics</strong>
            <div className="browser-evidence-grid">
              <span>Failure category <b>{(latestRun.evidence.failure_kind || "unknown").replaceAll("_"," ")}</b></span>
              <span>Worker lifetime <b>{latestRun.evidence.worker_lifecycle === "ephemeral_container"
                ? "Disposable Docker container"
                : latestRun.evidence.worker_lifecycle === "single_job_process"
                ? "One short-lived process" : "Legacy / unverified"}</b></span>
              <span>Browser console errors <b>{latestRun.evidence.console_errors ?? 0}</b></span>
              <span>Uncaught page exceptions <b>{latestRun.evidence.page_exceptions ?? 0}</b></span>
              <span>Failed network requests <b>{latestRun.evidence.failed_requests ?? 0}</b></span>
              <span>HTTP 5xx responses <b>{latestRun.evidence.http_5xx ?? 0}</b></span>
              {latestRun.evidence.last_path && <span>Last page path <b>{latestRun.evidence.last_path}</b></span>}
              {latestRun.evidence.failed_step_index != null &&
                <span>Failed action <b>Step {latestRun.evidence.failed_step_index+1}</b></span>}
            </div>
            <p>Only aggregate error counts are stored. Raw console output, tokens and response bodies are excluded.</p>
          </div>}
          {latestRun.checks.map((check,index) => <div className="check-row" key={index}>
            {check.status==="passed" ? <CheckCircle2 size={16} className="check-pass"/> : <AlertTriangle size={16} className="check-fail"/>}
            <div><strong>{check.name}</strong><p>{check.detail} · {check.duration_ms}ms</p></div>
          </div>)}
          {latestRun.screenshot_available && <a className="text-button" target="_blank" rel="noreferrer"
            href={apiBase + "/api/runs/" + latestRun.id + "/screenshot"}>
            Inspect screenshot <ArrowRight size={15}/>
          </a>}
          {suggestion && canDraft && <div className="browser-repair-hint">
            <strong><WandSparkles size={16}/> Possible locator change</strong>
            <p>Step {suggestion.step_index+1}: the {suggestion.role} named
              <b> “{suggestion.original_name}” </b>was not found. A visible candidate is
              <b> “{suggestion.proposed_name}”</b> (similarity {Math.round(suggestion.confidence*100)}%).
            </p>
            <p>This is not proof of a regression fix. GQA will keep the original failure and all assertions.</p>
            <button className="button secondary" disabled={repairing} onClick={proposeRepair}>
              {repairing ? <Loader2 size={15} className="spin"/> : <FileCode2 size={15}/>}
              {repairing ? "Creating proposal..." : "Create reviewable repair proposal"}
            </button>
          </div>}
          {selected.repaired_from_run_id && latestRun.status === "passed" && canReview && <div className="browser-repair-confirm">
            {acceptedReview ? <>
              <strong><CheckCircle2 size={17}/> Verified locator lesson saved</strong>
              <p>Revision {acceptedReview.app_revision} (user-declared) · Project memory record {acceptedReview.memory_id.slice(0,8)}</p>
              <p>This lesson is version-scoped and will not silently rewrite other flows.</p>
            </> : <>
              <strong>Record this verified correction</strong>
              <p>The repaired flow passed against the original failing target. Save it as a project lesson only if this is the expected application behavior.</p>
              <label>Application version or commit ID (user-declared, not independently verified)
                <input value={revision} onChange={e=>setRevision(e.target.value)}
                  minLength={3} maxLength={80} placeholder="e.g. staging-commit-a1b2c3"/>
              </label>
              <button className="button secondary" disabled={accepting || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(revision)}
                onClick={acceptRepair}>
                {accepting ? <Loader2 size={15} className="spin"/> : <CheckCircle2 size={15}/>}
                {accepting ? "Recording lesson..." : "Confirm and save verified repair"}
              </button>
            </>}
          </div>}
        </div>}
      </div>}
    </section>
  );
}
