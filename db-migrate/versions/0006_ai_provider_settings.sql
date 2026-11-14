-- 0006: AI provider settings entered in the dashboard, with encrypted API keys.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.ai_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider TEXT NOT NULL CHECK (provider IN ('deepseek','openai','gemini','anthropic','custom')),
  send_project_context BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES public.gqa_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- API keys are AES-256-GCM ciphertext; the encryption key is never stored
-- in the database. key_hint holds at most the last four characters.
CREATE TABLE IF NOT EXISTS public.ai_provider_credentials (
  provider TEXT PRIMARY KEY CHECK (provider IN ('deepseek','openai','gemini','anthropic','custom')),
  api_key_ciphertext BYTEA CHECK (api_key_ciphertext IS NULL OR length(api_key_ciphertext) BETWEEN 29 AND 1024),
  key_hint TEXT NOT NULL DEFAULT '' CHECK (length(key_hint) <= 4),
  model TEXT NOT NULL DEFAULT '' CHECK (length(model) <= 200),
  endpoint TEXT NOT NULL DEFAULT '' CHECK (endpoint = '' OR endpoint LIKE 'https://%'),
  updated_by UUID REFERENCES public.gqa_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only record of who changed AI settings. Never contains key material.
CREATE TABLE IF NOT EXISTS public.ai_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.gqa_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('settings_saved','provider_changed','key_saved','key_cleared')),
  provider TEXT NOT NULL CHECK (provider IN ('deepseek','openai','gemini','anthropic','custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_settings_audit_recent ON public.ai_settings_audit(created_at DESC);
