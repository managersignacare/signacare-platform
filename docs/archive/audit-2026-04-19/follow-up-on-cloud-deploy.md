# Follow-up on Cloud Deploy

**Created:** 2026-04-20
**Owner:** Reviewer (engineering lead)
**Authoritative status:** open — this document tracks items that must be verified or monitored when Signacare EMR moves from dev into staging/canary/production, and unresolved diagnoses that the short local audit could not close.

**Principle:** the local diagnostic session for BUG-187 produced **negative evidence** (catalogued mechanism not reproduced in current codebase) — not **settled closure**. Short-duration probes and grep-based absence are not sufficient to eliminate intermittent, long-uptime, load-shaped failure modes. This document preserves that uncertainty and names concrete actions that only meaningful cloud-shaped load can validate.

---

## 1. Executive summary

BUG-187 mitigations will ship in Wave A-0 as **bounded hardening**, not as a full root-cause fix. The originally catalogued mechanism (`db() inside db.transaction()`) was not reproduced in the current codebase. A new root cause has not been evidenced. Mitigation is safe to deploy; conclusion is not.

Cloud deploy must carry a monitoring + verification backlog because:

1. The 21h-uptime pool-exhaustion symptom was real on the prior process. If the mitigation masks rather than eliminates the underlying class, cloud will see the symptom resurface at a slower cadence (now bounded by 60s idle-in-transaction reap, but the accumulation vector remains unexplained).
2. Several candidate mechanisms (LLM/scribe long handlers, BullMQ workers, process-level socket drift) could not be exercised in the short dev audit and may only manifest under real clinician workloads with sustained use.
3. Cloud introduces factors absent locally: longer process uptime, PgBouncer, load-balancer connection reuse, network zombie sockets, multi-pod scaling, real integration latency.

---

## 2. What the audit concluded (honest framing)

**Confirmed by audit:**
- In current codebase, no `db()` call inside any `db.transaction(async (trx) => ...)` body — zero matches across `apps/api/src/{features,jobs,middleware,shared,mcp,integrations}`.
- Across 3.5 min of observation with burst HTTP traffic (84 requests) + 1 scheduler tick: 460 pool acquires, 460 releases, zero net leak, zero orphaned connections.
- SSE `/events/stream` handler performs **zero DB connection acquisition** — uses Redis pub/sub only; ruled out as DB pool leak source.
- `backupScheduler` tick (the named leaker in original logs) fired cleanly under observation: 27 acquires, 27 releases.

**NOT concluded by audit:**
- That a leak class does not exist.
- That the catalogued root cause is invalid as a preventive rule.
- That the 21h drain was caused by anything specific.
- That cloud deployment will not re-exhibit the symptom.

**Correct framing for the bug catalogue:**
```
BUG-187 status:
  mechanism_originally_catalogued: db() inside db.transaction() leak
  mechanism_reproduction_status: NOT REPRODUCED in current audit
  operational_symptom: 21h-uptime pool exhaustion (observed, unresolved)
  mitigation_shipped: pool-level statement_timeout + idle_in_txn guardrails
  root_cause_status: OPEN — pending cloud-load evidence
```

The "`db() inside db.transaction()`" pattern remains a **preventive rule** (CLAUDE.md §2.1 + a guard check still warranted) — a class that must not be allowed to re-enter, not a defect class that was ever present in current code.

---

## 3. Items to VERIFY before cloud deploy

These are bounded hardening pieces that DO ship. Each has a concrete acceptance criterion.

