-- Patient tasks (clinician sets, patient completes) + appointment checklists
-- Following build rules: clinic_id NOT NULL, RLS, indexes

BEGIN;

CREATE TABLE IF NOT EXISTS patient_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  due_date      DATE,
  reminder_time TIME,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, completed, cancelled
  completed_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_tasks_patient ON patient_tasks (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_tasks_clinic ON patient_tasks (clinic_id);
CREATE INDEX IF NOT EXISTS idx_patient_tasks_status ON patient_tasks (status);

CREATE TABLE IF NOT EXISTS appointment_checklists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  appointment_id  UUID,
  item            VARCHAR(500) NOT NULL,
  is_completed    BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_checklist_patient ON appointment_checklists (patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_checklist_appt ON appointment_checklists (appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_checklist_clinic ON appointment_checklists (clinic_id);

ALTER TABLE patient_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_patient_tasks ON patient_tasks;
CREATE POLICY rls_patient_tasks ON patient_tasks
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE appointment_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_appt_checklists ON appointment_checklists;
CREATE POLICY rls_appt_checklists ON appointment_checklists
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON patient_tasks TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_checklists TO app_user;
  END IF;
END $$;

COMMIT;
