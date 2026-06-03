/*
 * BUG-PR-R1-12-FIX-S1-mha_reviews
 *
 * Add `lock_version` integer column to `mha_reviews`.
 *
 * S1 clinical-safety class per L4: statutory-review concurrency. The
 * MHA review record (review_type, review_date, outcome, next_review_date,
 * reviewed_by_*) is the canonical evidence of state-mandated mental
 * health act compliance. Concurrent edits during MDT review (multiple
 * clinicians correcting the same review row) must not silently overwrite.
 *
 * Today no feature-level handler exists in apps/api/src/features/ for
 * mha_reviews (table is INSERT-only via seed scripts + presumably an
 * out-of-tree migration path) — column is preventive enforcement so any
 * future UPDATE author MUST route through `updateWithOptimisticLock`
 * per CLAUDE.md §1.6. Sibling pattern of BUG-371a + BUG-402 + BUG-564 +
 * BUG-PR-R1-12-FIX-S0-medication_administrations.
 *
 * Default 1; NOT NULL. Down() is a NO-OP per BUG-371 precedent.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('mha_reviews', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('mha_reviews', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
