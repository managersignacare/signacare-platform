-- Category 6 — Database query plan audit
--
-- The k6 scenarios above measure latency from the API edge inward.
-- This file complements them by inspecting the query plans for the
-- queries that touch large tables. The expectation: every query
-- below MUST use an Index Scan (or Bitmap Index Scan), NEVER a
-- Sequential Scan, on any table with > 10,000 rows.
--
-- Run against the staging DB:
--
--   psql "$STAGING_DSN" -f scripts/k6/db-explain.sql > db-explain.out
--
-- Then grep for 'Seq Scan' in the output. ANY hit on a clinical
-- table is a CI failure — open an index migration before merge.
--
-- Standard satisfied: ACHS Standard 1 (responsive clinical record),
--                     ISO 25010 Performance Efficiency.
\timing on
\set ON_ERROR_STOP on

\echo '────────────────────────────────────────────────'
\echo 'Q1: Patient list — paginated by family_name'
\echo '────────────────────────────────────────────────'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, given_name, family_name, date_of_birth, clinic_id
FROM patients
WHERE clinic_id = (SELECT id FROM clinics LIMIT 1)
  AND deleted_at IS NULL
ORDER BY family_name, given_name
LIMIT 50;

\echo '────────────────────────────────────────────────'
\echo 'Q2: Patient search by ILIKE family_name'
\echo '────────────────────────────────────────────────'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, given_name, family_name
FROM patients
WHERE clinic_id = (SELECT id FROM clinics LIMIT 1)
  AND family_name ILIKE 'Smith%'
  AND deleted_at IS NULL
LIMIT 20;

\echo '────────────────────────────────────────────────'
\echo 'Q3: Active episodes for a patient (the most common'
\echo '    join in the API — episodes ⨝ patients)'
\echo '────────────────────────────────────────────────'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT e.id, e.episode_type, e.status, e.start_date, e.primary_diagnosis
FROM episodes e
WHERE e.patient_id = (SELECT id FROM patients LIMIT 1)
  AND e.clinic_id = (SELECT clinic_id FROM patients LIMIT 1)
  AND e.deleted_at IS NULL
ORDER BY e.start_date DESC
LIMIT 20;

\echo '────────────────────────────────────────────────'
\echo 'Q4: Medications for a patient (the MAR query)'
\echo '────────────────────────────────────────────────'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT pm.id, pm.drug_name, pm.dose, pm.frequency, pm.status
FROM patient_medications pm
WHERE pm.patient_id = (SELECT id FROM patients LIMIT 1)
  AND pm.clinic_id = (SELECT clinic_id FROM patients LIMIT 1)
ORDER BY pm.created_at DESC
LIMIT 50;

\echo '────────────────────────────────────────────────'
\echo 'Q5: Audit log for a patient (the timeline query)'
\echo '────────────────────────────────────────────────'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, action, staff_id, table_name, record_id, created_at
FROM audit_log
WHERE clinic_id = (SELECT id FROM clinics LIMIT 1)
ORDER BY created_at DESC
LIMIT 100;

\echo '────────────────────────────────────────────────'
\echo 'Q6: Clinical notes for a patient'
\echo '────────────────────────────────────────────────'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, note_type, signed_at, signed_by_staff_id
FROM clinical_notes
WHERE patient_id = (SELECT id FROM patients LIMIT 1)
  AND clinic_id = (SELECT clinic_id FROM patients LIMIT 1)
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
