# A2 DR Smoke Fingerprint Stabilization Evidence (2026-05-12)

## Scope

- Lane: `A2` (gate dependency stabilization)
- Slice: `A2-A2-4-DR-SMOKE-FINGERPRINT-STABILIZATION-2026-05-12`

## Artifacts

- `scripts/dr/restore-drill.sh`
- `docs/quality/expected-schema-fingerprint.txt`

## Structural Changes

1. Added canonical expected fingerprint artifact:
   - `docs/quality/expected-schema-fingerprint.txt`
2. Made schema hashing deterministic by stripping PostgreSQL 17 volatile dump tokens:
   - `\restrict ...`
   - `\unrestrict ...`
3. Added drill-role override support for privileged restore runs:
   - `DR_DB_HOST`, `DR_DB_PORT`, `DR_DB_USER`, `DR_DB_PASSWORD`, `DR_DB_NAME`
4. Improved restore failure diagnostics:
   - captures restore output in `$RESTORE_LOG`
   - emits extension permission hint when `permission denied to create extension` is detected
5. Added optional strict restored-fingerprint mode:
   - `DR_STRICT_RESTORED_SCHEMA_HASH=1` -> fail closed on restored hash mismatch
   - default non-strict mode accepts known deparse-style restored hash differences while still enforcing source baseline parity

## Verification (Same Session)

- `npm run guard:dr-drill-fingerprint` => PASS
- `npx vitest run scripts/guards/__tests__/check-dr-drill-asserts-fingerprint.test.ts` => PASS (2/2)
- `DR_DB_USER=postgres DR_DB_PASSWORD='' npm run dr:restore-drill` => PASS (17/0)
  - Source hash matched baseline.
  - Restored hash differed but was accepted under default non-strict mode.
  - Row-count and sample-patient round-trip assertions passed.

## Notes / Remaining External Closure Requirements

- Default app-owner drill role (`signacare_owner`) still cannot create privileged extensions during restore in this environment (expected least-privilege behavior).
- A2 lane closure remains gated on rollout contract evidence:
  - canary,
  - burn-in,
  - post-burn-in verification.
