# A3 Evidence — BUG-N2 Medicare IRN Mandatory (2026-05-12)

## Scope

- Lane: `A3` (Regulatory conformance ADHA/eRx/IHI)
- Bug: `BUG-N2`
- Requirement anchor: ADHA req `24065` (Medicare IRN mandatory)

## Root Cause

1. API boundary accepted IHI search payloads without `medicareIrn`.
2. HI Service client contract also modeled `medicareIrn` as optional.
3. This permitted non-compliant IHI search calls to reach integration logic.

## Structural Remediation

1. `apps/api/src/features/prescriptions/prescriptionController.ts`
   - `IhiSearchParamsSchema` now requires:
     - `medicareNumber` as `10-11` digits
     - `medicareIrn` as one digit `1-9`
2. `apps/api/src/integrations/hiService/hiServiceClient.ts`
   - `IhiSearchParams` interface now requires both `medicareNumber` and `medicareIrn`.
   - Added defensive runtime checks in `searchIhi()` for invalid/missing Medicare identifiers.
   - SOAP builder now always emits both Medicare card number and IRN fields in the IHI search payload.
3. Tests
   - Updated `hiServiceMtls.int.test.ts` to reflect mandatory IRN contract and added invalid-IRN guard proof.
   - Added `bugN2IhiSearchIrnRequired.int.test.ts` to pin route-level 422 rejection and valid payload acceptance.

## Verification

## L1

1. `npm run -s lint:changed` — PASS
2. `npm run -s typecheck` — PASS

## L2

1. `npm run guard:claude-discipline:ci` — PASS

## L4

1. `npm run test:integration -w apps/api -- hiServiceMtls.int.test.ts bugN2IhiSearchIrnRequired.int.test.ts` — PASS
   - `hiServiceMtls.int.test.ts`: `9/9`
   - `bugN2IhiSearchIrnRequired.int.test.ts`: `3/3`

## L5

1. `npx playwright test --project=chromium e2e/07-medications.spec.ts --grep "prescribe a new medication via the Prescribe dialog" --reporter=line` — PASS (`1/1`)

## Outcome

- `BUG-N2` implementation is complete in-repo with deterministic tests and gate pack.
- Per release contract, `BUG-N2` remains open until canary + burn-in + post-burn-in evidence is attached.
