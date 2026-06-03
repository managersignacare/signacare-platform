# D30 — S1 Closure Slice: WF71 Referral Safety Surfaces

**Date:** 2026-05-28  
**Owner:** Platform API  
**Bugs closed in this slice:** `BUG-WF71-UPLOAD-MIME-VALIDATION`, `BUG-WF71-ACK-EMAIL-MISSING`, `BUG-WF71-EXPIRY-SCHEDULER-MISSING`

## Scope

1. Confirm referral attachment ingestion is fail-closed for MIME/signature safety.
2. Confirm referral intake acknowledgment dispatch path is active and scheduler-backed.
3. Confirm 12-month referral expiry scheduler path is active with transition + notification writes.

## Regression proof run (local)

- `cd apps/api && npm run test:integration -- bugWf71ReferralAttachmentSafety.int.test.ts bugWf71ReferralAckEmail.int.test.ts bugWf71ReferralExpiryScheduler.int.test.ts`
  - PASS:
    - `bugWf71ReferralAttachmentSafety.int.test.ts` (2/2)
    - `bugWf71ReferralAckEmail.int.test.ts` (2/2)
    - `bugWf71ReferralExpiryScheduler.int.test.ts` (2/2)

## Implementation surfaces validated

- Attachment safety:
  - `apps/api/src/shared/referralAttachmentSafety.ts`
  - `apps/api/src/features/referrals/referralController.ts` (upload path)

- ACK dispatch + SLA backfill:
  - `apps/api/src/features/referrals/referralService.ts`
  - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`

- Expiry scheduler:
  - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
  - `apps/api/src/features/referrals/referralStateTransitionService.ts`

## Closure decision

These three referral S1 rows are marked **fixed** based on implementation completeness and passing integration proofs.

Operational SMTP/queue telemetry review stays in release verification checklists and does not block implementation-closure status in this backlog.
