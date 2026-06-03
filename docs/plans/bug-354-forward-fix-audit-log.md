# Plan — BUG-354 forward-fix: audit_log emission on access-admin slot trigger

## 1. Context

Commit `72ab65f` shipped `clinics_access_admin_slot_integrity()` trigger that NULLs `clinics.{nominated,delegated}_admin_staff_id` when the referenced staff transitions to an ineligible state (demotion / deactivation / soft-delete / clinic transfer). Retroactive L4 + L5 reviews (2026-04-23) both flagged **missing audit_log emission**:

- **L4 BLOCK Rule 8 (graceful degradation)**: "the triggers silently mutate production-critical state… an on-call responding to 'Dr X complains they lost admin privileges at 14:07 UTC' opens the logs and finds only the outer `UPDATE staff SET role = 'receptionist' WHERE id = $1`. The cascading NULL of `clinics.nominated_admin_staff_id` is invisible."
- **L5 REJECT Standard 4 (explicit-over-implicit)**: "Both trigger functions must `INSERT INTO audit_log(...)` as part of the trigger body… Per HIPAA §164.312(b) (audit controls) and OWASP ASVS v4 §7.1.3 (record security-relevant events), automatic security controls MUST be recorded in the audit log."

This commit is the forward-fix. Since `72ab65f` is shipped and per `feedback_wave_gate_discipline.md` we never amend shipped commits, we ship a new migration that `CREATE OR REPLACE FUNCTION` the trigger function body with audit emission.

## 2. Existing code to reuse

Grep-verified, not invented:

- **`audit_trigger_fn` at `apps/api/migrations/20260701000000_baseline.ts:96-120`** — canonical pattern for DB-level audit-log inserts. `LANGUAGE plpgsql SECURITY DEFINER` + `EXCEPTION WHEN OTHERS RETURN COALESCE(NEW, OLD)` so audit failure never blocks the operation. I will mirror its shape (SECURITY DEFINER + EXCEPTION block).
- **`audit_log` table columns** (from `apps/api/src/db/schema-snapshot.json`): `id, clinic_id, staff_id, user_id, username, action, operation, module, entity_type, entity_id, table_name, record_id, details, old_data, new_data, ip_address, user_agent, created_at`. Writes must only use columns that exist (CLAUDE.md §1.1).
- **`AuditAction` union at `apps/api/src/utils/audit.ts:4-54`** — TS-side SSoT for action strings. Must extend it with `ADMIN_SLOT_CLEARED_BY_TRIGGER`. The DB's `audit_log.action` column has no CHECK constraint (verified — existing rows have values like `'contraindication_blocked'`, `'bug_039_trigger_update_probe'`, etc.).
- **Existing trigger function `clinics_access_admin_slot_integrity()`** at `apps/api/migrations/20260423000005_access_admin_slot_integrity_trigger.ts` — I will issue `CREATE OR REPLACE FUNCTION` on the SAME name. No `DROP TRIGGER` needed because the trigger references the function by name and `CREATE OR REPLACE FUNCTION` replaces the body in-place without breaking the trigger binding.
- **`current_setting('app.clinic_id', true)` + `current_setting('app.user_id', true)`** — already set by `rlsMiddleware` at `apps/api/src/middleware/rlsMiddleware.ts:47-52`. Available from within the trigger.
- **`@migration-raw-exempt: function_create` taxonomy category** — CLAUDE.md §12.4.

## 3. Change surface (explicit per-file edits; no abstractions)

- **NEW** `apps/api/migrations/20260423000007_access_admin_trigger_audit_log.ts` — migration with `up()` = `CREATE OR REPLACE FUNCTION clinics_access_admin_slot_integrity()` emitting one `audit_log` row per slot-clearing transition, then the slot UPDATE; `down()` = restores the original (BUG-354) function body without audit emission.
- **EDIT** `apps/api/src/utils/audit.ts` — extend `AuditAction` union with `'ADMIN_SLOT_CLEARED_BY_TRIGGER'`.
- **NEW** `apps/api/tests/integration/accessAdminSlotIntegrityTriggerAudit.int.test.ts` — integration suite appending to the existing BUG-354 coverage. Two new scenarios (the primary delta) + one regression scenario.
- **EDIT** `apps/api/src/db/schema-snapshot.json` — regenerated (no table-shape change but captures new function body / function definition; run `npm run db:snapshot`).
- **EDIT** `docs/fix-registry.md` — new anchor `R-FIX-BUG-354-AUDIT-LOG-EMISSION` pinning the audit-INSERT line in the new migration.

