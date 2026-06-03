# Plan — BUG-187 + BUG-264 + BUG-366b combined: DB pool hardening + Azure PG SSL

**Commit target:** single atomic commit.
**Risky-class:** yes (shared/, db/).
**Gate:** full L1-L5 + L4 (config-layer) + L5 (architecture).

---

## 1. Context

BUG-187 mitigated the pool-exhaustion symptom by landing `statement_timeout = '30s'` and `idle_in_transaction_session_timeout = '60s'` at connection level. Root still OPEN because the 2026-04-20 diagnostic couldn't reproduce the originating mechanism in dev.

BUG-264 catalogued a reproducible pool-pressure signal under Playwright load (`used:50, free:0, pending:3`). The accepted patterns named there (dedicated SSE pool / no-DB SSE route / idle-disconnect) are ALREADY in place:
- `apps/api/src/middleware/rlsMiddleware.ts:32` skips `/events` + `text/event-stream`
- `apps/api/src/features/events/sseRoutes.ts` uses a single shared IORedis subscriber, 5-min idle cleanup, heartbeat tear-down
- No DB connection is held per SSE client

So BUG-264's structural mechanism is already closed. What remains is (a) pool-sizing that's Azure-informed rather than the dev-era `max: 50`, and (b) the third BUG-187 follow-up timeout — `lock_timeout` — not yet landed.

BUG-366b is part B of the split BUG-366 (366a Key Vault shipped in `02023c8`). It covers PG SSL + pool sizing + session timeouts for Azure — exactly the surface that combines with BUG-187/264. Shipping them together in one commit keeps the pool config change and the BUG-187 timeout extension co-located.

## 2. Existing code to reuse (grep-verified)

