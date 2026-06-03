# A2-2 Contract-Tightening Evidence — BUG-334 (2026-05-11)

## Scope

Lane `A2`, serial slice `A2-BUG-334-A2-2-CONTRACT-TIGHTENING-2026-05-11`:

1. Remove null/omitted `clinics.hpio` write paths from app/API contracts.
2. Promote `BUG-334` app-readiness from `pending` to `verified` only after guard-confirmed blocker count reaches zero.

## Contract Changes Landed

- `packages/shared/src/clinic.schemas.ts`
  - `ClinicCreateSchema.hpio` is now required and non-null.
  - `ClinicUpdateSchema.hpio` remains optional but no longer nullable.
- `packages/shared/src/provisioning.schemas.ts`
  - `ProvisionClinicSchema.hpio` added as required.
- `apps/api/src/features/clinic/clinicService.ts`
  - `createClinic` now writes `hpio: dto.hpio` (no null fallback).
  - `updateClinic` now patches `hpio` only when a string is provided.
- `apps/api/src/features/provisioning/provisioningService.ts`
  - provisioning clinic insert now writes `hpio`.
- `apps/web/src/features/power-settings/components/OnboardingWizard.tsx`
  - onboarding payload now includes required `hpio`.
- `apps/web/src/features/settings/components/ErxConfigPanel.tsx`
  - save/load normalization moved to `undefined` for `hpio` (no `null` outbound patch value).

## Guard Integrity Hardening

During this slice, the `BUG-334` checker in
`scripts/guards/check-a2-not-null-app-readiness.ts` was tightened to avoid a
false positive where `hpio` was non-null but later fields in
`ClinicCreateSchema` were nullable/optional.

Regression coverage added:

- `scripts/guards/__tests__/check-a2-not-null-app-readiness.test.ts`
  - new case: non-null `hpio` with trailing nullable fields still yields
    `BUG-334: blockers=0`.

## Verification Commands

```bash
npx vitest run scripts/guards/__tests__/check-a2-not-null-app-readiness.test.ts
npm run guard:a2-not-null-readiness
npm run guard:a2-not-null-app-readiness
npm run lint:changed --silent
npm run typecheck
npm run guard:claude-discipline:ci --silent
```

## Result Summary

- `BUG-334` blocker count is now `0` in `guard:a2-not-null-app-readiness`.
- `.github/a2-not-null-readiness.json` target for `BUG-334` is promoted to:
  - `appReadinessStatus: "verified"`
  - evidence pointer to this artifact.
- `BUG-315` remains `pending` with active blockers; `A2-2 Phase C` remains
  blocked until that target is also verified.
