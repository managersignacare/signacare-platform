# Class A2 Dedupe Foundation Evidence

**Captured:** 2026-05-07  
**Scope:** local-only A2 foundation slice  
**Confidence labels:** per section

## Goal

Make replayable audit writes idempotent before any timeout-based
auth/audit decoupling is introduced.

## Why This Slice Came Before Timeout-Based Decoupling

**Finding:** the repo already had a Redis-backed audit outbox
([auditOutbox.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/auditOutbox.ts)),
but it only recovered from DB writes that failed fast.

**Structural gap:** if a future A2 step times out a hanging audit write
and re-enqueues the row, append-only `audit_log` would duplicate unless
the DB has a deterministic dedupe key.

**Confidence:** `HIGH`

## Pre-Slice Local DB Posture

Before this slice, local `audit_log` had:

- append-only triggers: present
- RLS policies: present
- `dedupe_key` column: absent
- `uq_audit_log_dedupe_key` constraint: absent

Verified via local `psql` against `signacaredb` on port `5433`.

**Confidence:** `HIGH`

## Slice Changes

1. Added migration
   [20260701000055_bug_login_hang_audit_log_dedupe_key.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/migrations/20260701000055_bug_login_hang_audit_log_dedupe_key.ts)
   to add nullable `audit_log.dedupe_key` plus unique constraint
   `uq_audit_log_dedupe_key`.
2. Added shared helper
   [auditDedupeKey.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/auditDedupeKey.ts)
   with deterministic 5-second bucket key generation.
3. Updated
   [audit.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/utils/audit.ts)
   so new audit writes persist `dedupe_key` and insert with
   `ON CONFLICT (dedupe_key) DO NOTHING`.
4. Updated
   [auditOutbox.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/auditOutbox.ts)
   so replay also uses `ON CONFLICT (dedupe_key) DO NOTHING`.

## Local Verification

### L1 / L2 / L3

- `npx tsc --noEmit -p apps/api/tsconfig.json` PASS
- targeted ESLint PASS on touched A2 files
- `npx vitest run --config vitest.config.ts tests/unit/auditDedupeKey.test.ts tests/auditOutbox.test.ts` in `apps/api` PASS (`11/11`)
- `npm run guard:migration-convention` PASS
- `npm run guard:claude-discipline:ci` PASS

**Confidence:** `HIGH`

### L4 — migration + real DB proof

- `npm run migrate:dev` in `apps/api` PASS  
  Applied: `20260701000055_bug_login_hang_audit_log_dedupe_key.ts`
- post-migration `\d+ audit_log` shows:
  - `dedupe_key character varying(255)`
  - `uq_audit_log_dedupe_key UNIQUE CONSTRAINT`
- `npx vitest run --config vitest.integration.config.ts tests/integration/auditLogDedupe.int.test.ts` PASS (`1/1`)

The integration proof writes the same logical audit event twice in the
same 5-second bucket and verifies exactly one persisted `audit_log` row
for the computed `dedupe_key`.

**Confidence:** `HIGH`

## Findings

### Finding A2-1 — Idempotent replay is now structurally possible on local DB

New audit writes can be safely re-attempted without creating duplicate
append-only rows, provided the replay uses the same `dedupe_key`.

**Confidence:** `HIGH`

### Finding A2-2 — This slice does not yet decouple login from a hanging audit write

This slice intentionally did **not** introduce timeout-based fallback or
change the broader outbox architecture. It only removed the duplicate-row
risk that blocked that next step.

**Confidence:** `HIGH`

## Closure Judgment

**A2 foundation objective for this slice:** satisfied.

## Recommended Next Slice

Proceed to a bounded A2 runtime slice that:

- uses the existing Redis-backed outbox as repo reality
- introduces a bounded audit-write wait on the login path
- only re-enqueues on timeout now that `dedupe_key` makes replay safe
- proves no duplicate `audit_log` rows under timeout/replay conditions
