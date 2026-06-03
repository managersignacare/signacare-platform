# B1/RF Phase-1 — Clarification Command Ownership Hardening (2026-05-14)

## Scope

Drain route-level repository write bypasses on referral clarification mutation surfaces:

- `POST /api/v1/referrals/:id/clarification`
- `PATCH /api/v1/referrals/:id/clarification-response`

## Why

`referralRoutes.ts` still performed direct write orchestration (`referralRepository.updateReferral` + `insertWorkflowEvent`) on controller/route surfaces, tracked in:

- `scripts/guards/check-controller-repo-write-bypass.allowlist` (4 referral-route entries)

This violated the command-ownership direction for B1/RF consolidation and left write behavior split between route handlers and service commands.

## Change

1. Moved clarification mutations to command methods in `referralClarificationCommands.ts`:
   - `requestClarification({ clinicId, userId, referralId, question })`
   - `applyClarificationResponse({ clinicId, userId, referralId, notes })`
2. Added deterministic not-found behavior (`AppError(404, NOT_FOUND)`) in service command boundary.
3. Kept status transition enforcement through repository state-machine guard path:
   - `received -> info_requested`
   - `info_requested -> under_review`
4. Kept workflow event emission + audit update semantics in service layer.
5. Drained 4 referral-route entries from `check-controller-repo-write-bypass.allowlist`.

## Verification (Same Session)

1. `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts`
   - PASS (`2/2`)
2. `npm run guard:controller-repo-write-bypass`
   - PASS (no controller-side direct repo write calls)
3. `npm run lint:changed`
   - PASS
4. `npm run typecheck`
   - PASS
5. `npm run guard:claude-discipline:ci`
   - PASS

## Outcome

For this RF clarification surface, write orchestration now flows through service commands rather than route-level repository writes, and the pre-existing allowlist debt for those bypasses is drained.
