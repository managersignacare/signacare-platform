# Plan — BUG-362: stale-admin-slot reconciliation sweep

## 1. Context

BUG-354 (commit aa1db68) introduced the `clinics_access_admin_slot_integrity` trigger that NULLs `clinics.{nominated,delegated}_admin_staff_id` when the referenced staff transitions to an ineligible state (demote / deactivate / soft-delete / clinic-transfer) — but the trigger **only fires on NEW transitions**.

L4 clinical-safety retrospective on commit 80bc2ac flagged:
> Any clinic whose `clinics.nominated_admin_staff_id` or `delegated_admin_staff_id` currently points at a staff row where `is_active=false OR deleted_at IS NOT NULL OR role IN ('receptionist','readonly')` is a PRE-EXISTING stale-slot vulnerability the trigger will NOT self-heal.

The Layer A guard at `authGuards.ts:requirePatientRelationship` (BUG-351 R-FIX) denies the bypass at query time, so there is no active PHI leak. But the stale slot is still present in the DB — an audit of `clinics.nominated_admin_staff_id` shows an FK pointing at ineligible staff. Must be cleared.

## 2. Existing code to reuse

- **`clinics_access_admin_slot_integrity()`** at `apps/api/migrations/20260423000007_access_admin_trigger_audit_log.ts` — the canonical pattern. Same `ineligible` test + audit row shape I'll use for the reconciliation pass.
- **`AuditAction` union** at `apps/api/src/utils/audit.ts` — extend with `ADMIN_SLOT_CLEARED_RECONCILIATION` (parallel to `ADMIN_SLOT_CLEARED_BY_TRIGGER`).
- **Reconciliation-migration pattern** — one-time UPDATE + INSERT INTO audit_log combined in a single SQL statement with `RETURNING` so the audit row receives the pre-update context for each affected clinic.

## 3. Change surface (per-file)

- **NEW** `apps/api/migrations/20260423000008_reconcile_stale_admin_slots.ts` — one-off `up()` migration:
  - Collects every `clinics.id` where `nominated_admin_staff_id` or `delegated_admin_staff_id` points at ineligible staff (role in operational-only, is_active=false, deleted_at NOT NULL)
  - Emits one `audit_log` row per clearing via `INSERT INTO audit_log ... SELECT`, with `action='ADMIN_SLOT_CLEARED_RECONCILIATION'`, `new_data` JSONB `{staff_id, reason, slot}` matching the BUG-354 shape, `user_id = NULL` (this is a system reconciliation, not a clinician action)
  - NULLs the two FK columns in two UPDATEs
  - `down()`: no-op. Rolling back the reconciliation would re-create dangling pointers — worse than leaving them cleared. Document "irreversible one-off reconciliation; down() intentionally no-op." A `down()` marker IS still present for `migrate:rollback` compatibility.
- **EDIT** `apps/api/src/utils/audit.ts` — extend `AuditAction` union with `'ADMIN_SLOT_CLEARED_RECONCILIATION'`.
- **NEW** `apps/api/tests/integration/bug362StaleAdminSlotReconciliation.int.test.ts` — 3 scenarios:
  - T1 pre-migration: seed clinic with a demoted (receptionist) staff as nominated_admin; run migration; assert slot NULLed + audit row emitted with reason=`role_demoted`
  - T2: seed clinic with a deactivated (is_active=false) staff as delegated_admin; run migration; assert slot NULLed + reason=`deactivated`
  - T3: seed clinic with an ELIGIBLE staff (clinician, active) as nominated_admin; run migration; assert slot UNCHANGED (no false positive)
- **EDIT** `docs/fix-registry.md` — new anchor `R-FIX-BUG-362-STALE-ADMIN-SLOT-RECONCILIATION`
- **EDIT** `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-362 state → fixed

## 4. Test plan

**L2.5 TDD:**
- Pre-fix: the test integration scenarios cannot run until the migration exists. I'll write the tests first, point them at a migration file that doesn't yet exist → FAIL with "migration not applied". Then implement migration → PASS.
- This is slightly different from the usual pre-fix-FAIL trace because the unit under test (the migration's SQL) only runs once. The assertion is: after migration `up()`, the DB state matches expected.

**L2.6 adjacent suites:**
- `clinicalAccessRbac.int.test.ts` (17 tests) — no change expected; the migration only touches slots that were already stale, and Layer A guard already denied bypass for those
- `accessAdminSlotIntegrityTrigger.int.test.ts` (6 tests) + `accessAdminSlotIntegrityTriggerAudit.int.test.ts` (3 tests) — no change; the trigger still fires on NEW transitions, reconciliation doesn't affect future behaviour
- `clinicAccessAdminsPowerSettings.int.test.ts` (5 tests) — no change

**L2.7 flake:** run new suite ×3.

## 5. Gate (per PART 13.1)

Risky-class (db/ + migration + security-adjacent):

| # | Check | Apply |
|---|---|---|
| L1.1 | tsc api | must pass |
| L1.2 | eslint on touched files | 0 new errors |
| L1.3 | all 18 guards green (including BUG-358 which enforces audit emission on any NEW trigger — not applicable here since reconciliation is NOT a trigger, but BUG-358 should still pass) | must pass |
| L1.4 | fix-registry | new anchor added |
| L2.5 | TDD: test FAIL pre-migration (seed ineligible staff in slot, assert slot is NULL — FAIL before migration), PASS post-migration | must capture both traces |
| L2.6 | adjacent 4 suites | 44 tests green |
| L2.7 | flake ×3 | zero |
| L3 | code-reviewer-general | RUN — db/migration + auth-adjacent |
| L4 | clinical-safety-reviewer | RUN — clinical-access reconciliation |
| L5 | architecture-reviewer | RUN — db/ + auth/ |

## 6. Explicit non-goals

- Not changing the BUG-354 trigger behaviour — it already handles future transitions correctly.
- Not adding a `staff_active_check` view or similar abstraction — too much scope.
- Not emitting a separate ADMIN_SLOT_RECONCILIATION_RUN summary row (row-per-clearing is sufficient; summary lives in migration logs).
- Not running the reconciliation every N days — this is a one-off; future stale slots will be created and cleared by the BUG-354 trigger in the same transaction (no stale-slot window opens going forward).
