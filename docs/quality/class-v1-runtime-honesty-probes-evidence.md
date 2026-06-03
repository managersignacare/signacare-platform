# Class V1 Runtime Honesty Probes Evidence

**Captured:** 2026-05-07  
**Scope:** local-only V1 slice (`V1-RUNTIME-HONESTY-PROBES`)  
**Confidence labels:** per section

## Goal

Remove fail-open probe behavior across k6, DR restore drill, and Playwright
global setup so verification surfaces cannot silently report false green.

## Changes

1. Added shared fail-closed k6 patient probe helper:
   - [patient.js](/Users/drprakashkamath/Projects/Signacare/scripts/k6/lib/patient.js)
2. Migrated patient-backed k6 scenarios to fail closed in `setup()`:
   - [baseline.js](/Users/drprakashkamath/Projects/Signacare/scripts/k6/baseline.js)
   - [load.js](/Users/drprakashkamath/Projects/Signacare/scripts/k6/load.js)
   - [stress.js](/Users/drprakashkamath/Projects/Signacare/scripts/k6/stress.js)
   - [spike.js](/Users/drprakashkamath/Projects/Signacare/scripts/k6/spike.js)
   - [soak.js](/Users/drprakashkamath/Projects/Signacare/scripts/k6/soak.js)
3. Hardened DR restore drill:
   - [restore-drill.sh](/Users/drprakashkamath/Projects/Signacare/scripts/dr/restore-drill.sh)
   - Requires canonical schema fingerprint baseline.
   - Validates source + restored schema hashes against expected baseline.
   - Fails on zero-row high-volume source/restored tables.
   - Fails when sample patient assertion cannot run.
4. Removed silent Playwright setup suppression:
   - [global-setup.ts](/Users/drprakashkamath/Projects/Signacare/e2e/fixtures/global-setup.ts)
5. Added mechanical guards + tests:
   - [check-k6-thresholds.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-k6-thresholds.ts)
   - [check-dr-drill-asserts-fingerprint.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-dr-drill-asserts-fingerprint.ts)
   - [check-playwright-globalsetup-fail-closed.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-playwright-globalsetup-fail-closed.ts)
   - Guard tests under `scripts/guards/__tests__/...`
6. Wired all 3 guards into `guard:claude-discipline` in [package.json](/Users/drprakashkamath/Projects/Signacare/package.json).

## Local Verification

### L1

- targeted ESLint on all touched V1 files: PASS

### L2

- `npm run guard:k6-thresholds`: PASS
- `npm run guard:dr-drill-fingerprint`: PASS
- `npm run guard:playwright-globalsetup-fail-closed`: PASS
- `npm run guard:claude-discipline:ci`: PASS

### L3

- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-k6-thresholds.test.ts scripts/guards/__tests__/check-dr-drill-asserts-fingerprint.test.ts scripts/guards/__tests__/check-playwright-globalsetup-fail-closed.test.ts`: PASS (`8/8`)

### L4 / L5

- `npm run dr:restore-drill`: **NOT RUN in this slice** (requires expected schema fingerprint baseline + drill-capable DB role)
- `npm run perf:baseline`: **NOT RUN in this slice** (requires running API target + seeded patient data)

**Confidence:** `HIGH` for L1/L2/L3 claims; `NOT VERIFIED IN THIS RUN` for L4/L5.

## Findings

### Finding V1-1 — k6 patient-backed scenarios previously had skip-to-green behavior

Before this slice, missing patient discovery could degrade into per-iteration
`if (!data.patientId) return` paths, allowing low-signal runs.

**Confidence:** `HIGH`

### Finding V1-2 — DR drill truthfulness required stronger validity gates

Restore success alone was insufficient; canonical schema parity and non-empty
clinical table checks are now enforced.

**Confidence:** `HIGH`

### Finding V1-3 — Probe hardening is now mechanically pinned in CI

The new guards are wired into `guard:claude-discipline`, preventing regression
to silent probe behavior without a guard violation.

**Confidence:** `HIGH`

## Closure Judgment

`V1-RUNTIME-HONESTY-PROBES` local static closure: **satisfied** (L1-L3 complete).  
Runtime/live closure: **pending** dedicated L4/L5 run environment.
