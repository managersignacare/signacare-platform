# A2 Local Closeout Gate Pack (2026-05-12)

## Scope

- Lane: `A2`
- Slice: `A2-A2-CLOSEOUT-LOCAL-GATE-PACK-2026-05-12`
- Intent: produce a single-session local evidence bundle after A2-0..A2-4 implementation commits.

## Included A2 Implementation Commits

- `37b2dc05` — A2-0 BUG-355 ledger-truth checkpoint
- `ccfcb9fb` — A2-1 BUG-706 governance lock re-verification
- `295c1384` — A2-2 Phase A readiness guard
- `73827419` — A2-2 Phase B app-readiness contract guard
- `999b6c67` — A2-2 BUG-334 contract tightening
- `e5a5ab77` — A2-2 BUG-315 contract tightening
- `444ff5ab` — BUG-355 fail-closed operational-role SSoT guard
- `f7b03e86` — A2-2 Phase C NOT NULL enforcement closure
- `137f8bf2` — A2-3 BUG-287 hash-chain restoration
- `e257033b` — A2-4 DR smoke fingerprint stabilization

## Local Gate Verification (Single Serial Session)

1. `npm run guard:claude-discipline:ci`  
   Result: PASS
2. `npm run typecheck`  
   Result: PASS
3. `npm run migrate:rehearsal`  
   Result: PASS  
   Notes: `BUG-706` rollback failure is correctly governed as `approved-forward-fix-only` via ticket `BUG-706-FWD-FIX-APPROVAL-2026-05-09` (fail-closed policy path).
4. `npm run test:integration -w apps/api -- clinicalNotesConsentFK.int.test.ts limitCeilings.int.test.ts reportsRoutesHealth.int.test.ts auditLogHashChain.int.test.ts`  
   Result: PASS  
   Per-file:
   - `auditLogHashChain.int.test.ts`: 4/4
   - `clinicalNotesConsentFK.int.test.ts`: 5/5
   - `limitCeilings.int.test.ts`: 11/11
   - `reportsRoutesHealth.int.test.ts`: 4/4
5. `DR_DB_USER=postgres DR_DB_PASSWORD='' npm run dr:restore-drill`  
   Result: PASS (17/0)  
   Notes:
   - source schema fingerprint matched baseline (`c0d6972dfa7db170702f0a9120568c685477e4f2a2bf869b75e447c1ade9ab20`)
   - restored fingerprint drift accepted in non-strict mode (`DR_STRICT_RESTORED_SCHEMA_HASH=0`)
   - row-count parity and sample patient round-trip checks passed.

## Closure Boundary (What Is Still Required)

A2 implementation is complete for current in-scope backlog. Final bug closure remains blocked on rollout contract evidence only:

- Canary evidence (Azure internal ring)
- Burn-in completion (per policy window)
- Post-burn-in verification rerun
- No rollback-trigger events during burn-in

Applies to: `BUG-287`, `BUG-315`, `BUG-334`, `BUG-706`.

`BUG-288` remains `deferred-post-staging` unless explicit DB+Security signoff changes state.
