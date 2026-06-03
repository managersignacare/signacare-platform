# BUG-SA-006 — Assignment Drift Reconciliation Protocol

**Date:** 2026-05-28  
**Scope:** Legacy mismatch repair between `episodes` ownership and `patient_team_assignments`.

## 1) Why this exists

Several runtime paths now use shared assignment predicates, but legacy rows can still drift from active episode ownership. This protocol provides a safe, repeatable reconciliation/backfill flow.

## 2) Tooling

Script:
- [apps/api/scripts/reconcile-assignment-drift.ts](../../../apps/api/scripts/reconcile-assignment-drift.ts)

Default behavior:
- Dry-run only (no writes)
- Reports:
  - missing assignment rows
  - rows requiring reactivation/clinician sync
  - stale active assignment rows

Apply modes:
- `--apply`: write missing + reactivation/clinician-sync rows
- `--apply --deactivate-stale`: also deactivate stale active rows

## 3) Execution order (no shortcuts)

1. Snapshot:
   - DB backup and migration state capture
2. Dry-run globally:
   - `npx tsx apps/api/scripts/reconcile-assignment-drift.ts`
3. Dry-run by clinic:
   - `npx tsx apps/api/scripts/reconcile-assignment-drift.ts --clinic <clinicId>`
4. Review stale candidates with operations/clinical owner before deactivation.
5. Apply writes without stale deactivation first:
   - `npx tsx apps/api/scripts/reconcile-assignment-drift.ts --apply`
6. Re-run dry-run and confirm zero missing/sync rows.
7. Optional stale deactivation pass only after approval:
   - `npx tsx apps/api/scripts/reconcile-assignment-drift.ts --apply --deactivate-stale`
8. Record execution evidence in `docs/quality/remediation/evidence/`.

## 4) Verification SQL

```sql
-- Active episodes (with ownership) lacking matching active assignment rows
SELECT e.id AS episode_id, e.patient_id, e.team_id, e.primary_clinician_id
FROM episodes e
LEFT JOIN patient_team_assignments pta
  ON pta.patient_id = e.patient_id
 AND pta.org_unit_id = e.team_id
WHERE e.status = 'active'
  AND e.deleted_at IS NULL
  AND e.team_id IS NOT NULL
  AND e.primary_clinician_id IS NOT NULL
  AND (pta.id IS NULL OR pta.is_active = false OR pta.primary_clinician_id <> e.primary_clinician_id);
```

```sql
-- Active assignment rows that do not map to active episodes
SELECT pta.id, pta.patient_id, pta.org_unit_id, pta.primary_clinician_id
FROM patient_team_assignments pta
LEFT JOIN episodes e
  ON e.patient_id = pta.patient_id
 AND e.team_id = pta.org_unit_id
 AND e.status = 'active'
 AND e.deleted_at IS NULL
WHERE pta.is_active = true
  AND e.id IS NULL;
```

## 5) Rollback posture

- The script runs inside a DB transaction per invocation.
- If `--deactivate-stale` was executed by mistake, restore from backup or re-run targeted reactivation updates from audited run output.

## 6) Ownership

- Technical owner: Platform API team
- Sign-off owners: Clinical operations + data governance
