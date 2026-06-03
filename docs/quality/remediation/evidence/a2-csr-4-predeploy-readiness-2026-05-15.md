# A2 CSR-4 Pre-Deployment Readiness Evidence (2026-05-15)

## Scope

- Phase: `CSR-4`
- Lane: `A2` (DB Contract + Immutability)
- Bugs in scope: `BUG-287`, `BUG-315`, `BUG-334`, `BUG-706`
- Goal: prove pre-deployment readiness (`R0`) without claiming rollout closure (`R1` remains open until canary/burn-in/post-burn-in).

## Blocker Found During CSR-4 Replay

1. `BUG-287` chain verifier failed in `auditLogHashChain.int` (`mismatch_count=1`).
2. Root cause: hash-chain trigger could produce a per-scope branch under concurrent/same-batch inserts (duplicate predecessor assignment).

## Structural Fix Applied

1. Added migration `apps/api/migrations/20260701000068_bug_287_hash_chain_scope_state_fix.ts`.
2. Added scope-state table `audit_log_chain_scope_state` to keep canonical per-scope tail hash.
3. Trigger now:
   - acquires scope advisory lock,
   - assigns `chain_ordinal` inside trigger via sequence,
   - uses scope-state tail as predecessor,
   - updates scope-state tail atomically.
4. Resealed historical rows by `chain_ordinal` and rebuilt scope state.
5. Strengthened regression test:
   - `apps/api/tests/integration/auditLogHashChain.int.test.ts`
   - F4 tail lookup uses `chain_ordinal DESC` (contract-aligned)
   - new F5 verifies same-batch inserts remain linear.

## Verification Commands and Results

1. `npm run test:integration -w apps/api -- tests/integration/auditLogHashChain.int.test.ts` → PASS (`5/5`)
2. `npm run test:integration -w apps/api -- tests/integration/clinicalNotesConsentFK.int.test.ts tests/integration/limitCeilings.int.test.ts tests/integration/reportsRoutesHealth.int.test.ts tests/integration/auditLogHashChain.int.test.ts` → PASS (`4/4 files`)
3. `npm run migrate:rehearsal` → PASS (`approved-forward-fix-only` posture enforced for `BUG-706`)
4. `npx eslint apps/api/migrations/20260701000068_bug_287_hash_chain_scope_state_fix.ts apps/api/tests/integration/auditLogHashChain.int.test.ts` → PASS
5. `npm run typecheck` → PASS
6. `npm run guard:all` → PASS

## CSR-4 Verdict

- `A2` is **R0-ready** for pre-deployment:
  - `BUG-287` local integrity blocker resolved structurally,
  - `BUG-315/334/706` local readiness remains green.
- `R1` rollout closure still pending for:
  - canary evidence,
  - burn-in evidence,
  - post-burn-in rerun evidence.

