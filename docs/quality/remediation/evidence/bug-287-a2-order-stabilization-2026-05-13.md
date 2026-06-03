# BUG-287 A2 Order Stabilization Evidence (2026-05-13)

## Scope

- Lane: `A2`
- Bug: `BUG-287`
- Change type: structural hardening (no symptom-only patch)

## Problem Reproduced

- `auditLogHashChain.int.test.ts` failed in `F3` with `mismatch_count=118`.
- `limitCeilings.int.test.ts` timed out in `beforeAll` (360000ms).
- Diagnostics showed drift concentrated in bulk `DELETE` audit rows sharing identical timestamps.

## Root Cause

1. Hash validation ordered rows by `(created_at, id)`.
2. Append trigger linked by "latest tail" lookup, not deterministic insertion ordinal.
3. Multi-row inserts with equal `created_at` (for example audit trigger bursts) could fork chain linkage.
4. Tail lookup performance degraded under high insert volume due non-ordinal predecessor search.

## Structural Fix

- Added migration: `apps/api/migrations/20260701000067_bug_287_hash_chain_order_stabilization.ts`
  - Introduced `audit_log.chain_ordinal` (deterministic global insertion order).
  - Added sequence-backed default for new rows.
  - Added indexes:
    - `idx_audit_log_chain_ordinal_unique`
    - `idx_audit_log_chain_scope_ordinal_desc`
  - Replaced hash predecessor lookup to `scope + chain_ordinal < NEW.chain_ordinal`.
  - Re-sealed existing chain data to deterministic ordinal order.
  - Preserved BUG-039 immutability by bounded trigger lift/re-enable for backfill only.
- Updated integration proof:
  - `apps/api/tests/integration/auditLogHashChain.int.test.ts`
  - F3 now validates end-to-end chain against `chain_ordinal` order.

## Verification (same session)

- `npm run migrate:dev -w apps/api` => PASS (applied `20260701000067...`)
- `npm run test:integration -w apps/api -- tests/integration/auditLogHashChain.int.test.ts` => PASS (4/4)
- `npm run test:integration -w apps/api -- tests/integration/limitCeilings.int.test.ts` => PASS (11/11)
- `npm run test:integration -w apps/api -- tests/integration/clinicalNotesConsentFK.int.test.ts tests/integration/limitCeilings.int.test.ts tests/integration/reportsRoutesHealth.int.test.ts tests/integration/auditLogHashChain.int.test.ts` => PASS (5 + 11 + 4 + 4)
- `npm run migrate:rehearsal -w apps/api` => PASS (`BUG-706` approved-forward-fix-only contract preserved)
- `npm run guard:a2-not-null-readiness` => PASS
- `npm run guard:a2-not-null-app-readiness` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Closure Posture

- Local engineering blocker is resolved.
- `BUG-287` remains `open` until rollout closure contract completes (canary + burn-in + post-burn-in evidence).
