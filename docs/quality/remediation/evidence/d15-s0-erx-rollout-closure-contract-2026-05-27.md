# D15 S0 eRx Rollout Closure Contract (BUG-344, BUG-P1)

**Date:** 2026-05-27  
**Scope:** S0 backlog closure governance for `BUG-344` and `BUG-P1`  
**Mode:** Local revalidation complete; external rollout evidence pending

## 1) Local Revalidation (Completed)

### BUG-344 — ADHA conformance vectors
- Command:
  - `cd apps/api && npx vitest run tests/conformance/cts-v3-0-1-full/erxConformanceA5.test.ts`
- Result:
  - `60/60` tests passed.
- Interpretation:
  - Local conformance harness and expanded vector pack remain green after recent S0 slices.

### BUG-P1 — EoP redaction contract
- Commands:
  - `cd apps/api && npx vitest run tests/unit/bugP1EopRedaction.test.ts`
  - `npm run guard:eop-redaction`
- Results:
  - Unit tests: `3/3` passed.
  - Guard: `BUG-P1 guard passed.`
- Interpretation:
  - Token-path redaction contract remains intact (structural regression guard still effective).

## 2) Why These Rows Cannot Be Marked `fixed` Yet

Both bugs require external regulated integration evidence that cannot be proven in local-only runtime:
- ADHA sandbox / partner endpoint canary execution.
- Burn-in telemetry capture under production-like traffic.
- Post-burn-in rerun with signed closure evidence.

Without that packet, closure would be non-honest and violate rollout-governance discipline.

## 3) Mandatory External Closure Checklist

### BUG-344 closure steps
1. Canary run against ADHA sandbox endpoint with signed payload security mode enabled.
2. Capture request/response conformance traces for representative vector classes.
3. Burn-in window: monitor retry/error distributions and payload contract integrity.
4. Post-burn-in rerun: repeat the canary suite and compare deltas.
5. Attach evidence file and flip `BUG-344` from `in_progress` to `fixed`.

### BUG-P1 closure steps
1. Canary token-delivery flow using real outbound channel path.
2. Verify token-facing message/path excludes forbidden clinical fields.
3. Burn-in monitoring: no redaction contract regressions; no sensitive-field leakage.
4. Post-burn-in rerun with evidence snapshots.
5. Attach evidence file and flip `BUG-P1` from `in_progress` to `fixed`.

## 4) Closure Gate Rule

Do not mark either bug `fixed` until all three are present:
- Canary artifact
- Burn-in telemetry artifact
- Post-burn-in rerun artifact

This document is the explicit closure contract for those two S0 items.
