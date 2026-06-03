# D5 Allocation Convergence Slice (Bulk + Transition + Reallocation)

**Date:** 2026-05-22  
**Scope:** Structural convergence for patient allocation mutation orchestration (no UI changes)

## 1) What changed

1. Added shared execution command:
   - `apps/api/src/features/patients/allocationExecutionCommand.ts`
   - Provides:
     - `validateAllocationExecutionInstructions(...)`
     - `executeAllocationInstructions(...)`
   - Supports both instruction modes:
     - `planned_transition`
     - `reallocation`

2. Refactored planned-transition execution to shared command:
   - `apps/api/src/features/staff-settings/staffTransitionCommands.ts`
   - `executePlannedTransition(...)` now builds patient-scoped instructions, validates once, executes once, then stamps assignment rows as executed.

3. Refactored reallocation-approve execution to shared command:
   - `apps/api/src/features/reallocations/reallocationService.ts`
   - `approve(...)` now validates/executes through the same shared command path.

4. Added regression guard:
   - `scripts/guards/check-allocation-command-convergence.ts`
   - `package.json` script:
     - `guard:allocation-command-convergence`
   - Enforces:
     - orchestration modules import shared allocation command
     - orchestration modules call `executeAllocationInstructions(...)`
     - direct `applyPatientAllocationMutation(...)` calls are blocked in those orchestration modules

5. Added integration coverage for team-only reallocation approval:
   - `apps/api/tests/integration/bugBulkPlannedReallocationAssignmentPath.int.test.ts`
   - New case verifies reallocation approval without destination clinician:
     - updates team
     - preserves episode primary clinician
     - writes active target team assignment with `primary_clinician_id = null`

## 2) L1–L5 gate evidence

### L1
- `npm run -w apps/api build` ✅
- `npm run typecheck` ✅
- `npm run lint` ✅

### L2
- `npm run -w apps/api test:integration -- bugBulkPlannedReallocationAssignmentPath.int.test.ts` ✅
  - **15/15 passing**

### L3
- Integration assertions expanded for reallocation path (team-only move case) ✅

### L4
- `npm run guard:allocation-command-convergence` ✅
- `npm run guard:query-has-clinic-id` ✅
- `npm run guard:trx-not-db-inside-transaction` ✅
- `npm run guard:jsonb-extraction` ✅
- `npm run guard:safety-route-integration-coverage` ✅
- `npm run guard:all` ✅

### L5
- End-to-end allocation invariants probed through integration execution path:
  - bulk reassign (clinician + key-worker)
  - planned transition execute
  - reallocation request/approve/reject
  - four-eyes enforcement
  - cross-clinic target rejection
  - team-assignment API consistency
  - team-only reallocation behavior
  - all green in current pass

## 3) Catalogue sync

- `docs/quality/bugs-remaining.md`
  - `BUG-SA-003` moved to `in_progress` with implementation detail and closure prerequisites.
  - `BUG-SA-004` moved to `in_progress` with read-path convergence/backfill closure prerequisites.

