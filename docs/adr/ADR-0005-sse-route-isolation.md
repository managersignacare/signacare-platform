# ADR-0005: SSE route isolation from RLS transaction chain

## Status
Accepted (shipped pre-session; formalised during BUG-264 closure in d5115a6).

## Context

Signacare uses Server-Sent Events (SSE) to push real-time notifications to the clinician browser: AI job completion, patient arrivals, medication-due alerts, escalation notifications. An SSE connection is intentionally long-lived — minutes to hours — because the client keeps it open for the session.

`rlsMiddleware` wraps authenticated requests in a `knex.transaction(...)` block so `SET LOCAL app.clinic_id` is honoured by RLS. If SSE handlers went through `rlsMiddleware`, each SSE connection would hold a DB transaction open for its full lifetime. Under Playwright load (BUG-264 materialisation), ~50 concurrent SSE connections drained the 50-connection pool within minutes.

Three accepted patterns existed for BUG-264: (a) dedicated SSE connection pool, (b) SSE routes that use no DB connection, (c) shorten heartbeat + forcibly disconnect idle clients. Patterns (b) and (c) are additive; (a) is only necessary if (b) fails.

## Decision
`rlsMiddleware` (`apps/api/src/middleware/rlsMiddleware.ts:32`) skips RLS wrapping when `req.path.includes('/events')` OR `req.headers.accept === 'text/event-stream'`. SSE delivery uses Redis pub/sub (`sseRoutes.ts`) with a single shared IORedis subscriber per process, 5-minute idle cleanup, and heartbeat tear-down on write failure. SSE never touches the DB pool.

## Consequences
Pool pressure from SSE is structurally eliminated. SSE delivery path is decoupled from DB availability — Redis outage degrades notifications, not clinical write paths.

## References
- `apps/api/src/middleware/rlsMiddleware.ts:32`
- `apps/api/src/features/events/sseRoutes.ts`
- BUG-264 catalogue entry (state: fixed in d5115a6)
