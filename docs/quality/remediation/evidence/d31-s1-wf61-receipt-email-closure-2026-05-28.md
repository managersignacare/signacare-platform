# D31 — S1 Closure: BUG-WF61-RECEIPT-EMAIL-MISSING

**Date:** 2026-05-28  
**Bug:** `BUG-WF61-RECEIPT-EMAIL-MISSING`  
**Severity:** S1  
**Scope:** Billing receipt/invoice email dispatch proof at service + API integration layers.

## What Was Completed

1. Added endpoint-level integration coverage for billing email dispatch:
   - New file: `apps/api/tests/integration/bugWf61ReceiptEmail.int.test.ts`
2. Verified `recordPayment` emits a `billing_notice` email job containing:
   - `clinicId`, `patientId`, `invoiceId`, `paymentId`
   - Title containing `Payment receipt`
3. Verified `markInvoiceSent` emits a `billing_notice` email job containing:
   - `clinicId`, `patientId`, `invoiceId`
   - Title `Invoice issued — <invoiceNumber>`
4. Fixed teardown integrity in the new integration test:
   - Removed invalid `clinic_id` predicate on `invoice_line_items` cleanup to avoid transaction-abort residue.

## Gate Evidence

- `npm run guard:email-worker-not-stub` -> **PASS**
- `cd apps/api && npx vitest run tests/unit/emailWorkerService.test.ts tests/unit/billingServiceReceiptEmail.test.ts` -> **PASS** (2 files, 9 tests)
- `cd apps/api && npm run test:integration -- bugWf61ReceiptEmail.int.test.ts` -> **PASS** (1 file, 2 tests)

## Outcome

`BUG-WF61-RECEIPT-EMAIL-MISSING` is closed with deterministic local proof across queue producer logic and API route behavior.  
Delivery-provider uptime/credentials remain an operations concern handled by environment/runbook controls, not a product-code gap for this bug.

