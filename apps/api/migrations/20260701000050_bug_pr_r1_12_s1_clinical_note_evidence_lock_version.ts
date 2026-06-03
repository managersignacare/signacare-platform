/*
 * BUG-PR-R1-12-FIX-S1-clinical_note_evidence
 *
 * Add `lock_version` integer column to `clinical_note_evidence`.
 *
 * S1 clinical-safety class: evidence-link concurrency. Today no
 * feature-level handler exists in apps/api/src/features/ for this
 * table — column is preventive enforcement so any future UPDATE author
 * MUST route through `updateWithOptimisticLock` per CLAUDE.md §1.6.
 * Sibling pattern of BUG-371 + BUG-564.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('clinical_note_evidence', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('clinical_note_evidence', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
