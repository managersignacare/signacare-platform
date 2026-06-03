# A2-2 Contract-Tightening Evidence — BUG-315 (2026-05-11)

## Scope

Lane `A2`, serial slice `A2-BUG-315-A2-2-CONTRACT-TIGHTENING-2026-05-11`:

1. Remove missing/null `clinical_notes.consent_id` write paths.
2. Promote `BUG-315` app-readiness from `pending` to `verified` only after
   guard-confirmed blocker count reaches zero.

## Contract Changes Landed

- `apps/api/src/shared/recordingConsent.ts`
  - added `ensureClinicalNoteConsent(...)`:
    - validates explicit consent IDs when provided,
    - reuses latest active consent for the patient/clinic when available,
    - creates clinician-attestation consent rows when none exist.
- `apps/api/src/features/clinical-notes/clinicalNote.repository.ts`
  - repository create now always resolves and writes non-null `consent_id`.
- `apps/api/src/features/clinical-notes/clinicalNote.service.ts`
  - service create now forwards optional `consentId` into repository create.
- `apps/api/src/features/patients/patientRoutes.ts`
  - all in-file `clinical_notes` insert paths now resolve/write `consent_id`:
    - `POST /:id/notes`
    - hotspot create/resolution note inserts
    - admission-waitlist timeline note inserts.
- `packages/shared/src/schemas/clinicalNote.schema.ts`
  - `CreateNoteSchema` now accepts optional `consentId`.
- `packages/shared/src/clinicalNote.Schemas.ts`
  - `CreateClinicalNoteInlineSchema` now accepts optional `consentId`.

## Guard Integrity Hardening

`scripts/guards/check-a2-not-null-app-readiness.ts` was tightened for BUG-315:

- scans all `patientRoutes` clinical-note insert blocks,
- fails when any insert omits `consent_id`,
- fails when any insert allows explicit null/`?? null` fallback,
- keeps repository create path checks.

This prevents a false-green state where one route is fixed but sibling insert
surfaces still violate A2-2 app-readiness requirements.

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

- `BUG-315` blocker count is now `0` in `guard:a2-not-null-app-readiness`.
- `.github/a2-not-null-readiness.json` target for `BUG-315` is promoted to:
  - `appReadinessStatus: "verified"`
  - evidence pointer to this artifact.
- Both A2-2 app-readiness targets are now `verified`; Phase C remains governed
  by `allowNotNullEnforcement=false` until explicit enforcement slice + safety
  gates are executed.
