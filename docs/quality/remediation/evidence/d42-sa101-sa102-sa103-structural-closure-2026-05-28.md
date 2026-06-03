# D42 Structural Closure — BUG-SA-101 / BUG-SA-102 / BUG-SA-103

**Date:** 2026-05-28  
**Scope:** Contract-level structural controls for API envelope convergence, row-interface coverage ratcheting, and allowlist debt governance.

## What Changed

1. Closed `BUG-SA-101` (API Contracts) with machine-enforced convergence:
   - Added shared envelope SSoT:
     - `packages/shared/src/apiEnvelope.schemas.ts`
     - canonical builders for list/detail/action envelopes.
   - Added operational envelope helpers:
     - `apps/api/src/shared/http/responseEnvelope.ts`
   - Added executable convergence guard:
     - `scripts/guards/check-api-envelope-contract.ts`
   - Added date-bound convergence contract:
     - `.github/api-envelope-contract.json`
   - Guard is wired into the discipline lane (`guard:claude-discipline`).

2. Closed `BUG-SA-102` (Guard Coverage) with explicit coverage ratchet:
   - Added executable coverage guard:
     - `scripts/guards/check-row-iface-coverage-contract.ts`
   - Added checkpoint contract:
     - `.github/row-iface-coverage-contract.json`
   - Uses `check-row-interface-matches-db` metrics and fails if:
     - `unbound` rises above checkpoint max
     - `verified` drops below checkpoint min
     - effective coverage drops below checkpoint floor
   - Guard is wired into the discipline lane.

3. Closed `BUG-SA-103` (Guard Debt) by making allowlist burn-down governable:
   - Existing executable contract remains authoritative:
     - `.github/allowlist-burndown-contract.json`
     - `scripts/guards/check-allowlist-burndown-contract.ts`
   - Added fix-registry anchors that tie SA-103 directly to this mechanism.

## Baseline Metrics Captured (2026-05-28)

- API envelope guard:
  - files scanned: `332`
  - total `res.json` calls: `1164`
  - object-literal envelopes: `734`
  - canonical (`data`/`ok`): `137`
  - non-canonical: `597`
  - legacy `items`: `26`
  - legacy `success`: `9`

- Row-interface coverage guard:
  - scanned: `369`
  - verified: `77`
  - exempt: `16`
  - unbound/skipped: `276`
  - effective coverage: `21.81%`

These are now pinned as checkpoint ceilings/floors in the contract files and fail-loud on regression.

## Gate Evidence (local)

- `npm run -s guard:api-envelope-contract` ✅
- `npm run -s guard:row-iface-coverage-contract` ✅
- `npm run -s guard:allowlist-burndown-contract` ✅
- `npm run -s guard:claude-discipline:ci` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s typecheck` ✅

## Closure Note

This is a structural close, not a cosmetic label change: all three bugs now have executable contracts and CI enforcement in the discipline lane. We have removed silent drift room and made convergence measurable with dated checkpoints.