| # | Item | File | Acceptance |
|---|---|---|---|
| V1 | `afterCreate` applies `statement_timeout = '30s'` + `idle_in_transaction_session_timeout = '60s'` to BOTH `appPool` AND `rawDbRead` | `apps/api/src/db/db.ts` | A test asserting `SHOW statement_timeout` returns 30s on a fresh connection from each pool |
| V2 | `dbPoolPressure.int.test.ts` exists at the catalogue-named path, with a mitigation-regression assertion (pg_sleep(35) cancelled at ~30s) | `apps/api/tests/integration/dbPoolPressure.int.test.ts` | Red-first trace captured (revert afterCreate → test FAILS → re-apply → test PASSES); both traces attached to PR body |
| V3 | Fix-registry rows added | `docs/fix-registry.md` | Two present-pattern anchors: `R-FIX-POOL-STATEMENT-TIMEOUT` + `R-FIX-INTEGRATION-RUNNER-RECURSIVE`; verified by `check-fix-registry.sh` passing |
| V4 | Integration test runner walks subdirs | `apps/api/scripts/run-integration-tests.mjs` | Smoke test confirms BUG-187 test file is discovered and executes |
| V5 | Diagnostic instrumentation removed from db.ts BEFORE commit | `apps/api/src/db/db.ts` | No `SIGNACARE_POOL_DIAGNOSTIC` code paths remain; grep returns zero matches |
| V6 | Catalogue updated with *provisional* language per this doc's §2 — NOT with "catalogue was wrong" | `docs/audit-2026-04-19/bug-catalogue-v2.yaml` | BUG-187 `root_cause` field says "mechanism not reproduced in current audit" |

---

## 4. Items HELD — require named adopters + governance before shipping

### 4.1 `withUnboundedStatementTimeout` escape-hatch helper
**Status:** proposed, NOT to be implemented until a named adopter list + governance are approved.
**Risk:** without allowlist, becomes a convenience bypass that silently weakens the 30s cap — violates "no new patterns" rule (CLAUDE.md §A.1.4) and the "fail fast, fail loud" architectural standard.
**Gate to approve:** CAB review of the explicit enum of audited operation types with named call sites (e.g. matview refresh, privacy export, backup, bulk report, FHIR bulk export) + `check-unbounded-timeout-callers.ts` guard allowlist.
**Tracked as:** separate ticket TBD (NOT a new BUG-NNN; this is a helper proposal, not a defect).

### 4.2 Catalogue rewrite to assert "catalogued cause is wrong"
**Status:** REJECTED by reviewer. Do not state this in the catalogue.
**Correct:** "mechanism not reproduced in current audit; root cause open" — preserves uncertainty per CLAUDE.md §3.1 prohibitions 1 + 2 (never guess, never assume).
**Tracked in:** `bug-catalogue-v2.yaml` BUG-187 amendment per V6 above.

---

## 5. Post-deploy monitoring checklist (cloud)

These are what to watch for once the mitigation is in staging + canary + production. If any threshold trips, STOP scale-out and re-open diagnostic.

### 5.1 Pool pressure signals
| Metric | Green | Amber (alert) | Red (page) |
|---|---|---|---|
| `appPool` used/max ratio sustained | <50% | 50-70% for >10 min | >70% for >10 min |
| `rawDbRead` used/max ratio | <50% | 50-70% for >10 min | >70% for >10 min |
| `numPendingAcquires` | 0 | >0 briefly | >5 sustained |
| Pool-pressure log lines per hour | 0 | 1-10 | >10 |
| `idle in transaction` Postgres connections lingering | 0 | 1-3 briefly | ≥4 sustained (reap not working) |
| `KnexTimeoutError` in logs | 0 | 1 per day | >1 per hour |

Source for each metric:
- Pool stats: extend existing `DB pool pressure detected` log (db.ts:167) to emit to Prometheus alongside the warn
- Postgres state: `pg_stat_activity` count WHERE `state = 'idle in transaction' AND usename = 'app_user' AND state_change < now() - interval '2 minutes'`

### 5.2 Connection lifetime signals
Track 95p and 99p connection age for `app_user` in `pg_stat_activity`:
- Baseline expectation: 95p < 2 min, 99p < 10 min (normal req/res cycle + pool min-keep)
- Cloud watch: if 95p or 99p climb past baseline over a sliding 24h window, the leak class is active despite the guardrails

