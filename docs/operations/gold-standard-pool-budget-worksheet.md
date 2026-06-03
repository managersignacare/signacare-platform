# Signacare Gold-Standard Pool Budget Worksheet

**Date:** 2026-05-29  
**Scope:** API + DB + SSE + AI concurrency controls (pre-deployment capacity posture)

## 1) Current-state control matrix (what already exists)

| Control | Gold-standard expectation | Status | Repo evidence |
|---|---|---|---|
| App DB pool bounds | Explicit min/max pool caps per process | `exists` | `apps/api/src/db/db.ts` (`poolMin`, `poolMax`, `pool.max`) |
| PgBouncer-aware defaults | Different defaults for direct DB vs PgBouncer path | `exists` | `apps/api/src/db/db.ts` (`isPgBouncer`, default `20/2` vs `50/5`) |
| Primary query timeout | Enforced `statement_timeout` | `exists` | `apps/api/src/db/db.ts` (`afterCreate` SET) + `apps/api/src/middleware/rlsMiddleware.ts` |
| Idle-in-transaction kill switch | Enforced `idle_in_transaction_session_timeout` | `exists` | `apps/api/src/db/db.ts` (`afterCreate` SET) |
| Lock wait cap | Enforced `lock_timeout` | `exists` | `apps/api/src/db/db.ts` (`afterCreate` SET) |
| Admin pool isolation | Separate low-cap privileged pool | `exists` | `apps/api/src/db/db.ts` (`adminPool` max 5) |
| Read path separation | Dedicated `dbRead` replica/fallback pool | `exists` | `apps/api/src/db/db.ts` (`dbRead`, `DB_REPLICA_*`) |
| Readiness reflects replica state | Replica check + required/not-required mode | `exists` | `apps/api/src/routes/health.ts` (`db_replica`, `DB_REPLICA_REQUIRED`) |
| Pool pressure warning | Runtime warning for pending/near-cap usage | `exists` | `apps/api/src/db/db.ts` (`DB pool pressure detected`) |
| SSE connection guardrails | Max concurrent connections + idle timeout | `exists` | `apps/api/src/features/events/sseRoutes.ts` (`SSE_MAX_CONNECTIONS`, `SSE_IDLE_TIMEOUT_MS`) |
| LLM/Whisper concurrency caps | Semaphore limits to avoid AI resource storms | `exists` | `apps/api/src/utils/semaphore.ts` (`LLM_MAX_CONCURRENT`, `WHISPER_MAX_CONCURRENT`) |
| AI queue worker throttling | Concurrency + rate limiter on AI jobs | `exists` | `apps/api/src/jobs/workers/aiWorker.ts` (`concurrency`, `limiter`) |
| Env contract coverage | Runtime keys catalogued + guard-enforced | `exists` | `docs/operations/env-contract-catalog.md`, `guard:env-template-contract` |
| Transaction leak guard | Reject `db()` usage inside `db.transaction` blocks | `exists` | `scripts/guards/check-trx-not-db-inside-transaction.ts` |
| Perf scenario suite | Baseline/load/stress/spike/soak scripts + threshold guard | `exists` | `scripts/k6/*`, `scripts/guards/check-k6-thresholds.ts` |
| Pool observability in `/metrics` | Export `pg_pool_used/free/pending` gauges | `exists` | `apps/api/src/observability/metrics.ts` (`signacare_pg_pool_*`) + `server.ts` poller bootstrap |
| Process-role budgeting | Clear API vs worker vs scheduler process split with independent budgets | `partial` | `apps/api/src/server.ts` currently starts workers+schedulers in-process on API boot |
| Doc/runtime consistency for SSE cap | Default + docs/comments aligned | `partial` | `sseRoutes.ts` comment says 500 while default is 5000 unless env overrides |
| Startup pool-budget assertion | Fail/warn startup when projected pressure exceeds safe threshold | `exists` | `apps/api/src/server.ts` + `apps/api/src/shared/poolBudget.ts` (`DB_POOL_BUDGET_ASSERT_MODE`) |
| CI worksheet contract guard | Verify template keys + projection non-risky in CI | `exists` | `scripts/guards/check-pool-budget-contract.ts` (`npm run guard:pool-budget-contract`) |

### Snapshot result
- `exists`: 18
- `partial`: 2
- `missing`: 0

---

