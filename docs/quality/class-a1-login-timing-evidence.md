# Class A1 Login Timing Evidence

**Captured:** 2026-05-07  
**Scope:** local-only A1 evidence run  
**Confidence labels:** per section

## Goal

Determine whether the 30-second login hang is attributable to one of the direct awaited stages in [authController.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/auth/authController.ts).

## Instrumented Stages

The following direct `await` stages in `loginController` were wrapped with `withTiming(...)`:

1. `login.authService.login`
2. `login.importStaffDb`
3. `login.readMustChangePasswordFlag`
4. `login.writeAuditLog`

All four are mechanically enforced by [check-login-path-pino-timing.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-login-path-pino-timing.ts).

## Local Evidence Runs

### Run A — existing dev server on `:4000`

**Command**

```bash
LOGIN_PINO_TIMING=1 k6 run --vus 1 --duration 60s scripts/k6/baseline.js
```

**Observed result**

- request failed with `EOF`
- login p95 = `30s`
- `http_req_failed = 100%`

**Important limitation**

`LOGIN_PINO_TIMING=1` was applied to the k6 client process, not the already-running API server on `:4000`, so this run did **not** emit server-side timing events.

**Confidence:** `HIGH` on the failure signal, `LOW` on stage attribution from this run.

### Run B — fresh instrumented API server on `:4001`

**Server command**

```bash
LOGIN_PINO_TIMING=1 PORT=4001 npm run dev -w apps/api
```

**Client command**

```bash
K6_BASE_URL=http://localhost:4001 k6 run --vus 1 --duration 60s scripts/k6/baseline.js
```

**k6 result**

- login p95 = `94.99ms`
- global p99 = `92.2ms`
- `http_req_failed = 0%`
- 17 completed iterations

**Representative timing events**

```text
kind=TIMING stage=login.authService.login durationMs=81..88
kind=TIMING stage=login.importStaffDb durationMs=0
kind=TIMING stage=login.readMustChangePasswordFlag durationMs=1
kind=TIMING stage=login.writeAuditLog durationMs=0..3
```

**Representative access result**

```text
POST /login status=200 durationMs=88..91
```

**Confidence:** `HIGH`

## Findings

### Finding A1-1 — No direct awaited stage in `loginController` dominates latency on a fresh process

On the fresh instrumented server, every timed stage completed in under `90ms`, and the whole `/login` request completed in about `88–91ms`.

**Confidence:** `HIGH`

### Finding A1-2 — The previously observed 30-second login failure is process-instance-sensitive

The existing server on `:4000` still reproduced the `30s`/`EOF` class, while the fresh server on `:4001` did not.

This means the failure is **not** proven to be an inherent steady-state delay in the direct awaited stages inside `loginController`.

**Confidence:** `HIGH`

### Finding A1-3 — A1 narrows the fault space but does not fully prove the exact root cause

What A1 proves:

- the direct awaited login-controller stages are fast on a fresh process
- no single direct awaited controller stage explains the 30-second hang

What A1 does **not** yet prove:

- whether the `:4000` failure lives in long-lived process state
- whether a degraded dependency path only emerges after uptime
- whether a sibling auth-path surface outside the direct controller waits is the true trigger

**Confidence:** `MEDIUM`

## A1 Closure Judgment

**Local A1 objective:** satisfied.

Reason:

- instrumentation landed
- guard landed
- local L1/L2/L3 passed
- local L4 evidence was captured
- the evidence meaningfully narrowed the fault space

## Recommended A2 Entry Condition

A2 should start with this assumption:

- do **not** treat the controller’s four direct awaited stages as the dominant cause
- reconcile existing [auditOutbox.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/auditOutbox.ts)
- design A2 for a fault that may be process-state-sensitive or outside the narrow controller timing path
