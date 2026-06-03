# Phase 0b Local Probe Evidence — 2026-05-08

**Execution mode**: local preflight only (non-gate-clearing)  
**Runner**: `npm run probe:phase-0b`  
**Generated at (UTC)**: `2026-05-08T16:31:34Z`  
**Target label**: `local-dev`

## Result Summary

| Probe | Status | Note |
|---|---|---|
| 0b.1 | RISK | bypass/super posture detected for signacare_owner or app_user |
| 0b.2 | RISK | audit_log FORCE RLS is not enabled |
| 0b.3 | PASS | no-update and no-delete triggers present |
| 0b.4 | PASS | schema fingerprint captured |
| 0b.5 | PASS | scheduler inventory captured |
| 0b.6 | PASS | outbox inventory captured |
| 0b.7 | PASS | k6 baseline completed |
| 0b.8 | RISK | statement_timeout is zero |
| 0b.9 | RISK | vite sourcemap posture not explicitly configured |

## Captured Evidence Files

Source runtime directory: `/tmp/phase-0b-probes-20260508-163134`

- `0b.1-role-bypass.txt`
- `0b.2-audit-log-rls.txt`
- `0b.3-audit-log-ddl.txt`
- `0b.4-schema.sha256`
- `0b.5-scheduler-db-inventory.txt`
- `0b.5-scheduler-code-inventory.txt`
- `0b.6-audit-table-inventory.txt`
- `0b.6-audit-code-inventory.txt`
- `0b.7-k6-baseline.txt`
- `0b.7-k6-summary.json`
- `0b.8-statement-timeout.txt`
- `0b.8-db-list.txt`
- `0b.9-sourcemap-posture.txt`

## 0b.7 Local k6 Snapshot

From `0b.7-k6-baseline.txt` (60s run):

- `http_req_failed rate=0.00%`
- `http_req_duration p(95)=15.21ms`
- `http_req_duration{name:login} p(95)=95.4ms`
- `http_req_duration{name:patient_get} p(95)=14.09ms`

## Gate Interpretation

This run is **evidence-only**. It does not unblock classes because v4 requires
production-clone execution for gate-clearing verdicts.
