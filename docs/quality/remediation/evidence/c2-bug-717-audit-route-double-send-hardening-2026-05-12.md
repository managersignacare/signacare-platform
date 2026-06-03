# C2 Evidence — BUG-717 Audit Route Double-Send Hardening (2026-05-12)

## Scope

- Lane: `C2` (runtime honesty probes and environment fidelity)
- Bug: `BUG-717`
- Surface: `/api/v1/staff-settings/audit-log` during RBAC probe traffic

## Root Cause Summary

1. Client-abort (`close`) during long-running audit-log read could reject the RLS transaction with `"Client disconnected"`.
2. Middleware catch path still flowed through Express error handling when headers were not yet sent.
3. Route flow could continue and attempt a late `res.json(...)` write, producing `ERR_HTTP_HEADERS_SENT`.

## Structural Remediation

1. `apps/api/src/middleware/rlsMiddleware.ts`
   - Treat `"Client disconnected"` as terminal and return from catch without re-entering Express error flow.
2. `apps/api/src/features/staff-settings/staffSettingsRoutes.ts`
   - Added response-liveness guard (`req.aborted`/`req.destroyed`/`res.writableEnded`/`res.headersSent`) before post-query work and final `res.json(...)`.
3. `apps/api/tests/unit/rlsMiddleware.test.ts`
   - Added deterministic regression for disconnect terminal behavior.
   - Updated duplicate-invocation guard test to reflect request-scoped guard architecture.

## Verification

## L1

1. `npm run -s lint:changed` — PASS
2. `npm run -s typecheck` — PASS

## L3

1. `npm run -s test -w apps/api -- tests/unit/rlsMiddleware.test.ts` — PASS (`2/2`)

## L5

1. `NODE_OPTIONS='--trace-warnings' npx playwright test --project=chromium e2e/probes/rbac-matrix.spec.ts --reporter=line` — PASS (`20/20`)
2. Log signature check on `/tmp/bug717-rbac.log`:
   - `ERR_HTTP_HEADERS_SENT` — not present
   - `Cannot set headers after they are sent to the client` — not present
   - `staffSettingsRoutes.ts:598` — not present

## Outcome

- `BUG-717` implementation complete in-repo with deterministic repro replay clean.
- Per release contract, bug remains `open` until canary + burn-in + post-burn-in evidence is attached.
