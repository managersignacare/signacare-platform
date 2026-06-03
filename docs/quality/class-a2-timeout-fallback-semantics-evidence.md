# Class A2 Timeout Fallback Semantics Evidence

**Captured:** 2026-05-07  
**Scope:** local-only A2 follow-up slice (`A2-TIMEOUT-FALLBACK-SEMANTICS`)  
**Confidence labels:** per section

## Goal

Move bounded-wait semantics from controller-local login code into the
shared `writeAuditLog` writer so every caller gets the same fail-safe
behavior.

## Changes

1. Added bounded timeout controls inside
   [audit.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/utils/audit.ts):
   - `AUDIT_DB_WRITE_TIMEOUT_MS` (default `2000ms`)
   - `AUDIT_OUTBOX_ENQUEUE_TIMEOUT_MS` (default `1000ms`)
2. Primary insert now uses
   `withTimeout(..., 'audit.write.primaryInsert')`.
3. Legacy-schema fallback is now conditional:
   - only attempted for schema-mismatch failures (`42703` / missing column).
   - non-schema failures skip legacy retry and go straight to outbox.
4. Outbox enqueue is now bounded through
   `enqueueAuditOutboxBounded(..., 'audit.write.enqueueOutbox.*')`.
5. Added unit tests:
   [auditWriteTimeoutFallback.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/auditWriteTimeoutFallback.test.ts)
   covering timeout, schema fallback, direct outbox fallback, and outbox-timeout behavior.
6. Added structural guard:
   [check-bounded-await-in-audit-writer.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-bounded-await-in-audit-writer.ts)
   with fixture tests, and wired it into `guard:claude-discipline`.

## Local Verification

### L1 / L2 / L3

- `npx tsc --noEmit -p apps/api/tsconfig.json` PASS
- targeted ESLint PASS on touched files
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/auditWriteTimeoutFallback.test.ts tests/auditOutbox.test.ts tests/unit/auditDedupeKey.test.ts` PASS (`15/15`)
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-bounded-await-in-audit-writer.test.ts` PASS (`4/4`)
- `npx tsx scripts/guards/check-bounded-await-in-audit-writer.ts` PASS
- `npm run guard:claude-discipline:ci` PASS (includes new audit-writer bounded-await guard)

**Confidence:** `HIGH`

### L4 targeted integration

- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/auditLogDedupe.int.test.ts` PASS (`1/1`)

**Confidence:** `HIGH`

## Findings

### Finding A2-TFS-1 — Shared writer no longer has unbounded DB/outbox waits

`writeAuditLog` now has bounded wait semantics at the writer layer, so
future call sites inherit safe behavior without controller-local wrappers.

**Confidence:** `HIGH`

### Finding A2-TFS-2 — Dedupe invariant still holds under fallback paths

Timeout/fallback logic preserves the existing `dedupe_key` replay
strategy; targeted integration proof remains green.

**Confidence:** `HIGH`

### Finding A2-TFS-3 — Regression prevention is mechanical, not policy-only

Guard + guard-test + discipline-suite wiring prevent silent drift back to
unbounded writer waits.

**Confidence:** `HIGH`

## Closure Judgment

`A2-TIMEOUT-FALLBACK-SEMANTICS` local objective: **satisfied**.