### 5.3 Specific paths to instrument
These SKIP rlsMiddleware per db.ts:32-42 and are the most likely orphaned-connection candidates. Instrument each to log acquire/release timestamps + request-id correlation:
- `GET /api/v1/events/stream` (SSE — ruled out as DB leak in audit, but keep observability)
- `POST /api/v1/llm/ambient-note` (handler can run 30-300s)
- `POST /api/v1/llm/suggest`, `/clinical-ai`, `/agent` (various Ollama-facing)
- `POST /api/v1/scribe/*` (all scribe session routes)

### 5.4 Scheduler + BullMQ worker signals
- Per-scheduler `tick-started` and `tick-completed` log entries (most already present; audit completeness)
- BullMQ worker "processing" duration per job class
- Cron-overlap detection: if `tick-started` fires while prior tick is still active, log + alert

### 5.5 Redis signals (added per BUG-197 fix, 2026-04-20)
BUG-197 sets `maxmemory-policy allkeys-lru` — eviction replaces write-rejection as the failure mode under pressure. This is a conscious trade, not a lossless fix. Cloud must watch:

| Metric | Green | Amber (alert) | Red (page) |
|---|---|---|---|
| Redis `used_memory` / `maxmemory` ratio | <50% | 50-70% for >10 min | >70% for >10 min |
| `INFO stats` `evicted_keys` rate | 0-10/hour | 10-100/hour | >100/hour sustained |
| `INFO stats` `rejected_connections` | 0 | >0 briefly | >5 sustained |
| Keys per DB: DB0/DB2 (BullMQ) entry count drift | stable or growing | unexplained dips >10% | sudden drop >25% (eviction of queue state) |
| Keys per DB: DB3 `jwt-blacklist:*` prefix count | stable | unexplained dips | sudden drop (security window) |

Source for each: `redis-cli INFO memory|stats|keyspace` + `redis-cli --scan --pattern 'jwt-blacklist:*' | wc -l`.

**Why the per-DB metrics matter (BUG-197 residual risk):**

- **DB0 (BullMQ AI job queue)** and **DB2 (BullMQ HL7 worker queue)** store job state without TTL. Under `allkeys-lru`, they can be evicted — losing a queued job = clinical work loss (unsent HL7 order, unprocessed ambient note). Eviction spike in these DBs is a critical alert.
- **DB3 `jwt-blacklist:*`** evicting early creates a security window: a revoked token can be briefly valid until its natural JWT expiry. Monitor key-count drift; reconcile with token-revocation events in audit_log.
- **DB3 `webauthn-challenge:*`** eviction just forces the user to retry authentication — annoying but not harmful.
- **DB3 `refresh-token:*`** eviction mid-rotation force-logs-out the legitimate user — see also BUG-220 refresh-token family invalidation logic.

### 5.6 Redis post-deploy verification checklist (BUG-197)
Before first customer traffic:
- [ ] `CONFIG GET maxmemory` on production Redis returns non-zero bounded value
- [ ] `CONFIG GET maxmemory-policy` returns `allkeys-lru`
- [ ] `CONFIG GET maxmemory-reserved` + `maxfragmentationmemory-reserved` sized per Azure Cache capacity (50MB reserved for C-family SKU is typical)
- [ ] Memory-pressure alert rule deployed to monitoring backend
- [ ] `evicted_keys` counter dashboard panel exists
- [ ] Per-DB key-count drift dashboard exists (DB0, DB2, DB3)

---

## 6. Replication harness (deferred work — no BUG row yet)

To move BUG-187 from "mechanism open" to "closed", a replication harness is needed. This is out of scope for Wave A-0 but listed here so future work has scope.

