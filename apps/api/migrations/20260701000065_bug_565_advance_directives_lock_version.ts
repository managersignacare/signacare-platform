/*
 * BUG-565 — Add `lock_version` integer column to `advance_directives`.
 *
 * `advance_directives.content` is JSONB and can be edited by multiple
 * clinicians during active care-planning workflows. Without row-version
 * predicates, concurrent PATCH calls can silently overwrite each other.
 *
 * This migration adds the canonical optimistic-lock column so all UPDATE
 * paths can route through `updateWithOptimisticLock` (BUG-371 helper).
 *
 * Down() is a NO-OP per BUG-371 / BUG-402 / BUG-564 precedent:
 * dropping `lock_version` during rollback silently disables conflict
 * detection for any rolling-window clients still sending versions.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('advance_directives', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('advance_directives', (t) => {
      // R-FIX-BUG-565-MIGRATION-LOCK-VERSION
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-565 follows BUG-371/402/564 append-only
  // rollback posture for lock_version safety.
}

