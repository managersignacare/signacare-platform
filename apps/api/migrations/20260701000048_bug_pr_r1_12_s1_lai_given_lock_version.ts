/*
 * BUG-PR-R1-12-FIX-S1-lai_given
 *
 * Add `lock_version` integer column to `lai_given`.
 *
 * S1 clinical-safety class: LAI administration audit concurrency.
 * Today repository is INSERT-only (create / findBySchedule /
 * countConsecutiveRefusals); column is preventive enforcement so any
 * future UPDATE author MUST route through `updateWithOptimisticLock`
 * per CLAUDE.md §1.6. Sibling pattern of BUG-371 + BUG-564.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('lai_given', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('lai_given', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
