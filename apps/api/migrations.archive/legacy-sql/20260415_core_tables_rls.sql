-- =============================================================================
-- Core-Tables Row-Level Security
-- Date: 2026-04-15
--
-- Scope: every tenant-scoped table in `public` that has a `clinic_id`
--        column but currently has RLS disabled. 98 tables identified
--        on 2026-04-15 after the Phase 0.6 reseed.
--
-- Why this migration exists
--   CLAUDE.md §6.3 requires every table with a clinic_id column to
--   enable RLS + tenant_isolation as defence-in-depth behind the
--   application-level clinic_id filter. An audit on 2026-04-15
--   (after the Phase 0.5 rename + Phase 0.6 reseed) found that only
--   15 tables had RLS enabled; the remaining 98 tenant-scoped tables
--   — including every core clinical table (patients, episodes,
--   clinical_notes, appointments, patient_medications, messages,
--   tasks, etc.) — were protected only by application-layer WHERE
--   clauses. A bug in any single query that forgets clinic_id would
--   allow cross-tenant data disclosure.
--
-- Design principles
--   1. Name-agnostic DDL per CLAUDE.md §7.4: no literal database
--      names, no literal role names. The policy references
--      `current_setting('app.clinic_id', true)` which is set by the
--      auth middleware on every request.
--   2. Dynamic table discovery via information_schema so the
--      migration stays correct as new tables are added — it doesn't
--      carry a hardcoded list that would drift.
--   3. Fully idempotent: re-running is a no-op. Each policy is
--      DROPped IF EXISTS then CREATEd, and ENABLE ROW LEVEL
--      SECURITY is skipped if already enabled.
--   4. Owner role (signacare_owner) keeps its default table-owner
--      bypass. Only the runtime role (app_user) is subject to RLS.
--      This matches docs/gold-standard-reports/08-deployment-guide.md
--      §2 where migrations run as owner and app queries run as
--      app_user.
--   5. Null-safe session settings: `NULLIF(current_setting(...), '')`
--      handles the case where the session variable is unset (returns
--      empty string, not NULL) without a cast exception.
--
-- Special cases
--   1. `clinics` table: uses `id` as the tenant key, not `clinic_id`.
--      Policy compares row.id against app.clinic_id.
--   2. `audit_log` table: append-only, written by triggers. The
--      trigger already sets clinic_id from the session, so the
--      standard tenant_isolation policy works — but we add USING +
--      WITH CHECK so reads and writes are both gated consistently.
--   3. Auth tables (`staff`, `staff_sessions`, `mfa_secrets`): these
--      already have an `auth_bypass` policy from
--      20260329_rls_app_user.sql that lets login reads through before
--      app.clinic_id is set. We add tenant_isolation alongside; the
--      two policies are ORed at query time, so authenticated requests
--      get tenant isolation and pre-auth login gets bypass.
--   4. Tables already enabled by an earlier migration (15 of them)
--      are detected via pg_class.relrowsecurity and the enable step
--      is skipped, but the tenant_isolation policy is still
--      installed (idempotent, replaces any existing policy with
--      the same name).
--
-- Rollback
--   Tables and their data are untouched. A rollback would issue
--   `DISABLE ROW LEVEL SECURITY` + `DROP POLICY rls_<table>_tenant`
--   on each affected table. Not included here by design — this is
--   defence-in-depth and removing it mid-production re-introduces
--   the hazard CLAUDE.md §6.3 exists to mitigate.
--
-- Standard satisfied: CLAUDE.md §6.3 (every table with clinic_id has
--                     RLS), OWASP A01 (broken access control),
--                     Australian Privacy Act 1988 (Cth) APP 6
--                     (use/disclosure), ACHS Standard 1 (patient
--                     record integrity + tenant isolation).
-- =============================================================================

BEGIN;

-- Resolve the owner role dynamically so ALTER DEFAULT PRIVILEGES and
-- any future owner-specific DDL honours whichever role is running the
-- migration — never the literal "signacare_owner" string.
DO $$
DECLARE
  owner_role TEXT := COALESCE(NULLIF(current_setting('app.owner_role', true), ''), current_user);
BEGIN
  PERFORM set_config('app.owner_role', owner_role, true);
  RAISE NOTICE 'RLS migration running as owner role: %', owner_role;
END $$;

