# Local Dev — Redis configuration runbook

**Purpose:** apply the BUG-197 Redis hardening (maxmemory + allkeys-lru) to local developer Redis instances.

## Canonical path — Docker

The canonical supported path is `docker-compose` with the config mounted via `infra/redis.conf`. This is the source of truth for CI and for shared developer environments.

```bash
docker compose up -d redis
# Redis picks up /etc/redis/redis.conf automatically per the docker-compose service's command + volume
```

Verify:

```bash
docker compose exec redis redis-cli CONFIG GET maxmemory
# → 1) "maxmemory"
#   2) "536870912"           # 512mb
docker compose exec redis redis-cli CONFIG GET maxmemory-policy
# → 1) "maxmemory-policy"
#   2) "allkeys-lru"
```

**Prefer Docker if you can.** It matches CI, matches staging, and there is no per-dev config drift.

## Secondary path — Homebrew (macOS dev machines)

For developers using the Homebrew-managed Redis that Signacare installs as part of the Phase 0.7 local-dev setup, the same settings must be applied manually. Homebrew's Redis does NOT pick up `infra/redis.conf` automatically — it uses `/opt/homebrew/etc/redis.conf`.

### One-time setup

```bash
# Option A — apply to the running instance via redis-cli (non-persistent)
redis-cli -p 6379 CONFIG SET maxmemory 512mb
redis-cli -p 6379 CONFIG SET maxmemory-policy allkeys-lru
redis-cli -p 6379 CONFIG REWRITE

# Option B — edit Homebrew's config file manually (persistent across restarts)
# Open /opt/homebrew/etc/redis.conf in your editor and set:
#   maxmemory 512mb
#   maxmemory-policy allkeys-lru
# Then restart:
brew services restart redis
```

Verify with the same `CONFIG GET` commands as above.

### Why not automate this

An automation script (`scripts/dev/configure-local-redis.sh`) was considered and rejected during BUG-197 remediation. Reason: it would introduce a second configuration branch that drifts from `infra/redis.conf`, creating the exact "multiple ways to do one thing" failure mode principal-engineer rule 4 prohibits. The runbook keeps Docker as the one true path, with Homebrew documented for developers who prefer it.

## Troubleshooting

### Tests in `apps/api/tests/integration/redisEviction.int.test.ts` fail

Most common cause: the local Redis that the test suite connects to has not been configured per this runbook. Re-run the "One-time setup" commands and re-run the tests.

### Redis memory alarm fires locally

Expected during development — 512mb is intentionally small so LRU eviction is observable. If you need more for a specific test session, set `maxmemory` higher in `infra/redis.conf` + commit the change via a PR that bumps the fix-registry anchor if the bound meaningfully changes.

### I want to add a new Redis key pattern that must NOT be evicted

Eviction is global per `allkeys-lru`. There is no per-key-prefix protection. If a new key class genuinely cannot survive eviction:
1. File a BUG row with scope "non-evictable Redis key class" under Track B
2. Do NOT change the policy to `volatile-lru` without CAB approval (deviates from Azure bicep)
3. Alternative: write the data to Postgres with Redis as a write-through cache

## Cross-references

- `infra/redis.conf` — canonical config
- `docker-compose.yml` redis service — Docker wiring
- `deploy/azure/modules/redis.bicep` — Azure production config source of truth
- `docs/audit-2026-04-19/follow-up-on-cloud-deploy.md` §5.5–§5.6 — post-deploy monitoring + verification
- Fix-registry anchor: `R-FIX-REDIS-ALLKEYS-LRU`
