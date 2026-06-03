/*
 * BUG-PR-R1-12-FIX-S0-restrictive_interventions
 *
 * Add `lock_version` integer column to `restrictive_interventions`.
 *
 * S0 patient-harm class per L4: MHA evidentiary corruption — concurrent
 * "end intervention" calls from multiple clinicians during a high-acuity
 * episode could silently overwrite duration_minutes / debrief_notes /
 * notified_persons, corrupting the AHPRA / state Mental Health Act audit
 * record. Unlike BUG-PR-R1-12-FIX-S0-medication_administrations (no
 * UPDATE path today), this table HAS an active UPDATE path:
 * `POST /restrictive-interventions/:id/end` in bedRoutes.ts.
 *
 * The migration adds the column; the route is wired to
 * `updateWithOptimisticLock` in the same commit. Sibling pattern of
 * BUG-371b prescriptions/medications wiring (REQUIRED expectedLockVersion
 * at the Zod boundary; high-harm-class posture).
 *
 * Default 1; NOT NULL. Down() is a NO-OP per BUG-371 precedent.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('restrictive_interventions', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('restrictive_interventions', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent. Dropping lock_version
  // mid-rollback silently disables conflict detection on subsequent
  // UPDATEs. Append-only is safer than rollback-rollforward complexity.
}
