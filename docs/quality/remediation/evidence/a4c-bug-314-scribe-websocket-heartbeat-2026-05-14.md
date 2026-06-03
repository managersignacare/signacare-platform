# A4c BUG-314 Local Evidence — Scribe WebSocket Heartbeat Liveness

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-314`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added a dedicated heartbeat controller in `apps/api/src/mcp/scribeWebSocketHeartbeat.ts`.
   - Tracks per-socket liveness via `lastPongAt`.
   - Emits periodic ping checks.
   - Enforces fail-closed stale-socket termination (`close` + `terminate`).
   - Invokes a cleanup callback so owning code can remove stale session state.

2. Integrated heartbeat lifecycle into `apps/api/src/mcp/scribeStreaming.ts`.
   - New close code `SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT = 4410`.
   - Configurable heartbeat windows:
     - `SCRIBE_WS_HEARTBEAT_INTERVAL_MS` (default 15s),
     - `SCRIBE_WS_HEARTBEAT_TIMEOUT_MS` (default 45s).
   - Connection hooks:
     - `heartbeat.register(ws)` on `connection`,
     - `heartbeat.markPong(ws)` on `pong`,
     - `heartbeat.unregister(ws)` on `close`.
   - Interval tick calls `heartbeat.tick(wss.clients ?? [])` and fail-closes sockets that exceed timeout or fail ping write.

3. Added stale-session cleanup on heartbeat termination.
   - On heartbeat timeout, the controller callback removes session state from:
     - `sessions`,
     - `wsSessionIndex`.
   - This prevents dead/half-open sockets from leaving ghost active sessions in memory.

4. Added regression tests for heartbeat invariants.
   - `apps/api/tests/unit/scribeWebSocketHeartbeat.test.ts`:
     - `BUG-314-1` healthy client ping path,
     - `BUG-314-2` stale timeout close/terminate path,
     - `BUG-314-3` pong refresh resets timeout window,
     - `BUG-314-4` ping-write failure fail-closed path.

## Regression Proof (Local)

1. `npm run test -w apps/api -- tests/unit/scribeWebSocketHeartbeat.test.ts` => PASS (`4/4`)
2. `npm run test:integration -w apps/api -- tests/integration/scribeWebSocketConsent.int.test.ts` => PASS (`10/10`)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary replay of long-lived `/ws/scribe` sessions with liveness timeout verification under production topology.
2. Burn-in + post-burn-in evidence proving no dead-client session accumulation and no regressions in consent/auth close paths.
3. Catalogue row flip only after rollout closure contract is satisfied.
