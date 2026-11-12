CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    app_type TEXT NOT NULL CHECK (app_type IN ('fullstack','web','mobile','api','backend')),
    stack TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('architecture','requirement','correction','lesson','preference')),
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','proposed','superseded')),
    supersedes_id UUID REFERENCES memories(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_document TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS memories_project_created ON memories (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memories_search ON memories USING GIN(search_document);

CREATE TABLE IF NOT EXISTS qa_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('local','staging','production')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES qa_requests(id) ON DELETE CASCADE,
    selected_agents JSONB NOT NULL,
    warnings JSONB NOT NULL,
    approval_required BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_project_created ON plans (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS repo_inspections (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS consulted_memories JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS repo_context JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  screenshot_available BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS test_runs_project_started ON test_runs(project_id,started_at DESC);

-- Structured plan proposals are never marked as executed tests.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS test_spec JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS browser_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  objective TEXT NOT NULL,
  steps JSONB NOT NULL,
  digest CHAR(64) NOT NULL,
  generation_mode TEXT NOT NULL CHECK (generation_mode IN ('rules','model')),
  warning TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS browser_flows_project_created ON browser_flows(project_id,created_at DESC);
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS flow_id UUID REFERENCES browser_flows(id);
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS execution_kind TEXT NOT NULL DEFAULT 'smoke';

-- Immutable evidence-based browser repair lineage and reviewed lessons.
ALTER TABLE browser_flows ADD COLUMN IF NOT EXISTS repaired_from_flow_id UUID REFERENCES browser_flows(id);
ALTER TABLE browser_flows ADD COLUMN IF NOT EXISTS repaired_from_run_id UUID REFERENCES test_runs(id);
ALTER TABLE browser_flows ADD COLUMN IF NOT EXISTS repair_target TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS browser_flow_one_repair_per_failure
ON browser_flows(repaired_from_run_id) WHERE repaired_from_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS repair_acceptances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 original_flow_id UUID NOT NULL REFERENCES browser_flows(id),
 repaired_flow_id UUID NOT NULL UNIQUE REFERENCES browser_flows(id),
 original_failure_run_id UUID NOT NULL REFERENCES test_runs(id),
 verified_run_id UUID NOT NULL UNIQUE REFERENCES test_runs(id),
 app_revision TEXT NOT NULL,
 target_url TEXT NOT NULL,
 step_index INTEGER NOT NULL,
 old_name TEXT NOT NULL,
 new_name TEXT NOT NULL,
 memory_id UUID NOT NULL REFERENCES memories(id),
 accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS repair_acceptances_project_date
ON repair_acceptances(project_id,accepted_at DESC);

CREATE TABLE IF NOT EXISTS browser_locator_cache (
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 original_flow_digest CHAR(64) NOT NULL,
 target_origin TEXT NOT NULL,
 app_revision TEXT NOT NULL,
 step_index INTEGER NOT NULL,
 proposed_name TEXT NOT NULL,
 verified_flow_id UUID NOT NULL REFERENCES browser_flows(id),
 expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(project_id,original_flow_digest,target_origin,app_revision,step_index)
);
CREATE INDEX IF NOT EXISTS browser_locator_cache_expiration
ON browser_locator_cache(expires_at);
