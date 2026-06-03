# D17 — S1 Closure Slice: WF61 Receipt / Invoice Email Dispatch

**Date:** 2026-05-28  
**Bug targeted:** `BUG-WF61-RECEIPT-EMAIL-MISSING`

## Scope

Wire billing-driven patient email notifications into the operational email worker path so receipt/invoice events are no longer silent.

## Implementation

- Extended email worker contract:
  - [apps/api/src/jobs/workers/emailWorkerService.ts](../../../../apps/api/src/jobs/workers/emailWorkerService.ts)
  - Added `EmailJobType = 'billing_notice'` with patient recipient resolution and billing-focused message builder.

- Wired billing events to email queue:
  - [apps/api/src/features/billing/billingService.ts](../../../../apps/api/src/features/billing/billingService.ts)
  - `recordPayment(...)` now enqueues `email` queue `billing_notice` job (patient-scoped receipt notification) after successful payment write.
  - `markInvoiceSent(...)` now enqueues `billing_notice` job (invoice-issued notification) when patient linkage exists.
  - Queue enqueue remains best-effort and non-blocking for payment persistence.

## Regression coverage

- [apps/api/tests/unit/emailWorkerService.test.ts](../../../../apps/api/tests/unit/emailWorkerService.test.ts)
  - added billing-notice send path test
  - added missing-`patientId` fail-closed test

- [apps/api/tests/unit/billingServiceReceiptEmail.test.ts](../../../../apps/api/tests/unit/billingServiceReceiptEmail.test.ts)
  - asserts payment success enqueues billing notice payload
  - asserts enqueue failure does not fail the payment write path

## Gate results (local)

- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/emailWorkerService.test.ts tests/unit/billingServiceReceiptEmail.test.ts` -> pass (2 files, 9 tests)
- `cd apps/api && npx tsc --noEmit` -> pass

## Remaining closure gate

- Staging replay with live SMTP/Outlook configuration and operator verification of delivered receipt/invoice emails for representative billing flows.
