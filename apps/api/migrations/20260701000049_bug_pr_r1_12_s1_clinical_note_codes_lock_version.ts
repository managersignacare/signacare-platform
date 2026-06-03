/*
 * BUG-PR-R1-12-FIX-S1-clinical_note_codes
 *
 * Add `lock_version` integer column to `clinical_note_codes`.
 *
 * S1 clinical-safety class: coded-diagnoses concurrency. Multiple
 * clinicians may concurrently accept/reject the same AI-suggested
 * ICD-10 code attached to a clinical note (clinicalNote.controller
 * `updateCode`). Silent overwrite of `accepted_by_staff_id` /
 * `rejected_by_staff_id` corrupts the AHPRA-evidentiary attribution
 * chain. UPDATE wired through `updateWithOptimisticLock` in same
 * commit; expectedLockVersion REQUIRED at Zod boundary.
 *
 * Default 1; NOT NULL. Down() is a NO-OP per BUG-371 precedent.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('clinical_note_codes', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('clinical_note_codes', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
