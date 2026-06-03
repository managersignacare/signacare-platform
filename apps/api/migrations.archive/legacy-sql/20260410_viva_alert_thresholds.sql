-- Viva alert thresholds — clinicians set rules to get alerted on patient tracking data
-- Following build rules: clinic_id NOT NULL, RLS, indexes, NOT NULL on required cols

BEGIN;

CREATE TABLE IF NOT EXISTS viva_alert_thresholds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  tracking_type VARCHAR(30) NOT NULL,           -- mood, anxiety, sleep, energy, weight, bpSystolic, bloodSugar etc
  direction     VARCHAR(10) NOT NULL DEFAULT 'below',  -- below or above
  threshold     NUMERIC(10,2) NOT NULL,
  consecutive_days INTEGER NOT NULL DEFAULT 3,  -- trigger after X consecutive days
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_viva_thresholds_patient ON viva_alert_thresholds (patient_id);
CREATE INDEX IF NOT EXISTS idx_viva_thresholds_clinic ON viva_alert_thresholds (clinic_id);

ALTER TABLE viva_alert_thresholds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_viva_thresholds ON viva_alert_thresholds;
CREATE POLICY rls_viva_thresholds ON viva_alert_thresholds
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON viva_alert_thresholds TO app_user;
  END IF;
END $$;

COMMIT;
