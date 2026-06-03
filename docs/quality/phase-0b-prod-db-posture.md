# Phase 0b Production-Clone DB Posture Ledger

**Plan source**: `~/.claude/plans/streamed-dazzling-shell.md` (v4)  
**Execution date (start)**: 2026-05-08  
**Owner**: platform remediation execution track  
**Purpose**: run and record the class-blocking posture probes before class-level remediation.

## Rules

1. Every probe must capture: exact command, timestamp, environment, raw output excerpt, verdict.
2. `UNKNOWN` is allowed only before first execution. Never mark `PASS` without runtime evidence.
3. If a probe result blocks a class, that class remains `BLOCKED` until the blocker is closed and re-verified.
4. Use the canonical probe runner when possible: `PHASE0B_DSN="<target-dsn>" npm run probe:phase-0b`
   - Default output: `/tmp/phase-0b-probes-<timestamp>/phase-0b-summary.md`
   - Paste summary + key excerpts into this ledger; raw artifact path must be retained.

## Environment Declaration

- **Target**: production-clone database (not dev scratch DB)
- **DB**: `signacaredb`
- **Roles under test**: `signacare_owner`, `app_user`, any bypass/super roles
- **Operator gate**: required for commands that need production-clone access
- **Local preflight executed**: `localhost:5433` as `drprakashkamath` on 2026-05-08 (Asia/Kolkata).  
  Local results are evidence-only and **cannot** unblock class gates until re-run on production-clone.
- **Local preflight evidence artifact**: [phase-0b-local-probe-evidence-2026-05-08.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/phase-0b-local-probe-evidence-2026-05-08.md)

---

## Probe Register

### 0b.1 — role bypass posture
- **Command**:
  - `psql -c "SELECT rolname, rolbypassrls, rolsuper, rolcreaterole FROM pg_roles ORDER BY rolname"`
- **Blocks class**: `F`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - `signacare_owner | rolbypassrls=t | rolsuper=f`
  - `app_user | rolbypassrls=f | rolsuper=f`
- **Verdict**: `LOCAL-RISK DETECTED` (bypass role present; production-clone confirmation required)

### 0b.2 — audit_log RLS posture
- **Command**:
  - `psql -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='audit_log'"`
- **Blocks class**: `F`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - `audit_log | relrowsecurity=t | relforcerowsecurity=f`
- **Verdict**: `LOCAL-RISK DETECTED` (`FORCE ROW LEVEL SECURITY` not enabled; production-clone confirmation required)

### 0b.3 — audit_log trigger + mutability surface
- **Command**:
  - `psql -c "\\d+ audit_log"`
- **Blocks class**: `F`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - Triggers present: `audit_log_no_update`, `audit_log_no_delete` (`audit_log_prevent_mutation()`)
  - Policy present: `rls_audit_log_tenant`
  - Table includes `dedupe_key` + unique index `uq_audit_log_dedupe_key`
- **Verdict**: `LOCAL-PASS (STRUCTURE ONLY)` (must re-verify on production-clone)

### 0b.4 — schema fingerprint parity
- **Command**:
  - `pg_dump --schema-only --no-owner --no-acl signacaredb | sort | sha256sum`
- **Blocks class**: `B1`, `B2`, `V1`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - Local fingerprint: `481610e71691813d44a8731b451bc871723dafe525f76e422c0f9b193e4340a4`
- **Verdict**: `LOCAL-BASELINE CAPTURED` (parity check blocked until production-clone hash captured)

### 0b.5 — scheduler inventory
- **Command**:
  - `psql -c "\\dt"`
  - `rg -n "BullMQ|cron|setInterval|setTimeout" apps/api/src/jobs -S`
- **Blocks class**: `S`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - 242 relations listed locally via `\dt`
  - Scheduler/worker inventory present in `apps/api/src/jobs/**`:
    - cron schedulers (`node-cron`) for pathology, MHA, clozapine, reminders, etc.
    - timer-based scheduler (`auditOutboxDrainer.ts`)
    - BullMQ worker surfaces (`jobs/workers/**`, bootstrap references)
