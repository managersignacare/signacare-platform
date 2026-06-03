// apps/api/migrations/20260701000033_clinics_hpio.ts
//
// BUG-295 — clinics.hpio (HPI-O) column + format CHECK.
//
// Pre-fix: clinics table had no hpio column. erxRestPayloads.ts line 258
// serialised `${el('PrescriberHPIO', c.hpio || '')}` which emitted an
// EMPTY STRING for every ETP1 + ETP2 eRx payload. An HPI-O is mandatory
// under HI Service for any clinic participating in eRx — every
// submission left Signacare with no organisational identifier, an
// instant eRx accreditation failure.
//
// This migration adds the column + structural CHECK constraint. The
// app-layer hard-error (erxRestPayloads throws ERX_NOT_CONFIGURED when
// clinic.hpio is missing) + WARN-mode boot assertion land in the same
// commit.
//
// Column is NULLABLE because:
//   (a) Fresh dev / test / integration-test DBs don't have real HPI-O
//       values assigned (ops populate via admin UI per tenant).
//   (b) 7 existing clinic rows today are all NULL post-migration.
//       Making NOT NULL would fail the migration on any non-empty DB.
//       Tightening to NOT NULL after ops backfill is BUG-316 follow-up.
//
// CHECK constraint enforces format (16 digits starting with 800362) but
// ALLOWS NULL — so the structural defence fires only on INSERT/UPDATE
// with a supplied-but-malformed value, never on the existing NULL rows.
// Luhn checksum enforcement lives at the app layer (BUG-296's
// validateHiNumber) rather than in PL/pgSQL — keeps the migration
// self-contained and avoids a schema-level Luhn function that would
// need to stay in sync with the TS helper.
//
// Standard: HI Service policy requires HPI-O on every eRx submission.
// APP 11.1 security (organisational-identifier integrity).

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinics', (t) => {
    t.string('hpio', 16).nullable();
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinics
      ADD CONSTRAINT clinics_hpio_format_check
      CHECK (hpio IS NULL OR hpio ~ '^800362[0-9]{10}$')
  `);

  // Preflight data audit per plan § eRx boot-assertion rollout
  // protection — log the count of clinics with NULL hpio at migration
  // time so ops can track the backfill progress without querying
  // the DB manually.
  // @migration-raw-exempt: introspection
  const result = await knex.raw<{ rows: Array<{ count: string }> }>(`
    SELECT COUNT(*)::text AS count FROM clinics WHERE hpio IS NULL
  `);
  const nullCount = result.rows?.[0]?.count ?? '0';
  // eslint-disable-next-line no-console
  console.log(`[BUG-295 preflight] clinics with NULL hpio after migration: ${nullCount}. Ops must backfill before STRICT_ERX_HPIO=true.`);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_hpio_format_check');
  await knex.schema.alterTable('clinics', (t) => {
    t.dropColumn('hpio');
  });
}
