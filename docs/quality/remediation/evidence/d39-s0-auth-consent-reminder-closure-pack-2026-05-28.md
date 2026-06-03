# D39 S0 Closure Pack — Auth/Reset + Consent + Reminder Safety

**Date:** 2026-05-28  
**Scope:** `BUG-WF42-EMAIL-WORKER-STUB`, `BUG-WF22-PWD-RESET-MISSING`, `BUG-WF52-SUICIDE-ALERT-MISSING`, `BUG-WF21-OTP-CAP-MISSING`, `BUG-WF41-SLOT-RACE`, `BUG-WF42-CANCEL-CLEANUP-MISSING`, `BUG-WF51-ATTESTATION-BYPASS`, `BUG-WF51-CONSENT-REVOKE-RACE`, `BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT`, `BUG-ARCH-PATIENTAPP-ACTIVATION-ATTEMPT-CAP`.

## Validation runbook (local L2/L3/L4 proof)

### Integration suite

- `npm run -w apps/api test:integration -- passwordResetFlow.int.test.ts mfaAttemptCap.int.test.ts appointmentSlotUniqueness.int.test.ts appointmentCancelReminderCleanup.int.test.ts ambientNoteConsentGate.int.test.ts bug417AiDraftSignAttestation.int.test.ts rateLimiting.test.ts` ✅

### Email worker + billing-notice proof

- `npm run guard:email-worker-not-stub` ✅
- `npx vitest run apps/api/tests/unit/emailWorkerService.test.ts apps/api/tests/unit/billingServiceReceiptEmail.test.ts` ✅
- `npm run -w apps/api test:integration -- bugWf61ReceiptEmail.int.test.ts` ✅

### Supporting checks

- `npm run guard:bugs-remaining-uniqueness` ✅
- `npm run guard:bug-closure-record-schema` ✅

## Closure basis by bug

- `BUG-WF42-EMAIL-WORKER-STUB`: worker no longer stubbed; dispatch path and billing-notice queueing proven by unit + integration + structural guard.
- `BUG-WF22-PWD-RESET-MISSING`: password reset request/confirm endpoint flow proven in `passwordResetFlow.int.test.ts`.
- `BUG-WF52-SUICIDE-ALERT-MISSING`: server-side high-risk trigger path proven in `bugWf52AssessmentSuicideRiskEscalation.int.test.ts` (run in S1/S0 packs in this cycle).
- `BUG-WF21-OTP-CAP-MISSING`: OTP/MFA attempt cap proven in `mfaAttemptCap.int.test.ts`.
- `BUG-WF41-SLOT-RACE`: DB unique active-slot enforcement proven in `appointmentSlotUniqueness.int.test.ts`.
- `BUG-WF42-CANCEL-CLEANUP-MISSING`: queued reminder cleanup on cancel proven in `appointmentCancelReminderCleanup.int.test.ts`.
- `BUG-WF51-ATTESTATION-BYPASS`: fail-closed sign-attestation enforcement proven in `bug417AiDraftSignAttestation.int.test.ts`.
- `BUG-WF51-CONSENT-REVOKE-RACE`: mid-flow consent re-check and fail-closed behavior proven in `ambientNoteConsentGate.int.test.ts`.
- `BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT`: rate-limit enforcement on patient login proven in `rateLimiting.test.ts`.
- `BUG-ARCH-PATIENTAPP-ACTIVATION-ATTEMPT-CAP`: activation attempt cap proven in `rateLimiting.test.ts`.

## Note on deployment evidence

Operational canary/telemetry replay remains part of deployment runbooks, but code-level safety closure and regression proof for the above defects is complete in this cycle.
