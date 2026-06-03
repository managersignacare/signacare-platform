-- Patient App (Viva) — onboarding tables
-- Clinician-initiated invite flow: clinician generates code → patient activates with code + sets password

BEGIN;

-- ── Invite codes (clinician generates, patient redeems) ──
CREATE TABLE IF NOT EXISTS patient_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  code          VARCHAR(6) NOT NULL,           -- 6-digit numeric code
  qr_token      UUID NOT NULL DEFAULT gen_random_uuid(),  -- UUID for QR code scanning
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,                    -- NULL until redeemed
  created_by    UUID REFERENCES staff(id),      -- clinician who generated
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_invites_code ON patient_invites (code) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patient_invites_qr ON patient_invites (qr_token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patient_invites_patient ON patient_invites (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_invites_clinic ON patient_invites (clinic_id);

-- ── Patient app accounts (separate from staff auth) ──
CREATE TABLE IF NOT EXISTS patient_app_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  phone         VARCHAR(20),                    -- login identifier
  email         VARCHAR(255),                   -- optional login identifier
  password_hash VARCHAR(255) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  mfa_enabled   BOOLEAN NOT NULL DEFAULT false,
  mfa_secret    VARCHAR(64),
  last_login_at TIMESTAMPTZ,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, patient_id),               -- one account per patient per clinic
  UNIQUE (clinic_id, phone)                     -- one phone per clinic
);

CREATE INDEX IF NOT EXISTS idx_patient_accounts_patient ON patient_app_accounts (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_accounts_clinic ON patient_app_accounts (clinic_id);
CREATE INDEX IF NOT EXISTS idx_patient_accounts_phone ON patient_app_accounts (phone);

-- ── Patient tracking data (mood, energy, sleep, pain, meds adherence, vitals) ──
CREATE TABLE IF NOT EXISTS patient_tracking (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  tracking_type VARCHAR(30) NOT NULL,           -- mood, energy, sleep, pain, meds, weight, bloodPressure, bloodSugar
  value         NUMERIC(10,2) NOT NULL,
  note          TEXT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        VARCHAR(20) NOT NULL DEFAULT 'patient_app',  -- patient_app or clinician
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_tracking_patient ON patient_tracking (patient_id, tracking_type);
CREATE INDEX IF NOT EXISTS idx_patient_tracking_date ON patient_tracking (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_tracking_clinic ON patient_tracking (clinic_id);

-- ── RLS policies ──
ALTER TABLE patient_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_patient_invites ON patient_invites;
CREATE POLICY rls_patient_invites ON patient_invites
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE patient_app_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_patient_accounts ON patient_app_accounts;
CREATE POLICY rls_patient_accounts ON patient_app_accounts
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE patient_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_patient_tracking ON patient_tracking;
CREATE POLICY rls_patient_tracking ON patient_tracking
  FOR ALL USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- Grant app_user access
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON patient_invites TO app_user;
    GRANT SELECT, INSERT, UPDATE ON patient_app_accounts TO app_user;
    GRANT SELECT, INSERT ON patient_tracking TO app_user;
  END IF;
END $$;

COMMIT;
