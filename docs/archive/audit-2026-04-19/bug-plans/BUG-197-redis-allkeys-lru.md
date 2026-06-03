# BUG-197 — Redis noeviction default causes write-rejection under memory pressure

> **Post-hoc backfill.** Plan doc created after commit.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-0 (pre-flight) |
| Change-class | risky (infra config touching every Redis consumer) |
| Commit SHA | `bc782bd` |
| Fix-registry anchor | R-FIX-REDIS-ALLKEYS-LRU |
| Discovered | pre-plan |
| Closed | 2026-04-20 |

## 2. Diagnosis

**Root cause:** Redis default `maxmemory-policy` is `noeviction` — when memory fills up, Redis REJECTS writes with OOM rather than evicting old keys. Signacare uses Redis for CSRF tokens, sessions, BullMQ queue state, jwtBlacklist, SSE pub/sub, and rate limits — all of these write continuously. Under sustained memory pressure these all start failing.

**Classification:** isolated — one config file, one policy knob — but with system-wide blast radius because every feature touches Redis.

## 3. Approach

**Gold-standard fix:** set a bounded `maxmemory` + switch eviction policy from `noeviction` to `allkeys-lru`. Eviction replaces rejection as the graceful-degradation mode. LRU is appropriate because most keys have natural TTL (CSRF tokens, challenges, rate-limit counters).

**Chosen values:**
- `maxmemory 512mb` — sized for initial deployment; not optimised.
- `maxmemory-policy allkeys-lru` — simple, well-understood; `volatile-lru` was rejected because some keys (BullMQ) don't always have explicit TTL.

**Downstream impact:** under sustained pressure, BullMQ queue state OR jwtBlacklist entries could be evicted. Both are monitored risks — BullMQ job loss means job replay is needed (existing idempotency patterns); jwtBlacklist eviction means a revoked-but-unblacklisted token could be accepted (narrow window, mitigated by 60-minute access token TTL).

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| `volatile-lru` | BullMQ queue state and some session keys don't always carry TTL — `volatile-lru` would leave them unevictable, re-introducing the OOM failure class |
| Split Redis instances per concern (BullMQ, sessions, rate limits) | Premature optimisation; `rejected_approaches` flagged in catalogue — revisit only if real production data justifies the operational overhead |
| Enable Redis persistence (AOF) | Persistence is a separate concern; conflating it with eviction policy was rejected by reviewer as scope creep (tracked in follow-up-on-cloud-deploy.md §10.5) |

## 5. Reviewer refinement trail

**Initial proposal — REJECTED.** Reviewer comments:
1. Misclassified as `standard`; reviewer insisted `risky` (infra change affecting all Redis consumers).
2. Reopened the policy choice when catalogue had already locked `allkeys-lru` — unnecessary deliberation.
3. Made unverified "matches production config" claim without reading the Azure Bicep module.
4. Made unverified AOF-persistence claim.
5. Test #4 was non-mutation-resistant.
6. Reviewer requested line-number check against Bicep module (50 vs 55).
7. Conscious-trade documentation needed in follow-up doc.

**Revised proposal — accepted:**
1. Classified `risky`; full L3+L5 review path.
2. Policy choice closed per catalogue.
3. Verified Bicep at line 55 — updated fix-registry row reference accordingly.
4. AOF deferred to follow-up-on-cloud-deploy.md §10.5 explicitly — not claimed solved.
5. Test #4 replaced with a mutation-resistant scenario: write 600×1MB keys, assert eviction counter advances and zero OOM-rejection counter — directly discriminates noeviction from allkeys-lru.
6. BullMQ eviction + jwtBlacklist eviction risks documented in follow-up §5.5 + §5.6.

## 6. Implementation outline

**Files touched:**
- `infra/redis.conf` — new file with `maxmemory 512mb` + `maxmemory-policy allkeys-lru`.
- `docker-compose.yml` — Redis service `command: redis-server /usr/local/etc/redis/redis.conf` + volume mount.
- `docs/audit-2026-04-19/follow-up-on-cloud-deploy.md` §5.5 + §5.6 — conscious-trade documentation (BullMQ eviction risk, jwtBlacklist eviction window, persistence deferred).
- `deploy/azure/modules/redis.bicep` — matched policy at line 55.

## 7. Tests

`apps/api/tests/integration/redisEviction.int.test.ts` — 3 discriminating tests:
1. `CONFIG GET maxmemory` > 0 (not default 0).
2. `CONFIG GET maxmemory-policy` equals `allkeys-lru`.
3. Write 600×1MB keys; assert `evicted_keys` counter advances AND `rejected_connections`/OOM-rejection counter stays zero under pressure.

**Red-first trace:** default Redis config → test 2 FAILs (`noeviction`). After applying the fix → test 2 PASSes.

## 8. Verification trace

- Default Redis (no config) → tests 1+2 FAIL.
- With `infra/redis.conf` mounted → all 3 pass.
- Under 600MB pressure → eviction activates; no OOM rejections.
- BullMQ queue under pressure → queue state CAN be evicted; job replay via idempotency.

## 9. Residual risk

- BullMQ queue state + jwtBlacklist entries evictable under sustained pressure. Monitoring required in production (documented in follow-up §5.5). Narrow window for jwtBlacklist because access tokens are 60-min TTL.
- AOF persistence NOT enabled. Cache-style use-case; if durability is needed for any key class, promote to a separate Redis DB with persistence (deferred — follow-up §10.5).
- Cross-DB eviction: Signacare uses 4 logical Redis DBs (0-3); `allkeys-lru` operates across the entire instance. Memory pressure in one DB can evict keys from another. Mitigation path deferred (follow-up §10.6).

## 10. CAB / change-control notes

- Catalogue state → `fixed`.
- No new dependency, no licence acceptance.
- Conscious-trade accepted: eviction-over-rejection documented in follow-up doc §5.5.

## 11. QA agent verdicts

Fix pre-dates QA-agent L1-L5 framework going live for this BUG. Manual reviewer sign-off.
