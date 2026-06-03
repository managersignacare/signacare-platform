# A4a BUG-337 Local Evidence — HPI-O Validator SSoT Convergence

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-337`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Removed local HPI-O regex drift from eRx payload builder:
   - `apps/api/src/integrations/escript/erxRestPayloads.ts`
   - Deleted file-local `HPIO_FORMAT` regex.
2. Switched to canonical shared identifier validation:
   - Added import from `apps/api/src/shared/hiNumbers.ts`:
     - `HI_PREFIX`
     - `validateHiNumber`
   - Payload gate now uses `validateHiNumber(c.hpio, HI_PREFIX.HPI_O)`.
3. Regression test hardening:
   - `apps/api/tests/integration/erxHpioValidation.int.test.ts`
   - Added `T6b` for bad-Luhn HPI-O rejection (same shape/prefix, invalid checksum).
   - Updated `T9` to assert current A2 Phase-C contract (`clinics.hpio` NOT NULL rejects omitted value).

## Local Verification

1. `npm run test:integration -w apps/api -- tests/integration/erxHpioValidation.int.test.ts` => PASS (`10/10`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay eRx canary prescribing paths for a clinic with valid HPI-O and attach evidence.
2. Complete burn-in and post-burn-in verification per lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.