**Proposed harness shape:**
1. Synthetic clinician-session simulator: spawns N virtual clinicians, each opens SSE, runs a mock ambient-note upload (pre-recorded audio), aborts mid-stream at random intervals, repeats
2. Runs for 24-48h against a dev-tier DB
3. Captures pool metrics on a 10-second timeline
4. Correlates leak onset with request class + client-disconnect pattern

**Estimated effort:** 3-5 engineer-days. **Not a bug fix; belongs in Track B test-infrastructure sprint alongside BUG-111 (E2E probe enablement)**.

---

## 7. Overlapping catalogue items (no new bugs filed — process discipline)

The diagnostic surfaced two lines of thought that are **already catalogued** under different IDs. Per plan v3 PART 9.2 scope-control discipline, I must NOT silently insert BUG-260 / BUG-261. Documenting the overlap here instead:

| My proposal | Existing catalogued bug | Action |
|---|---|---|
| BUG-260 "LLM handler pool-hygiene audit" | **BUG-145** (deferred, Phase ρ1 — "LLM/Whisper runs in same Express process"). Moving LLM to BullMQ workers *structurally* eliminates the long-handler-holds-connection class. | NO new bug. Add a cross-reference note to BUG-145 in the catalogue: "includes pool-hygiene audit surfaced during BUG-187 diagnostic 2026-04-20" |
| BUG-261 "pool-pressure alerting" | **BUG-049** (in-scope, Wave B-9 — "Integration health framework missing"). Pool-pressure monitoring belongs in the integration health dashboard + alerting surfaces being built there. | NO new bug. Add a cross-reference note to BUG-049: "must include per-pool utilisation + pressure alerting per BUG-187 follow-up doc" |

Both cross-references require CAB approval to land in the catalogue's change log. Filing them as an amendment, not as new BUG rows, preserves the 255-total immutability declared in plan v3 PART 13.

---

## 8. Escalation triggers — re-open diagnostic under these conditions

If ANY of these fire in staging / canary / production, treat BUG-187 as unresolved and re-open the diagnostic under formal change-control:

1. **Pool-pressure alert (§5.1 Red row) fires at any stage** — mitigation is being overwhelmed
2. **`KnexTimeoutError` log entries observed post-deploy** — guardrails not preventing the originally observed symptom
3. **95p connection lifetime climbs steadily over a week** — accumulation is happening beneath the noise floor
4. **A scheduler logs `tick failed`** — same symptom class as original report
5. **A developer or reviewer identifies the actual `db() inside db.transaction` pattern in a commit** — the preventive rule failed

Re-open triggers require:
- Incident doc at `docs/runbooks/incident-bug-187-<date>.md`
- Wave Owner notified within 2 hours
- CAB review within 24 hours
- Diagnostic session funded (replication harness deployment)

---

## 9. Test-layer distinctions (per reviewer's G.1 framing)

The reviewer correctly distinguished two different test purposes. Both must exist, named appropriately, to satisfy G.1.

### 9.1 Mitigation-regression test (shipping in Wave A-0)
**File:** `apps/api/tests/integration/dbPoolPressure.int.test.ts`
**Claims:** the statement_timeout + idle_in_txn guardrails behave as configured.
**Red-first:** revert afterCreate → tests FAIL because `SHOW statement_timeout` returns 0 + `pg_sleep(35)` hangs. Re-apply → PASS. Both traces attached to PR body.
**What it proves:** the mitigation is in force.
**What it does NOT prove:** the original symptom is eliminated.

### 9.2 Root-cause reproduction test (DEFERRED — not shipping until replication harness §6 exists)
**File:** `apps/api/tests/integration/dbPoolExhaustionReproduction.int.test.ts` (future)
**Claims:** under cloud-shaped load over N minutes, pool utilisation stays bounded AND no connection lingers in state=idle-in-txn past 60s.
**Red-first:** prior to mitigation, test drains pool in ~N minutes via the replication harness. Post-mitigation, pool stays bounded.
**What it proves:** the original symptom class is defeated.
**Status:** not feasible in current dev environment; named in §6 as deferred work.