## 2) Pool budget worksheet (fill this before production cutover)

## Inputs

| Variable | Meaning | Current baseline in repo | Your target |
|---|---|---|---|
| `A` | API process count (instances/workers) | `4` (`apps/api/ecosystem.config.js`) | |
| `B` | `DB_POOL_MAX` (app pool max per process) | `20` behind PgBouncer, else `50` | |
| `C` | Admin pool max per process | `5` (fixed) | |
| `D` | `DB_REPLICA_POOL_MAX` per process | `30` default | |
| `E` | Read replica configured | `yes/no` (`DB_REPLICA_HOST`) | |
| `F` | DB usable backend connections | Example plan uses ~`730` on Azure D2s_v3 | |
| `G` | Reserved backend connections (ops/migrations/superuser margin) | recommend `>= 20%` of usable | |
| `H` | Non-API DB consumers (other services/scripts) | deployment-specific | |
| `I` | Target safe-utilization ceiling for steady state | recommend `<= 70%` | |

## Formulas

1. **Client-side socket ceiling** (all pools, all API processes):  
   `client_socket_ceiling = A * (B + C + D)`

2. **Primary DB pressure ceiling**:
   - if `E = yes` (read replica present):  
     `primary_pressure = A * (B + C) + H`
   - if `E = no` (dbRead falls back to primary):  
     `primary_pressure = A * (B + C + D) + H`

3. **Replica pressure ceiling** (only if `E = yes`):  
   `replica_pressure = A * D`

4. **Safe primary cap**:  
   `safe_primary_cap = floor((F - G) * I)`  
   (with `I = 0.70` by default)

5. **Headroom ratio**:  
   `headroom_ratio = primary_pressure / safe_primary_cap`

## Decision thresholds

| Condition | Verdict |
|---|---|
| `headroom_ratio <= 0.60` | Healthy |
| `0.60 < headroom_ratio <= 0.80` | Caution (watch burst traffic) |
| `headroom_ratio > 0.80` | Risky (reduce pools or scale DB/PgBouncer tier) |

---

## 3) Recommendations (priority order)

## P0 (do before broad rollout)
1. Set explicit production values for `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_REPLICA_POOL_MAX`, `SSE_MAX_CONNECTIONS`, `LLM_MAX_CONCURRENT`, `WHISPER_MAX_CONCURRENT` in deployment env (no implicit defaults).
2. Decide production process topology:  
   - API-only processes for HTTP traffic  
   - worker/scheduler processes isolated to controlled count  
   Current in-process bootstrap (`server.ts`) multiplies scheduler/query load with API instance count.
3. Enforce `DB_REPLICA_REQUIRED=true` where read replica is mandatory, so degraded replica is a readiness failure rather than silent fallback.

## P1 (next hardening slice)
1. Wire alert rules in monitoring stack for:
   - `signacare_pg_pool_pending{pool="app"} > 5`
   - `signacare_pg_pool_used{pool="app"} / signacare_pg_pool_max{pool="app"} > 0.9`
2. Align SSE default/comment/template (500 vs 5000) and keep one SSoT.

## P2 (regression-proof governance)
1. Extend soak evidence to require actual pool metrics (k6 docs should reference `signacare_pg_pool_*` explicitly).
2. Publish a deployment runbook section that records worksheet inputs/outputs per environment (dev/staging/prod) and update each release.
3. Keep `DB_POOL_BUDGET_ASSERT_MODE=fail` for production cutover windows, then relax to `warn` only with explicit CAB sign-off.

---

## 5) Executable commands

```bash
# One-shot worksheet projection from current env:
npm run ops:pool-budget

# CI guard for template contract + projection sanity:
npm run guard:pool-budget-contract
```

---

## 4) Quick worked example (using current defaults)

Assume:
- `A=4`, `B=20`, `C=5`, `D=30`, `E=yes`, `F=730`, `G=146` (20%), `H=10`, `I=0.70`

Then:
- `primary_pressure = 4 * (20+5) + 10 = 110`
- `safe_primary_cap = floor((730-146) * 0.70) = 408`
- `headroom_ratio = 110 / 408 = 0.27` (healthy)

If replica is **not** configured (`E=no`):
- `primary_pressure = 4 * (20+5+30) + 10 = 230`
- `headroom_ratio = 230 / 408 = 0.56` (still acceptable, but much tighter)
