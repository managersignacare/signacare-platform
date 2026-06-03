# B1/B2/B3 Evidence — BUG-ECT / BUG-TMS Safety-Surface Audit-Log Drain

Date: 2026-05-14  
Lane: B1/B2/B3 (procedures family)  
Scope: `BUG-ECT-*`, `BUG-TMS-*` phase-3 safety-surface audit convergence

## Objective

Remove residual allowlist debt on ECT/TMS mutation audit coverage and make safety-surface forensic logging fail-closed under global CI guarding.

## Changes

1. Canonical audit writer convergence in ECT service:
   - `apps/api/src/features/ect/ectService.ts`
   - `createCourse(...)` and `recordSession(...)` now call `writeAuditLog(...)` directly.
   - Removed non-canonical wrapper usage (`auditLogService.logCreate`).
2. Canonical audit writer convergence in TMS service:
   - `apps/api/src/features/tms/tmsService.ts`
   - `createCourse(...)` and `recordSession(...)` now call `writeAuditLog(...)` directly.
   - Removed non-canonical wrapper usage (`auditLogService.logCreate`).
3. Regression-proof hardening:
   - `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`
   - Added source-level assertions pinning `writeAuditLog(...)` usage and forbidding legacy wrapper usage on ECT/TMS mutation paths.
4. Guard debt drain:
   - `scripts/guards/check-safety-surface-audit-log.allowlist`
   - Removed 4 stale entries (2 ECT + 2 TMS) now that mutation paths are structurally compliant.

## Regression Proof

- `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` => PASS (`8/8`)
- `npm run guard:safety-surface-audit-log` => PASS (validated mutations `14`, allowlist reduced to `7`)
- `npm run guard:all` => PASS

## Outcome

ECT/TMS safety-surface mutation auditing is now enforced by canonical `writeAuditLog(...)` calls and no longer depends on ECT/TMS-specific allowlist exceptions, reducing silent forensic-trail regression risk in B3 procedure workflows.