Reviewer's point preserved: a test that proves the guardrail works is NOT a test that proves the underlying bug class is closed.

---

## 10. Cloud-deploy-specific follow-ups (net-new to this document)

These items are not in the current bug catalogue and are NOT proposed as new BUGs. They are operational discoveries that cloud deploy will need to address via ordinary ops work.

### 10.1 PgBouncer interaction (if adopted)
`db.ts:59` already detects `PGBOUNCER_HOST` and tunes pool sizing. But:
- `statement_timeout` set via `afterCreate` may be reset by pgBouncer connection recycling in transaction mode
- `idle_in_transaction_session_timeout` may never fire if pgBouncer holds the session
- Verify both settings persist across pgBouncer-mediated connections before relying on them as guardrails

**Action before enabling pgBouncer:** run §9.1 mitigation test behind pgBouncer. If fails, the guardrails require different placement (server-side Postgres parameter rather than per-connection SET).

### 10.2 Read-replica behaviour
`rawDbRead` falls back to `appPool` credentials when no replica is configured (db.ts:197-210). Under production with a real replica:
- Connection lifecycle on the replica may differ (different network path, different config)
- Pool pressure on replica may diverge from primary; monitor independently
- Replication lag affects `idle_in_transaction` timing — transactions on primary that read from replica may linger

### 10.3 Multi-pod scaling
When API scales past 1 pod:
- Each pod has its own `appPool` (max=40 per pod)
- N pods × 40 = total Postgres connection budget
- Verify Postgres `max_connections` > N × 40 + safety margin + other consumers (replicas, pgBouncer, migrations)
- Monitor `pg_stat_activity` for total connection count, not per-pod

### 10.4 TCP socket lifecycle (the Candidate B hypothesis from diagnostic)
Cloud load balancers and NAT may TCP-zombie connections when a client disconnects abruptly. Postgres backend may linger until TCP keepalive. Local dev cannot reproduce this reliably.
- Set OS-level TCP keepalive on the API container: `net.ipv4.tcp_keepalive_time = 60`
- Set Postgres `tcp_keepalives_idle = 30` + `tcp_keepalives_interval = 10` + `tcp_keepalives_count = 3`
- Postgres auto-closes zombies within ~1 min of silence rather than the default 2h

### 10.5 Redis persistence mode (deferred from BUG-197)
The BUG-197 fix sets `maxmemory` + eviction policy but does NOT specify persistence (AOF vs RDB). Defaults from `redis:7-alpine` image apply. Persistence interacts with eviction:
- Under RDB-only (default): recent writes between snapshots are lost on restart; eviction doesn't change this
- Under AOF: every write logged; eviction produces AOF entries too
- Under neither: pure in-memory; restart wipes all state including BullMQ queues

Cloud action item: decide explicit persistence mode per Azure Cache tier. Azure Standard tier has RDB by default; Premium can enable AOF. Persistence choice should be reviewed with BUG-049 (integration health) and BUG-168 (backup verification automation).

### 10.6 Redis multi-DB isolation under pressure (new concern from BUG-197 audit)
Signacare uses 4 logical Redis DBs (0-3) for different concerns. `allkeys-lru` eviction operates across the ENTIRE instance — memory pressure in DB1 (rate limits) can evict keys from DB0 (BullMQ jobs). There is no per-DB memory quota in Redis.

Cloud action item: if cross-DB eviction becomes a problem under real load, the plan-v3 deferred item BUG-145 (ρ1 — LLM/Whisper to BullMQ workers) partially mitigates by reducing DB0 + DB2 pressure. Alternative: split into multiple Redis instances per concern (catalogued `rejected_approaches` for BUG-197 flagged this as premature; re-visit if real deploy data justifies).

---

## 11. WebAuthn origin/RP enforcement at the reverse-proxy (BUG-239 residual)

