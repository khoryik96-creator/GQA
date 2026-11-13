-- 0004: Database-generated append-only audit of QA activity.
-- No user-supplied prompts, input values, screenshots, tokens or descriptions
-- are copied into this table. Existing historical rows are not backfilled:
-- previous actor identity cannot be safely inferred.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.qa_activity_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  actor_id UUID,
  object_id UUID NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('browser_flow','test_run','repair_acceptance','memory')),
  action TEXT NOT NULL CHECK (action IN ('flow_drafted','flow_revised','repair_proposed',
    'run_started','run_status_changed','repair_approved','memory_recorded')),
  result_status TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_activity_project_date
  ON public.qa_activity_audit(project_id,created_at DESC,id DESC);

-- The trigger function is owned by the migration principal. Never trust a
-- client-supplied event payload or execution identity.
CREATE OR REPLACE FUNCTION public.gqa_record_qa_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  kind TEXT;
  event TEXT;
  actor UUID;
  status_value TEXT := '';
BEGIN
  IF TG_TABLE_NAME = 'browser_flows' THEN
    kind := 'browser_flow';
    actor := NEW.created_by;
    IF NEW.repaired_from_run_id IS NOT NULL THEN
      event := 'repair_proposed';
    ELSIF NEW.revised_from_flow_id IS NOT NULL THEN
      event := 'flow_revised';
    ELSE
      event := 'flow_drafted';
    END IF;
  ELSIF TG_TABLE_NAME = 'test_runs' THEN
    kind := 'test_run';
    actor := NEW.initiated_by;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
      event := 'run_status_changed';
    ELSE
      event := 'run_started';
    END IF;
    status_value := NEW.status;
  ELSIF TG_TABLE_NAME = 'repair_acceptances' THEN
    kind := 'repair_acceptance';
    actor := NEW.approved_by;
    event := 'repair_approved';
  ELSIF TG_TABLE_NAME = 'memories' THEN
    kind := 'memory';
    actor := NEW.created_by;
    event := 'memory_recorded';
  ELSE
    RAISE EXCEPTION 'Unsupported QA audit source';
  END IF;

  INSERT INTO public.qa_activity_audit
    (project_id,actor_id,object_id,object_type,action,result_status)
  VALUES(NEW.project_id,actor,NEW.id,kind,event,status_value);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.gqa_reject_qa_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'QA activity audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS gqa_audit_flow_insert ON public.browser_flows;
CREATE TRIGGER gqa_audit_flow_insert AFTER INSERT ON public.browser_flows
  FOR EACH ROW EXECUTE FUNCTION public.gqa_record_qa_activity();
DROP TRIGGER IF EXISTS gqa_audit_run_insert ON public.test_runs;
CREATE TRIGGER gqa_audit_run_insert AFTER INSERT ON public.test_runs
  FOR EACH ROW EXECUTE FUNCTION public.gqa_record_qa_activity();
DROP TRIGGER IF EXISTS gqa_audit_run_status ON public.test_runs;
CREATE TRIGGER gqa_audit_run_status AFTER UPDATE OF status ON public.test_runs
  FOR EACH ROW EXECUTE FUNCTION public.gqa_record_qa_activity();
DROP TRIGGER IF EXISTS gqa_audit_repair_insert ON public.repair_acceptances;
CREATE TRIGGER gqa_audit_repair_insert AFTER INSERT ON public.repair_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.gqa_record_qa_activity();
DROP TRIGGER IF EXISTS gqa_audit_memory_insert ON public.memories;
CREATE TRIGGER gqa_audit_memory_insert AFTER INSERT ON public.memories
  FOR EACH ROW EXECUTE FUNCTION public.gqa_record_qa_activity();
DROP TRIGGER IF EXISTS gqa_audit_append_only ON public.qa_activity_audit;
CREATE TRIGGER gqa_audit_append_only BEFORE UPDATE OR DELETE ON public.qa_activity_audit
  FOR EACH ROW EXECUTE FUNCTION public.gqa_reject_qa_audit_mutation();
