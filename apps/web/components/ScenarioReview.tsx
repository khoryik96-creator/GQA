import type { ReactNode } from "react";
import { AlertCircle, BookOpenCheck, CheckSquare2, ClipboardList, FlaskConical, HelpCircle, ListChecks, ShieldAlert } from "lucide-react";

export type TestScenario = {
  id: string;
  agent_id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  objective: string;
  preconditions: string[];
  steps: string[];
  expected_results: string[];
  required_inputs: string[];
  related_memory_ids: string[];
  evidence_status: string;
};
export type TestSpecification = {
  version: string;
  generation_mode: "rules" | "model";
  strategy: string;
  scenarios: TestScenario[];
  missing_inputs: string[];
  review_required: boolean;
  context_digest: string;
  notices: string[];
};

function DetailList({ title, icon, items, numbered = false }: {
  title: string; icon: ReactNode; items: string[]; numbered?: boolean;
}) {
  if (!items?.length) return null;
  const ListElement = numbered ? "ol" : "ul";
  return (
    <section className="spec-list">
      <h4>{icon}{title}</h4>
      <ListElement>{items.map((item, index) => <li key={index}>{item}</li>)}</ListElement>
    </section>
  );
}

export default function ScenarioReview({ spec }: { spec?: TestSpecification }) {
  if (!spec?.scenarios?.length) {
    return (
      <section className="card spec-panel">
        <div className="card-head"><div><h2><ClipboardList size={18}/> Structured QA plan</h2><p>No test specification was generated for this plan.</p></div></div>
      </section>
    );
  }

  const priorities = ["P0", "P1", "P2"] as const;
  return (
    <section className="card spec-panel">
      <div className="card-head">
        <div>
          <h2><ClipboardList size={18}/> Principal QA test strategy</h2>
          <p>Reviewable requirements and expected behavior — not executable tests or evidence of passing.</p>
        </div>
        <span className={"pill " + (spec.generation_mode === "model" ? "" : "neutral")}>
          {spec.generation_mode === "model" ? "AI-drafted" : "Rules fallback"}
        </span>
      </div>

      <p className="spec-strategy">{spec.strategy}</p>
      <div className="spec-summary">
        <span><FlaskConical size={15}/>{spec.scenarios.length} proposed scenarios</span>
        {priorities.map(priority => <span key={priority} className={"priority " + priority.toLowerCase()}>
          {priority}: {spec.scenarios.filter(s => s.priority === priority).length}
        </span>)}
      </div>

      <div className="scenario-list">
        {spec.scenarios.map(scenario => (
          <details className="scenario" key={scenario.id}>
            <summary>
              <span className={"priority " + scenario.priority.toLowerCase()}>{scenario.priority}</span>
              <div className="scenario-heading">
                <strong>{scenario.id} · {scenario.title}</strong>
                <small>{scenario.agent_id.replaceAll("-", " ")} · {scenario.evidence_status || "proposed"}</small>
              </div>
              <span className="scenario-expand">Details</span>
            </summary>
            <div className="scenario-body">
              <p>{scenario.objective}</p>
              <div className="scenario-columns">
                <DetailList title="Preconditions" icon={<CheckSquare2 size={15}/>} items={scenario.preconditions}/>
                <DetailList title="Test procedure" icon={<ListChecks size={15}/>} items={scenario.steps} numbered/>
                <DetailList title="Expected results" icon={<BookOpenCheck size={15}/>} items={scenario.expected_results}/>
                <DetailList title="Inputs needed before execution" icon={<HelpCircle size={15}/>} items={scenario.required_inputs}/>
              </div>
              {!!scenario.related_memory_ids?.length && <p className="scenario-source">
                Linked to {scenario.related_memory_ids.length} confirmed memory record(s) from this project.
              </p>}
            </div>
          </details>
        ))}
      </div>

      {!!spec.missing_inputs?.length && (
        <div className="spec-missing"><strong><AlertCircle size={16}/> Missing project information</strong>
          <ul>{spec.missing_inputs.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      )}
      <div className="spec-footer"><ShieldAlert size={16}/>
        <span>Human review is required. These scenarios were not executed, and their expected results may require clarification.</span>
      </div>
    </section>
  );
}