Application-level origin/RPID enforcement is implemented in [apps/api/src/features/auth/webauthnRoutes.ts](../../apps/api/src/features/auth/webauthnRoutes.ts) via `@simplewebauthn/server`'s `verifyRegistrationResponse` / `verifyAuthenticationResponse`. The library rejects any assertion whose `clientDataJSON.origin` is not in `WEBAUTHN_ORIGIN`, and any authenticator-data `rpIdHash` that is not for `WEBAUTHN_RP_ID`. That is the authoritative check.

**Residual concern for cloud deploy:** a misconfigured reverse proxy that fronts the API could let a request arrive with a `Host:` header that does not match any expected origin while the clientDataJSON still looks right. This is defence-in-depth, not a bypass of the crypto check — SimpleWebAuthn will still reject the signature if the origin is wrong — but a proxy that passes unvetted `Host:` headers weakens the audit trail (the application-layer log records the CLAIMED origin from clientData, which may differ from the CONNECTED origin).

### 11.1 Cloud runbook

Before production canary:
- [ ] NGINX / Cloudflare: enforce `Host:` header whitelist. Reject requests whose `Host` header is not in the WEBAUTHN_ORIGIN allowlist at the edge (`server_name` strict matching in NGINX, or a WAF rule in Cloudflare).
- [ ] Azure App Service: configure custom domains + `HTTP_HOST_NAMES` binding so the app only accepts the canonical hostnames.
- [ ] Log access logs with the CONNECTED hostname (via `$host` or `X-Forwarded-Host`) and compare to the application-layer logged origin — divergence is a finding.

### 11.2 Why this is not BUG-239 scope

The BUG-239 root cause (silent MFA bypass via missing crypto verify) is closed by the library integration. Proxy-layer Host-header hygiene is a general cloud-deploy hardening, not a WebAuthn-specific flaw. Track under deployment checklist, not as a new bug row. If real logs during staging surface divergence, promote to a new BUG row at that point.

### 11.3 Env validation is BUG-233, not here

The `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` env vars are documented in `apps/api/.env.example` but startup validation (presence, format, no-default-in-production) is explicitly BUG-233's scope (Wave A-4 env-validator). This doc does not implement or claim that validation.

---

## 12. HL7 outbound — first-lab integration checklist (BUG-238 residual)

BUG-238 closed the silent-drop vector and ships an MLLP dispatcher. Real-lab shakedown still has the usual first-integration risks — track here so the operator catching them at canary has the checklist.

### 12.1 Before first real lab is pointed at production

- [ ] `HL7_LAB_PROTOCOL=mllp` set in production env (BUG-043 Wave A-2 startup validator will enforce this once it lands; until then, this checklist is the gate).
- [ ] `HL7_LAB_HOST` + `HL7_LAB_PORT` point at the lab's own endpoint (not a proxy with cached routing).
- [ ] `HL7_LAB_TIMEOUT` reviewed — default 30s; some labs respond only after a minute for complex panels.
- [ ] ACK-format variance captured — real labs differ on whether `MSA|AA` contains trailing fields, whether NACKs echo original control ID, whether `ACK^R01` vs `ACK` is used. Log the first 5 ACKs in full before declaring green. Tracked under BUG-229.

### 12.2 Certificate / credential expiry

- [ ] MLLP over TCP typically runs inside a private network tunnel (VPN, private link) — confirm tunnel cert expiry is monitored (ties to BUG-234 cert-expiry dashboard).
- [ ] If lab introduces TLS-wrapped MLLP, server-cert expiry joins the same dashboard.

### 12.3 Canary-period observability

- [ ] Hourly query: `SELECT operation, COUNT(*) FROM audit_log WHERE created_at > now() - '1 hour' AND operation LIKE 'HL7_DISPATCH_%' GROUP BY 1` — posts to ops channel.
- [ ] Threshold alert: `HL7_DISPATCH_FAILURE > HL7_DISPATCH_SUCCESS / 10` over any 15-min window.
- [ ] Any `HL7_DISPATCH_HELD_UNCONFIGURED` row after canary promotion is a sev-1 — env drift between release and lab onboarding.