- **Verdict**: `LOCAL-INVENTORY CAPTURED` (production-clone/runtime deployment topology still required)

### 0b.6 — outbox/inflight audit surface
- **Command**:
  - `psql -c "\\dt audit*"`
  - `rg -n "auditOutbox|audit_outbox|pending_audit" apps/api/src -S`
- **Blocks class**: `A2`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - `\dt audit*` local tables: `audit_log`, `audit_runs`, `audit_templates`
  - Source inventory confirms Redis outbox + drainer pipeline:
    - `apps/api/src/shared/auditOutbox.ts`
    - `apps/api/src/jobs/schedulers/auditOutboxDrainer.ts`
    - `apps/api/src/utils/audit.ts` uses `enqueueAuditOutbox`
- **Verdict**: `LOCAL-INVENTORY CAPTURED` (production-clone topology confirmation required)

### 0b.7 — login path timing baseline
- **Command**:
  - `npm run perf:baseline`
  - runtime traces from login stage timing instrumentation
- **Blocks class**: `A1`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - Canonical runner execution:
    - `PHASE0B_RUN_K6=1 PHASE0B_K6_BASE_URL=http://localhost:4000 PHASE0B_K6_DURATION=60s npm run probe:phase-0b`
    - artifact: [phase-0b-local-probe-evidence-2026-05-08.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/phase-0b-local-probe-evidence-2026-05-08.md)
  - k6 key metrics:
    - `http_req_failed rate=0.00%`
    - `http_req_duration p(95)=15.21ms`
    - `http_req_duration{name:login} p(95)=95.4ms`
- **Verdict**: `LOCAL-PASS (SHORT-RUN)` (production-clone baseline still required for class unblocking)

### 0b.8 — timeout posture
- **Command**:
  - `psql -c "SHOW statement_timeout"`
  - `psql -c "\\l"`
- **Blocks class**: `A2`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - `SHOW statement_timeout;` => `0`
  - `\l` captured DB owner/access posture (`signacaredb` owned by `signacare_owner`, `app_user=c`)
- **Verdict**: `LOCAL-RISK DETECTED` (`statement_timeout=0`; production-clone confirmation required)

### 0b.9 — production sourcemap posture
- **Command**:
  - `cat apps/web/vite.config.ts`
  - `ls apps/web/dist/*.map | wc -l`
- **Blocks class**: `G2`
- **Status**: `LOCAL-PREFLIGHT COMPLETE / PROD-CLONE PENDING`
- **Executed at**: `2026-05-08 (Asia/Kolkata)`
- **Evidence**:
  - `apps/web/vite.config.ts` has no explicit `build.sourcemap` setting
  - local `apps/web/dist/*.map` count: `0`
- **Verdict**: `LOCAL-SIGNAL CAPTURED` (must verify on production artifact pipeline)

---

## Class Gate Summary

| Class | Gate source | Current gate state |
|---|---|---|
| A1 | 0b.7 | BLOCKED (local short-run passed; production-clone baseline pending) |
| A2 | 0b.6, 0b.8 | BLOCKED (local evidence captured; production-clone confirmation pending) |
| B1 | 0b.4 | BLOCKED (local fingerprint captured; production-clone parity pending) |
| B2 | 0b.4 | BLOCKED (local fingerprint captured; production-clone parity pending) |
| F | 0b.1, 0b.2, 0b.3 | BLOCKED (local risk signals found; production-clone confirmation pending) |
| G2 | 0b.9 | BLOCKED (local signal captured; production artifact verification pending) |
| S | 0b.5 | BLOCKED (local inventory captured; production-clone topology pending) |
| V1 | 0b.4 | BLOCKED (local fingerprint captured; production-clone parity pending) |

## Notes

- This ledger is intentionally strict: it tracks posture evidence, not remediation.
- Class execution starts only after required probes have production-clone verdicts (local preflight is non-block-clearing evidence only).
