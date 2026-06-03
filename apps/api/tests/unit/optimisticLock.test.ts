/*
 * apps/api/tests/unit/optimisticLock.test.ts
 *
 * BUG-371 — pure-logic helper-misuse tests for the `updateWithOptimisticLock`
 * helper at `apps/api/src/shared/db/optimisticLock.ts`.
 *
 * DB-scenario tests (matching version, stale version, two-transaction
 * race, clinic_id mismatch) live in
 * `apps/api/tests/integration/bug371OptimisticLock.int.test.ts` and run
 * via `npm run test:integration` against a live Postgres.
 *
 * These unit tests cover the input-validation contract that does NOT
 * need a database connection: detect helper-misuse at the call boundary
 * BEFORE issuing a SQL query.
 */
import { describe, it, expect } from 'vitest';
import {
  validateOptimisticLockOptions,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  buildOptimisticLockConflictDetails,
} from '../../src/shared/db/optimisticLock';

describe('BUG-371 updateWithOptimisticLock — input validation (helper-misuse)', () => {
  it('OL-VAL-1: canonical OPTIMISTIC_LOCK_CONFLICT code literal exported', () => {
    // The canonical 409 code is part of the API contract — every caller
    // must reference this literal, not invent its own. Pinning it here
    // means a future refactor that renames the literal would break
    // every consumer at compile-time.
    expect(OPTIMISTIC_LOCK_CONFLICT_CODE).toBe('OPTIMISTIC_LOCK_CONFLICT');
  });

  it('OL-VAL-2: rejects caller-supplied lock_version in patch (would silently double-increment)', () => {
    const opts = {
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'c1' },
      expectedLockVersion: 1,
      patch: { status: 'cancelled', lock_version: 5 },
      returning: ['id', 'lock_version'],
    };
    expect(() => validateOptimisticLockOptions(opts)).toThrow(/lock_version/i);
  });

  it('OL-VAL-3: rejects caller-supplied updated_at in patch (helper sets it canonically)', () => {
    const opts = {
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'c1' },
      expectedLockVersion: 1,
      patch: { status: 'cancelled', updated_at: new Date() },
      returning: ['id', 'lock_version'],
    };
    expect(() => validateOptimisticLockOptions(opts)).toThrow(/updated_at/i);
  });

  it('OL-VAL-4: rejects expectedLockVersion <= 0 (defence-in-depth — Zod should already block)', () => {
    const base = {
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'c1' },
      patch: { status: 'cancelled' },
      returning: ['id', 'lock_version'],
    };
    expect(() => validateOptimisticLockOptions({ ...base, expectedLockVersion: 0 })).toThrow();
    expect(() => validateOptimisticLockOptions({ ...base, expectedLockVersion: -1 })).toThrow();
    expect(() => validateOptimisticLockOptions({ ...base, expectedLockVersion: 1.5 })).toThrow();
    expect(() => validateOptimisticLockOptions({ ...base, expectedLockVersion: NaN })).toThrow();
  });

  it('OL-VAL-5: rejects missing id in where (defence-in-depth — single-row mutate must specify id)', () => {
    const opts = {
      table: 'prescriptions',
      where: { clinic_id: 'c1' },
      expectedLockVersion: 1,
      patch: { status: 'cancelled' },
      returning: ['id', 'lock_version'],
    };
    expect(() => validateOptimisticLockOptions(opts)).toThrow(/id/i);
  });

  it('OL-VAL-6: rejects missing clinic_id in where (defence-in-depth per CLAUDE.md §1.3)', () => {
    const opts = {
      table: 'prescriptions',
      where: { id: 'abc' },
      expectedLockVersion: 1,
      patch: { status: 'cancelled' },
      returning: ['id', 'lock_version'],
    };
    expect(() => validateOptimisticLockOptions(opts)).toThrow(/clinic_id/i);
  });

  it('OL-VAL-7: rejects empty returning array (must enumerate columns per CLAUDE.md §1.7)', () => {
    const opts = {
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'c1' },
      expectedLockVersion: 1,
      patch: { status: 'cancelled' },
      returning: [],
    };
    expect(() => validateOptimisticLockOptions(opts)).toThrow(/returning/i);
  });

  it('OL-VAL-8: rejects empty patch (no-op UPDATE is a misuse signal)', () => {
    const opts = {
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'c1' },
      expectedLockVersion: 1,
      patch: {},
      returning: ['id', 'lock_version'],
    };
    expect(() => validateOptimisticLockOptions(opts)).toThrow(/patch/i);
  });

  it('OL-VAL-9: accepts well-formed options (positive baseline)', () => {
    const opts = {
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'c1' },
      expectedLockVersion: 42,
      patch: { status: 'cancelled' },
      returning: ['id', 'lock_version', 'status'],
    };
    expect(() => validateOptimisticLockOptions(opts)).not.toThrow();
  });

  it('OL-VAL-10: conflict details redact clinic_id from client payload (BUG-567)', () => {
    const details = buildOptimisticLockConflictDetails({
      table: 'prescriptions',
      where: { id: 'abc', clinic_id: 'tenant-1', status: 'active' },
      expectedLockVersion: 7,
    });

    expect(details).toEqual({
      table: 'prescriptions',
      where: { id: 'abc' },
      expectedLockVersion: 7,
      scope: 'clinic_scoped',
    });
  });
});
