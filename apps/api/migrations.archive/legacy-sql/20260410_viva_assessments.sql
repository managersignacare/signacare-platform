-- Viva assessments — schema only.
--
-- Adds patient-assignment fields to `outcome_measures` so Viva
-- self-rating scales can be assigned to a patient, completed on the
-- patient-facing app, and scored back into the clinician record.
--
-- IMPORTANT — separation of concerns.
--   This file is a SCHEMA migration. It intentionally does NOT insert
--   clinical-content seed data (Zung SDS, K10, PHQ-9, etc). Inserting
--   seed data from a schema migration couples the rollout to a
--   specific clinic UUID (or requires per-clinic duplication) which
--   broke on 2026-04-15 when the hardcoded clinic_id didn't match the
--   current deployment. See CLAUDE.md §9.1.
--
--   Canonical seed path for clinical templates:
--     apps/api/src/seed-clinical-templates.ts  →  clinical_templates
--     apps/api/src/seed-templates.ts           →  templates
--
--   Both scripts pick an existing clinic via `SELECT id FROM clinics
--   LIMIT 1` and seed templates for it. To add a new rating scale:
--     1. Add the scale definition to one of those seed scripts.
--     2. Run `npx ts-node -r dotenv/config src/seed-clinical-templates.ts`
--        (or seed-templates.ts) once per environment.
--     3. Do NOT add it back to this migration file.

BEGIN;

-- Patient-assignment fields on outcome_measures. Each ALTER uses
-- ADD COLUMN IF NOT EXISTS so the migration is idempotent and safe
-- to re-run on an already-updated schema. No clinic-specific data
-- is touched.
ALTER TABLE outcome_measures ADD COLUMN IF NOT EXISTS status               VARCHAR(20) DEFAULT 'completed';
ALTER TABLE outcome_measures ADD COLUMN IF NOT EXISTS assigned_for_patient BOOLEAN     DEFAULT false;
ALTER TABLE outcome_measures ADD COLUMN IF NOT EXISTS template_id          UUID        REFERENCES templates(id);
ALTER TABLE outcome_measures ADD COLUMN IF NOT EXISTS template_name        VARCHAR(255);
ALTER TABLE outcome_measures ADD COLUMN IF NOT EXISTS assigned_by          UUID        REFERENCES staff(id);
ALTER TABLE outcome_measures ADD COLUMN IF NOT EXISTS completed_at         TIMESTAMPTZ;

COMMIT;
