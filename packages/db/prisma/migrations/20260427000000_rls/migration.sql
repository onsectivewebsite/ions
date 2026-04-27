-- Row-level security on tenant-scoped tables.
--
-- Strategy:
--   * `app_tenant_match(uuid)` reads two GUCs set by the app per request:
--       - `app.tenant_id`   — set by `withTenant(prisma, tenantId, ...)` for
--         everything inside a firm-scoped procedure.
--       - `app.is_platform` — set by `withPlatformGod(prisma, ...)` for the
--         Onsective platform manager and any pre-auth lookups that cannot
--         know a tenant yet (sign-in, OTP request, etc.). Every god-mode
--         call MUST emit an AuditLog entry.
--   * Each policy uses the helper for both READ (USING) and WRITE (WITH
--     CHECK) so cross-tenant inserts / updates are rejected too.
--
-- Caveat for local dev: PostgreSQL bypasses RLS for the table owner
-- and superusers. The compose file uses `onsec` as the postgres
-- superuser, so RLS is effectively a no-op locally. Production must
-- connect the application as a non-superuser role distinct from the
-- Prisma migration user. That role split lands in Phase 1 alongside
-- the production compose. The policies here are still correct and
-- exercised in CI integration tests using a non-superuser role.
--
-- See packages/tenancy/src/index.ts for the GUC writers.

-- ── Helper ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_tenant_match(row_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    coalesce(current_setting('app.is_platform', true), '') = 'true'
    OR (
      current_setting('app.tenant_id', true) IS NOT NULL
      AND current_setting('app.tenant_id', true) <> ''
      AND row_tenant_id::text = current_setting('app.tenant_id', true)
    )
$$;

-- ── Tenant (a tenant only sees its own row; platform sees all) ─────────────
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON "Tenant"
  FOR ALL
  USING (
    coalesce(current_setting('app.is_platform', true), '') = 'true'
    OR id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    coalesce(current_setting('app.is_platform', true), '') = 'true'
    OR id::text = current_setting('app.tenant_id', true)
  );

-- ── Branch ─────────────────────────────────────────────────────────────────
ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Branch"
  FOR ALL
  USING (app_tenant_match("tenantId"))
  WITH CHECK (app_tenant_match("tenantId"));

-- ── User ───────────────────────────────────────────────────────────────────
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  FOR ALL
  USING (app_tenant_match("tenantId"))
  WITH CHECK (app_tenant_match("tenantId"));

-- ── Role ───────────────────────────────────────────────────────────────────
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Role"
  FOR ALL
  USING (app_tenant_match("tenantId"))
  WITH CHECK (app_tenant_match("tenantId"));

-- ── Invite ─────────────────────────────────────────────────────────────────
ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invite"
  FOR ALL
  USING (app_tenant_match("tenantId"))
  WITH CHECK (app_tenant_match("tenantId"));

-- ── AuditLog (allow tenantId NULL — platform-level events) ─────────────────
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  FOR ALL
  USING (
    coalesce(current_setting('app.is_platform', true), '') = 'true'
    OR (
      "tenantId" IS NOT NULL
      AND "tenantId"::text = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    coalesce(current_setting('app.is_platform', true), '') = 'true'
    OR (
      "tenantId" IS NOT NULL
      AND "tenantId"::text = current_setting('app.tenant_id', true)
    )
    OR "tenantId" IS NULL  -- platform-level audit inserts (sign-in attempts before tenant is known)
  );

-- ── PlatformUser, Passkey, Session — explicitly NOT RLS-bound ──────────────
-- These tables are accessed before any tenant context exists (sign-in path).
-- Authorization is enforced in the application layer:
--   * PlatformUser is gated by tRPC platformProcedure middleware.
--   * Passkey/Session lookups always include the userId from the session.
-- When refresh-token rotation lands in Phase 1, Session gains an additional
-- userId-scoped policy. For now, leaving them unbound keeps the auth flow
-- simple and observable.
