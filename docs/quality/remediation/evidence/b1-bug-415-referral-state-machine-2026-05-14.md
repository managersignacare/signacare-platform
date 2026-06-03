# B1 — BUG-415 Referral State-Machine Guard (2026-05-14)

## Scope

- Lane: `B1` (Command Consolidation / referral transition integrity)
- Bug: `BUG-415`
- Objective: block referral lifecycle regressions (example class: `DRAFT -> SENT -> DRAFT`) via one canonical transition guard enforced on all mutable paths.

## Structural Changes

1. Added canonical transition guard module:
   - `apps/api/src/features/referrals/referralStatusStateMachine.ts`
   - API: `assertReferralStatusTransition(fromStatus, toStatus)`
2. Enforced in repository mutation SSoT:
   - `apps/api/src/features/referrals/referralRepository.ts`
   - `updateReferral` now:
     - fast-paths non-status updates unchanged,
     - row-locks current referral (`FOR UPDATE`) for status updates,
     - validates transition before write.
3. Enforced in route sibling path:
   - `apps/api/src/features/referrals/referralRoutes.ts`
   - `PATCH /by-episode/:episodeId` now resolves current status and validates transition before applying update.

## Legacy Compatibility Policy

Legacy labels are normalized before transition checks to canonical values:

- `draft -> received`
- `sent -> pending_broadcast`
- `pending -> received`
- `acknowledged -> under_review`
- `in_review -> under_review`
- `closed -> closed_no_response`
- `completed -> appointment_booked`

This keeps historical state values compatible while still fail-closing illegal regressions.

## Regression Proof

- Unit: `apps/api/tests/unit/referralStatusStateMachine.test.ts`
  - no-op and forward transitions pass
  - legacy normalization path is exercised
  - terminal regressions and unknown-source states fail with transition error
- Integration: `apps/api/tests/integration/bug415ReferralStateMachine.int.test.ts`
  - route path: `PATCH /referrals/:id` accepts forward transition, rejects terminal regression
  - by-episode path: `PATCH /referrals/by-episode/:episodeId` rejects terminal regression
  - canonical post-decision progression (`accepted -> appointment_booked`) remains allowed

## Verification (2026-05-14)

- `npm run test -w apps/api -- tests/unit/referralStatusStateMachine.test.ts` => PASS (`5/5`)
- `npm run test:integration -w apps/api -- tests/integration/bug415ReferralStateMachine.int.test.ts` => PASS (`4/4`)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Closure Posture

Local implementation is complete. Bug remains open until rollout closure contract is satisfied:

- canary verification,
- burn-in window,
- post-burn-in evidence replay and catalogue flip.
