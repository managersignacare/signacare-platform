# Class B1 Schema Rowtype Pipeline Evidence

**Captured:** 2026-05-07  
**Scope:** local-only B1 slice (`B1-SCHEMA-ROWTYPE-PIPELINE`)  
**Confidence labels:** per section

## Goal

Prove that schema/rowtype generation is canonical, idempotent, and
mechanically enforced against handwritten drift.

## Changes

1. Added canonical regeneration command in [package.json](/Users/drprakashkamath/Projects/Signacare/package.json):
   - `schema:regenerate` → `npm run generate:types-from-migrations --silent`
2. Recorded B1 local verification as a durable artifact (this file).

## Local Verification

### L1 / L2

- `npm run schema:regenerate` PASS
- `git diff --name-only apps/api/src/db/types packages/shared/src/_scaffolds` returned exactly:
  - `apps/api/src/db/types/audit_log.ts`
  - `packages/shared/src/_scaffolds/audit_log.dto.scaffold.ts`
  - `packages/shared/src/_scaffolds/audit_log.response.scaffold.ts`
- `npm run guard:generator-no-diff` surfaced the same 3-file drift (expected pre-commit in this slice)
- `npm run guard:row-iface-drift` PASS
- `npm run guard:code-columns` PASS
- `npm run guard:query-builder-columns` PASS
- `npm run guard:claude-discipline:ci` PASS

**Confidence:** `HIGH`

## Findings

### Finding B1-1 — regeneration is idempotent

Regeneration consistently converged on the same 3 generated `audit_log`
artifacts (no expanding/churning diff set).

**Confidence:** `HIGH`

### Finding B1-2 — drift controls are active

Row↔schema, write-column, and query-column guards all pass on current
snapshot, so handwritten drift is mechanically constrained.

**Confidence:** `HIGH`

### Finding B1-2b — latent generator drift was caught and absorbed

`dedupe_key` existed in migration/runtime but was absent from generated
`audit_log` row/scaffold outputs. B1 absorbed this by updating the 3
generated files rather than hand-editing consuming code.

**Confidence:** `HIGH`

### Finding B1-3 — known partitioning deferral is separate

Audit-log partitioning (`BUG-288`) remains a documented deferred item and
is not part of B1 rowtype-pipeline closure.

**Confidence:** `HIGH`

## Closure Judgment

`B1-SCHEMA-ROWTYPE-PIPELINE` local objective: **satisfied**.
