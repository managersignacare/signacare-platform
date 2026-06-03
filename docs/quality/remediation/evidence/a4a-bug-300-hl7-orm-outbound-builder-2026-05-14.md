# A4a BUG-300 Local Evidence — HL7 ORM^O01 Pharmacy Outbound Builder

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-300`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added canonical pharmacy HL7 builder/parser module:
   - `apps/api/src/integrations/hl7/hl7OrmBuilder.ts`
2. Outbound message builder contract:
   - `buildPharmacyOrmO01(...)` now emits HL7 v2.5 ORM^O01 segments:
     - `MSH`, `PID`, `ORC`, `RXO`, `RXE`
   - message escaping and deterministic timestamp formatting are handled in-module.
3. Transport integration contract:
   - `dispatchPharmacyOrmO01(...)` routes generated ORM messages through existing `dispatchHl7` transport SSoT (no transport fork).
4. Dispense confirmation parser contract:
   - `parseRdeO11DispenseConfirmation(...)` parses `RDE^O11` message control id, order number, order status, ack code, and dispense details.
   - fail-closed behavior on malformed messages:
     - missing `MSH` / `ORC`,
     - unsupported message type (`HL7_RDE_INVALID_MESSAGE_TYPE`).
   - partner-compat hardening includes ORC status fallback (`ORC-5` primary, `ORC-4` fallback) for dialect variance.
5. Regression coverage:
   - `apps/api/tests/unit/bug300Hl7OrmOutboundBuilder.test.ts` (`4/4`):
     - builder segment shape,
     - transport dispatch seam,
     - RDE parse success,
     - fail-closed parse for non-RDE message type.
   - `apps/api/tests/unit/hl7Transport.test.ts` (`5/5`) replayed to confirm transport behavior remains stable.

## Local Verification

1. `npm run test -w apps/api -- tests/unit/bug300Hl7OrmOutboundBuilder.test.ts tests/unit/hl7Transport.test.ts` => PASS (`9/9`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay canary partner-dialect sample ORM/RDE messages (mock and real partner fixtures) and confirm no parser/build drift.
2. Complete burn-in and post-burn-in verification per A4a lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.

