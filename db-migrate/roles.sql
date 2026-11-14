-- Migrations are executed as the bootstrap gqa role, never from the API.
SELECT format('CREATE ROLE gqa_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gqa_app')
\gexec
ALTER ROLE gqa_app PASSWORD :'app_password';
ALTER ROLE gqa_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE gqa TO gqa_app;
GRANT USAGE ON SCHEMA public TO gqa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO gqa_app;
GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO gqa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gqa IN SCHEMA public
 GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO gqa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gqa IN SCHEMA public
 GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO gqa_app;

-- Only database-owned source-table triggers may append QA events. The runtime
-- principal can read, but cannot forge, modify, or delete audit rows.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qa_activity_audit FROM gqa_app;

-- AI settings changes are audited append-only; the runtime may only add rows.
REVOKE UPDATE, DELETE ON TABLE public.ai_settings_audit FROM gqa_app;
