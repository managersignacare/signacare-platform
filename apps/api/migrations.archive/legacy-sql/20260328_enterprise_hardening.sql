-- ═══════════════════════════════════════════════════════════════════════════════
-- Enterprise Hardening Migration
-- Date: 2026-03-28
-- Scope: FKs, updated_at, auto-timestamps, RLS, audit triggers
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ADD updated_at TO TABLES MISSING IT
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl TEXT;
  missing_tables TEXT[] := ARRAY[
    'advance_directives','ai_training_feedback','assessment_responses','bed_movements',
    'billing_accounts','carers','contact_records','data_breach_log',
    'episode_types','ereferrals','escalation_events','group_session_attendees',
    'hotspots','invoice_line_items','llm_interactions','message_thread_participants',
    'org_unit_programs','outcome_measures','patient_alert_attachments','patient_attachments',
    'patient_contacts','patient_legal_attachments','patient_providers','patient_team_assignments',
    'payments','planned_transition_assignments','programs','referral_workflow_events',
    'report_runs','restrictive_interventions','sms_campaign_recipients','sms_campaigns',
    'staff_permissions','template_categories','treatment_pathways'
  ];
BEGIN
  -- ALTER TABLE IF EXISTS is the gate: tables that don't exist on a
  -- given deployment (e.g. fresh v2_baseline without the extended
  -- legacy surface) are silently skipped. ADD COLUMN IF NOT EXISTS is
  -- the second gate: re-runs don't error on the second pass.
  FOREACH tbl IN ARRAY missing_tables LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()', tbl);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. AUTO-TIMESTAMP TRIGGER FUNCTION (reusable)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply auto-timestamp to ALL tables that have updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
  LOOP
    -- Drop if exists to make idempotent
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. FOREIGN KEY CONSTRAINTS (safe — only if referenced table/column exists)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Helper: Add FK only if both table and column exist, skip on error
CREATE OR REPLACE FUNCTION add_fk_if_valid(
  src_table TEXT, src_col TEXT, ref_table TEXT, ref_col TEXT DEFAULT 'id'
) RETURNS void AS $$
DECLARE
  cname TEXT;
BEGIN
  cname := 'fk_' || src_table || '_' || src_col;
  -- Check source exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src_table AND column_name=src_col) THEN RETURN; END IF;
  -- Check target exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=ref_table AND column_name=ref_col) THEN RETURN; END IF;
  -- Check FK doesn't already exist
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name WHERE tc.constraint_type='FOREIGN KEY' AND kcu.table_name=src_table AND kcu.column_name=src_col) THEN RETURN; END IF;
  -- Truncate constraint name to 63 chars (PG limit)
  cname := left(cname, 63);
  BEGIN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE SET NULL', src_table, cname, src_col, ref_table, ref_col);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipped FK %: %', cname, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

-- clinic_id → clinics
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='clinic_id' AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema='public') LOOP
    PERFORM add_fk_if_valid(r.table_name, 'clinic_id', 'clinics');
  END LOOP;
END $$;

-- patient_id → patients
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='patient_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'patient_id', 'patients');
  END LOOP;
END $$;

-- episode_id → episodes
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='episode_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'episode_id', 'episodes');
  END LOOP;
END $$;

-- staff FK columns → staff
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND data_type='uuid'
      AND (column_name LIKE '%staff_id' OR column_name IN ('author_id','sender_id','assigned_to_id','assigned_by_id','raised_by_id','resolved_by_id','acknowledged_by_id','decision_by_id','triaged_by_id','recorded_by_id','reported_by_id','authorised_by_id','completed_by_id','created_by_id','generated_by_id','entered_by_id','granted_by_id','reviewed_by_id','actor_id'))
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema='public')
  LOOP
    PERFORM add_fk_if_valid(r.table_name, r.column_name, 'staff');
  END LOOP;
END $$;

-- template_id → templates
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='template_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'template_id', 'templates');
  END LOOP;
END $$;

-- appointment_id → appointments
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='appointment_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'appointment_id', 'appointments');
  END LOOP;
