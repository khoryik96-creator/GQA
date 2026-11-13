-- 0005: AI code review runs and their evidence-checked findings.
-- Stores model output only; source file contents are never persisted.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.code_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.gqa_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 200),
  focus TEXT NOT NULL DEFAULT '' CHECK (length(focus) <= 1000),
  repository TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL DEFAULT '' CHECK (commit_sha = '' OR commit_sha ~ '^[0-9a-f]{40}$'),
  files_reviewed JSONB NOT NULL DEFAULT '[]'::jsonb,
  files_skipped INTEGER NOT NULL DEFAULT 0 CHECK (files_skipped >= 0),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL DEFAULT '',
  severity_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  discarded_count INTEGER NOT NULL DEFAULT 0 CHECK (discarded_count >= 0),
  notices JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK ((status = 'running') = (completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS code_reviews_project_date
  ON public.code_reviews(project_id, created_at DESC, id DESC);
-- At most one running review per project, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS code_reviews_one_running
  ON public.code_reviews(project_id) WHERE status = 'running';
