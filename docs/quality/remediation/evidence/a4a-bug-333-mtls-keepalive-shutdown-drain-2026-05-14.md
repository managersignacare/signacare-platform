# A4a BUG-333 Local Evidence — mTLS Keep-Alive Shutdown Drain

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-333`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added canonical mTLS keep-alive drain API:
   - `apps/api/src/shared/mtls.ts`
   - new runtime function `drainMtlsAgentCacheForShutdown()` destroys and clears all cached keep-alive agents.
2. Wired graceful shutdown hook for mTLS drain:
   - `apps/api/src/server.ts`
   - new hook `mtls-agent-drain` at priority `45` invokes `drainMtlsAgentCacheForShutdown()` before DB/Redis teardown.
3. Converged eRx Adapter to shared mTLS cache:
   - `apps/api/src/integrations/escript/erxAdapterClient.ts`
   - replaced local per-file `httpsAgent` cache with shared `createMtlsAgent(...)` so shutdown drain covers this integration too.
4. Added regression-proof test:
   - `apps/api/tests/mtlsHelper.test.ts`
   - `T6` seeds cached agents, runs shutdown drain, asserts both agents are destroyed and cache size is zero.

## Local Verification

1. `npm run test -w apps/api -- tests/mtlsHelper.test.ts` => PASS (`6/6`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay canary integration flows that exercise outbound mTLS clients (HI/NPDS/eRx adapter path).
2. Complete burn-in and post-burn-in verification per A4a lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.
