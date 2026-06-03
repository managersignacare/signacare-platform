/*
 * BUG-PR-R1-12-FIX-S1-shift_handovers
 *
 * Add `lock_version` integer column to `shift_handovers`.
 *
 * S1 clinical-safety class: handover concurrency. Multiple nurses on
 * the same shift may concurrently edit the handover (key_issues /
 * patient_updates / pending_actions / acknowledged_at). Silent
 * overwrite during the high-pressure handover window corrupts the
 * AHPRA Standard 6 clinical-handover record. UPDATE wired through
 * `updateWithOptimisticLock`; expectedLockVersion REQUIRED at Zod
 * boundary.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('shift_handovers', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('shift_handovers', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
