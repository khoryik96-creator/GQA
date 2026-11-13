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

-- Local-only administrator sessions. Only SHA-256 digests of random tokens
-- are stored, and every authenticated API request checks expiration/revocation.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_digest BYTEA PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_sessions_active_expiry ON auth_sessions(expires_at)
WHERE revoked_at IS NULL;

-- v0.7: bounded, redacted per-run diagnostic summary.
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

-- v0.8: account principals and scoped membership; existing single-admin
-- sessions have no user_id and are invalidated by the new login query.
CREATE TABLE IF NOT EXISTS gqa_users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 global_role TEXT NOT NULL DEFAULT 'member'
   CHECK (global_role IN ('admin','member')),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES gqa_users(id);
CREATE INDEX IF NOT EXISTS auth_sessions_user_active
  ON auth_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS project_memberships (
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES gqa_users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('owner','qa','reviewer','viewer')),
 granted_by UUID NOT NULL REFERENCES gqa_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id,user_id)
);
CREATE INDEX IF NOT EXISTS project_memberships_user ON project_memberships(user_id);
CREATE TABLE IF NOT EXISTS project_access_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL REFERENCES gqa_users(id),
 subject_id UUID NOT NULL REFERENCES gqa_users(id),
 action TEXT NOT NULL CHECK (action IN ('upsert','revoke')),
 old_role TEXT NOT NULL DEFAULT '',
 new_role TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_access_audit_project ON project_access_audit(project_id,created_at DESC);

-- v0.9 security events are attributed to actor and target and contain no
-- plaintext passwords, tokens or arbitrary user-supplied descriptions.
CREATE TABLE IF NOT EXISTS account_security_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id UUID NOT NULL REFERENCES gqa_users(id),
 subject_id UUID NOT NULL REFERENCES gqa_users(id),
 action TEXT NOT NULL CHECK (action IN
  ('password_change','admin_password_reset','account_suspended','account_reactivated')),
 reason TEXT NOT NULL CHECK (reason IN
  ('self_service','account_recovery','security_review','team_change','access_cleanup')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_security_audit_recent
 ON account_security_audit(created_at DESC);

-- Audit actor fields preserve old records without fabricating identities.
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES gqa_users(id);
ALTER TABLE browser_flows ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES gqa_users(id);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES gqa_users(id);
ALTER TABLE repair_acceptances ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES gqa_users(id);
CREATE INDEX IF NOT EXISTS test_runs_quality_recent ON test_runs(project_id,started_at DESC,id DESC)
 WHERE status IN ('passed','failed');
