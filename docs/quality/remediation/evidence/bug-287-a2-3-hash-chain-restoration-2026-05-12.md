# BUG-287 A2-3 Hash-Chain Restoration Evidence (2026-05-12)

## Scope

- Lane: `A2` (Database Contract and Immutability Hardening)
- Slice: `A2-A2-3-BUG-287-HASH-CHAIN-RESTORATION-2026-05-12`
- BUG: `BUG-287`

## Implementation Artifacts

- `apps/api/migrations/20260701000062_bug_287_audit_log_hash_chain_restore.ts`
- `apps/api/tests/integration/auditLogHashChain.int.test.ts`

## Structural Outcome

1. Added `audit_log.prev_hash` and `audit_log.row_hash` (non-null enforced after backfill).
2. Added `audit_log_chain_baselines` with per-scope signed baseline marker `system_reconciliation_baseline`.
3. Restored historical chain deterministically for existing rows.
4. Added append-time chain trigger `trg_audit_hash_chain` for new rows (per-scope advisory lock).
5. Preserved BUG-039 immutability posture: bounded update-trigger lift only during backfill, then immediate re-enable.

## Verification Executed (Same Session)

- `npm run guard:claude-discipline:ci` => PASS
- `npm run typecheck` => PASS
- `npx eslint apps/api/migrations/20260701000062_bug_287_audit_log_hash_chain_restore.ts apps/api/tests/integration/auditLogHashChain.int.test.ts` => PASS
- `npm run migrate:dev -w apps/api` => PASS (`20260701000062_bug_287_audit_log_hash_chain_restore.ts` applied)
- `npm run test:integration -w apps/api -- auditLogHashChain.int.test.ts` => PASS (4/4)
- `npm run test:integration -w apps/api -- clinicalNotesConsentFK.int.test.ts limitCeilings.int.test.ts reportsRoutesHealth.int.test.ts` => PASS (5/5, 11/11, 4/4)
- `npm run migrate:rehearsal` => PASS (`BUG-706` approved-forward-fix-only policy still fail-closed)
- `npm run dr:restore-drill` => expected-red (missing expected schema fingerprint artifact)
- `npm run guard:dr-drill-fingerprint` => PASS

## Residual / Closure State

- `BUG-287` remains `open` in ledger until rollout closure contract completes:
  - canary evidence,
  - burn-in window,
  - post-burn-in verification rerun.