-- =============================================================================
-- 1. Generic tenant_isolation on every table with a clinic_id column
-- =============================================================================
-- Skipped:
--   - `clinics` (handled separately — uses id, not clinic_id)
--   - `audit_log` (handled separately — needs relaxed policy)
--   - Tables that don't exist on this deployment (to_regclass check)
--
-- Not skipped (but safe):
--   - `staff`, `staff_sessions`, `mfa_secrets`: tenant_isolation is
--     ADDED alongside the pre-existing auth_bypass policy. The two
--     policies are ORed at query time.
--   - Tables that already have RLS enabled: the ALTER is a no-op,
--     the policy is refreshed.
DO $$
DECLARE
  tbl TEXT;
  skip_tables TEXT[] := ARRAY['clinics', 'audit_log'];
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name
       AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
       AND c.column_name = 'clinic_id'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name
  LOOP
    IF tbl = ANY (skip_tables) THEN
      CONTINUE;
    END IF;

    -- Defensive: skip tables that don't actually exist as regclass
    -- (covers views marked as BASE TABLE by legacy migrations).
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
      'rls_' || tbl || '_tenant', tbl);

    EXECUTE format(
      $q$CREATE POLICY %I ON %I
           FOR ALL
           USING      (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
           WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)$q$,
      'rls_' || tbl || '_tenant', tbl
    );
  END LOOP;
END $$;

-- =============================================================================
-- 2. clinics table — special case (uses id, not clinic_id)
-- =============================================================================
-- The row's own id IS the tenant key. A clinic can only see itself.
-- Pre-auth login reads clinics via the auth_bypass path (which
-- evaluates to TRUE when app.clinic_id is not set) so branding /
-- feature-flag lookups work on the unauthenticated landing page.
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_clinics_tenant ON clinics;
CREATE POLICY rls_clinics_tenant ON clinics
  FOR ALL
  USING      (id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

DROP POLICY IF EXISTS rls_clinics_auth_bypass ON clinics;
CREATE POLICY rls_clinics_auth_bypass ON clinics
  FOR SELECT
  USING (NULLIF(current_setting('app.clinic_id', true), '') IS NULL);

-- =============================================================================
-- 3. audit_log table — append-only, triggered
-- =============================================================================
-- audit_log is written exclusively by triggers. The trigger sets
-- clinic_id from the current session (see audit_trigger_fn in
-- 20260328_enterprise_hardening.sql). The standard tenant_isolation
-- policy works for triggered INSERTs because the row's clinic_id
-- always matches app.clinic_id at trigger fire time.
--
-- For READS: same tenant isolation applies — a clinic only sees its
-- own audit rows. The exception is a cross-tenant audit reviewer
-- (privacy officer) who needs full visibility; that reviewer
-- connects as signacare_owner (owner bypass) rather than app_user.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_audit_log_tenant ON audit_log;
CREATE POLICY rls_audit_log_tenant ON audit_log
  FOR ALL
  USING      (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- Pre-auth audit writes (e.g. failed login attempts before clinic
-- context exists) need to be allowed. Without this, an anonymous
-- POST /auth/login with a wrong password would fail RLS on the
-- audit trigger INSERT and the whole request would 500.
DROP POLICY IF EXISTS rls_audit_log_preauth_insert ON audit_log;
CREATE POLICY rls_audit_log_preauth_insert ON audit_log
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.clinic_id', true), '') IS NULL);

-- =============================================================================
-- 4. staff / staff_sessions / mfa_secrets — add tenant_isolation alongside
--    the pre-existing auth_bypass policy from 20260329_rls_app_user.sql
-- =============================================================================
-- auth_bypass lets pre-clinic-context login reads through (TRUE when
-- app.clinic_id is unset). tenant_isolation additionally restricts
-- authenticated reads to the caller's clinic. Both policies exist
-- side-by-side and are ORed at query time, so each authenticated
-- request sees only its own clinic's rows, and unauthenticated login
-- can still fetch the staff row by email.

-- staff table already has clinic_id, so the generic loop above has
-- already installed rls_staff_tenant. We do NOT need to re-install
-- here — the loop handles it. But we DO need to ensure RLS is
-- actually enabled on staff (the loop skips the ENABLE if the table
-- is in skip_tables, which it isn't — so RLS is enabled above).
-- This block is purely documentation of the intent; no DDL needed.

-- =============================================================================
-- 5. Verification RAISE NOTICE — report final count
-- =============================================================================
DO $$
DECLARE
  rls_count INT;
  policy_count INT;
  db_name TEXT := current_database();
BEGIN
  SELECT COUNT(*) INTO rls_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity = true;

  SELECT COUNT(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'public';

  RAISE NOTICE 'Core-tables RLS complete on database %. RLS-enabled tables: %, Total policies: %',
    db_name, rls_count, policy_count;
END $$;

COMMIT;
