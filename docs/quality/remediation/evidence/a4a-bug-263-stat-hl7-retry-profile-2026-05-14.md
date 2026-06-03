# A4a BUG-263 Local Evidence — HL7 STAT Retry + Early Alert Profile

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-263`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added canonical HL7 urgency retry profile SSoT:
   - `apps/api/src/integrations/hl7/hl7OutboundRetryProfile.ts`
   - profiles:
     - `routine` / `urgent`: `attempts=5`, exponential `delay=30_000`, no early alert
     - `stat`: `attempts=3`, exponential `delay=10_000`, `alertAtAttempt=2`
2. Wired enqueue-time urgency profile application:
   - `apps/api/src/features/pathology/pathologyService.ts`
   - `placeOrder(...)` now:
     - computes retry profile from order urgency,
     - applies profile attempts/backoff per job,
     - includes `urgency` in outbound queue payload for worker-side failure policy.
3. Wired failed-attempt policy for early STAT signaling:
   - `apps/api/src/jobs/workers/hl7Worker.ts`
   - extracted `handleOutboundHl7JobFailure(...)` to centralize failure semantics.
   - fixed inline-handled filter to skip only true unrecoverables (`NOT_CONFIGURED`, `PROTOCOL_UNSUPPORTED`).
   - emits `integration_unreachable` alert on STAT failed attempt `2` (`retryProfile: stat`, `alertReason: retry-threshold-breached`) while retries continue.
4. Added regression coverage:
   - `apps/api/tests/unit/bug263Hl7RetryProfile.test.ts` (`2/2`) pins urgency-profile constants.
   - `apps/api/tests/integration/hl7Transport.int.test.ts` (`4/4`) adds explicit BUG-263 assertion for attempt-2 early alert payload.

## Local Verification

1. `npm run test -w apps/api -- tests/unit/bug263Hl7RetryProfile.test.ts` => PASS (`2/2`)
2. `npm run test:integration -w apps/api -- tests/integration/hl7Transport.int.test.ts` => PASS (`4/4`)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay canary STAT pathology order failures and verify attempt-2 early alert routing in operations telemetry.
2. Complete burn-in and post-burn-in verification per A4a lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.