- [db.ts:87-98](apps/api/src/db/db.ts#L87-L98) `appUserAfterCreate` — already runs `SET statement_timeout + SET idle_in_transaction_session_timeout` on every app_user connection. Add `lock_timeout` to the same statement.
- [db.ts:52-54](apps/api/src/db/db.ts#L52-L54) `sslConfig` — already respects `config.database.ssl`. Nothing to add for Azure PG — `DB_SSL=true` already does the right thing; the node-postgres bundled CA chain covers Azure's PG Flexible Server cert.
- [db.ts:59-62](apps/api/src/db/db.ts#L59-L62) `isPgBouncer` + `poolMax` + `poolMin` — already env-configurable via `DB_POOL_MAX` / `DB_POOL_MIN`. The hardcoded defaults (50 direct, 5 PgBouncer) are out-of-date for Azure; update the default when PgBouncer is detected to 20 per `docs/plans/azure-staging-deployment.md §2.2`.
- [db.ts:125-141](apps/api/src/db/db.ts#L125-L141) `dbAdmin` pool — currently max 5, matches plan. No change.
- [rlsMiddleware.ts:55](apps/api/src/middleware/rlsMiddleware.ts#L55) `SET LOCAL statement_timeout='30s'` — already per-transaction belt-and-braces on top of connection-level 30s.
- [apps/api/.env.example:22-29](apps/api/.env.example#L22-L29) + [.env.production.template:38-57](apps/api/.env.production.template#L38-L57) — already document DB_PORT / DB_SSL / DB_POOL_MAX.

## 3. Change surface (file by file)

### 3.1 `apps/api/src/db/db.ts`

- Extend `appUserAfterCreate` SQL to include `SET lock_timeout = '5s'` alongside the two existing timeouts. One added SET keeps the afterCreate round-trip at 1 query (SQL supports multiple `SET`s in a single statement ending with `SELECT 1`).
- Bump the PgBouncer-branch `poolMax` default from `"5"` → `"20"` to match `docs/plans/azure-staging-deployment.md §2.2` (conservative 10 → hot cap 20). Direct-connection default stays at 50 since that path is dev-only by policy (Azure production MUST route through PgBouncer per the plan).
- Update the comment block explaining BUG-187 guardrails so a future reader sees three timeouts named, not two.

### 3.2 `apps/api/tests/integration/dbPoolTimeouts.int.test.ts` (new)

Integration test against live Postgres (docker-compose). Asserts that a new connection from the app_user pool has:
- `SHOW statement_timeout` → `30s`
- `SHOW idle_in_transaction_session_timeout` → `60s` (60000ms)
- `SHOW lock_timeout` → `5s` (5000ms)

This is the regression test that pins the three-timeout invariant. Without it, any future PR that drops the `lock_timeout` from `appUserAfterCreate` ships silently.

### 3.3 `apps/api/tests/integration/dbPoolSizing.int.test.ts` (new)

Asserts that the app_user pool is configured with:
- Pool-level `min >= 2`
- Pool-level `max` reflects `DB_POOL_MAX` env OR the PgBouncer-aware default
- `afterCreate` hook set (proves BUG-187 timeouts are wired)

This is a config-shape assertion — catches accidental removal of pool bounds.

### 3.4 `apps/api/.env.example`

Add commented-out `DB_POOL_MIN=5` + document the PgBouncer-vs-direct default split. Keep `DB_POOL_MAX=50` for local dev (direct Postgres) — NOT changed.

### 3.5 `apps/api/.env.production.template`

Update the DB block to explicitly document the Azure-informed defaults:
- `DB_POOL_MAX=20` (behind PgBouncer; Azure PG Flexible Server D2s_v3)
- `DB_POOL_MIN=5`
- Mention the three-timeout triple as operational baseline
- Clarify that `DB_HOST` should point at the PgBouncer endpoint (port 6432) when the sidecar is enabled

### 3.6 `docs/fix-registry.md`

Five new anchors:
- `R-FIX-BUG-187-LOCK-TIMEOUT` — `appUserAfterCreate` SQL contains `lock_timeout`
- `R-FIX-BUG-187-STATEMENT-TIMEOUT` — same SQL contains `statement_timeout = '30s'` (pins the existing invariant so a regression adds a test signal)
- `R-FIX-BUG-187-IDLE-IN-TX-TIMEOUT` — same SQL contains `idle_in_transaction_session_timeout = '60s'`
- `R-FIX-BUG-366B-PGBOUNCER-POOL-DEFAULT` — pins the `"20"` default when `isPgBouncer` is true
- `R-FIX-BUG-366B-DB-SSL-CONFIG-HONORED` — pins the `config.database.ssl ? { ssl: ... } : {}` branch so a future refactor that hardcodes `ssl: false` fails the merge gate

### 3.7 `docs/audit-2026-04-19/bug-catalogue-v2.yaml`

Transition:
- `BUG-187` → `state: fixed` (the three-timeout triple is the accepted pattern)
- `BUG-264` → `state: fixed` (structural SSE isolation + bounded pool + three timeouts)
- `BUG-366b` → `state: fixed`

`fixed_in` points at this commit hash (filled post-commit).

## 4. Test plan

**Failing-test-first (TDD evidence)**:
1. Write `dbPoolTimeouts.int.test.ts` expecting `SHOW lock_timeout = '5s'`. Against current code (no `lock_timeout` in afterCreate), this test returns the Postgres default (`0` = disabled). Test FAILS.
2. Capture pre-fix FAIL trace (expect `lock_timeout=0`).
3. Add the `lock_timeout = '5s'` to afterCreate.
4. Test PASSES. Capture post-fix PASS trace.

Adjacent suites that must remain green:
- `healthEndpoints.test.ts` — /ready calls dbAdmin + appPool, still works with tightened timeouts
- `authBoundaries.int.test.ts` — rlsMiddleware still wraps authenticated requests correctly
- `clinicalAccessRbac.int.test.ts` — BUG-351/354 trigger + guard chain still fires
- `rlsMiddleware` integration suite if any exists

Flake check: 3 isolated runs on each new test, zero flake.

## 5. Gate

| Check | Rationale |
|---|---|
| L1.1 tsc | db.ts touched |
| L1.2 eslint | touched files: db.ts, .env.example, .env.production.template |
| L1.3 17 CI guards | snapshot-freshness, fix-registry, etc. |
| L1.4 check-fix-registry | 5 new anchors must all verify |
| L2.5 TDD | failing test, then fix, then PASS |
| L2.6 Adjacent tests | run integration suite (healthEndpoints + authBoundaries + clinicalAccessRbac + bug281 + accessAdminSlot + clinicAccessAdmins) |
| L2.7 Flake ×3 | new tests |
| L3 code-reviewer-general | risky-class: touches db/ |
| L4 clinical-safety-reviewer | any auth/session/DB path — in scope |
| L5 architecture-reviewer | shared/, db/, infrastructure layer |

## 6. Out of scope

- Fast/dedicated pool for LLM/scribe long-running connections — separate concern, tracked as a future BUG (the current code skips RLS for those paths but still uses the main pool for their own queries).
- Database-level parameter enforcement (enforcing `statement_timeout` as a Postgres parameter rather than per-connection) — requires Azure Flexible Server "Server Parameters" configuration, which is ops-layer not engineering-layer. Documented in the Azure deploy checklist (§5 of `docs/plans/azure-staging-deployment.md`).
- PgBouncer sidecar configuration — documented in `docs/plans/azure-staging-deployment.md §2.2`, but provisioning is a deploy-time task.
- Azure PG CA certificate bundle — node-postgres's bundled CA chain (`pg-connection-string` default) already covers Azure's PG Flexible Server cert; no additional cert path needed.

## 7. Risk / reversibility

- `lock_timeout = '5s'` is conservative. Deadlock-prone transactions will now fail at 5s with `55P03 lock_not_available` rather than hanging indefinitely. Catches are already in place at the route layer (each handler has try/catch + `next(err)` per §3.1). No silent behaviour change.
- Pool max change from 5 → 20 (PgBouncer branch) increases server-side connection pressure linearly. Azure PG D2s_v3 max_connections=859 / 15% reserve = ~730 usable. With 4 workers × 20 = 80 connections per API replica. For a staging 1-replica deploy, comfortably under limits. Document in plan.
- All changes revertible via `git revert` — single commit, no migrations, no schema change, no state change.

## 8. Verification pre-commit

```bash
# L1 tsc
npx tsc --noEmit -p apps/api/tsconfig.json

# L1 eslint
npx eslint apps/api/src/db/db.ts

# L1 guards
npm run guard:fix-registry
bash .github/scripts/check-fix-registry.sh

# L2 TDD
cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/dbPoolTimeouts.int.test.ts

# L2 adjacent
node apps/api/scripts/run-integration-tests.mjs

# L2 flake
for i in 1 2 3; do cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/dbPoolTimeouts.int.test.ts || break; done
```
