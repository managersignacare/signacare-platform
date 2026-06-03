# D11 M1–M5 Structural Remediation Slice

**Date:** 2026-05-23  
**Mode:** Implementation + verification (code + guards + targeted tests)

## Scope Completed in this slice

1. **M2 (email worker stub)**
   - Replaced stubbed `emailWorker.ts` with a live BullMQ worker and graceful shutdown wiring.
   - Added `emailWorkerService.ts` for recipient resolution and delivery dispatch (SMTP-first, Outlook fallback where applicable).
   - Added unit coverage for delivery paths and permanent-error paths.
   - Added guard: `guard:email-worker-not-stub`.

2. **M1 (centralized event emission)**
   - Added canonical emitter facade: `features/events/clinicalSignalEmitter.ts`.
   - Migrated key feature callsites to `emitClinicalSignal(...)` (messaging/referrals/integration drift surfaces).
   - Added guard: `guard:centralized-notification-emitter` (blocks direct `notificationService.emit(...)` in feature modules).

3. **M4 (concurrency on god-table surface)**
   - Added migration: `20260701000080_bug_pr_structural_m4_tasks_lock_version.ts` (`tasks.lock_version`).
   - Wired task update flow to optimistic locking (`updateWithOptimisticLock` path + expected lock version pass-through).
   - Added unit coverage for lock version propagation and missing-lock hard fail.

4. **M3 (allowlist debt hygiene / stale-item enforcement)**
   - Enhanced `check-opt-locking-new-tables` to detect stale allowlist entries and fail correctly.
   - Fixed CLI pass condition bug so stale entries are now merge-gating failures.
   - Removed stale allowlist entry (`tasks`) after `lock_version` remediation.
   - Updated fix-registry decisiveness allowlist pin-count drifts uncovered by guard run.

5. **M5 (fail-silent defaults)**
   - Removed fail-open `.catch` fallbacks from dashboard query surfaces (`DashboardPage`, `DashboardViewBits` handover summary).
   - Added explicit React Query `isError` wiring for manager/reception/clinical alerts surfaces.
   - Added guard: `guard:dashboard-no-fail-open-catch` to prevent fallback reintroduction on dashboard pages.
   - Hardened `patientRepository.hasSearchTsvColumn()` fallback to log degraded path instead of silent swallow.

## Verification Evidence (this slice)

### L1
- `npx tsc --noEmit -p packages/shared/tsconfig.json` ✅
- `cd apps/api && npx tsc --noEmit` ✅
- `cd apps/web && npx tsc --noEmit` ✅
- `npm run -s lint` ✅

### L2/L3 targeted tests
- `apps/api` unit: email worker + emitter + task lock version ✅
- `apps/web` dashboard role views ✅
- guard unit tests (new and touched guards) ✅

### L4 guards
- `guard:email-worker-not-stub` ✅
- `guard:centralized-notification-emitter` ✅
- `guard:dashboard-no-fail-open-catch` ✅
- `guard:opt-locking-new-tables` ✅ (0 violations, 0 stale)
- `guard:no-fire-and-forget` ✅
- `guard:claude-discipline:ci` ✅

### `guard:all` status in working tree
- `guard:all` currently fails in this dirty local state due:
  - `guard:generator-no-diff` (expected while generated files are modified but not committed),
  - previously `guard:fix-registry-decisiveness` drift (now resolved in this slice).

## Remaining structural work (next slices)

1. Expand centralized emitter enforcement to scheduler/context emitters (jobs layer).
2. Continue M4 lock-version rollout for remaining allowlisted multi-writer tables.
3. Reduce fail-silent fallback patterns across non-dashboard web/API feature surfaces.
4. Drain high-risk allowlist classes incrementally with per-bug closure evidence.

