# ADR-0003: Three-timeout triple on app_user DB connections

## Status
Accepted (shipped in BUG-187/264/366b combined; commit d5115a6).

## Context

BUG-187 catalogued a recurring symptom: after ~21 hours of uptime, the `app_user` pool reached `used=50, free=0, pending=5`, `KnexTimeoutError` on auth/login, and tenant-wide login outage. The 2026-04-20 diagnostic couldn't reproduce the originating mechanism in dev, but BUG-264 (Playwright load) reproduced the symptom.

The original BUG-187 mitigation set `statement_timeout=30s` (stuck-query cancellation) and `idle_in_transaction_session_timeout=60s` (orphaned-transaction reaping) at every `afterCreate`. Bounded two failure modes but NOT a third: `lock_timeout=0` (PostgreSQL default = disabled), so a query waiting on a row/table lock could hang indefinitely, holding the pool connection.

PostgreSQL raises distinct error classes for each timeout: `57014 statement_timeout`, `25P03 idle_in_transaction_session_timeout`, `55P03 lock_not_available`. Handling all three distinctly lets the route error handler surface retry semantics (503) rather than opaque 500.

## Decision
Every new app_user connection runs `appUserAfterCreate` which sets three PostgreSQL session timeouts: `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`, `lock_timeout=5s`. dbAdmin (owner role) pool deliberately bypasses these so long migrations / DDL succeed.

## Consequences
Stuck queries cancelled at 30s. Orphaned transactions killed at 60s. Lock waits fail-fast at 5s with distinct `55P03 lock_not_available` error class. Workflows that legitimately need >5s locks must adapt — BUG-367 maps the PG error class to a user-facing 503-retry.

## References
- Commit d5115a6
- Fix-registry: R-FIX-BUG-187-STATEMENT-TIMEOUT, R-FIX-BUG-187-IDLE-IN-TX-TIMEOUT, R-FIX-BUG-187-LOCK-TIMEOUT
- `apps/api/src/db/db.ts:appUserAfterCreate`
