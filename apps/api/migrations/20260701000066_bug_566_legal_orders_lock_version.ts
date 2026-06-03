/*
 * BUG-566 — Add `lock_version` optimistic-lock columns to legal-order tables.
 *
 * Scope:
 *   - `patient_legal_orders` (active CRUD surface)
 *   - `legal_orders` (canonical/legal scheduler surface)
 *
 * The legal-order domain is multi-writer in real workflows (intake +
 * clinician + reviewer). Without row-version predicates, PATCH updates
 * can silently overwrite concurrent changes.
 *
 * Down() is intentionally NO-OP (append-only posture) per BUG-371 family:
 * dropping lock columns re-enables silent-overwrite behaviour during
 * rollback windows.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasPatientLegalOrders = await knex.schema.hasColumn('patient_legal_orders', 'lock_version');
  if (!hasPatientLegalOrders) {
    await knex.schema.alterTable('patient_legal_orders', (t) => {
      // R-FIX-BUG-566-MIGRATION-LOCK-VERSION-PATIENT-LEGAL-ORDERS
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }

  const hasLegalOrders = await knex.schema.hasColumn('legal_orders', 'lock_version');
  if (!hasLegalOrders) {
    await knex.schema.alterTable('legal_orders', (t) => {
      // R-FIX-BUG-566-MIGRATION-LOCK-VERSION-LEGAL-ORDERS
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-566 keeps lock_version append-only safety posture.
}
