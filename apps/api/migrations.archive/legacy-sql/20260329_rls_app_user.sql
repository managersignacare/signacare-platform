-- =============================================================================
-- RLS Gold Standard: Separate DB Role for Application Queries
-- Date: 2026-03-29  (rewritten 2026-04-15 for Phase 0.5)
--
-- Architecture:
--   signacare_owner (owner)    — runs migrations, DDL, bypasses RLS by ownership
--   app_user        (app role) — runs all application queries, subject to RLS
--
-- RLS policies enforce tenant isolation at the database level.
-- Auth-critical tables get bypass policies so login works without clinic context.
--
-- Name-agnostic: this migration MUST NOT hardcode the database name or the
-- owner role name. It uses current_database() for the DB and a session
-- setting app.owner_role (defaulted to current_user) for the owner. See
-- CLAUDE.md §7.4 for the rule and the 2026-04-15 drift-incident history
-- that motivated the rewrite — an earlier version of this file hardcoded
-- "signacareemr" (a database name that never existed) and "signacare"
-- (a role name that never existed), which meant running the migration
-- against any real environment would fail at the first GRANT statement.
-- The CI guard .github/scripts/check-no-stray-db-names.sh enforces
-- this rule across the whole repo so the drift cannot silently recur.
-- =============================================================================

BEGIN;

-- Resolve the owner role dynamically. If the operator has already set
-- app.owner_role (e.g. via `SET LOCAL app.owner_role = 'signacare_owner'`
-- at the top of a migration run), we honour it. Otherwise we fall back
-- to current_user, which is whichever role connected to execute this
-- file. Either way, no literal role name appears in this file.
DO $$
BEGIN
  PERFORM current_setting('app.owner_role', true);
EXCEPTION WHEN undefined_object THEN
  -- current_setting returns '' not an error for unset custom GUCs when
  -- missing_ok=true, so this branch is defensive only; the real fallback
  -- happens in the statement below.
  NULL;
END $$;

DO $$
DECLARE
  owner_role TEXT := COALESCE(NULLIF(current_setting('app.owner_role', true), ''), current_user);
BEGIN
  PERFORM set_config('app.owner_role', owner_role, true);
END $$;

-- =============================================================================
-- 1. GRANT PRIVILEGES TO app_user
-- =============================================================================
-- All four statements below use dynamic SQL so the database name and
-- owner role are substituted at execution time. Static GRANT / ALTER
-- DEFAULT PRIVILEGES statements cannot use current_database() or
-- current_setting() inline — the parser rejects them as function calls
-- in identifier position. Hence the format() + EXECUTE pattern.

DO $$
DECLARE
  db_name TEXT := current_database();
  owner_role TEXT := current_setting('app.owner_role', true);
BEGIN
  -- CONNECT on the database
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', db_name);

  -- USAGE on the public schema
  EXECUTE 'GRANT USAGE ON SCHEMA public TO app_user';

  -- DML on all existing tables
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user';

  -- Sequences (for gen_random_uuid via DEFAULT, serial columns, etc.)
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user';

  -- Default privileges for FUTURE tables/sequences created by the owner role
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user',
    owner_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user',
    owner_role
  );
END $$;

-- =============================================================================
-- 2. ENSURE RLS IS ENABLED ON ALL TENANT-SCOPED TABLES
-- =============================================================================
-- RLS is already enabled from the enterprise_hardening migration.
-- Since app_user is NOT the table owner, RLS applies automatically.
-- No FORCE needed — that's only for making owners subject to RLS.

-- =============================================================================
-- 3. AUTH BYPASS POLICIES
-- =============================================================================
-- These allow access when app.clinic_id is NOT set (login/MFA flow).
-- When app.clinic_id IS set (regular requests), these evaluate to FALSE
-- and only the tenant_isolation policy applies.
--
-- Condition:  NULLIF(current_setting('app.clinic_id', true), '') IS NULL
--   - If clinic_id not set: current_setting returns '' → NULLIF → NULL → TRUE
--   - If clinic_id IS set:  current_setting returns UUID → NULLIF → UUID → FALSE

-- staff: login lookup by email, update failed_login_attempts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'auth_bypass') THEN
    EXECUTE 'CREATE POLICY auth_bypass ON staff FOR ALL
      USING (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)
      WITH CHECK (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)';
  END IF;
END $$;

-- staff_sessions: create/read/revoke sessions during login/logout
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff_sessions' AND policyname = 'auth_bypass') THEN
    EXECUTE 'CREATE POLICY auth_bypass ON staff_sessions FOR ALL
      USING (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)
      WITH CHECK (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)';
  END IF;
END $$;

-- mfa_secrets: MFA verification during login
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mfa_secrets' AND policyname = 'auth_bypass') THEN
    EXECUTE 'CREATE POLICY auth_bypass ON mfa_secrets FOR ALL
      USING (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)
      WITH CHECK (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)';
  END IF;
END $$;

-- =============================================================================
-- 4. VERIFY: List all RLS-enabled tables and their policies
-- =============================================================================
DO $$
DECLARE
  rls_count INT;
  policy_count INT;
  db_name TEXT := current_database();
  owner_role TEXT := current_setting('app.owner_role', true);
BEGIN
  SELECT COUNT(*) INTO rls_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true;

  SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE schemaname = 'public';

  RAISE NOTICE 'RLS setup complete on database % (owner role %). RLS-enabled tables: %, Total policies: %',
    db_name, owner_role, rls_count, policy_count;
END $$;

COMMIT;
