-- Ephemeral PostgreSQL benchmark fixture. NEVER run against a user database.
-- The large single-batch inserts intentionally create identical timestamps
-- so the UUID tie-break ordering is exercised under stress.
\set ON_ERROR_STOP on
\timing on

INSERT INTO projects(name,repo_url,app_type,stack)
 VALUES ('GQA benchmark fixture','https://github.com/khoryik96-creator/GQA','web','synthetic')
 RETURNING id AS bench_project \gset
INSERT INTO qa_requests(project_id,prompt,environment)
 VALUES (:'bench_project'::uuid,'Synthetic pagination benchmark','local')
 RETURNING id AS bench_request \gset

INSERT INTO memories(project_id,kind,content)
 SELECT :'bench_project'::uuid,'requirement','synthetic page memory '||i
 FROM generate_series(1,25000) i;
INSERT INTO plans(project_id,request_id,selected_agents,warnings)
 SELECT :'bench_project'::uuid,:'bench_request'::uuid,'[]'::jsonb,'[]'::jsonb
 FROM generate_series(1,25000);
SELECT id AS bench_plan FROM plans WHERE project_id=:'bench_project'::uuid
 ORDER BY created_at DESC,id DESC LIMIT 1 \gset
INSERT INTO test_runs(project_id,plan_id,target_url,status)
 SELECT :'bench_project'::uuid,:'bench_plan'::uuid,'http://fixture:8081','passed'
 FROM generate_series(1,25000);
INSERT INTO browser_flows(project_id,plan_id,prompt,objective,steps,digest,generation_mode)
 SELECT :'bench_project'::uuid,:'bench_plan'::uuid,
  'Synthetic browser flow '||i,'Benchmark synthetic flow','[]'::jsonb,
  repeat('a',64),'rules'
 FROM generate_series(1,25000) i;

ANALYZE;
DO $$
DECLARE n bigint;
BEGIN
 SELECT count(*) INTO n FROM plans;
 IF n<25000 THEN RAISE EXCEPTION 'not enough plan rows %',n; END IF;
 SELECT count(*) INTO n FROM test_runs;
 IF n<25000 THEN RAISE EXCEPTION 'not enough run rows %',n; END IF;
 SELECT count(*) INTO n FROM browser_flows;
 IF n<25000 THEN RAISE EXCEPTION 'not enough flow rows %',n; END IF;
 SELECT count(*) INTO n FROM memories;
 IF n<25000 THEN RAISE EXCEPTION 'not enough memory rows %',n; END IF;
END $$;

\echo 'Dataset: 25,000 rows each in plans, test_runs, browser_flows, memories'
\echo '== plans first page, representative API selection =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT p.id::text,p.project_id::text,p.request_id::text,q.prompt,q.environment,
 p.selected_agents,p.warnings,p.approval_required,p.status,p.created_at,
 p.consulted_memories,p.repo_context,p.test_spec
FROM plans p JOIN qa_requests q ON q.id=p.request_id
WHERE p.project_id=:'bench_project'::uuid
ORDER BY p.created_at DESC,p.id DESC LIMIT 25;
SELECT created_at AS cursor_created,id AS cursor_id FROM plans
 WHERE project_id=:'bench_project'::uuid
 ORDER BY created_at DESC,id DESC OFFSET 20000 LIMIT 1 \gset
\echo '== plans deep page (20,001st record) =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT p.id::text,p.project_id::text,p.request_id::text,q.prompt,q.environment,
 p.selected_agents,p.warnings,p.approval_required,p.status,p.created_at,
 p.consulted_memories,p.repo_context,p.test_spec
FROM plans p JOIN qa_requests q ON q.id=p.request_id
WHERE p.project_id=:'bench_project'::uuid
 AND (p.created_at,p.id)<(:'cursor_created'::timestamptz,:'cursor_id'::uuid)
ORDER BY p.created_at DESC,p.id DESC LIMIT 25;

\echo '== runs first page =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id::text,project_id::text,plan_id::text,target_url,status,checks,
 started_at,finished_at,screenshot_available,COALESCE(flow_id::text,''),
 execution_kind,evidence
FROM test_runs WHERE project_id=:'bench_project'::uuid
ORDER BY started_at DESC,id DESC LIMIT 25;
SELECT started_at AS cursor_started,id AS cursor_run_id FROM test_runs
 WHERE project_id=:'bench_project'::uuid
 ORDER BY started_at DESC,id DESC OFFSET 20000 LIMIT 1 \gset
\echo '== runs deep page (20,001st record) =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id::text,project_id::text,plan_id::text,target_url,status,checks,
 started_at,finished_at,screenshot_available,COALESCE(flow_id::text,''),
 execution_kind,evidence
FROM test_runs WHERE project_id=:'bench_project'::uuid
 AND (started_at,id)<(:'cursor_started'::timestamptz,:'cursor_run_id'::uuid)
ORDER BY started_at DESC,id DESC LIMIT 25;

\echo '== browser flows first page =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id::text,project_id::text,plan_id::text,prompt,objective,steps,
 digest,generation_mode,warning,COALESCE(repaired_from_flow_id::text,''),
 COALESCE(repaired_from_run_id::text,''),repair_target,created_at
FROM browser_flows WHERE project_id=:'bench_project'::uuid
ORDER BY created_at DESC,id DESC LIMIT 25;
SELECT created_at AS cursor_flow_created,id AS cursor_flow_id FROM browser_flows
 WHERE project_id=:'bench_project'::uuid
 ORDER BY created_at DESC,id DESC OFFSET 20000 LIMIT 1 \gset
\echo '== browser flows deep page (20,001st record) =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id::text,project_id::text,plan_id::text,prompt,objective,steps,
 digest,generation_mode,warning,COALESCE(repaired_from_flow_id::text,''),
 COALESCE(repaired_from_run_id::text,''),repair_target,created_at
FROM browser_flows WHERE project_id=:'bench_project'::uuid
 AND (created_at,id)<(:'cursor_flow_created'::timestamptz,:'cursor_flow_id'::uuid)
ORDER BY created_at DESC,id DESC LIMIT 25;

\echo '== memories first page (no search) =='
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id::text,project_id::text,kind,content,source,status,
 COALESCE(supersedes_id::text,''),created_at
FROM memories WHERE project_id=:'bench_project'::uuid
ORDER BY created_at DESC,id DESC LIMIT 25;
