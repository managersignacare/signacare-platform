/*
 * apps/api/src/shared/db/optimisticLock.ts
 *
 * BUG-371 — shared optimistic-locking helper.
 *
 * The canonical pattern for column-based optimistic locking on
 * single-row UPDATEs over multi-writer clinical tables (prescriptions,
 * patient_medications, episodes — and treatment_pathways once BUG-402
 * lands).
 *
 * Behaviour:
 *   1. Caller supplies WHERE (id + clinic_id), expected lock_version,
 *      and a patch.
 *   2. Helper validates the call shape (caller must NOT supply
 *      lock_version or updated_at — helper sets both canonically).
 *   3. Builds `WHERE id = ? AND clinic_id = ? AND lock_version = ?`
 *      (the `andWhere` keeps the lock predicate structurally separate
 *      and visible in pino-instrumented Knex query logs).
 *   4. UPDATEs with `lock_version = lock_version + 1` and the patch.
 *   5. RETURNING the explicit column list per CLAUDE.md §1.7.
 *   6. 0 rows returned → throws `AppError(409, 'OPTIMISTIC_LOCK_CONFLICT')`.
 *      Otherwise returns the new row.
 *
 * The helper PREVENTS the silent-double-increment / silent-stale-write
 * class — every concurrent edit either wins or fails LOUD with a 409
 * the caller must surface.
 *
 * Cross-references:
 *   - CLAUDE.md §1.6 (race-condition rules + this helper documented)
 *   - CLAUDE.md §1.7 (explicit returning-columns)
 *   - CLAUDE.md §1.3 (clinic_id required in every multi-tenant query)
 *   - CLAUDE.md §2.1 (transaction-aware: helper honours `trx`)
 *   - apps/api/src/features/clinical-notes/clinicalNote.repository.ts
 *     (HAZARD-006 inline implementation; BUG-371-FOLLOWUP-4 will
 *     refactor it to consume this helper)
 */

import type { Knex } from 'knex';
import { db } from '../../db/db';
import { AppError } from '../errors';

/**
 * Canonical 409 error code for optimistic-lock conflicts. Imported
 * + asserted by helper unit tests so a future rename breaks the
 * contract pin at compile time.
 */
export const OPTIMISTIC_LOCK_CONFLICT_CODE = 'OPTIMISTIC_LOCK_CONFLICT' as const;

/**
 * BUG-567 — redacts tenant-scope identifiers from client-facing conflict
 * details while keeping the row id needed for deterministic retry/debug UX.
 */
export function redactOptimisticLockWhereForClient(
  where: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('id' in where) out.id = where.id;
  return out;
}

export function buildOptimisticLockConflictDetails(
  opts: Pick<OptimisticLockOptions, 'table' | 'where' | 'expectedLockVersion'>,
): Record<string, unknown> {
  return {
    table: opts.table,
    where: redactOptimisticLockWhereForClient(opts.where),
    expectedLockVersion: opts.expectedLockVersion,
    scope: 'clinic_scoped',
  };
}

/**
 * Options for `updateWithOptimisticLock`. Validated by
 * `validateOptimisticLockOptions` (called by the helper but exported
 * for unit-test coverage of the validation contract without DB
 * setup).
 */
export interface OptimisticLockOptions {
  /** Target table name. Must be a real DB table. */
  table: string;
  /**
   * Identifier filters. MUST include `id` AND `clinic_id` per
   * CLAUDE.md §1.3 (multi-tenant defence-in-depth). Additional
   * filters (e.g. `status: 'active'` for state-machine guards) may
   * be added.
   */
  where: Record<string, unknown>;
  /** The version the caller read; helper enforces this matches DB. */
  expectedLockVersion: number;
  /**
   * Columns to update. MUST NOT include `lock_version` or
   * `updated_at` — helper sets both canonically (lock_version =
   * lock_version + 1; updated_at = now). MUST be non-empty.
   */
  patch: Record<string, unknown>;
  /**
   * Explicit RETURNING columns per CLAUDE.md §1.7. MUST include
   * `'lock_version'` so the caller can use the new version on the
   * next mutation.
   */
  returning: ReadonlyArray<string>;
  /**
   * Optional transaction. If provided, the UPDATE executes through
   * the transaction's connection (per CLAUDE.md §2.1 — every query
   * inside a transaction MUST use the trx).
   */
  trx?: Knex.Transaction;
}

