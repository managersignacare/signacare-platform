# B1 Evidence — Episode Discharge Summary Clinic-Scope Hardening (2026-05-14)

Date: 2026-05-14  
Lane: B1 (episode/referral transition family residual)  
Scope: `BUG-EP-*` family phase-1 clinic-scope hardening on discharge-summary paths

## Objective

Close remaining id-only episode query/mutation surfaces in discharge-summary routes so tenant boundary stays explicit and deterministic.

## Changes Landed

Updated `apps/api/src/features/episode/episodeRoutes.ts`:

1. `POST /:id/discharge-summary/generate`
   - Draft-save update changed from id-only to clinic-scoped:
   - `where({ id: req.params.id, clinic_id: req.clinicId })`

2. `POST /:id/discharge-summary/submit`
   - Post-update episode fetch changed from id-only to clinic-scoped:
   - `where({ id: req.params.id, clinic_id: req.clinicId })`

This removes the remaining id-only path pair and prevents cross-tenant row materialization on the submit flow.

## Regression Proof

Added integration test:

- `apps/api/tests/integration/episodeDischargeSummaryClinicScope.int.test.ts`
  - cross-tenant submit attempt returns `404 Episode not found`
  - no `discharge_review` task side effect is created in caller clinic for foreign episode id

## Verification (same session)

- `npm run test:integration -w apps/api -- tests/integration/episodeDischargeSummaryClinicScope.int.test.ts` => PASS (`1/1`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Closure Posture

This evidence closes the local phase-1 clinic-scope residual for discharge-summary episode paths under the `BUG-EP-*` family.  
Family-level closure remains pending broader `BUG-EP-*` matrix/backlog completion and rollout closure contract.

