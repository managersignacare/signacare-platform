/*
 * BUG-PR-R1-12-FIX-S1-escalations
 *
 * Add `lock_version` integer column to `escalations`.
 *
 * S1 clinical-safety class per L4: ISBAR audit-trail concurrency. The
 * escalation status flow (raised → in_progress → resolved/closed) +
 * ISBAR fields are AHPRA-evidentiary. Concurrent multi-clinician edits
 * during an active escalation must not silently overwrite.
 *
 * UPDATE paths (all in escalation.repository.ts:addEvent +
 * escalation.service.ts callers):
 *   - update (UpdateEscalationSchema)         — REQUIRED expectedLockVersion
 *   - resolve (ResolveEscalationSchema)       — REQUIRED expectedLockVersion
 *   - addNote (AddEscalationNoteSchema)       — REQUIRED expectedLockVersion
 *   - acknowledge (no body schema today)      — preserved as legacy path
 *     with structured warn-log per BUG-371c asymmetric posture
 *     (acknowledged_at idempotency guard already prevents the race)
 *
 * Default 1; NOT NULL. Down() is a NO-OP per BUG-371 precedent.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('escalations', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('escalations', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 precedent — append-only.
}
