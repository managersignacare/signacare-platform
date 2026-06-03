# Class A2 Bounded Audit Timeout Evidence

**Captured:** 2026-05-07  
**Scope:** local-only A2 runtime slice (`A2-BOUNDED-AUDIT-TIMEOUT`)  
**Confidence labels:** per section

## Goal

Bound the login-path audit wait so auth success does not inherit unbounded
latency from a degraded audit dependency.

## Changes

1. Login audit stage now wraps `writeAuditLog(...)` with
   `withTimeout(..., timeoutMs, 'login.writeAuditLog')` in
   [authController.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/auth/authController.ts).
2. Added env-driven timeout resolution (`LOGIN_AUDIT_TIMEOUT_MS`,
   default `2000ms`) in the same controller.
3. Added structural guard
   [check-bounded-await-in-login-path.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-bounded-await-in-login-path.ts)
   with fixture tests in
   [check-bounded-await-in-login-path.test.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/__tests__/check-bounded-await-in-login-path.test.ts).
4. Added auth-controller unit proof for timeout path in
   [authControllerAuditObservability.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/authControllerAuditObservability.test.ts)
   (`AC-3d`).

## Local Verification

### L1 / L2 / L3

- `npx tsc --noEmit -p apps/api/tsconfig.json` PASS
- targeted ESLint PASS on touched files
- `npx vitest run --config vitest.config.ts tests/unit/authControllerAuditObservability.test.ts` in `apps/api` PASS (`9/9`)
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-bounded-await-in-login-path.test.ts` PASS (`4/4`)
- `npx tsx scripts/guards/check-bounded-await-in-login-path.ts` PASS
- `npm run guard:claude-discipline:ci` PASS

**Confidence:** `HIGH`

### L4 runtime smoke (local)

- Started fresh API process on `PORT=4002`
- Health check PASS on `/health`
- Ran:
  `K6_BASE_URL=http://localhost:4002 k6 run --vus 1 --duration 20s scripts/k6/baseline.js`

Observed:

- `http_req_failed = 0.00%`
- login threshold PASS (`p95 < 400ms`)
- measured login `p95 = 108.37ms`

**Confidence:** `HIGH`

## Findings

### Finding A2-T1 — Login path no longer waits indefinitely on audit stage

Controller-level bounded timeout is in place and mechanically guarded.
Unit test proves a never-settling audit promise no longer blocks login.

**Confidence:** `HIGH`

### Finding A2-T2 — Slice is bounded and does not claim full A2 closure

This slice hardens login-stage wait behavior only. It does not yet
replace the existing outbox architecture or prove global timeout/fallback
semantics for every `writeAuditLog` caller.

**Confidence:** `HIGH`

## Closure Judgment

`A2-BOUNDED-AUDIT-TIMEOUT` local objective: **satisfied**.

## Recommended Next Slice

Proceed to an A2 follow-up that handles timeout-triggered replay/fallback
semantics in the shared audit writer path, while preserving dedupe
invariants added in the prior A2 foundation slice.
