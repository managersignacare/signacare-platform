-- Viva medication reminders + patient document sharing
-- Following build rules: clinic_id NOT NULL, RLS, indexes

BEGIN;

-- ── Medication reminders (clinician sets, patient receives notifications) ──
CREATE TABLE IF NOT EXISTS patient_med_reminders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  medication_id UUID REFERENCES patient_medications(id),
  drug_name     VARCHAR(255) NOT NULL,
  dose          VARCHAR(100),
  instructions  TEXT NOT NULL,                   -- patient-centric language
  days_of_week  INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',  -- 1=Mon..7=Sun
  reminder_time TIME NOT NULL DEFAULT '08:00',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_med_reminders_patient ON patient_med_reminders (patient_id);
CREATE INDEX IF NOT EXISTS idx_med_reminders_clinic ON patient_med_reminders (clinic_id);

-- ── Patient documents (shared by clinician to patient) ──
CREATE TABLE IF NOT EXISTS patient_shared_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  title         VARCHAR(255) NOT NULL,
  doc_type      VARCHAR(30) NOT NULL DEFAULT 'document',  -- document, weblink
  file_path     TEXT,                            -- for uploaded files
  url           TEXT,                            -- for weblinks
  shared_by     UUID REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_docs_patient ON patient_shared_documents (patient_id);
CREATE INDEX IF NOT EXISTS idx_shared_docs_clinic ON patient_shared_documents (clinic_id);

-- ── Triage number (per patient, set by clinician) ──
ALTER TABLE patients ADD COLUMN IF NOT EXISTS viva_triage_number VARCHAR(30);

-- ── Patient appointment response ──
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_response VARCHAR(30);

-- ── RLS ──
ALTER TABLE patient_med_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_med_reminders ON patient_med_reminders;
CREATE POLICY rls_med_reminders ON patient_med_reminders
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE patient_shared_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_shared_docs ON patient_shared_documents;
CREATE POLICY rls_shared_docs ON patient_shared_documents
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- Grant app_user access
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON patient_med_reminders TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON patient_shared_documents TO app_user;
  END IF;
END $$;

COMMIT;
