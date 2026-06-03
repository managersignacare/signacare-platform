/**
 * Phase 0.7.2 #4 — Change CASCADE→RESTRICT on clinical data FKs.
 *
 * Deleting a patient row previously cascaded to delete all their
 * clinical_notes, episodes, medications, prescriptions, and risk
 * assessments. The patient service uses soft-delete (deleted_at),
 * never hard-delete, so the CASCADE was a latent data-loss risk
 * from the original schema.
 *
 * RESTRICT means a hard-delete of a patient will fail with a FK
 * constraint error — which is the correct behaviour for clinical
 * data that must be preserved for audit/legal purposes.
 */
import type { Knex } from 'knex';

const CLINICAL_TABLES = [
  { table: 'clinical_notes', column: 'patient_id', fkName: 'clinical_notes_patient_id_foreign' },
  { table: 'episodes', column: 'patient_id', fkName: 'episodes_patient_id_foreign' },
  { table: 'patient_medications', column: 'patient_id', fkName: 'patient_medications_patient_id_foreign' },
  { table: 'prescriptions', column: 'patient_id', fkName: 'prescriptions_patient_id_foreign' },
  { table: 'risk_assessments', column: 'patient_id', fkName: 'risk_assessments_patient_id_foreign' },
];

export async function up(knex: Knex): Promise<void> {
  for (const { table, column, fkName } of CLINICAL_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;

    // Check if the FK exists with CASCADE
    const fk = await knex.raw(`
      SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = ? AND tc.constraint_name = ?
    `, [table, fkName]);

    if ((fk.rows ?? []).length === 0) continue;
    if (fk.rows[0].delete_rule === 'RESTRICT') continue;

    // Drop and recreate with RESTRICT
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fkName}`);
    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${fkName}
      FOREIGN KEY (${column}) REFERENCES patients(id) ON DELETE RESTRICT
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const { table, column, fkName } of CLINICAL_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fkName}`);
    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${fkName}
      FOREIGN KEY (${column}) REFERENCES patients(id) ON DELETE CASCADE
    `);
  }
}
