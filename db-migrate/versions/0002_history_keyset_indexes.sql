-- 0002: Exact project-scoped keyset ordering for plans, test runs,
-- browser flows and memories. Preserve earlier indexes for other query paths.
-- This transactional migration builds ordinary indexes (not CONCURRENTLY);
-- schedule a maintenance window for large existing databases because index
-- creation can block concurrent writes until the transaction commits.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE INDEX IF NOT EXISTS plans_project_created_id
  ON plans (project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS test_runs_project_started_id
  ON test_runs (project_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS browser_flows_project_created_id
  ON browser_flows (project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS memories_project_created_id
  ON memories (project_id, created_at DESC, id DESC);
