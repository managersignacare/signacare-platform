# Class A2 Caller Consistency Sweep Evidence

**Captured:** 2026-05-07  
**Scope:** local-only A2 follow-up slice (`A2-CALLER-CONSISTENCY-SWEEP`)  
**Confidence labels:** per section

## Goal

After centralizing timeout/fallback semantics in `writeAuditLog`, prevent
caller-side drift (ad-hoc `withTimeout` / `Promise.race` wrappers) unless
a caller-level SLA exception is explicitly documented.

## Changes

1. Added policy guard
   [check-write-audit-timeout-policy.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-write-audit-timeout-policy.ts)
   to detect caller wrappers around `writeAuditLog`.
2. Added guard tests
   [check-write-audit-timeout-policy.test.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/__tests__/check-write-audit-timeout-policy.test.ts)
   for pass/fail wrapper scenarios.
3. Added explicit SLA exemption annotation on login audit stage in
   [authController.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/auth/authController.ts):
   `@write-audit-timeout-exempt: ...`.
4. Wired guard into discipline umbrella in [package.json](/Users/drprakashkamath/Projects/Signacare/package.json):
   - `guard:write-audit-timeout-policy`
   - included in `guard:claude-discipline`.
5. Added hard architecture decision artifact:
   [rewrite-vs-remediation-decision-matrix.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/rewrite-vs-remediation-decision-matrix.md).

## Local Verification

### L1 / L2 / L3

- `npx tsc --noEmit -p apps/api/tsconfig.json` PASS
- targeted ESLint PASS on touched files
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-write-audit-timeout-policy.test.ts` PASS
- `npx vitest run --config apps/api/vitest.config.ts apps/api/tests/unit/authControllerAuditObservability.test.ts` PASS
- `npx tsx scripts/guards/check-write-audit-timeout-policy.ts` PASS
- `npm run guard:claude-discipline:ci` PASS (includes new policy guard)

**Confidence:** `HIGH`

## Findings

### Finding A2-CCS-1 — Shared-writer strategy is now mechanically protected

Unapproved caller wrappers around `writeAuditLog` now fail guard checks.

**Confidence:** `HIGH`

### Finding A2-CCS-2 — Login timeout remains explicit, not accidental

The only caller-level timeout exception is annotated with rationale at
the call site.

**Confidence:** `HIGH`

### Finding A2-CCS-3 — Rewrite-vs-remediation choice is now codified

Strategy selection now has hard gates and weighted scoring in a durable
repo artifact, reducing decision drift.

**Confidence:** `HIGH`

## Closure Judgment

`A2-CALLER-CONSISTENCY-SWEEP` local objective: **satisfied**.
