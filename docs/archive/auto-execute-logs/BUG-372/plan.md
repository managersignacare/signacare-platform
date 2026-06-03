# BUG-372 — Plan (locked) — 3 sub-cycles

**Goal.** Three clinical-safety alerts that must fire on schedule but don't:
1. Pathology critical-result (unacknowledged > 30 min)
2. MHA review-window (T-7d / T-3d / T-1d / T-0 / T+overdue buckets)
3. Prescription-repeat (T-7d / T-1d / T+overdue; clozapine drug-class promotion)

## Sub-cycle split (per BUG-371 precedent)

Land **a → b → c**:

| Sub-cycle | Surface | Cron | Audience |
|---|---|---|---|
| **BUG-372a** | `pathology_results` + `pathology/` + new scheduler | `*/15 * * * *` AEST | primary clinician + ordering clinician |
| **BUG-372b** | `legal_orders` + `patient_legal_orders` + NEW `features/legal/` + scheduler | `0 * * * *` AEST | primary clinician + creator |
| **BUG-372c** | `prescriptions` + `erx_tokens` + scheduler | `0 6 * * *` AEST | prescriber + primary clinician |

## Verified facts (NO guessing per `feedback_no_guessing.md`)

- **Scheduler**: `node-cron ^3.0.3` already in `apps/api/package.json:57`. Canonical: `appointmentReminderScheduler.ts` + `referralSlaScheduler.ts`. Bootstrap registry: `apps/api/src/jobs/bootstrap.ts:32`.
- **Notification**: `notificationService.emit({dedupeKey, channels: ['sse','bell','fcm']})` — partial unique index on `(clinic_id, payload->>'dedupe_key')` handles idempotency atomically. No email/SMS to staff (out of scope; cascade-7).
- **Pathology schema**: `pathology_results.is_critical` (bool) + `abnormal_flag` (`critical_high|critical_low|abnormal|low|high|normal`) + `critical_acknowledged_at` + `critical_acknowledged_by_id`. Critical = `is_critical=true OR abnormal_flag IN ('critical_high','critical_low')`.
- **MHA schema**: `legal_orders.review_date` (canonical) + `patient_legal_orders.review_date` (legacy). Both alive. Scheduler covers UNION.
- **Prescription schema**: `prescriptions.repeats` (int) + `expires_at` (date). NO `repeats_remaining`, NO `next_repeat_due`. Consumed count derived from `erx_tokens.dispensed_at IS NOT NULL` JOIN. (Critical: do NOT add columns — would break BUG-371 opt-lock guarantee.)
- **Responsible-clinician fan-out**: episodes.primary_clinician_id → patient_team_assignments.primary_clinician_id (active) → row-author (`prescribed_by_staff_id` / `ordered_by_id` / `created_by_staff_id`). Modelled on `referralSlaScheduler.ts:153-164`.
- **RLS**: schedulers query bare `db()` without `app.clinic_id` set; row-bound `clinic_id` is propagated into each emit. Pattern: `appointmentReminderScheduler.ts:20-25`.
- **System actor**: pass literal string `'system'` per `referralSlaScheduler.ts:137` + pathologyService HL7-ingest precedent (CLAUDE.md §13 documented exception).

## Dedupe-key shapes (idempotency, §1.7 of plan)

- Pathology: `pathology-critical:<resultId>:<staffId>:fired-day:<YYYY-MM-DD>`
- MHA review: `mha-review:<table>:<orderId>:<bucket>` where bucket ∈ `T-7d|T-3d|T-1d|T-0d|T+1d-overdue`
- Prescription-repeat: `prescription-repeat:<prescriptionId>:<bucket>` where bucket ∈ `T-7d|T-1d|T+0-due|T+overdue`

## Test plan — RED first, all 19 tests

### BUG-372a (6 unit + 3 int)
TP-PA-1..6 unit: critical-row criteria; acknowledged-skip; non-critical-skip; fan-out; per-row failure isolation. TP-PA-INT-1..3: notifications row materialises; same-day dedupe; next-day re-emit.

### BUG-372b (7 unit + 3 int)
TP-MHA-1..7 unit: T-7d/T-3d/T-1d/T-0/T+overdue buckets; deleted/discharged skip; both-tables coverage. TP-MHA-INT-1..3.

### BUG-372c (6 unit + 3 int)
TP-PR-1..6 unit: bucket emission; repeats=0 skip; consumed≥repeats skip; cancelled-status skip; clozapine drug-class severity='critical'; fan-out. TP-PR-INT-1..3.

## Fix-registry anchors (17 total)

5 each (372a/b/c) + 2 cross-cycle (timer-safety + no-swallow). See plan §6 for the full table.

## Cascade-discovery (file atomically with 372a)

1. Clozapine FBC overdue scheduler
2. LAI due scheduler
3. Lithium-level overdue
4. ECT consent expiry
5. Advance-directive review-by
6. Clozapine `monitoring_week` schedule
7. Email channel for `notificationService`
8. Full `apps/api/src/features/legal/` feature (BUG-400 owns CRUD; we ship read-only repo here)

## Acceptance gates (per sub-cycle, NON-NEGOTIABLE per `feedback_wave_gate_discipline.md`)

- Pre-fix RED test FAILS on stub
- L1: tsc × 3 + 25 guards + 1147+ fix-registry anchors PASS (1130 + 17 BUG-372)
- L2: 3× flake on new tests + 0 regression vs §0.2 baseline
- L3: code-reviewer-general PASS
- L4: clinical-safety-reviewer PASS (clinical-safety surfaces)
- L5: architecture-reviewer PASS (new scheduler files; new `features/legal/` dir on 372b)
- 2-REJECT absorb cap default BLOCKED per `feedback_explicit_override_for_2reject_cap.md`
- Atomic catalogue flip + cascade BUGs filed atomically per `feedback_atomic_catalogue_flip.md`
- Explicit per-cycle user push authorization per `feedback_explicit_push_authorization.md`

## Rejected approaches (explicit, per `feedback_no_silent_out_of_scope.md`)

1. Add `repeats_remaining`/`next_repeat_due` columns — rejected; derive from `erx_tokens` instead.
2. BullMQ delayed jobs at exact T-7d etc. — rejected; sweep-cron + dedupe is simpler & self-heals.
3. Single combined `clinicalAlertScheduler.ts` — rejected per atomic-flip cap.
4. Email channel for staff — rejected; out of scope, filed as cascade-7.
5. Hardcoded 30-min pathology threshold — rejected; pull from `settingsService.getThresholds()`.
6. Per-clinic transaction loop with `app.clinic_id` set — rejected; deviates from precedent.
7. New `SystemAuthContext` type — rejected; use `actorId='system'` string per precedent.

See `/Users/drprakashkamath/Projects/Signacare/docs/archive/auto-execute-logs/BUG-372/plan-full.md` (this file) for the complete plan.
