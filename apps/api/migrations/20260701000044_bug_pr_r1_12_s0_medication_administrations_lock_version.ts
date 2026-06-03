/*
 * BUG-PR-R1-12-FIX-S0-medication_administrations
 *
 * Add `lock_version` integer column to `medication_administrations`.
 *
 * Sibling pattern of BUG-371a + BUG-402 + BUG-564. Per L4 clinical-safety
 * grading on BUG-PR-R1-12-CASCADE-DRAIN-OPT-LOCKING this is an S0 entry
 * (LAI/PRN double-administration race — patient harm class). No UPDATE
 * path exists today (the table is INSERT-only via nurseFeatureRoutes
 * MAR write); the column is preventive enforcement so any future UPDATE
 * author (e.g. corrective-amendment workflow, retrospective backfill)
 * MUST route through `updateWithOptimisticLock` per CLAUDE.md §1.6.
 *
 * Default 1; NOT NULL; monotonically incremented by
 * `apps/api/src/shared/db/optimisticLock.ts:updateWithOptimisticLock`.
 *
 * Down() is a NO-OP per the BUG-371 + BUG-564 precedent — dropping
 * lock_version mid-rollback silently disables conflict detection on
 * subsequent UPDATEs. Append-only.
 *
 * Builder-first per CLAUDE.md §12.1 — uses only `knex.schema.alterTable
 * + t.integer().notNullable().defaultTo(1)`.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('medication_administrations', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('medication_administrations', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-PR-R1-12 + BUG-371 precedent. Dropping
  // lock_version mid-rollback silently disables conflict detection.
  // Append-only is safer than rollback-rollforward complexity.
}