/**
 * Pure-logic validation of helper inputs. Exported for unit-test
 * coverage; called automatically by `updateWithOptimisticLock` before
 * any SQL is issued.
 *
 * Each rejection throws a plain `Error` (NOT `AppError`) because these
 * are programmer-misuse signals, not user-facing 4xx/5xx — they
 * should fail loud at development time and never reach a client.
 */
export function validateOptimisticLockOptions(opts: OptimisticLockOptions): void {
  if (
    !Number.isInteger(opts.expectedLockVersion) ||
    opts.expectedLockVersion <= 0 ||
    Number.isNaN(opts.expectedLockVersion)
  ) {
    throw new Error(
      `BUG-371 updateWithOptimisticLock: expectedLockVersion must be a positive integer; got ${String(
        opts.expectedLockVersion,
      )}`,
    );
  }
  if (!opts.where || typeof opts.where !== 'object') {
    throw new Error('BUG-371 updateWithOptimisticLock: where is required');
  }
  if (!('id' in opts.where) || opts.where.id === undefined || opts.where.id === null) {
    throw new Error('BUG-371 updateWithOptimisticLock: where.id is required (single-row mutate)');
  }
  if (
    !('clinic_id' in opts.where) ||
    opts.where.clinic_id === undefined ||
    opts.where.clinic_id === null
  ) {
    throw new Error(
      'BUG-371 updateWithOptimisticLock: where.clinic_id is required (CLAUDE.md §1.3 defence-in-depth)',
    );
  }
  if (!opts.patch || typeof opts.patch !== 'object') {
    throw new Error('BUG-371 updateWithOptimisticLock: patch is required');
  }
  if (Object.keys(opts.patch).length === 0) {
    throw new Error('BUG-371 updateWithOptimisticLock: patch is empty (no-op UPDATE is a misuse signal)');
  }
  if ('lock_version' in opts.patch) {
    throw new Error(
      'BUG-371 updateWithOptimisticLock: patch must NOT include lock_version; helper sets it canonically (lock_version + 1)',
    );
  }
  if ('updated_at' in opts.patch) {
    throw new Error(
      'BUG-371 updateWithOptimisticLock: patch must NOT include updated_at; helper sets it canonically',
    );
  }
  if (!Array.isArray(opts.returning) || opts.returning.length === 0) {
    throw new Error(
      'BUG-371 updateWithOptimisticLock: returning must be a non-empty column list (CLAUDE.md §1.7)',
    );
  }
}

/**
 * Update a single row with optimistic-lock enforcement. Returns the
 * updated row (with bumped `lock_version`) or throws `AppError(409,
 * 'OPTIMISTIC_LOCK_CONFLICT')` if the row's lock_version did not
 * match `expectedLockVersion`.
 *
 * Usage:
 * ```ts
 * const updated = await updateWithOptimisticLock<MedicationRow>({
 *   table: 'patient_medications',
 *   where: { id, clinic_id: auth.clinicId },
 *   expectedLockVersion: dto.expectedLockVersion,
 *   patch: { dose, frequency },
 *   returning: MEDICATION_COLUMNS,
 * });
 * ```
 */
export async function updateWithOptimisticLock<TRow = unknown>(
  opts: OptimisticLockOptions,
): Promise<TRow> {
  validateOptimisticLockOptions(opts);

  const conn = opts.trx ?? db;
  const fullPatch: Record<string, unknown> = {
    ...opts.patch,
    lock_version: db.raw('lock_version + 1'),
    updated_at: new Date(),
  };

  const rows = (await conn(opts.table)
    .where(opts.where)
    .andWhere({ lock_version: opts.expectedLockVersion })
    .update(fullPatch)
    .returning(opts.returning as string[])) as TRow[];

  if (!rows || rows.length === 0) {
    throw new AppError(
      `Concurrent edit detected on ${opts.table} — refresh and try again`,
      409,
      OPTIMISTIC_LOCK_CONFLICT_CODE,
      buildOptimisticLockConflictDetails(opts),
    );
  }
  return rows[0];
}
