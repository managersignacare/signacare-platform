# A3 BUG-P1 — Electronic EoP Content Redaction Evidence (2026-05-15)

## Scope

Close local implementation work for `BUG-P1` by separating token-facing EoP output from full clinical XML and enforcing regression-proof redaction for token delivery surfaces.

## Implementation Summary

1. Split eRx XML builders in [apps/api/src/integrations/escript/erxRestPayloads.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/integrations/escript/erxRestPayloads.ts):
   - `buildClinicalXml(...)` for full clinical submit/cancel/amend/reactivate flows.
   - `buildTokenEoPXml(...)` for token-facing payloads containing only `SCID`, `DSPID`, and `Token`.
2. Hardened token delivery renderers in [apps/api/src/integrations/escript/tokenDeliveryService.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/integrations/escript/tokenDeliveryService.ts):
   - added `buildRedactedEopSmsBody(...)` and `buildRedactedEopEmailHtml(...)`
   - output is token-identifier only; no patient/demographic/medication/prescriber fields
   - fixed sender identity seam: Outlook send path now uses `actorId` as `staffId`
3. Updated request contract in [apps/api/src/features/prescriptions/prescriptionController.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/prescriptions/prescriptionController.ts) for redacted token-delivery shape (`scid`/`dspId`, channel safety check).
4. Added structural regression guard:
   - [scripts/guards/check-eop-redaction.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-eop-redaction.ts)
   - validates token EoP required tags and blocks forbidden clinical fields/leaks.
5. Added guard + product regression tests:
   - [scripts/guards/__tests__/check-eop-redaction.test.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/__tests__/check-eop-redaction.test.ts)
   - [apps/api/tests/unit/bugP1EopRedaction.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/bugP1EopRedaction.test.ts)
6. Wired guard into discipline chain in [package.json](/Users/drprakashkamath/Projects/Signacare/package.json):
   - added `guard:eop-redaction`
   - included in `guard:claude-discipline`

## Verification Commands

1. `npm run guard:eop-redaction`
2. `npm run test:guards -- --run scripts/guards/__tests__/check-eop-redaction.test.ts`
3. `npm run test -w apps/api -- tests/unit/bugP1EopRedaction.test.ts`
4. `npm run lint:changed`
5. `npm run typecheck`
6. `npm run guard:claude-discipline:ci`

## Verification Results

- `npm run guard:eop-redaction` => PASS
- `npm run test:guards -- --run scripts/guards/__tests__/check-eop-redaction.test.ts` => PASS (`3/3`)
- `npm run test -w apps/api -- tests/unit/bugP1EopRedaction.test.ts` => PASS (`3/3`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## BUG Ledger State

- `BUG-P1`: local implementation + mechanical guard + regression tests landed.
- Final closure still requires canary/burn-in/post-burn-in rollout evidence per program closure contract.
