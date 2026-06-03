# B2 Evidence — BUG-323 Clozapine Controller Write-Bypass Allowlist Drain

Date: 2026-05-14  
Lane: B2 (Medication and prescribing workflow engine)  
Scope: Local integrity debt drain (no behavior change)

## Decision

Drain stale `check-controller-repo-write-bypass` allowlist rows for clozapine
controller write paths that are already service-owned.

## Why

`apps/api/src/features/clozapine/clozapineController.ts` no longer performs
direct repository writes for:

1. `createAdministration`
2. `createObservation`
3. `upsertMonitoringCheck`

These paths delegate to `clozapineService`, so the old allowlist entries were
stale debt masking true outstanding command-ownership gaps.

## Changes

Updated:

- `scripts/guards/check-controller-repo-write-bypass.allowlist`

Removed 3 stale entries:

1. `clozapineRepository.createAdministration`
2. `clozapineRepository.createObservation`
3. `clozapineRepository.upsertMonitoringCheck`

## Verification

Executed in same session:

1. `npm run guard:controller-repo-write-bypass`  
   PASS (`No controller-side direct repo write calls found`)

## Closure Posture

This is a local regression-prevention hygiene drain under `BUG-323` command
ownership. Rollout closure contract remains pending canary + burn-in evidence.
