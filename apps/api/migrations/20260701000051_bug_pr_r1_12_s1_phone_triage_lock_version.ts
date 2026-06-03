/*
 * BUG-PR-R1-12-FIX-S1-phone_triage
 *
 * Add `lock_version` integer column to `phone_triage`.
 *
 * S1 clinical-safety class: triage decision concurrency. Two UPDATE
 * paths exist:
 *   - PUT  /phone-triage/:id (receptionist; admin-scope fields +
 *     receptionist_summary)
 *   - PATCH /phone-triage/:id/clinical-triage (nurse; clinical_risk_flags
 *     + clinical urgency)
 * Concurrent edits across these paths must not silently overwrite —
 * receptionist actionTaken or urgency change racing with nurse risk
 * flag update would corrupt the triage record. Both paths wired
 * through `updateWithOptimisticLock`; expectedLockVersion REQUIRED
 * at Zod boundary.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('phone_triage', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('phone_triage', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
