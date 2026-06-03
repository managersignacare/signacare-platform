# Class V2 Canonical Test Substrate Evidence

**Captured:** 2026-05-07  
**Scope:** local-only V2 slice (`V2-CANONICAL-TEST-SUBSTRATE`, seed singleton foundation)  
**Confidence labels:** per section

## Goal

Establish a canonical persona source of truth for test harness identity and
enforce singleton usage with mechanical guards.

## Changes

1. Added canonical persona fixture + idempotent seeder:
   - [canonical-personas.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/fixtures/canonical-personas.ts)
2. Migrated integration helper admin credential source:
   - [_helpers.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/_helpers.ts)
3. Added and wired singleton guard:
   - [check-canonical-persona-seed-singleton.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-canonical-persona-seed-singleton.ts)
   - [check-canonical-persona-seed-singleton.test.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/__tests__/check-canonical-persona-seed-singleton.test.ts)
4. Added seed scripts:
   - [apps/api/package.json](/Users/drprakashkamath/Projects/Signacare/apps/api/package.json)
   - [package.json](/Users/drprakashkamath/Projects/Signacare/package.json)

## Local Verification

### L1

- targeted ESLint on touched V2 files: PASS

### L2

- `npm run guard:canonical-persona-seed-singleton`: PASS
- `npm run guard:claude-discipline:ci`: PASS

### L3

- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-canonical-persona-seed-singleton.test.ts`: PASS (`3/3`)

### Runtime substrate check

- `npm run seed:canonical-personas`: PASS (`[seed-canonical-personas] done — 9 personas upserted`)

**Observed pre-existing warning during seed run:** `[BUG-216 drift] PHI-regex columns not in PHI_FIELDS ...`  
This warning is outside V2 seed-singleton scope and was not introduced by this slice.

**Confidence:** `HIGH` for all claims in this slice.

## Findings

### Finding V2-1 — credentials were duplicated in integration substrate

`_helpers.ts` previously hardcoded seeded admin credentials instead of
consuming a canonical fixture source.

**Confidence:** `HIGH`

### Finding V2-2 — canonical persona definition had no singleton guard

There was no mechanical check preventing multiple canonical persona exports
or direct literal fallback in integration helpers.

**Confidence:** `HIGH`

## Closure Judgment

`V2-CANONICAL-TEST-SUBSTRATE` seed-singleton foundation: **satisfied**.  
Remaining V2 scope (`400 vs 422` contract drift triage) is a separate follow-up slice.
