# B2 Evidence — BUG-404 Mandatory Instrument Field Enforcement

Date: 2026-05-14  
Lane: B1/B2/B3 (Command Consolidation)  
Bug: `BUG-404`  
Status: local implementation re-verified; rollout-closure pending

## Scope

`BUG-404` closes the structural gap where formal instrument assessments could be
saved without required completeness fields.

Enforced invariants:

1. HoNOS family (`honos`, `honos65`, `honosca`) requires complete item map `1..N`
with integer range checks.
2. Optional `totalScore` must equal derived item total when present.
3. Formal risk instruments (`C-SSRS`/`CSSRS`/`Columbia`/`HoNOS`) require
`totalScore`, `scoreBand`, `riskNarrative`, `riskManagementPlan`, and `reviewDate`.

## Structural Surfaces

- `packages/shared/src/outcome.Schemas.ts`
- `packages/shared/src/risk.schemas.ts`
- `apps/api/tests/integration/bug404AssessmentMandatoryFields.int.test.ts`

## Verification (2026-05-14)

1. `npm run test:integration -w apps/api -- tests/integration/bug404AssessmentMandatoryFields.int.test.ts`
   - PASS (`4/4`)
   - Rejects partial HoNOS payloads (`422`)
   - Accepts complete HoNOS payloads (`201`)
   - Rejects partial C-SSRS payloads (`400`)
   - Accepts complete C-SSRS payloads (`201`)
2. `npm run guard:claude-discipline:ci`
   - PASS

## Residual / Rollout Contract

Local engineering closure is complete. Catalogue flip remains gated on rollout
closure contract only:

1. Canary evidence attached.
2. Burn-in window complete.
3. Post-burn-in verification rerun linked.
