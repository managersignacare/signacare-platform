# B2 BUG-289 Evidence Packet — Prescriber Allow-List Expansion

**Date:** 2026-05-13  
**Lane:** B2 (Medication and Prescribing Workflow Engine)  
**Bug:** `BUG-289`  
**Scope class:** Class F app-behavior + Class M function-level DB contract update (shared SSoT function replacement)  
**Status:** implementation complete-in-repo; rollout closure pending

## 1) Problem Statement

`BUG-040` shipped a strict prescribing discipline barrier with a narrow initial allow-list suitable for mental-health rollout. As prescribing scope widened, legitimate non-mental-health specialist prescribers were blocked at both app and DB layers because all enforcement paths consume the same SSoT function `is_prescribing_eligible_discipline(...)`.

## 2) Structural Remediation Landed

1. Replaced SSoT function through migration:
   - `apps/api/migrations/20260701000063_bug_289_prescriber_discipline_allowlist_expansion.ts`
2. Expanded allow-list to include:
   - `internal-medicine`
   - `general-medicine`
   - `endocrinology`
   - `paediatrics`
   - `obstetrics-gynaecology`
   - `general-surgery`
   - `medical-oncology`
3. Hardened normalization in SSoT function:
   - lower + trim
   - collapse non-alphanumeric runs to `-`
   - trim leading/trailing dashes
4. Extended integration test matrix:
   - `apps/api/tests/integration/prescriberDisciplineBarrier.int.test.ts`
   - added specialist-allow assertions and app-layer parity assertion

## 3) Safety Invariants Preserved

1. Non-prescribing disciplines remain blocked with canonical BUG-040 error semantics.
2. NULL-discipline prescriber rows remain fail-closed in trigger path.
3. Single SSoT policy remains shared by:
   - app-layer `requirePrescribingDiscipline`
   - patient-medication trigger barrier
   - prescriptions trigger barrier
   - clozapine trigger barriers

## 4) Local Verification (L1/L2/L4)

1. `npm run lint:changed`  
   Result: PASS
2. `npm run typecheck`  
   Result: PASS
3. `npm run guard:claude-discipline:ci`  
   Result: PASS
4. `cd apps/api && npm run migrate:dev`  
   Result: PASS  
   Evidence: `Batch 73`, applied `20260701000063_bug_289_prescriber_discipline_allowlist_expansion.ts`
5. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/prescriberDisciplineBarrier.int.test.ts`  
   Result: PASS (`17/17`)

### Determinism Note

An initial L4 run before applying the new migration failed on newly-allowed specialist cases (expected: old function definition still active in local DB). After `migrate:dev`, the same suite passed (`17/17`), confirming behavior is driven by schema/migration state rather than brittle test assumptions.

## 5) Residual / Closure Posture

`BUG-289` remains **open** until rollout closure contract is satisfied:

1. Azure canary evidence attached
2. Burn-in window complete
3. Post-burn-in verification rerun attached
4. No rollback triggers in burn-in window