No code in `apps/api/src/features/*` is edited. The fix is purely at the DB + shared audit-type level.

## 4. Test plan

**Failing-test-first (TDD evidence for L2.5):**

1. Before the forward-fix migration runs: re-fire the trigger (e.g. demote a staff in integration test setup) and assert an `audit_log` row exists with `action = 'ADMIN_SLOT_CLEARED_BY_TRIGGER'` and `table_name = 'clinics'`. This test MUST FAIL against commit `72ab65f` (the baseline) — proving the pre-fix state. Capture the FAIL log in the commit body.
2. Apply the forward-fix migration locally. Re-run the same test — it MUST PASS.

**Scenarios in the new integration suite:**

| # | Setup | Action | Assertion |
|---|---|---|---|
| T1 | Clinic with nominated_admin_staff_id set to staff A | Demote A to receptionist | `audit_log` row exists with action=`ADMIN_SLOT_CLEARED_BY_TRIGGER`, table_name=`clinics`, record_id=clinic.id, new_data JSONB contains `staff_id`, `reason='role_demoted'`; slot is NULLed (existing BUG-354 behaviour still holds) |
| T2 | Clinic with delegated_admin_staff_id set | Deactivate the staff | audit row with reason=`deactivated`; slot NULLed |
| T3 | Clinic with nominated_admin_staff_id set | Change the staff's given_name (benign) | NO new audit_log row with `ADMIN_SLOT_CLEARED_BY_TRIGGER` action; slot UNCHANGED (existing T6 behaviour preserved) |

**Adjacent suites that must stay green:**

- `apps/api/tests/integration/accessAdminSlotIntegrityTrigger.int.test.ts` (existing 6 tests from BUG-354) — must all still pass.
- `apps/api/tests/integration/clinicalAccessRbac.int.test.ts` (17 tests) — access-admin join behaviour unchanged.
- `apps/api/tests/integration/clinicAccessAdminsPowerSettings.int.test.ts` (5 tests) — Power Settings flow unchanged.

**Flake check (L2.7):** run the new suite ×3 in isolation; zero flake required.

## 5. Gate (10 checks mandated by PART 13.1)

| # | Check | Expected outcome |
|---|---|---|
| L1.1 | tsc api + web + shared | 0 errors |
| L1.2 | eslint on touched files (`audit.ts`, new migration, new test) | 0 new `any`, 0 new silent `.catch`, 0 new `void asyncCall()` |
| L1.3 | All 17 CI guards | 14/17 PASS (3 pre-existing — naming-conv, no-silent-catches, no-stray-db-names in WARN — all in files I don't touch) |
| L1.4 | check-fix-registry | PASS, one new anchor `R-FIX-BUG-354-AUDIT-LOG-EMISSION` |
| L2.5 | Pre-fix FAIL trace + post-fix PASS trace in commit body | both quoted verbatim |
| L2.6 | Adjacent suites green | 3 listed above |
| L2.7 | Flake ×3 | zero |
| L3 | code-reviewer-general | RISKY-class (db/ + migration + auth-adjacent) — MUST RUN |
| L4 | clinical-safety-reviewer | RISKY (auth/session/RBAC path — access-admin slot management) — MUST RUN |
| L5 | architecture-reviewer | RISKY (shared/, db/, auth/) — MUST RUN |

Absorb rule applies: any REJECT/BLOCK → absorb before commit. Stop-rule at 2 consecutive REJECTs.

## 6. Explicit non-goals

- **Not wiring jwtBlacklist** (that's BUG-356 in a future commit).
- **Not adding trigger-audit-row CI guard** (that's BUG-358).
- **Not reconciling existing stale slots** (that's BUG-362).
- **Not extending to BUG-353 revocation trigger** (BUG-353 is parked; forward-fix applies only to BUG-354).
- **Not fixing the 10 pre-existing parseInt-without-radix / 4 silent-catch violations** (BUG-359 + BUG-360).
