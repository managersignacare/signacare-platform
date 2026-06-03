# D25 S1 Closure — BUG-ARCH-ALLOWLIST-TIMEBOMB-2026-12-31

**Date:** 2026-05-28  
**Bug:** `BUG-ARCH-ALLOWLIST-TIMEBOMB-2026-12-31`  
**Scope:** Proactive, machine-enforced burn-down governance for high-volume allowlist debt before expiry cliff.

## What Changed

1. Added canonical burn-down contract:
   - `.github/allowlist-burndown-contract.json`
   - Defines lane-level checkpoints for the highest-volume allowlists:
     - response-shape-validated
     - service-auth-context
     - soft-delete-filter
     - zod-schema-parity
     - jsonb-extraction
     - migration-index-discipline
   - Every lane has non-increasing `maxOpen` milestones ending at `0` by `2026-12-31`.

2. Added executable guard:
   - `scripts/guards/check-allowlist-burndown-contract.ts`
   - Validates:
     - contract schema/version + final deadline
     - lane uniqueness + milestone sort order
     - non-increasing `maxOpen`
     - final milestone reaches zero
     - live allowlist entry counts do not exceed current checkpoint budget

3. Wired guard into discipline lane:
   - `package.json`
   - Added script: `guard:allowlist-burndown-contract`
   - Added to `guard:claude-discipline` execution chain.

4. Added fix-registry anchors:
   - `R-FIX-BUG-ARCH-ALLOWLIST-TIMEBOMB-GUARD`
   - `R-FIX-BUG-ARCH-ALLOWLIST-TIMEBOMB-CONTRACT`

## Gate Evidence (local)

- `npm run -s guard:allowlist-burndown-contract` ✅
- `npm run -s guard:claude-discipline:ci` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s guard:bugs-remaining-uniqueness` ✅
- `npm run -s typecheck` ✅

## Closure Note

This closes the “timebomb” class as a structural control: high-volume allowlist
debt is now governed by date-bound budgets that fail-loud on drift. The debt
does not disappear instantly, but silent runway extension is blocked.
