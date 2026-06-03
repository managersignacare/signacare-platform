# Agent F — Regression + orphan tables (COMPLETED)

## Status: REGRESSION-FREE + HEALTHY — no action items

## Part 1 — Fix-registry guard

- 672 rows verified
- 0 failures

## Part 2 — 11 Phase R follow-up bugs regression check

All CLEAN:
- Bug 1 (Dart URLs): `/mobile/sync` + `/mobile/fcm/register-device` leading-slash present
- Bug 3 (varchar): gender varchar(100) + Zod .max(100) + frontend maxLength=100
- Bug 4 (view): patient_active_specialties exists
- Bug 5 (assessment_datetime): assessed_at (not ghost)
- Bug 6 (nursing_assessments.next_review_at): column present
- Bug 11 (audit_log): 0 ghost COALESCE refs
- Bug 12 (OrgSettings): 6 React.lazy calls (was 1, now 6)
- D.1 guard file exists at scripts/guards/check-query-builder-columns.ts
- Sweeps clean: no clinic_id on patient_team_assignments, no .whereNull('deleted_at') on exception tables, trainingPipeline uses llm_interactions JOIN

## Part 3 — Pattern regression scan

- `.whereNull('deleted_at')` on exception tables: 0 violations (229 refs all valid)
- Ghost audit cols (createdat/entityid/ipaddress): 0 matches
- Ghost review_datetime: 0 code refs (1 comment only)
- `/api/v1/` prefix in apiClient: 0 matches

## Part 4 — Orphan tables

- 273 total tables
- 0 confirmed orphans
- 0 suspected orphans
- 0 write-only orphans

Every DB table has at least one code reference (INSERT/SELECT/UPDATE/DELETE).
