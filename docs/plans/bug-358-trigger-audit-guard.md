# Plan — BUG-358: CI guard `check-trigger-has-audit-row`

## 1. Context

BUG-358 was catalogued in commit `48b3eae` (S3, Phase-0.5-follow-up, blocked_by BUG-357). The L4/L5 retrospective on BUG-354 identified a pattern gap: **every DB trigger that mutates a security-critical table must emit an `audit_log` row inside its function body**, but this is currently enforced only by code review.

BUG-354 forward-fix (aa1db68) landed the `ADMIN_SLOT_CLEARED_BY_TRIGGER` audit row on `clinics_access_admin_slot_integrity`. Future triggers (BUG-353 redo, BUG-362 reconciliation, clozapine triggers, prescribing triggers) must follow the same pattern. Without a mechanical guard, a new trigger function could ship without audit emission and silently create a HIPAA §164.312(b) / OWASP ASVS v4 §7.1.3 compliance gap.

**Goal:** add a static CI guard that scans every `CREATE FUNCTION ... RETURNS TRIGGER` definition in `apps/api/migrations/*.ts` and asserts its body contains `INSERT INTO audit_log`, OR the function is on an allowlist for documented exceptions (e.g. `set_updated_at`, `staff_can_see_specialty` — these are helper/read functions that don't mutate security-critical state).

## 2. Existing code to reuse

- **Existing CI guards** in `.github/scripts/check-*.sh` (bash) and `scripts/guards/check-*.ts` (typescript) — pattern is well-established. Pick bash for grep-heavy scans, TS for anything that needs AST analysis. This guard is pure regex, so bash.
- **`audit_trigger_fn` at `apps/api/migrations/20260701000000_baseline.ts:96-120`** — the canonical trigger that IS already audited (SECURITY DEFINER + INSERT INTO audit_log). Pattern the guard can look for as the "known-good" shape.
- **`clinics_access_admin_slot_integrity` at `20260423000007_access_admin_trigger_audit_log.ts`** — the BUG-354 forward-fix that proves the pattern compiles.
- **Existing CI guard whitelist idiom** (`grep -v`) used in `check-no-stray-db-names.sh` for documented exceptions.

## 3. Change surface

Two new files + one wire-up:

- **NEW** `.github/scripts/check-trigger-has-audit-row.sh` — bash script that:
  1. `git grep -E "CREATE (OR REPLACE )?FUNCTION [a-z_]+ *\(\s*\) *(RETURNS|AS \$\$|RETURNS TRIGGER)"` across `apps/api/migrations/*.ts`
  2. Extracts the function name + the full function body (between `$$` delimiters)
  3. For each function that returns `TRIGGER`, asserts `INSERT INTO audit_log` appears in the body OR the function name is on the allowlist
  4. Allowlist: `set_updated_at` (BEFORE UPDATE timestamp helper, no security relevance); `audit_trigger_fn` (IS the audit writer — recursion concern); `staff_can_see_specialty` (RLS helper); `is_prescribing_eligible_discipline` (discipline check, returns boolean, no state change); `validate_mrn_format`, `validate_medicare_format`, etc. (format validators). Precise allowlist determined by dry-run + manual review.
  5. On violation → exit 1 with file:line + function name + rationale.
- **NEW** `docs/plans/bug-358-trigger-audit-guard.md` (this file)
- **EDIT** `docs/fix-registry.md` — new anchor `R-FIX-BUG-358-TRIGGER-AUDIT-GUARD` pinning the guard script name or the core grep pattern.
- **EDIT** `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-358 state → fixed.

## 4. Test plan (TDD-style)

**L2.5 pre-fix FAIL:** write the guard. Run against a test fixture that omits `INSERT INTO audit_log` in a TRIGGER function — assert FAIL with specific file:line output.

**L2.5 post-fix PASS:** run against the current repo state — must PASS (baseline triggers are all either audit-emitting or on the allowlist).

**Adjacent: `npm run ci-guards`** (if such aggregator exists) or the merge-gate composite — all 18 guards (17 existing + this new one) must pass together.

## 5. Gate (per PART 13.1)

Non-risky-class (CI-guard-only, no production code, no migration, no auth):

- L1.1 tsc: N/A (bash script)
- L1.2 eslint: N/A (bash script)
- L1.3 all 17 existing guards: must stay green. This new guard MUST also pass in the same run (no self-incrimination).
- L1.4 fix-registry: new anchor added
- L2.5: guard PASS on current repo = proof. Manual dry-run against a synthetic violating fixture proves FAIL path works.
- L2.6: N/A (no runtime behaviour)
- L2.7: N/A
- **L3 code-reviewer: run** — the guard is defensive infrastructure, but not touching shared/db/auth. Non-risky per strict definition. Will run anyway for discipline.
- **L4 clinical-safety: run** — guard protects a clinical-safety invariant (HIPAA audit). Run.
- **L5 architecture: run** — Standard 2 (fail fast/loud) + Standard 4 (explicit) reinforcement. Run.

## 6. Explicit non-goals

- Not auditing runtime behaviour — this is a STATIC analysis on migration source.
- Not scanning `apps/api/migrations/20260701000000_baseline.ts` (the squashed baseline — per §12.4 `@migration-squashed-baseline` directive, the 437 raw calls in it are pre-existing and allowlisted).
- Not scanning `.sql` files in `apps/api/src/db/migrations/` — those were ledger-only and Knex-tracked `.ts` wrappers override.
- Not rewriting any existing trigger to add audit emission — if a trigger fires the new guard, FIX the trigger (follow-up BUG) instead of allowlisting silently.
- Not a CI guard for `check-no-unguarded-jwt-verify` (L5 BUG-356 recommendation) — that belongs in a different catalogued bug (recommend filing as BUG-364). Out of scope.
