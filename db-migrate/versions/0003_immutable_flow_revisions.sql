-- 0003: Immutable user-authored browser-flow revisions.
-- Each successor is inserted as a new row; prior steps, digests and run
-- evidence never change. One successor per source enforces a linear history.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE browser_flows
  ADD COLUMN IF NOT EXISTS revised_from_flow_id UUID REFERENCES browser_flows(id);
CREATE UNIQUE INDEX IF NOT EXISTS browser_flow_one_revision_per_source
  ON browser_flows(revised_from_flow_id)
  WHERE revised_from_flow_id IS NOT NULL;
