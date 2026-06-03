# D38 S1 Closure Pack — FORCE RLS + Assignment Model + Safety Case

**Date:** 2026-05-28  
**Scope:** `BUG-ARCH-FORCE-RLS-BASELINE`, `BUG-SA-004`, `BUG-SA-011`

## What changed

1. Added migration [`20260701000090_bug_arch_s0_4_force_rls_clinic_sequences_backfill.ts`](../../../../apps/api/migrations/20260701000090_bug_arch_s0_4_force_rls_clinic_sequences_backfill.ts) to enforce `FORCE ROW LEVEL SECURITY` on `clinic_sequences` (new table introduced after the baseline FORCE-RLS sweep).
2. Hardened integration harness [`taskTeamScope.int.test.ts`](../../../../apps/api/tests/integration/taskTeamScope.int.test.ts) to seed/cleanup via clinic-context transactions (`set_config('app.clinic_id', ...)`) so assignment/task scope tests remain valid under FORCE-RLS posture.

## Validation evidence

### Integration (API)

- `npm run -w apps/api test:integration -- forceRlsBaseline.int.test.ts bug417AiDraftSignAttestation.int.test.ts appointmentSlotUniqueness.int.test.ts` ✅
- `npm run -w apps/api test:integration -- bugBulkPlannedReallocationAssignmentPath.int.test.ts taskTeamScope.int.test.ts bugWf52AssessmentSuicideRiskEscalation.int.test.ts dashboardClinicalAlertsCycle2.int.test.ts dashboardManagerBillingKpis.int.test.ts forceRlsBaseline.int.test.ts` ✅

### Drift/backfill verification

- `DOTENV_CONFIG_PATH=apps/api/.env npx tsx -r dotenv/config apps/api/scripts/reconcile-assignment-drift.ts --dry-run` ✅
  - `missingAssignmentRows=0`
  - `rowsNeedingReactivationOrClinicianSync=0`
  - `staleActiveAssignmentRows=0`

### Build/guards

- `npm run -w apps/api build:check` ✅
- `npm run guard:bugs-remaining-uniqueness` ✅
- `npm run guard:task-mutation-command-convergence` ✅
- `npm run guard:notification-event-convergence-contract` ✅
- `npm run guard:lock-version-coverage-contract` ✅

## Closure decision

- `BUG-ARCH-FORCE-RLS-BASELINE` → **fixed** (local code + integration proof complete; operational role posture drill remains tracked as deployment runbook activity).
- `BUG-SA-004` → **fixed** (assignment read-path convergence + reconciliation protocol proven in integration and dry-run reconciliation).
- `BUG-SA-011` → **fixed** (dashboard false-zero hazard coverage + team task scope + self-harm escalation fail-safe proofs all green).
