-- Postgres extensions used by the OnsecBoad schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- RLS plumbing: a session GUC that tenant middleware sets on every request.
-- Policies will reference current_setting('app.tenant_id', true) once added in Phase 1.
DO $$ BEGIN
  PERFORM set_config('app.tenant_id', '', false);
EXCEPTION WHEN OTHERS THEN NULL; END $$;
