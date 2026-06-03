# A4b BUG-313 Local Evidence — Third-Party Logger PHI Audit

**Date:** 2026-05-14  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-313`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Shared third-party DB error-audit hooks:
   - `apps/api/src/shared/thirdPartyErrorAudit.ts`
   - `registerKnexQueryErrorAudit(...)`:
     - attaches fail-visible `query-error` logging on knex pools
     - logs via pino with `err` object (BUG-267 serializer path), never raw `err.message`
     - captures only structural query metadata (`sqlVerb`, query/connection ids), no bindings payload
   - `registerPgClientErrorAudit(...)`:
     - attaches fail-visible `error` listener on pg client connections
     - logs via pino with `err` object and pool role tag
   - both hooks are idempotent to prevent duplicate listener registration.
2. DB layer wiring:
   - `apps/api/src/db/db.ts`
   - hooked audit module into:
     - app-user pool
     - read-replica pool
     - admin pool
   - per-connection pg error listeners now register during `afterCreate`.
3. BullMQ/worker-path hardening:
   - updated worker/queue failure logging to pass raw error objects:
     - `apps/api/src/features/patient-outreach/patientOutreachWorker.ts`
     - `apps/api/src/queues/ocrQueue.ts`
     - `apps/api/src/jobs/workers/hl7Worker.ts`
     - `apps/api/src/jobs/workers/aiWorker.ts`
     - `apps/api/src/jobs/bootstrap.ts`
     - `apps/api/src/features/patient-outreach/adminAlert.ts`
   - removed `err.message` logger metadata/template interpolation on these third-party paths.
4. New fail-closed regression guard:
   - `scripts/guards/check-third-party-error-audit.ts`
   - npm script: `guard:third-party-error-audit`
   - integrated into global `guard:all`
   - guard contract blocks worker/queue/bootstrap logger usages that pass `err.message` instead of `err` object.
5. Regression tests:
   - `apps/api/tests/unit/bug313ThirdPartyErrorAudit.test.ts` (3 tests)
   - `scripts/guards/__tests__/check-third-party-error-audit.test.ts` (3 tests)

## Local Verification

1. `npm run test -w apps/api -- tests/unit/bug313ThirdPartyErrorAudit.test.ts` => PASS
2. `npm run test:guards -- --run scripts/guards/__tests__/check-third-party-error-audit.test.ts` => PASS
3. `npm run guard:third-party-error-audit` => PASS
4. `npm run lint:changed` => PASS
5. `npm run typecheck` => PASS
6. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary log review confirms no PHI-bearing third-party error signatures on knex/pg/BullMQ paths.
2. Burn-in and post-burn-in verification completed per A4b lane closure contract.
3. Catalogue row flips only after rollout evidence packet is attached.