END $$;

-- bed_id → beds
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='bed_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'bed_id', 'beds');
  END LOOP;
END $$;

-- org_unit_id → org_units
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_unit_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'org_unit_id', 'org_units');
  END LOOP;
END $$;

-- thread_id → message_threads
SELECT add_fk_if_valid('messages', 'thread_id', 'message_threads');

-- treatment_plan_id → treatment_plans
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='treatment_plan_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'treatment_plan_id', 'treatment_plans');
  END LOOP;
END $$;

-- care_plan_goal_id → care_plan_goals
SELECT add_fk_if_valid('care_plan_interventions', 'care_plan_goal_id', 'care_plan_goals');

-- patient_medication_id → patient_medications
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='patient_medication_id' AND data_type='uuid' LOOP
    PERFORM add_fk_if_valid(r.table_name, 'patient_medication_id', 'patient_medications');
  END LOOP;
END $$;

-- Drop helper function
DROP FUNCTION IF EXISTS add_fk_if_valid;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. ROW-LEVEL SECURITY — enable on 21 tables missing it
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl TEXT;
  rls_tables TEXT[] := ARRAY[
    'care_plan_goals','care_plan_interventions','clinical_formulations',
    'community_resources','consent_records','data_breach_log','data_retention_policies',
    'medication_administrations','message_thread_participants','notifications',
    'nursing_assessments','patient_contacts','phone_triage','programs',
    'report_schedules','role_access_policies','shift_handovers',
    'side_effect_schedules','sms_campaigns','staff_leave','structured_observations'
  ];
BEGIN
  FOREACH tbl IN ARRAY rls_tables LOOP
    -- Skip tables that don't exist on this deployment (e.g. fresh
    -- v2_baseline without the extended legacy surface).
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;
    -- Skip tables that don't have a clinic_id column. The RLS policy
    -- is tenant-isolation by clinic_id — tables without that column
    -- can't be gated this way and would 42703 on CREATE POLICY.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl AND column_name='clinic_id'
    ) THEN
      CONTINUE;
    END IF;
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Create tenant isolation policy (idempotent via DROP ... IF EXISTS
    -- then CREATE, so a re-run doesn't hit "policy already exists").
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'rls_' || tbl || '_tenant', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (clinic_id = current_setting(''app.clinic_id'', true)::uuid)',
      'rls_' || tbl || '_tenant', tbl
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. AUDIT TRIGGER — generic function + apply to tables missing it
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (id, clinic_id, user_id, action, table_name, record_id, old_data, new_data, created_at)
  VALUES (
    gen_random_uuid(),
    COALESCE(current_setting('app.clinic_id', true)::uuid, NULL),
    COALESCE(current_setting('app.user_id', true)::uuid, NULL),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    now()
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Don't let audit failures block the operation
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit trigger to critical clinical tables that don't have one
DO $$
DECLARE
  tbl TEXT;
  audit_tables TEXT[] := ARRAY[
    'care_plan_goals','care_plan_interventions','clinical_formulations',
    'community_resources','consent_records','medication_administrations',
    'notifications','nursing_assessments','phone_triage',
    'report_schedules','shift_handovers','side_effect_schedules',
    'sms_campaigns','staff_leave','structured_observations',
    'contact_records','correspondence_letters','advance_directives',
    'carers','restrictive_interventions','treatment_pathways',
    'outcome_measures','assessment_responses','billing_accounts',
    'data_breach_log','hotspots','patient_contacts'
  ];
BEGIN
  FOREACH tbl IN ARRAY audit_tables LOOP
    -- Skip tables that don't exist on this deployment.
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_audit ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. SOFT-DELETE INDEX — ensure deleted_at columns are indexed for performance
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'deleted_at' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_deleted_at ON %I (deleted_at) WHERE deleted_at IS NULL', tbl, tbl);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. CLINIC_ID INDEX — ensure all tenant-scoped tables have clinic_id indexed
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'clinic_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_clinic_id ON %I (clinic_id)', tbl, tbl);
  END LOOP;
END $$;

COMMIT;
