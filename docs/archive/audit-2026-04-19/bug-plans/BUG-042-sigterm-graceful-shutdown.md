# BUG-042 — SIGTERM graceful shutdown handler (L3-refined, all 8 findings absorbed)

**Severity:** S0 | **Track:** A | **Wave:** A-2 | **Date:** 2026-04-21

---

## 1. Metadata

| Field | Value |
|---|---|
| Bug ID | BUG-042 |
| Plan source | EXECUTION-PLAN-v3-FULL §2.1 Wave A-2 |
| Related | BUG-187 (DB pool), BUG-197 (Redis eviction), BUG-202 (BullMQ duplicate enqueue — defence), BUG-035 (ambient consent — WS scribe), BUG-037 (llm_interactions audit) |
| Owner | Reviewer |
| Change-class | risky (server lifecycle + every integration surface) |

## 2. Diagnosis

server.ts had a minimal SIGTERM handler duplicated across HTTPS + HTTP branches. It closed the HTTP server, destroyed the DB pool, and quit Redis — but:
- Did NOT drain 8 BullMQ workers → in-flight jobs killed mid-execution → duplicate enqueue risk
- Did NOT close WebSocket connections → `server.close()` hung waiting on WS upgrades
- Did NOT flip `/ready` to 503 → LB kept routing traffic to a draining pod
- Was not re-entrant safe → double SIGTERM = double shutdown
- Did NOT cancel 8 node-cron schedulers → ticks fired against destroyed DB pool
- Did NOT stop workflow engine → event listeners kept firing
- SSoT violation (HTTP/HTTPS duplication)
- HIPAA 164.312(b) audit-completeness risk from Pino buffer loss on abrupt exit

Classification: **structural** — shutdown is cross-cutting lifecycle concern.

## 3. Approach — priority-based registry (CORRECTED after L3)

Single canonical `shared/gracefulShutdown.ts` with priority buckets:

| Priority | Hook | Why here |
|---|---|---|
| 100 | readiness → not_ready | LB stops routing FIRST |
| 90  | WebSocket close (1001 going-away + 1s grace + terminate) | MUST be > HTTP (80) — `server.close()` waits for WS upgrades |
| 85  | scheduled tasks cancelled | Stop cron before DB pool destroy |
| 80  | HTTP server (closeIdleConnections + close) | Keep-alive TCP drops to 0 immediately |
| 70  | Whisper external process stop | |
| 60  | BullMQ workers drain (current job completes) | Per-worker timeoutMs override: ai=20s, ocr=15s, others=5s |
| 50  | Workflow engine stop | Unregister event listeners |
| 20  | DB pool destroy | |
| 10  | Redis quit | |

Both SIGTERM (orchestrator) and SIGINT (local dev) invoke the same path. Re-entrant via `isShuttingDown` flag — second call logs warning and returns immediately (callers that must wait should await the first call).

Overall 25s deadline tracked; remaining hooks skipped with logged list when exceeded.

## 4. Explicit non-goals (transparent scope)

- Does NOT guarantee exactly-once execution (BUG-202 idempotency is the defence).
- Does NOT guarantee log durability under hard SIGKILL past the 25s budget (BUG-306 Pino sync flush).
- Does NOT guarantee WebSocket client seamless reconnect (client-side responsibility).
- Does NOT drain queued-but-not-started BullMQ jobs — only currently-executing jobs are awaited; queued jobs survive in Redis for next pod.
- Does NOT prevent SIGTERM races during module load (accepted residual — static-import discipline minimises window to startup nanoseconds).

## 5. Reviewer refinement trail

**L3 first review: REJECTED** with 8 substantive findings. All absorbed before any commit:

1. **WebSocket priority fix** — moved from 50 → 90 (BEFORE HTTP close). Previous ordering reproduced the pre-fix `server.close()` hang.
2. **Static top-level imports** in all 7 worker files + scribeStreaming.ts. Removed every `void import('../shared/gracefulShutdown').then(...)` (violated CLAUDE.md §9.6).
3. **Pino priority 5 removed** from header — no-op until BUG-306.
4. **Scheduler drain** — 8 node-cron schedulers + featureFlags `_cleanupTimer` now register at priority 85.
5. **Workflow engine stop** — `stopWorkflowEngine()` wired at priority 50.
6. **Duplicate /ready consolidated** — only `routes/health.ts` handler survives (with shutdown short-circuit).
7. **Stronger tests (T7-T9)** pinning WebSocket-before-HTTP, BullMQ drain, scheduler-before-DB ordering.
8. **Fire-and-forget guard** — run post-commit to verify no new `void import` patterns.

**L3 + L4 + L5 post-refinement: pending on current commit.**

## 6. Implementation outline

**New:**
- `apps/api/src/shared/gracefulShutdown.ts` — registry + runner + isReady + test helpers.
- `apps/api/tests/integration/gracefulShutdown.int.test.ts` — 9 tests.

**Modified:**
- `apps/api/src/server.ts` — static import of registry; replace both shutdown blocks with hook registration + `runGracefulShutdown(signal).finally(process.exit)`; delete duplicate `/ready`.
- `apps/api/src/routes/health.ts` — `/ready` adds shutdown short-circuit at top (static import).
- `apps/api/src/features/patient-outreach/patientOutreachWorker.ts` — register `worker.close()` hook.
- `apps/api/src/jobs/workers/{ai,outlook,sessionCleanup,hl7}Worker.ts` — register hooks (ai=20s, others=5s).
- `apps/api/src/queues/ocrQueue.ts` — register (ocr=15s timeout).
- `apps/api/src/mcp/scribeStreaming.ts` — register at priority 90 with 1001 going-away + terminate fallback.
- `apps/api/src/jobs/bootstrap.ts` — capture scheduler return tasks + register priority-85 stops; register workflowEngine stop at 50.
- `apps/api/src/shared/featureFlags.ts` — register `_cleanupTimer` clear.

## 7. Tests (9 total)

T1 `/ready` 200 pre-shutdown · T2 503 during · T3 idempotent double-call · T4 priority order · T5 hook-throw isolation · T6 per-hook 5s timeout · T7 WS 1001 before HTTP close · T8 BullMQ 2s in-flight job completes · T9 schedulers stop before DB destroy.

## 8. Verification

1. tsc × 3 clean.
2. `node scripts/run-integration-tests.mjs gracefulShutdown` → 9/9 PASS.
3. `npm run guard:no-fire-and-forget` clean.
4. `.github/scripts/check-fix-registry.sh` green.
5. Manual: start server, curl `/ready` → 200; `kill -TERM` → 503 within 100ms; observe per-hook log lines in priority order; exits within 25s.

## 9. Residual risk

Follow-ups filed:
- **BUG-306** (S2 B-9) — Pino sync flush at priority 5.
- **BUG-308** (S3 B-11) — shutdown observability dashboard.

## 10. QA agent verdicts

_Populated post-review._
- **L1 static:** _pending_
- **L2 narrative:** _pending_
- **L3 code judgement:** first pass REJECTED with 8 findings (all absorbed); refined pass pending
- **L4 clinical safety:** _pending_ (in-flight clinical jobs + WebSocket scribe sessions)
- **L5 architecture:** _pending_ (SSoT + priority decomposition)
