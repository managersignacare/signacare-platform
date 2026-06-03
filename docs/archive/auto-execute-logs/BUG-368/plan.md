# BUG-368 — clinic_id x5 + CI guard — Plan

## Root cause (verified)

5 endpoints in `apps/api/src/features/patients/patientRoutes.ts` query multi-tenant tables (`patient_attachments`, `patient_legal_attachments`, `patient_alerts`) with only `patient_id` — no `clinic_id` predicate. RLS is the second layer; CLAUDE.md §1.3 mandates app-layer `clinic_id` as the primary control.

| Line | Endpoint | Table | Current WHERE |
|---|---|---|---|
| 457 | `GET /:id/attachments` | patient_attachments | `{ patient_id, is_active }` |
| 632 | `GET /:id/pathology` | patient_attachments | `{ patient_id, is_active } + whereRaw "label LIKE 'Pathology:%'"` |
| 908 | `GET /:id/legal-attachments` | patient_legal_attachments | `{ patient_id }` |
| 926 | `GET /:id/alerts` | patient_alerts (joined alert_types, staff) | `patient_alerts.patient_id` |
| 1035 | `GET /:id/flags` | patient_alerts | `{ patient_id, is_active }` |

Verified via `schema-snapshot.json`: all 3 tables have a `clinic_id` column.

## Gold-standard fix

1. Add `clinic_id: req.clinicId` to each `.where(...)` (4 endpoints)
2. Endpoint with qualified-join (`patient_alerts.patient_id`): add `.where('patient_alerts.clinic_id', req.clinicId)` — qualifier matches the existing style
3. CI guard `scripts/guards/check-query-has-clinic-id.ts` — scans `apps/api/src/features/**/*.ts` for `.where({ patient_id: ... })` / `.where('<table>.patient_id', ...)` patterns on multi-tenant tables and asserts a matching `clinic_id` predicate (or `:Admin` function context). Modelled on `check-row-interface-matches-db.ts` — uses `schema-snapshot.json` as SSoT for the multi-tenant table list.
4. Integration test exercising cross-tenant read: seed Clinic A + Clinic B, GET `/:id/attachments` with Clinic A's auth but Clinic B's patient UUID → 404 (not 200-with-Clinic-B-data).

## Files touched

- `apps/api/src/features/patients/patientRoutes.ts` — 5 endpoints updated
- `scripts/guards/check-query-has-clinic-id.ts` — NEW CI guard
- `apps/api/tests/integration/bug368CrossClinicPatientRoutes.int.test.ts` — NEW integration test
- `docs/quality/fix-registry.md` — 1 present + 1 absent row + 1 guard-exists row
- `docs/quality/bugs-remaining.md` — BUG-368 marked fixed

## Risk + scope

- Minimal behaviour change on happy path (same clinic) — `clinic_id` filter matches existing row's clinic_id
- Cross-tenant attempt now returns empty result set (correct) instead of cross-clinic data
- CI guard must not false-positive on:
  - `:Admin` suffixed function bodies (intentional admin paths)
  - Queries joining through a parent that scopes to clinic_id (harder to detect statically; use a small allowlist)

## L3/L4/L5 expected

- L3: yes
- L4: yes — §13.5 semantic trigger (tenant-isolation gate)
- L5: yes — adds new CI guard + touches `features/patients/` which contributes to shared-helper patterns

## Fix-registry

- `R-FIX-BUG-368-PATIENTROUTES-CLINIC-ID` — `present` pattern asserting `clinic_id: req.clinicId` appears in each patched endpoint
- `R-FIX-BUG-368-CI-GUARD-EXISTS` — `present` pattern asserting `scripts/guards/check-query-has-clinic-id.ts` exists with its function signature
- `R-FIX-BUG-368-NO-UNSCOPED-PATIENT-ID-WHERE` — `absent` pattern asserting `.where({ patient_id: req.params.id })` without `clinic_id` never reappears in patientRoutes.ts