---

## 13. HL7 SFTP / REST dispatcher roadmap (BUG-260 / BUG-261)

BUG-238 scoped to MLLP only (see catalogue amendment). SFTP and REST dispatchers throw `HL7_TRANSPORT_PROTOCOL_UNSUPPORTED` with pointers at BUG-260 and BUG-261 respectively.

### 13.1 Why not ship them now

Shipping SFTP/REST dispatchers without a real lab to validate against would recreate the silent-drop failure class BUG-238 exists to close — placeholder code that looks live but isn't tested. Both rows are now catalogued (B-9 sprint, S1) and blocked-by first-lab onboarding; that blocking relationship is explicit, not implicit.

### 13.2 When a real SFTP or REST lab arrives

1. Unblock BUG-260 (SFTP) or BUG-261 (REST) — set `blocked_by` to `[]`.
2. File the real-lab's spec in the BUG row (`fix_summary` or `open_risks`).
3. Execute via the same propose → review → execute → subagent cycle.
4. Dispatcher becomes a genuine multi-protocol switch — the `PROTOCOL_UNSUPPORTED` branch for the newly-implemented protocol is deleted, the other remains.
5. Integration test must include: credential rotation (keys for SFTP; OAuth/mTLS for REST), landing-directory poll (SFTP) or HTTP 2xx/4xx/5xx mapping (REST), and the full audit_log + admin-alert path already tested for MLLP.

### 13.3 What must NOT happen

Do NOT ship either dispatcher behind a feature flag with the placeholder "ready to enable when a lab appears" — that's exactly the failure mode BUG-238 existed to close. Explicit `PROTOCOL_UNSUPPORTED` rejection is the right posture until the implementation is validated end-to-end.

### 13.4 BUG-278 deploy verification (Ollama prompt-log residual)

`BUG-278` remains a deploy-time check, not an app-runtime check.  
Before any canary promotion where Ollama is enabled:

```bash
OLLAMA_BASE_URL=http://localhost:11434 \
OLLAMA_MODEL=qwen2.5:14b \
OLLAMA_LOG_FILES=/var/log/ollama/server.log \
npm run probe:ollama-log-hygiene -w apps/api
```

Pass criteria:
1. Probe returns exit `0`.
2. Probe confirms no sentinel prompt token appears in configured Ollama logs.

If this fails: treat as containment (`S0/S1` path per current severity policy), disable debug/prompt logging on the Ollama service, rotate affected logs, and rerun until pass.

---

## 14. Change-log for this document

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Executor | Initial version capturing diagnostic findings + reviewer feedback |
| 2026-04-20 | Executor | Added §11 (BUG-239 proxy-layer origin enforcement residual) |
| 2026-04-20 | Executor | Added §12 + §13 (BUG-238 HL7 first-lab checklist + SFTP/REST roadmap) |
| 2026-05-13 | Executor | Added §13.4 BUG-278 Ollama prompt-log verification command + pass/fail containment posture |

---

## 15. Sign-off required before deploy

Before cloud deploy of any Wave A-0 commits touching BUG-187:
- [ ] Reviewer confirms §3 verification items V1-V6 complete
- [ ] Reviewer confirms §4 held items remain held (no stealth expansion of scope)
- [ ] CAB approves catalogue amendment per §2 language (provisional, not declarative)
- [ ] Security Approver sign-off for `afterCreate` change (touches all DB paths)
- [ ] Clinical Safety Approver sign-off for the 30s statement_timeout implication on LLM/scribe workflows
- [ ] Post-deploy monitoring (§5) wired into staging before first canary promotion
- [ ] §10 cloud-specific checks noted in deploy runbook

---

**END**
