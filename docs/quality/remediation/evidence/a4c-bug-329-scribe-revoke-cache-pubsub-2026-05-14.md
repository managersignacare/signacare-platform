# A4c BUG-329 Local Evidence — Scribe Revoke-Cache Cross-Process Invalidation

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-329`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added canonical Redis pub/sub bridge for revoke-cache invalidation.
   - New module: `apps/api/src/shared/scribeConsentRevokePubSub.ts`
   - Channel: `scribe-consent-revoke-cache-invalidation:v1`
   - Publisher emits structured payload:
     - `consentId`
     - `clinicId`
     - `source`
     - `revokedAt`
   - Subscriber validates payload shape and drops malformed messages fail-closed.
   - Subscriber startup is bounded-failure: if Redis pub/sub attach fails, runtime falls back to the existing short TTL cache behavior.

2. Recording-consent SSoT now owns the bridge API.
   - `apps/api/src/shared/recordingConsent.ts` additions:
     - `startConsentRevokeCachePubSubBridge()`
     - `publishConsentRevokedCacheInvalidation(consentId, clinicId)`
     - `__stopConsentRevokeCachePubSubBridgeForTests()`
   - Inbound pub/sub messages call `markConsentRevokedInCache(consentId)` so each process updates local in-memory state immediately.

3. Revoke route now publishes invalidation across all revoke outcomes.
   - `apps/api/src/features/llm/scribeRoutes.ts`:
     - already-revoked idempotent path: local mark + publish
     - concurrent-race idempotent path: local mark + publish
     - successful revoke path: local mark + publish
   - This removes the remaining "local cache stale false after remote revoke" recurrence path.

4. Startup wiring enables the bridge for running API processes.
   - `apps/api/src/server.ts` now starts the bridge after Redis readiness.
   - Failure to attach the subscriber is warn-only (TTL fallback remains active) to preserve service availability while retaining observability.

## Regression Proof (Local)

1. `npm run test -w apps/api -- tests/unit/scribeConsentRevokePubSub.test.ts` => PASS (`2/2`)
2. `npm run test:integration -w apps/api -- tests/integration/scribeConsentRevocation.int.test.ts` => PASS (`9/9`)
   - Includes `T9`: cached `false` revoke state is flipped by pub/sub invalidation after direct DB revoke, without waiting for TTL expiry.
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS

## Guard/Closure Note

`guard:all` includes `guard:snapshot-freshness`, which compares **git commit time** of migrations vs snapshot.  
To satisfy this ratchet in the same closure cycle, regenerated `apps/api/src/db/schema-snapshot.json` is included in this commit so snapshot commit-time is >= latest migration commit-time.

## Post-Deploy Closure Items (Still Required)

1. Canary replay on multi-instance topology confirming remote revoke invalidates in-memory cache across instances.
2. Burn-in + post-burn-in verification packet for revoke-path latency and no stale-allow windows.
3. Catalogue row flip only after rollout closure contract is satisfied.
