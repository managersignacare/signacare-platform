# B3 — BUG-563 Treatment-Pathway Status State Machine (2026-05-14)

## Scope

- Lane: `B1/B2/B3` (treatment-pathway command integrity surface)
- Bug: `BUG-563`
- Objective: block invalid status regressions and block session writes against closed pathways.

## Structural Changes

1. Added canonical transition guard:
   - `apps/api/src/features/treatment-pathways/pathwayStatusStateMachine.ts`
   - API: `assertPathwayStatusTransition(fromStatus, toStatus)`
2. Enforced transition guard on PATCH update path:
   - `apps/api/src/features/treatment-pathways/pathwayService.ts`
   - `update(...)` now validates `existing.status -> dto.status` before write.
3. Enforced active-only gate on session-write path:
   - `apps/api/src/features/treatment-pathways/pathwayService.ts`
   - `recordSession(...)` now rejects non-active pathways with `422 INVALID_STATE_TRANSITION`.

## Transition Contract

- Allowed:
  - `active -> paused|completed|discontinued`
  - `paused -> active|completed|discontinued`
- Blocked:
  - `completed -> active`
  - `discontinued -> active`
- Session-write invariant:
  - `POST /pathways/:id/session` requires `status === active`

## Regression Proof

- Unit: `apps/api/tests/unit/pathwayStatusStateMachine.test.ts`
  - validates allowed transitions
  - validates terminal reopen rejection
  - validates no-op transitions
- Integration: `apps/api/tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts`
  - allows `active -> paused`
  - blocks `completed -> active`
  - blocks `discontinued -> active`
  - blocks session recording on completed pathways; confirms `completedSessions` remains unchanged
- Sibling no-regression replay:
  - `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts`

## Verification (2026-05-14)

- `npm run test -w apps/api -- tests/unit/pathwayStatusStateMachine.test.ts` => PASS (`4/4`)
- `npm run test:integration -w apps/api -- tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts` => PASS (`4/4`)
- `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` => PASS (`7/7`)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS

### Addendum — Command-Ownership Guard Debt Drain (2026-05-14)

- Removed stale treatment-pathway route write-bypass allowlist entries from:
  - `scripts/guards/check-controller-repo-write-bypass.allowlist`
- Rationale: pathway patch/session writes are already service-owned (`pathwayService.update` / `recordSession`), so prior `pathwayRoutes.ts -> pathwayRepository.update` bypass entries were obsolete.
- Verification:
  - `npm run guard:controller-repo-write-bypass` => PASS

## Closure Posture

Local implementation is complete. Bug remains open until rollout closure contract is satisfied:

- canary verification,
- burn-in window,
- post-burn-in evidence replay and catalogue flip.
