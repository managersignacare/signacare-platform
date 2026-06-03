# BUG-602 — Plan (locked from L3 retroactive review of BUG-583)

The L3 retroactive review on SHA `6112524` (BUG-583) found that the silent-zero
class was only partially closed — direct `db()` calls in the two scheduler
files were switched to `dbAdmin`, but 5 transitive cascade paths still go
through bare `db()` and silently fail under the empty `app.clinic_id` GUC.

This is the gold-standard structural fix per `feedback_gold_standard.md`.

## Cascade methods to fix

1. **`referralSlaScheduler.notifyStaff` → `createTaskInternal`** (line 204) →
   `taskRepo.create` (bare db). **Fix:** switch scheduler call to
   `createTaskInternalAdmin` (already exists at `taskService.ts:70` for HL7
   worker context — established `*Admin` sibling pattern).

2. **`referralSlaScheduler.notifyStaff` → `createThread`** (line 217) →
   `messageRepo.createThread` (bare db). **Fix:** thread optional
   `conn: Knex = db` through `messageService.createThread` →
   `messageRepo.createThread`. Pass `dbAdmin` from scheduler.

3. **`referralSlaScheduler.processAutoClose` → `episodeService.close`**
   (line 137) → `episodeRepository.findById/update` (bare db). **Fix:** thread
   optional `conn: Knex = db` through `episodeService.close` →
   `episodeRepository.findById` + `update`. Pass `dbAdmin` from scheduler.

4. **`referralSlaScheduler.processAutoClose` →
   `referralFeedbackService.sendClosedNoResponseFeedback`** (line 148) →
   `referralRepository.findById/insertFeedbackLog` (bare db). **Fix:** accept
   optional `conn: Knex = db` on `sendClosedNoResponseFeedback`; propagate to
   all internal `referralRepository` calls; thread optional `conn` on
   `findById` and `insertFeedbackLog`. Pass `dbAdmin` from scheduler.

5. **`referralSlaScheduler.processAutoClose` bulk UPDATE** at line 141 —
   `dbAdmin('referral_clinician_offers').where({ referral_id, response:
   'pending' })` is missing `clinic_id` per CLAUDE.md §1.3. **Fix:** add
   `clinic_id: referral.clinic_id` to the WHERE clause. `dbAdmin` bypasses
   RLS, so application-layer clinic_id is the only enforcement.

## RED-gate integration test (the missing test class)

`apps/api/tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts` —
boots a real Postgres with RLS enabled, no `app.clinic_id` GUC set, runs the
referralSlaScheduler tick, asserts:
- `notifications` table has ≥1 row (covered by BUG-583 direct fix; baseline)
- `tasks` table has ≥1 row (covered by cascade fix #1)
- `message_threads` table has ≥1 row (covered by cascade fix #2)
- `episodes.status='closed'` for the auto-closed intake episode (cascade fix #3)
- `referral_workflow_events` table has the `auto_closed` event row (cascade fix #4)
- `referral_feedback_log` table has the closure-feedback row (cascade fix #4)
- `referral_clinician_offers.response='expired'` for the right clinic only (cascade fix #5)

Skip behaviour: `describe.skipIf(!READY)` per `_helpers.ts:isIntegrationReady`.

## Files modified

| File | Change |
|---|---|
| `apps/api/src/features/messaging/messageRepository.ts` | `createThread` accepts `conn: Knex = db` |
| `apps/api/src/features/messaging/messageService.ts` | `createThread` accepts + propagates `conn` |
| `apps/api/src/features/episode/episodeRepository.ts` | `findById`, `update` accept `conn` (note: `update` already routes through `updateWithOptimisticLock` which accepts `trx` — need parity for non-opt-locked path) |
| `apps/api/src/features/episode/episodeService.ts` | `close` accepts + propagates `conn` |
| `apps/api/src/features/referrals/referralRepository.ts` | `findById`, `insertFeedbackLog` accept `conn` |
| `apps/api/src/features/referrals/referralFeedbackService.ts` | `sendClosedNoResponseFeedback` accepts `conn` + propagates to internal repo calls (incl already-conn-aware `updateReferral` + `insertWorkflowEvent`) |
| `apps/api/src/jobs/schedulers/referralSlaScheduler.ts` | switch to `createTaskInternalAdmin`; pass `dbAdmin` to `createThread`/`episodeService.close`/`sendClosedNoResponseFeedback`; add `clinic_id` to UPDATE WHERE |

## Fix-registry anchors (8 minimum)

1. `R-FIX-BUG-602-USES-CREATE-TASK-ADMIN` — present `createTaskInternalAdmin` in scheduler
2. `R-FIX-BUG-602-MESSAGE-REPO-CONN` — present `conn: Knex = db` in messageRepository.createThread
3. `R-FIX-BUG-602-EPISODE-REPO-CONN` — present `conn` arg in episodeRepository.findById
4. `R-FIX-BUG-602-EPISODE-SERVICE-CONN` — present `conn` arg in episodeService.close signature
5. `R-FIX-BUG-602-REFERRAL-FEEDBACK-CONN` — present `conn` arg in sendClosedNoResponseFeedback
6. `R-FIX-BUG-602-CLINIC-ID-IN-BULK-UPDATE` — present `clinic_id: referral.clinic_id` in scheduler line 141
7. `R-FIX-BUG-602-NO-BARE-DB-IN-CASCADE` — absent `(?:createTaskInternal|messageService\.createThread|episodeService\.close|sendClosedNoResponseFeedback)` calls without `dbAdmin` arg in referralSlaScheduler.ts
8. `R-FIX-BUG-602-INTEGRATION-RED-GATE` — present integration test file path

## Acceptance gates

Per `feedback_wave_gate_discipline.md`:
- [ ] RED gate: integration test FAILS on stub
- [ ] L1: tsc × 3 + **FULL 25 guards** + 1167+ fix-registry anchors PASS
- [ ] L2: 3× flake on new tests + 0 regressions
- [ ] L3 PASS or absorb (max 1, 2-REJECT cap)
- [ ] L4 PASS (touches scheduler clinical-safety surface)
- [ ] L5 PASS (touches `shared/` via repos used by request paths; new pattern)
- [ ] Atomic catalogue flip BUG-602 → fixed in same commit
- [ ] Explicit user push authorization
